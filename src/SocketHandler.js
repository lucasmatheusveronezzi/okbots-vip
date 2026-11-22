'use strict';
const _fs = require('fs');
const _os = require('os');
const _path = require('path');
const BotManager = require('./BotManager');

// Identidade do dono guardada FORA das copias de deploy: sobrevive a restart
// do servidor e a mudanca do ID do Socket.IO. Nunca contem credencial.
const _ARQUIVO_DONO = process.env.OKBOTS_DONO_FILE ||
    _path.join(process.env.LOCALAPPDATA || _os.homedir(), 'OKBOTS', 'dono_fixo.txt');

function _lerDonoFixo() {
    try { return String(_fs.readFileSync(_ARQUIVO_DONO, 'utf8')).trim() || null; }
    catch (e) { return null; }
}

function _salvarDonoFixo(_id) {
    try {
        _fs.mkdirSync(_path.dirname(_ARQUIVO_DONO), { recursive: true });
        if (_id) _fs.writeFileSync(_ARQUIVO_DONO, String(_id).trim(), 'utf8');
        else { try { _fs.unlinkSync(_ARQUIVO_DONO); } catch (e) {} }
    } catch (e) {}
}

// Referencia global de bots (apenas diagnostico). NAO limita as sessoes:
// cada pessoa tem seu limite individual e as outras nao reduzem esse numero.
const _TETO_GLOBAL_BOTS = Number(process.env.MAX_BOTS_GLOBAL || 4000);
const _LIMITE_POR_SESSAO = Number(process.env.MAX_BOTS_POR_SESSAO || 1000);

// Servidores do jogo bloqueados por pedido: os bots NAO entram neles.
const _IPS_JOGO_BLOQUEADOS = new Set([
    '45.76.102.107',
    '130.94.45.154',
    '81.169.165.225',
    '45.77.5.207',
    '139.84.170.60',
    '216.128.169.33'
]);

// Modo "IP direto": somente a sessao do dono (servidor do jogo abaixo) entra
// sem proxy, usando o IP residencial dele. As pessoas continuam de proxy.
// O spawn direto e propositalmente lento para o jogo nao travar.
const _IP_DONO = String(process.env.OKBOTS_IP_DONO || '206.221.176.180');
// Desligado por padrao. Valores: '0' off | IP especifico | '1'/'all' = todas
// as sessoes de pessoas (usado so no teste com outro IP de saida).
const _MODO_DIRETO = String(process.env.OKBOTS_IP_DIRETO || '0').trim().toLowerCase();
const _DIRETO_LIGADO = _MODO_DIRETO !== '0' && _MODO_DIRETO !== '';
const _DIRETO_TODOS = _MODO_DIRETO === '1' || _MODO_DIRETO === 'all' || _MODO_DIRETO === 'todos';
const _LIMITE_DIRETO = Math.max(30, Math.min(_LIMITE_POR_SESSAO,
    Number(process.env.OKBOTS_DIRECT_LIMITE || 200)));

// Skins/cosmetico validados no jogo. Usados APENAS como reparo automatico de
// uma sessao que conectou bots mas nao conseguiu spawn (cosmetic 255 + skin
// antiga). Cada sessao e ajustada separadamente; nenhuma coba de outra.
const _SKINS_REPARO = [
    { code: [255, 255, 255, 0, 0, 0, 19, 135, 12, 11, 3, 9, 3, 11, 3, 9, 3, 11, 3, 9, 12, 11], tag: -1, name: 'OK Bot' },
    { code: [255, 255, 255, 0, 0, 0, 155, 85, 12, 11, 3, 9, 3, 11, 3, 9, 3, 11, 3, 9, 12, 11], tag: -1, name: 'OK Bot' }
];

// O reparo nao pode dar a mesma skin para todo mundo: varia apenas os bytes
// de cor (1,2,3), mantendo o tipo e o padrao que o jogo ja aceitou. A cor e
// derivada do ID da sessao, entao duas pessoas nunca recebem a mesma skin.
function _skinsReparoDaSessao(_id) {
    let _h = 2166136261;
    const _s = String(_id || '');
    for (let _i = 0; _i < _s.length; _i++) {
        _h ^= _s.charCodeAt(_i);
        _h = Math.imul(_h, 16777619);
    }
    return _SKINS_REPARO.map(function (_base, _i) {
        const _code = _base.code.slice();
        const _v = (_h ^ Math.imul(_i + 1, 0x9E3779B1)) >>> 0;
        let _r = (_v >>> 16) & 255;
        let _g = (_v >>> 8) & 255;
        let _b = _v & 255;
        // Evita preto puro (cobra quase invisivel no jogo).
        if (_r + _g + _b < 120) _b = 140;
        _code[1] = _r;
        _code[2] = _g;
        _code[3] = _b;
        return { code: _code, tag: _base.tag, name: _base.name };
    });
}

function _ipDoSocket(_socket) {
    try {
        const _h = (_socket.handshake && _socket.handshake.headers) || {};
        if (_h['cf-connecting-ip']) return String(_h['cf-connecting-ip']).split(',')[0].trim();
        if (_h['x-forwarded-for']) return String(_h['x-forwarded-for']).split(',')[0].trim();
        if (_socket.handshake && _socket.handshake.address) return String(_socket.handshake.address);
        if (_socket.conn && _socket.conn.remoteAddress) return String(_socket.conn.remoteAddress);
    } catch (e) {}
    return 'desconhecido';
}

