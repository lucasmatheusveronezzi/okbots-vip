'use strict';
const BotManager = require('./BotManager');

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

class _0x4f8a {
    constructor(_0x2b4c, _onEvento) {
        this._0x1d6e = _0x2b4c;
        this._onEvento = typeof _onEvento === 'function' ? _onEvento : function () {};
        // Uma sessao por conexao Socket.IO: cada pessoa tem seus proprios bots,
        // sua propia contagem, suas propias configuracoes e seu proprio alvo.
        this._sessoes = new Map();
        this._0x2f9a();
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
            try {
                // Conta apenas bots que realmente entraram no jogo (haveSnakeID),
                // evitando inflar o numero quando o servidor do jogo esta fora.
                _botsAoAlvo = _s.mgr._0x8b5c().filter(function (b) {
                    return b && b.killMode && b.haveSnakeID;
                }).length;
            } catch (e) {}
            _out.push({
                id: _i.id,
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
            const _info = {
                id: _0x8f1a.id,
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
                alvoNome: null
            };
            // Ponte usada pelo BotManager para emitir EVENTOS SOMENTE para
            // o socket desta pessoa (botIds, botCount, targetAcquired...).
            const _handler = {
                _0x1d6e: _0x8f1a,
                _0x6d4e: () => { _atualizarBots(); },
                _0x4e7c: function () {}
            };
            const _atualizarBots = () => {
                try { _info.bots = _mgr._0x1a2b(); } catch (e) {}
                try { _0x8f1a.emit('botCount', _info.bots); } catch (e) {}
            };
            _mgr._0x2d5e(_handler);
            this._sessoes.set(_0x8f1a.id, { mgr: _mgr, info: _info });
            this._registrar('conectou', 'Conectou ao servidor', _info);

            const _timerContagem = setInterval(_atualizarBots, 1000);

            _0x8f1a.on('disconnect', () => {
                clearInterval(_timerContagem);
                try { _mgr._0xstopAllBots(); } catch (e) {}
                this._registrar('saiu', 'Saiu do servidor', _info);
                this._sessoes.delete(_0x8f1a.id);
            });

            _0x8f1a.on('getBotCount', () => {
                _atualizarBots();
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
                _mgr._0x3f7b(_0x9c2d.ip, _0x9c2d.origin);
                if (_0x9c2d) {
                    // Permite proxy: so cai para direto se nenhum HTTP valido existir.
                    _mgr._setSpawnInfo(_0x9c2d.protocol, _0x9c2d.spawnLayout, false);
                    _info.servidor = _0x9c2d.ip;
                    _info.servidorIp = _ipDoServidor(_0x9c2d.ip);
                    _info.origin = _0x9c2d.origin;
                }
                _info.ativo = true;
                _info.ligadoEm = Date.now();
                this._registrar('ligou', 'Ligou os bots' + (_info.servidorIp ? ' no servidor ' + _info.servidorIp : ''), _info);
                _0x8f1a.emit('requestPosition');

                const _BotManager = require('./BotManager');
                _BotManager._prepararProxies(_0x9c2d.ip, function (_validos) {
                    console.log('[start] callback validos=' + (_validos ? _validos.length : 0) + ' ativo=' + _info.ativo);
                    if (!_info.ativo) return; // usuario desligou durante a validacao
                    if (_validos && _validos.length) {
                        _mgr._0x7d9e = _validos;
                    } else {
                        // Sem proxy funcionando: conexao direta como fallback.
                        _mgr._setSpawnInfo(_0x9c2d.protocol, _0x9c2d.spawnLayout, true);
                    }
                    _mgr._0x8c7f();
                });
            });

            _0x8f1a.on('stop', () => {
                _mgr._0xstopAllBots();
                if (_info.ativo) {
                    this._registrar('desligou', 'Desligou os bots', _info);
                }
                _info.ativo = false;
                _info.desligadoEm = Date.now();
                _info.bots = 0;
                _info.alvoId = null;
                _info.alvoNome = null;
                _info.modo = 'SEGURO';
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
                    _info.limite = _0xdata.limit;
                    if (typeof _mgr._0xsetBotLimit === 'function') {
                        _mgr._0xsetBotLimit(_0xdata.limit);
                    } else {
                        _mgr._0x9f2c = _0xdata.limit;
                    }
                }
            });

            _0x8f1a.on('error', () => {});
        });
    }
}

module.exports = _0x4f8a;