function _ipDoServidor(_url) {
    if (!_url || typeof _url !== 'string') return '';
    const _m = _url.match(/^wss?:\/\/([^\/:]+)/i);
    return _m ? _m[1] : '';
}

// Alvo guardado no manager DESTA sessao. Passado para a escolha de proxies
// para que outra sessao (em outro servidor/porta) nao decida por ela.
function _alvoDaSessao(_mgr) {
    return {
        host: (_mgr && _mgr._alvoHost) || '',
        porta: (_mgr && _mgr._alvoPorta) || ''
    };
}

class _0x4f8a {
    constructor(_0x2b4c, _onEvento) {
        this._0x1d6e = _0x2b4c;
        this._onEvento = typeof _onEvento === 'function' ? _onEvento : function () {};
        // Uma sessao por conexao Socket.IO: cada pessoa tem seus proprios bots,
        // sua propia contagem, suas propias configuracoes e seu proprio alvo.
        this._sessoes = new Map();
        // Todas as sessoes usam a lista INTEIRA de proxies. Nao ha divisao em
        // fatias: cada sessao pode escolher qualquer proxy da lista completa.
        this._totalProxies = 0;
        // Interruptor do modo IP direto (pode ser mudado em /api/ip-direto).
        this._diretoLigado = _DIRETO_LIGADO;
        this._diretoTodos = _DIRETO_TODOS;
        this._ipDono = _IP_DONO;
        // Sessao fixada como dona pelo painel local (/admin). Tem prioridade
        // sobre qualquer outra regra de identificacao.
        this._donoFixoId = _lerDonoFixo();
        // Sessoes que o usuario tirou do pago explicitamente: continuam nos
        // gratis mesmo sendo as mais antigas ou tendo nome DONO.
        this._semVipIds = new Set();
        // Quando ligado, TODAS as pessoas usam a linha paga rotativa. A
        // divulgacao continua na fonte separada (Proxifly), sem disputa.
        this._vipTodos = String(process.env.OKBOTS_VIP_TODOS || '0').trim() === '1';
        this._0x2f9a();
        // Teto global de emergencia: o container free tem 512 MB e morria
        // (Killed) quando varias sessoes somavam bots demais. Prioriza o dono.
        if (_TETO_GLOBAL_BOTS < 4000) {
            this._timerTetoGlobal = setInterval(() => this._aplicarTetoGlobal(), 1000);
        }
    }

    // Devolve a lista INTEIRA de proxies para a sessao. Sem fatias, sem rodizio
    // de blocos e sem limite artificial de proxies por pessoa.
    _getProxies(_total) {
        this._totalProxies = _total.length;
        return _total;
    }

    // Interruptor usado no teste de outro IP de saida. Nao mexe na extensao.
    getModoIpDireto() {
        return {
            ligado: this._diretoLigado,
            todos: this._diretoTodos,
            ip: this._ipDono,
            limite: _LIMITE_DIRETO
        };
    }

    setModoIpDireto(_op) {
        if (!_op) return this.getModoIpDireto();
        if (typeof _op.ligado === 'boolean') this._diretoLigado = _op.ligado;
        if (typeof _op.todos === 'boolean') this._diretoTodos = _op.todos;
        if (_op.ip) this._ipDono = String(_op.ip);
        return this.getModoIpDireto();
    }

    // Total de bots ativos em TODAS as sessoes (contagem viva dos managers).
    _totalBotsAtivos() {
        let _total = 0;
        for (const _s of this._sessoes.values()) {
            try { _total += _s.mgr.getConnectedCount(); } catch (e) {}
        }
        return _total;
    }

    // Cada sessao tem seu limite PROPRIO e individual. A quantidade de bots
    // das outras sessoes nunca reduz o limite de ninguem: se uma pessoa ligou
    // 1000, as demais continuam podendo subir ate 1000 cada uma.
    _aplicarLimite(_s) {
        const _pedido = (_s.info && typeof _s.info.limite === 'number' && _s.info.limite > 0)
            ? _s.info.limite : _LIMITE_POR_SESSAO;
        const _limite = Math.max(30, Math.min(_pedido, _LIMITE_POR_SESSAO));
        try {
            if (typeof _s.mgr._0xsetBotLimit === 'function') _s.mgr._0xsetBotLimit(_limite);
            else _s.mgr._0x9f2c = _limite;
        } catch (e) {}
        return _limite;
    }

    // Mantem o TOTAL de bots do processo abaixo do teto seguro da maquina.
    // Quem nao e o dono e cortado primeiro; a sessao do dono tem prioridade.
    _aplicarTetoGlobal() {
        if (_TETO_GLOBAL_BOTS >= 4000) return;
        const _ativas = [];
        for (const _s of this._sessoes.values()) {
            if (_s && _s.info && _s.info.ativo && _s.mgr) _ativas.push(_s);
        }
        let _total = 0;
        for (const _s of _ativas) {
            try { _total += _s.mgr.getConnectedCount(); } catch (e) {}
        }
        if (_total <= _TETO_GLOBAL_BOTS) return;
        const _ehDono = (_s) => !!this._donoFixoId &&
            (_s.info.uid === this._donoFixoId || _s.info.id === this._donoFixoId);
        const _corte = _ativas.filter(function (s) { return !_ehDono(s); })
            .concat(_ativas.filter(_ehDono));
        for (const _s of _corte) {
            if (_total <= _TETO_GLOBAL_BOTS) break;
            let _n = 0;
            try { _n = _s.mgr.getConnectedCount(); } catch (e) {}
            if (!_n) continue;
            const _novo = Math.max(0, _n - (_total - _TETO_GLOBAL_BOTS));
            try { _s.mgr._0xsetBotLimit(_novo); } catch (e) {}
            _total -= (_n - _novo);
        }
    }

    // As linhas pagas ficam EXCLUSIVAMENTE com a sessao do dono. Todas as
    // outras pessoas recebem blocos grátis exclusivos e disjuntos — nenhum IP
    // repetido entre elas e nenhuma dividindo a credencial do gateway.
    _distribuirPessoas(_BotManager) {
        const _BM = _BotManager || require('./BotManager');
        const _pessoas = [];
        for (const _x of this._sessoes.values()) {
            const _info = _x.info;
            const _mgr = _x.mgr;
            if (!_info || !_info.ativo || !_mgr) continue;
            if (_info.fonteProxies === 'proxifly') continue;
            if (_info.fonteProxies === 'direto' || _mgr._bypassProxy === true) continue;
            _pessoas.push(_x);
        }
        if (!_pessoas.length) return;
        _pessoas.sort(function (a, b) {
            return (a.info.ligadoEm || 0) - (b.info.ligadoEm || 0) ||
                String(a.info.id).localeCompare(String(b.info.id));
        });

        // O pago e EXCLUSIVO do dono: so vai para a sessao fixada no painel ou
        // marcada com DONO/owner no nome. Nenhuma outra pessoa herda a linha;
        // se nao houver dono identificado, o gateway fica parado em vez de
        // dar o pago para alguem que nao e o dono.
        let _dono = null;
        if (this._donoFixoId && !this._semVipIds.has(this._donoFixoId)) {
            _dono = _pessoas.find(function (_x) {
                return _x.info.uid === this._donoFixoId || _x.info.id === this._donoFixoId;
            }, this) || null;
        }
        if (!_dono) {
            _dono = _pessoas.find(function (_x) {
                if (this._semVipIds.has(_x.info.id) ||
                    (_x.info.uid && this._semVipIds.has(_x.info.uid))) return false;
                if (_x.info.servidorIp && _x.info.servidorIp === this._ipDono) return true;
                return (_x.mgr._0xbotNames || []).some(function (n) {
                    return /dono|owner/i.test(String(n || ''));
                });
            }, this) || null;
        }
        const _outros = _pessoas.filter(function (_x) { return _x !== _dono; });

        const _alvo = _alvoDaSessao(_pessoas[0].mgr);
        const _vip = (_BM._proxiesBrutosPorFonte && _BM._proxiesBrutosPorFonte('vip', _alvo)) || [];
        let _livre = (_BM._proxiesBrutosPorFonte && _BM._proxiesBrutosPorFonte('proxyscrape', _alvo)) || [];
        if (!_livre.length && _BM._proxiesReserva) _livre = _BM._proxiesReserva(_alvo) || [];
        // Dedup para um mesmo IP nunca entrar em dois blocos diferentes.
        _livre = Array.from(new Set(_livre.map(function (p) { return String(p); })));

        const _nBlocos = _outros.length + (_dono ? 1 : 0);
        const _porBloco = Math.max(1, Math.floor(_livre.length / Math.max(1, _nBlocos)));
        const _bloco = function (_k) {
            const _ini = _k * _porBloco;
            const _fim = (_k === _nBlocos - 1) ? _livre.length : (_ini + _porBloco);
            return _livre.slice(_ini, _fim);
        };
        // Nunca guardar/logar a credencial: so um hash da pool para detectar
        // mudancas e reiniciar os bots daquela sessao.
        const _hash = function (_arr) {
            let _h = 2166136261;
            const _s = _arr.join('|');
            for (let _i = 0; _i < _s.length; _i++) {
                _h ^= _s.charCodeAt(_i);
                _h = Math.imul(_h, 16777619);
            }
            return (_h >>> 0).toString(16);
        };

        // Sessoes de teste/diagnostico marcadas com "teste-livre" no nome dos
        // bots nao consomem a linha paga: recebem so um bloco gratuito
        // exclusivo, separado da reserva das pessoas reais.
        const _ehTesteLivre = function (_x) {
            return (_x.mgr._0xbotNames || []).some(function (n) {
                return /teste-livre/i.test(String(n || ''));
            });
        };

        const _aplicar = (_x, _lista, _reserva, _fonte) => {
            if (!_lista || !_lista.length) return;
            // A reserva faz parte da assinatura: quando outra sessao entra/sai,
            // os blocos gratuitos mudam e a sessao antiga precisa receber o
            // bloco novo. Sem isso ela ficava com a lista inteira e as novas
            // com pedacoes dela -> IP repetido quando o pago falhava.
            const _marca = _fonte + ':' + _hash(_lista) + ':' + _hash(_reserva || []);
            if (_x.info._poolAtual === _marca) return;
            const _mgr = _x.mgr;
            try {
                // NUNCA reinicia os bots ao trocar de pool. A lista nova vale
                // para bots novos (e para os que ainda estao conectando); quem
                // ja esta dentro do jogo nao e tocado. Isso vale tambem para
                // a troca gratis -> vip: nenhuma sessao fica em zero.
                const _nova = this._getProxies(_lista);
                if (typeof _mgr._trocarProxies === 'function') {
                    _mgr._trocarProxies(_nova, _reserva);
                } else {
                    _mgr._0x7d9e = _nova;
                    _mgr._0x4b6c = _nova;
                    _mgr._proxyReserva = _reserva;
                    _mgr._proxyFalhas = Object.create(null);
                }
                _x.info.fonteProxies = _fonte;
                _x.info.totalProxies = _lista.length;
                _x.info._poolAtual = _marca;
                console.log('[pool] sessao ' + _x.info.id + ' fonte=' + _fonte +
                    ' proxies=' + _lista.length + ' reserva=' + (_reserva ? _reserva.length : 0) +
                    ' restart=nao');
            } catch (e) {}
        };

        // Liberado pelo administrador: todas as pessoas usam a linha paga
        // rotativa. Cada sessao recebe um bloco gratuito DIFERENTE apenas como
        // reserva. A divulgacao ja foi excluida no inicio deste metodo.
        // Testes marcados com "teste-livre" ficam so no gratuito, para nao
        // disputar banda/limite com a linha das pessoas reais.
        if (this._vipTodos && _vip.length) {
            _pessoas.forEach(function (_x, _i) {
                if (_ehTesteLivre(_x)) {
                    _aplicar(_x, _bloco(_i), null, 'proxyscrape-teste');
                    return;
                }
                _aplicar(_x, _vip.slice(), _bloco(_i), 'vip-todos');
            }, this);
            return;
        }

        if (_dono) {
            if (_vip.length) {
                _aplicar(_dono, _vip.slice(), _bloco(0), 'vip');
            } else {
                _aplicar(_dono, _bloco(0), null, 'proxyscrape-1');
            }
        }
        _outros.forEach(function (_x, _i) {
            const _k = _dono ? _i + 1 : _i;
            _aplicar(_x, _bloco(_k), null, 'proxyscrape-' + (_k + 1));
        }, this);
    }

    // Converte UID estavel (ou ID antigo do socket) na chave salva no arquivo.
    _resolverChave(_chave) {
        if (!_chave) return null;
        const _k = String(_chave);
        for (const _s of this._sessoes.values()) {
            if (_s.info.uid === _k || _s.info.id === _k) return _s.info.uid || _s.info.id;
        }
        return _k;
    }

    // Fixa a linha paga na sessao escolhida no painel. Salvo em disco: vale
    // ate outra sessao ser fixada ou o usuario desfixar.
    fixarDono(_chave) {
        const _k = this._resolverChave(_chave);
        if (_k) this._semVipIds.delete(_k);
        this._donoFixoId = _k;
        _salvarDonoFixo(_k);
        this._distribuirPessoas(BotManager);
        return this._donoFixoId;
    }

    // Desfixar tira a sessao do pago de verdade: ela vai para um bloco gratis
    // e so volta ao pago se o usuario fixar de novo.
    desfixarDono(_chave) {
        // A sessao desfixada fica de fora do pago ate ser fixada de novo.
        // Nenhuma outra pessoa e promovida: o pago e so do dono.
        const _k = this._resolverChave(_chave);
        if (_k) this._semVipIds.add(_k);
        this._donoFixoId = null;
        _salvarDonoFixo(null);
        this._distribuirPessoas(BotManager);
        return null;
    }

    getDonoFixo() {
        return this._donoFixoId;
    }

    getSemVip() {
        return Array.from(this._semVipIds);
    }

    // Interruptor para usar a linha paga rotativa em TODAS as pessoas.
    // A divulgacao fica de fora e nao disputa IP com elas.
    getVipTodos() {
        return { ligado: !!this._vipTodos };
    }

    setVipTodos(_op) {
        if (_op && typeof _op.ligado === 'boolean') this._vipTodos = !!_op.ligado;
        this._distribuirPessoas(BotManager);
        return this.getVipTodos();
    }

    // Nome antigo mantido para nao quebrar chamadas existentes.
    _sincronizarFontes(_BotManager) {
        this._distribuirPessoas(_BotManager);
    }

    _registrar(_tipo, _texto, _info) {
        try {
            this._onEvento({
                tipo: _tipo,
                texto: _texto,
                ts: Date.now(),
                id: _info && _info.id,
                // Somente o IP do servidor do jogo. Nunca o IP da pessoa.
                servidorIp: _info && _info.servidorIp
            });
        } catch (e) {}
    }

    // Retrato usado pelo painel web. Nunca compartilha estado entre sessoes.
    listarSessoes() {
        const _agora = Date.now();
        const _out = [];
        for (const [_id, _s] of this._sessoes) {
            const _i = _s.info;
            let _botsAoAlvo = 0;
            let _botsNoJogo = 0;
            try {
                // Conta apenas bots que realmente entraram no jogo (haveSnakeID),
                // evitando inflar o numero quando o servidor do jogo esta fora.
                _botsAoAlvo = _s.mgr._0x8b5c().filter(function (b) {
                    return b && b.killMode && b.haveSnakeID;
                }).length;
                _botsNoJogo = _s.mgr._0x8b5c().filter(function (b) {
                    return b && b.haveSnakeID;
                }).length;
            } catch (e) {}
            _out.push({
                id: _i.id,
                uid: _i.uid,
                servidorIp: _i.servidorIp,
                conectadoEm: _i.conectadoEm,
                ligadoEm: _i.ligadoEm,
                desligadoEm: _i.desligadoEm,
                ativo: _i.ativo,
                bots: _i.bots,
                limite: _i.limite,
                servidor: _i.servidor,
                servidorIp: _i.servidorIp,
                origin: _i.origin,
                modo: _i.modo,
                alvoId: _i.alvoId,
                alvoNome: _i.alvoNome,
                protocolo: _s.mgr._protocol,
                layout: _s.mgr._spawnLayout,
                cosmetic: _s.mgr._0x4e8f ? _s.mgr._0x4e8f() : undefined,
                tag: _s.mgr._0x9b2a ? _s.mgr._0x9b2a() : undefined,
                skins: (_s.mgr._0xskinCodes || []).map(function (s) { return Array.isArray(s.code) ? s.code.join(',') : String(s); }),
                totalProxies: _i.totalProxies,
                reservaProxies: _s.mgr._proxyReserva ? _s.mgr._proxyReserva.length : 0,
                fonteProxies: _i.fonteProxies,
                direto: _s.mgr._bypassProxy === true,
                limiteDireto: _LIMITE_DIRETO,
                botsNoJogo: _botsNoJogo,
                botsAoAlvo: _botsAoAlvo,
                segundosConectado: Math.floor((_agora - _i.conectadoEm) / 1000)
            });
        }
        return _out;
    }

    _0x2f9a() {
        this._0x1d6e.on('connection', (_0x8f1a) => {
            const _mgr = new BotManager();
            const _h = (_0x8f1a.handshake && _0x8f1a.handshake.headers) || {};
            const _hs = _0x8f1a.handshake || {};
            const _auth = _hs.auth || {};
            const _query = _hs.query || {};
            const _info = {
                id: _0x8f1a.id,
                // UID estavel da extensao (localStorage). Nao muda ao reconectar.
                uid: String(_query.uid || _auth.uid || '').trim() || null,
                ip: _ipDoSocket(_0x8f1a),
                navegador: String(_h['user-agent'] || ''),
                pais: String(_h['cf-ipcountry'] || ''),
                conectadoEm: Date.now(),
                ligadoEm: null,
                desligadoEm: null,
                ativo: false,
                bots: 0,
                limite: null,
                servidor: null,
                servidorIp: '',
                origin: null,
                modo: 'SEGURO',
                alvoId: null,
                alvoNome: null,
                fonteProxies: null,
                totalProxies: 0
            };
            // Ponte usada pelo BotManager para emitir EVENTOS SOMENTE para
            // o socket desta pessoa (botIds, botCount, targetAcquired...).
            const _handler = {
                _0x1d6e: _0x8f1a,
                _0x6d4e: () => { _atualizarBots(); },
                _0x4e7c: function () {}
            };
            // Reparo automatico e LOCAL desta sessao: se os bots conectaram mas
            // nenhum recebeu snakeID, a configuracao de skin/cosmetico foi
            // rejeitada pelo jogo. Aplica os valores validados e reinicia SO
            // os bots desta pessoa, sem tocar nas outras sessoes.
            const _verificarSpawnPreso = () => {
                if (!_info.ativo || !_info.ligadoEm) return;
                // Uma vez por sessao (com cooldown): a extensao reenvia 'start'
                // ao reconectar e isso nao pode reiniciar os bots de novo.
                if (_info._spawnReparadoEm && Date.now() - _info._spawnReparadoEm < 600000) return;
                if (_info._spawnReparado) return;
                if (Date.now() - _info.ligadoEm < 45000) return;
                let _conectados = 0;
                let _noJogo = 0;
                try {
                    const _bots = _mgr._0x8b5c();
                    _conectados = _bots.length;
                    _noJogo = _bots.filter(function (b) { return b && b.haveSnakeID; }).length;
                } catch (e) { return; }
                if (_conectados < 15 || _noJogo > 0) return;
                _info._spawnReparado = true;
                _info._spawnReparadoEm = Date.now();
                try {
                    _mgr._0x3f8b(12);
                    _mgr._0xskinCodes = _skinsReparoDaSessao(_info.id);
                    // Nao reinicia: os bots conectados continuam e os proximos
                    // spawns ja saem com cosmetic/skin validos.
                    this._registrar('config', 'Ajustou skin/cosmetico validos (spawn rejeitado)', _info);
                    console.log('[spawn] sessao ' + _info.id + ' ajustada: cosmetic=12 skins validas (sem restart)');
                } catch (e) {}
            };

            const _atualizarBots = () => {
                try { _info.bots = _mgr._0x1a2b(); } catch (e) {}
                try { _0x8f1a.emit('botCount', _info.bots); } catch (e) {}
                _verificarSpawnPreso();
            };
            _mgr._0x2d5e(_handler);
            // Referencia da sessao usada por _aplicarLimite (evento setBotLimit).
            const _s = { mgr: _mgr, info: _info };
            this._sessoes.set(_0x8f1a.id, _s);
            this._registrar('conectou', 'Conectou ao servidor', _info);

            const _timerContagem = setInterval(_atualizarBots, 1000);

            _0x8f1a.on('disconnect', () => {
                clearInterval(_timerContagem);
                try { _mgr._0xstopAllBots(); } catch (e) {}
                this._registrar('saiu', 'Saiu do servidor', _info);
                this._sessoes.delete(_0x8f1a.id);
                // Se a divulgacao saiu, as pessoas voltam a poder usar a lista
                // unica 'vip' na proxima sincronizacao.
                try { this._sincronizarFontes(require('./BotManager')); } catch (e) {}
            });

            _0x8f1a.on('getBotCount', () => {
                _atualizarBots();
            });

            // Fallback para versoes antigas da extensao: o UID tambem vem por
            // evento, alem da query string do handshake.
            _0x8f1a.on('setUid', (_0xdata) => {
                const _uid = _0xdata && String(_0xdata.uid || '').trim();
                if (!_uid || _info.uid === _uid) return;
                // Se o dono tinha sido fixado pelo ID antigo do socket, migra
                // automaticamente para o UID estavel desta instalacao.
                if (this._donoFixoId === _info.id) {
                    this._donoFixoId = _uid;
                    _salvarDonoFixo(_uid);
                }
                _info.uid = _uid;
                try { this._distribuirPessoas(require('./BotManager')); } catch (e) {}
            });

            _0x8f1a.on('setMode', (_0xdata) => {
                if (!_0xdata || !_0xdata.mode) return;
                if (_0xdata.mode === 'follow' || _0xdata.mode === 'safe') {
                    _mgr._0xclearTarget();
                    if (_info.alvoId) {
                        this._registrar('desligou', 'Parou de atacar ' + (_info.alvoNome || ('#' + _info.alvoId)), _info);
                    }
                    _info.alvoId = null;
                    _info.alvoNome = null;
                    _info.modo = 'SEGURO';
                } else if (_0xdata.mode === 'attack') {
                    _mgr._0xkillMode = true;
                    _info.modo = 'ATAQUE';
                    for (const bot of _mgr._0x8b5c()) {
                        if (bot) bot.killMode = true;
                    }
                }
            });

            _0x8f1a.on('setTargetPlayer', (_0xdata) => {
                if (_0xdata && _0xdata.targetId) {
                    const _ok = _mgr._0xsetTargetPlayer(_0xdata);
                    if (_ok !== false) {
                        let _nome = _0xdata.name;
                        try {
                            const _p = _mgr._0xknownPlayers[_0xdata.targetId];
                            if (!_nome && _p) _nome = _p.name;
                        } catch (e) {}
                        _info.alvoId = _0xdata.targetId;
                        _info.alvoNome = _nome || ('Jogador #' + _0xdata.targetId);
                        _info.modo = 'ATAQUE';
                        this._registrar('atacou', 'Bots indo para ' + _info.alvoNome + ' (#' + _info.alvoId + ')', _info);
                    }
                }
            });

            _0x8f1a.on('setTargetByName', (_0xdata) => {
                if (_0xdata && _0xdata.name) {
                    const _ok = _mgr._0xsetTargetByName(_0xdata.name);
                    if (_ok !== false) {
                        _info.alvoNome = _0xdata.name;
                        try { _info.alvoId = (_mgr._0xtargetPlayer && _mgr._0xtargetPlayer.targetId) || _info.alvoId; } catch (e) {}
                        _info.modo = 'ATAQUE';
                        this._registrar('atacou', 'Bots indo para ' + _info.alvoNome, _info);
                    }
                }
            });

            _0x8f1a.on('getPlayerList', () => {
                _0x8f1a.emit('botIds', _mgr._0xgetBotSnakeIds());
                _0x8f1a.emit('playerList', _mgr._0xgetLivePlayers().map(function (p) {
                    return { targetId: p.targetId, name: p.name, x: p.x, y: p.y };
                }));
            });

            _0x8f1a.on('clearTarget', () => {
                if (_info.alvoId) {
                    this._registrar('desligou', 'Parou de atacar ' + (_info.alvoNome || ('#' + _info.alvoId)), _info);
                }
                _mgr._0xclearTarget();
                _info.alvoId = null;
                _info.alvoNome = null;
                _info.modo = 'SEGURO';
            });

            _0x8f1a.on('updateTargetPos', (_0xdata) => {
                if (_0xdata && _0xdata.x !== undefined && _0xdata.y !== undefined && _mgr._0xkillMode) {
                    _mgr._0xupdateTargetPos(_0xdata.x, _0xdata.y, _0xdata.fresh !== false);
                }
            });

            _0x8f1a.on('start', (_0x9c2d) => {
                const _ipServidor = _ipDoServidor(_0x9c2d && _0x9c2d.ip);
                if (_IPS_JOGO_BLOQUEADOS.has(_ipServidor)) {
                    try { _mgr._0xstopAllBots(); } catch (e) {}
                    _info.ativo = false;
                    _info.bots = 0;
                    _info.limiteEfetivo = 0;
                    this._registrar('bloqueou', 'Servidor do jogo bloqueado: ' + _ipServidor, _info);
                    console.log('[start] SERVIDOR BLOQUEADO ignorado: ' + _ipServidor);
                    try { _0x8f1a.emit('botCount', 0); } catch (e) {}
                    try { _0x8f1a.emit('serverBlocked', { ip: _ipServidor }); } catch (e) {}
                    return;
                }
                _mgr._0x3f7b(_0x9c2d.ip, _0x9c2d.origin);
                if (_0x9c2d) {
                    _info.servidor = _0x9c2d.ip;
                    _info.servidorIp = _ipDoServidor(_0x9c2d.ip);
                    _info.origin = _0x9c2d.origin;
                }
                _info.ativo = true;
                _info.ligadoEm = Date.now();

                const _nomes = Array.isArray(_mgr._0xbotNames)
                    ? _mgr._0xbotNames.map(function (n) { return String(n || '').toLowerCase(); })
                    : [];
                const _ehDivulgacao = _nomes.some(function (n) { return n.indexOf('opencode') !== -1; });
                // Modo normal: so a sessao do dono. 'todos' existe apenas para o
                // teste com outro IP de saida. Divulgacao nunca fica direta.
                const _ehDono = this._diretoLigado && (this._diretoTodos
                    ? !_ehDivulgacao
                    : (_info.servidorIp === this._ipDono ||
                       /^(127\.|::1|::ffff:127\.)/.test(String(_info.ip || ''))));
                const _usarDireto = !!(_0x9c2d && _0x9c2d.bypassProxy) || _ehDono;
                _mgr._setSpawnInfo(_0x9c2d.protocol, _0x9c2d.spawnLayout, _usarDireto);

                // Garante o limite individual desta sessao no start (mesmo se
                // a extensao nao tiver enviado setBotLimit antes). No modo
                // direto ha um teto de seguranca menor para o jogo nao travar.
                _info.limiteEfetivo = this._aplicarLimite(_s);
                this._aplicarTetoGlobal();
                if (_usarDireto && _info.limiteEfetivo > _LIMITE_DIRETO) {
                    _info.limiteEfetivo = _LIMITE_DIRETO;
                    _mgr._0x9f2c = _LIMITE_DIRETO;
                }
                this._registrar('ligou', 'Ligou os bots' +
                    (_info.servidorIp ? ' no servidor ' + _info.servidorIp : '') +
                    (_usarDireto ? ' (IP direto)' : ''), _info);
                _0x8f1a.emit('requestPosition');

                if (_usarDireto) {
                    _info.fonteProxies = 'direto';
                    _info.totalProxies = 0;
                    console.log('[start] IP DIRETO (dono) limite=' + _info.limiteEfetivo);
                    _mgr._0x8c7f();
                    return;
                }

                const _BotManager = require('./BotManager');
                if (!_info.ativo) return;
                if (_ehDivulgacao) {
                    // Divulgacao usa Proxifly exclusiva: nenhum IP em comum com
                    // as pessoas.
                    const _brutos = (_BotManager._proxiesBrutosPorFonte &&
                        _BotManager._proxiesBrutosPorFonte('proxifly', _alvoDaSessao(_mgr))) || [];
                    _info.fonteProxies = 'proxifly';
                    _info.totalProxies = _brutos.length;
                    if (_brutos.length) {
                        _mgr._0x7d9e = this._getProxies(_brutos);
                        _mgr._0x4b6c = _mgr._0x7d9e;
                    } else {
                        _mgr._setSpawnInfo(_0x9c2d.protocol, _0x9c2d.spawnLayout, true);
                        _info.fonteProxies = 'direto';
                    }
                    _mgr._0x8c7f();
                }
                // Pessoas: blocos exclusivos para TODAS as sessoes ativas,
                // inclusive a que acabou de ligar. Quem ja estava rodando
                // tambem troca de pool para nao dividir a credencial unica.
                this._distribuirPessoas(_BotManager);
                // Inicia o spawn APENAS se esta sessao estava parada. Se o
                // intervalo ja existe, nao reinicia — evita zerar os bots.
                if (!_mgr._0xbotInterval) _mgr._0x8c7f();
            });

            _0x8f1a.on('stop', () => {
                // Afeta SOMENTE o manager desta conexao. O manager de outra
                // sessao nunca entra aqui.
                const _antes = _mgr._0x1a2b();
                _mgr._0xstopAllBots();
                console.log('[stop] sessao ' + _info.id + ' bots=' + _antes);
                if (_info.ativo) {
                    this._registrar('desligou', 'Desligou os bots', _info);
                }
                _info.ativo = false;
                _info.desligadoEm = Date.now();
                _info.bots = 0;
                _info.alvoId = null;
                _info.alvoNome = null;
                _info.modo = 'SEGURO';
                _info._poolAtual = null;
                // Quem ficou ligado pode herdar o gateway ou receber um bloco
                // maior. Nenhum IP volta para a sessao que desligou.
                try { this._distribuirPessoas(require('./BotManager')); } catch (e) {}
            });

            _0x8f1a.on('movement', (_0x7d9e) => {
                if (_0x7d9e && typeof _0x7d9e.x !== 'undefined' && typeof _0x7d9e.y !== 'undefined') {
                    _mgr._0x2a5c(_0x7d9e.x, _0x7d9e.y);
                }
            });

            _0x8f1a.on('toggleBoostSpeed', (_0x4e7c) => {
                _mgr._0xsetBoostState(_0x4e7c.shouldBoost);
                for (const bot of _mgr._0x8b5c()) {
                    if (bot && bot.boostSpeed) bot.boostSpeed(_0x4e7c.shouldBoost);
                }
            });

            _0x8f1a.on('toggleZigZagMovement', () => _mgr._0x9c2d());
            _0x8f1a.on('toggleRandomMovement', () => _mgr._0x1f3e());

            _0x8f1a.on('toggleFoodMode', () => {
                const _enabled = _mgr._toggleFoodMode();
                _0x8f1a.emit('foodMode', { enabled: _enabled });
            });

            _0x8f1a.on('getFoodMode', () => {
                _0x8f1a.emit('foodMode', { enabled: _mgr._getFoodMode() });
            });

            _0x8f1a.on('setCosmetic', (_0x5d8a) => {
                if (_0x5d8a && typeof _0x5d8a.cosmetic !== 'undefined') _mgr._0x3f8b(_0x5d8a.cosmetic);
            });

            _0x8f1a.on('setTag', (_0x7c9b) => {
                if (_0x7c9b && typeof _0x7c9b.tag !== 'undefined') _mgr._0x7a9c(_0x7c9b.tag);
            });

            _0x8f1a.on('getCosmeticInfo', () => {
                _0x8f1a.emit('cosmeticInfo', {
                    currentCosmetic: _mgr._0x4e8f(),
                    currentTag: _mgr._0x9b2a()
                });
            });

            _0x8f1a.on('toggleTornadoMovement', () => _mgr._0x3d8f());
            _0x8f1a.on('toggleSpiralMovement', () => _mgr._0xToggleFixedCircle());
            _0x8f1a.on('setTornadoSettings', (_0x6e9f) => {
                if (_0x6e9f) _mgr._0x4f2a(_0x6e9f);
            });

            _0x8f1a.on('tornadoSettings', (_0x6e9f) => {
                if (!_0x6e9f) return;
                try {
                    const buffer = new ArrayBuffer(_0x6e9f.length);
                    const view = new DataView(buffer);
                    const uint8View = new Uint8Array(buffer);
                    for (let i = 0; i < _0x6e9f.length; i++) uint8View[i] = _0x6e9f[i];
                    _mgr._0x4f2a({
                        size: view.getUint16(1, true),
                        separation: view.getUint16(3, true),
                        finalAng: view.getUint8(5),
                        rOC: view.getUint16(6, true) / 100,
                        rotationDir: view.getUint8(8)
                    });
                } catch (error) {}
            });

            _0x8f1a.on('setMovementSettings', (_settings) => {
                if (_settings) _mgr._setMovementSettings(_settings);
            });

            _0x8f1a.on('setBotNames', (_0xdata) => {
                if (_0xdata && Array.isArray(_0xdata.names) && _0xdata.names.length > 0) {
                    _mgr._0xbotNames = _0xdata.names;
                    _mgr._0x2a7c.forEach((bot) => {
                        if (bot) bot.botNames = _0xdata.names;
                    });
                    // O nome "dono"/"owner" identifica a sessao do dono:
                    // reavalia a pool se ele tiver acabado de entrar.
                    try { this._distribuirPessoas(require('./BotManager')); } catch (e) {}
                }
            });

            _0x8f1a.on('setColorSchemes', (_0xdata) => {
                if (!_0xdata || !Array.isArray(_0xdata.schemes) || !_0xdata.schemes.length) return;
                const _0xschemes = _0xdata.schemes.map((_0item) => {
                    if (Array.isArray(_0item)) return { code: _0item, tag: -1, name: '' };
                    if (_0item && Array.isArray(_0item.code)) {
                        return {
                            code: _0item.code,
                            tag: (typeof _0item.tag === 'number') ? _0item.tag : -1,
                            name: _0item.name || ''
                        };
                    }
                    return null;
                }).filter(Boolean);
                if (!_0xschemes.length) return;
                _mgr._0xskinCodes = _0xschemes;
                _mgr._0x2a7c.forEach((bot) => {
                    if (bot) bot.skinCodes = _0xschemes;
                });
            });

            _0x8f1a.on('setBotLimit', (_0xdata) => {
                if (_0xdata && typeof _0xdata.limit === 'number' && _0xdata.limit > 0) {
                    // Teto maximo de 1000 por pessoa. O valor digitado na aba
                    // Limite e respeitado enquanto for <= 1000. Divulgacao
                    // continua com teto fixo de 700.
                    const _ehDivulgacao = _info.fonteProxies === 'proxifly' ||
                        ((_mgr._0xbotNames || []).some(function (n) {
                            return String(n || '').toLowerCase().indexOf('opencode') !== -1;
                        }));
                    // Sessoes de teste marcadas com "teste-pago" continuam na
                    // linha paga, mas com teto baixo: evita esgotar portas
                    // locais sem precisar de ajuste de UAC/TCP no Windows.
                    const _ehTestePago = (_mgr._0xbotNames || []).some(function (n) {
                        return /teste-pago/i.test(String(n || ''));
                    });
                    _info.limite = _ehTestePago
                        ? Math.min(_0xdata.limit, 700)
                        : _ehDivulgacao
                            ? Math.min(_0xdata.limit, 700)
                            : Math.min(_0xdata.limit, _LIMITE_POR_SESSAO);
                    if (_mgr._bypassProxy === true) {
                        _info.limite = Math.min(_info.limite, _LIMITE_DIRETO);
                    }
                    _info.limiteEfetivo = this._aplicarLimite(_s);
                this._aplicarTetoGlobal();
                }
            });

            _0x8f1a.on('error', () => {});
        });
    }
}

module.exports = _0x4f8a;
