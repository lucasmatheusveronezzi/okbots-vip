'use strict';
const _0x7f4a = require('./Bot');
const _0x3c2d = require('fs');
const _0xnet = require('net');
const _0xws = require('ws');
const _0xsocks = require('socks');

// Proxies gratuitos atualizados automaticamente pelo ProxyScrape (sem cartao).
// A lista vem da API publica e substitui os arquivos estaticos, que ficam
// obsoletos rapidamente. Atualiza a cada 30 minutos para todas as sessoes.
let _proxiesSocks = [];
let _proxiesHttp = [];
// Reserva usada somente quando a fonte autenticada falha: a lista gratuita
// completa, mantida separada para nao misturar IPs entre sessoes.
let _proxiesReservaS = [];
let _proxiesReservaH = [];
// Listas separadas por fonte. Cada sessao usa UMA fonte inteira, sem dividir
// a lista em fatias e sem compartilhar os mesmos IPs com outra sessao.
const _porFonte = {
    proxyscrape: { socks: [], http: [] },
    proxifly: { socks: [], http: [] },
    // Usada APENAS enquanto a divulgacao esta desligada: une as fontes das
    // pessoas com a Proxifly sem dividir em fatias. Se a divulgacao ligar, o
    // SocketHandler volta todas as sessoes de pessoas para 'proxyscrape'.
    vip: { socks: [], http: [] }
};
let _atualizandoProxies = false;
// Quantos bots criar por tick de 1ms. 3 acelera o spawn sem transformar o
// evento em um loop travado (o padrao antigo era 1).
const _BOTS_POR_TICK = Math.max(1, Math.min(10, Number(process.env.BOTS_POR_TICK || 3)));
// No modo IP direto todos os bots saem do MESMO IP. Spawn rapido derruba o
// handshake do jogo, entao vai um bot por vez com intervalo maior.
const _DIRETO_SPAWN_MS = Math.max(60, Math.min(1000, Number(process.env.OKBOTS_DIRECT_SPAWN_MS || 140)));
// Em container pequeno, criar 3 bots por ms abre centenas de handshakes TLS ao
// mesmo tempo e mata o processo por pico de memoria. Padrao local continua 1ms.
const _SPAWN_INTERVAL_MS = Math.max(1, Math.min(500, Number(process.env.OKBOTS_SPAWN_INTERVAL_MS || 1)));
// Cache das listas das PESSOAS. Evita que uma fonte externa fora do ar derrube
// a quantidade de proxies de uma hora para outra. Nunca guarda Proxifly.
const _cacheProxiesPath = require('path').join(require('os').tmpdir(), 'okbots_proxies_usuarios.json');
// Porta do servidor do jogo na sessao atual. Usada para escolher o tipo de
// proxy: HTTP bloqueia portas nao padrao (ex.: 444), SOCKS costuma liberar.
let _portaAlvo = '';
let _hostAlvo = '';

// Diagnostico dos bots (ultimos eventos) expos-to em /api/debug-bots.
const _debugBots = [];
function _registrarDebugBot(_msg) {
    const _texto = String(_msg);
    const _agora = Date.now();
    const _ultimo = _debugBots[_debugBots.length - 1];
    // Erros em massa (proxy morto) nao podem inundar o diagnostico.
    if (_ultimo && _ultimo.msg === _texto && _agora - _ultimo.ts < 1000) {
        _ultimo.qtd = (_ultimo.qtd || 1) + 1;
        _ultimo.ts = _agora;
        return;
    }
    _debugBots.push({ ts: _agora, msg: _texto, qtd: 1 });
    if (_debugBots.length > 100) _debugBots.splice(0, _debugBots.length - 100);
}
function _listarDebugBots() { return _debugBots.slice(-50); }

// Cache de proxies HTTP ja validados contra o servidor do jogo (por IP:porta).
const _cacheProxiesValidos = new Map();

function _hostPortaDoServidor(_server) {
    try {
        const _u = new URL(_server);
        return {
            host: _u.hostname.replace(/^\[|\]$/g, ''),
            porta: Number(_u.port) || (_u.protocol === 'wss:' ? 443 : 80)
        };
    } catch (_e) {
        return null;
    }
}

// Mesmo formato aceito pelo Bot.js: ip:porta, ip:porta:tipo ou
// usuario:senha@host:porta[:tipo]. Nunca imprime a credencial.
function _okParseProxy(_proxy) {
    const _s = String(_proxy || '').trim();
    let _user = null;
    let _pass = null;
    let _endereco = _s;
    const _at = _s.lastIndexOf('@');
    if (_at !== -1) {
        const _cred = _s.slice(0, _at);
        const _sep = _cred.indexOf(':');
        if (_sep !== -1) {
            _user = _cred.slice(0, _sep);
            _pass = _cred.slice(_sep + 1);
        }
        _endereco = _s.slice(_at + 1);
    }
    const _p = _endereco.split(':');
    return {
        host: _p[0],
        port: parseInt(_p[1], 10),
        tipo: _p.length >= 3 ? (parseInt(_p[2], 10) || 5) : 0,
        user: _user,
        pass: _pass
    };
}

function _testarProxyHttp(_proxy, _host, _porta, _ms) {
    return new Promise(function (_res) {
        const _m = _okParseProxy(_proxy);
        if (!_m.host || !Number.isFinite(_m.port)) return _res(false);
        const _sock = _0xnet.connect({ host: _m.host, port: _m.port });
        let _done = false;
        function _fin(_ok) {
            if (_done) return;
            _done = true;
            clearTimeout(_timer);
            try { _sock.destroy(); } catch (_e) {}
            _res(_ok);
        }
        // Timeout explicito: sockets em CONNECT often nao disparam 'timeout'.
        const _timer = setTimeout(function () { _fin(false); }, _ms);
        _sock.setTimeout(_ms);
        _sock.on('connect', function () {
            let _auth = '';
            if (_m.user !== null) {
                const _basic = Buffer.from(_m.user + ':' + (_m.pass || '')).toString('base64');
                _auth = '\r\nProxy-Authorization: Basic ' + _basic;
            }
            _sock.write('CONNECT ' + _host + ':' + _porta + ' HTTP/1.1\r\nHost: ' + _host + ':' + _porta + _auth + '\r\n\r\n');
        });
        _sock.on('data', function (_d) { _fin(_d.toString().indexOf('200') !== -1); });
        _sock.on('timeout', function () { _fin(false); });
        _sock.on('error', function () { _fin(false); });
    });
}

// Teste real: abre o MESMO WebSocket que os bots abrem, pelo proxy. CONNECT
// 200 nao garante que o handshake do jogo funcione (foi o que derrubou os bots).
function _testarProxyWs(_proxy, _serverUrl, _ms) {
    return new Promise(function (_res) {
        let _agent, _ws;
        try {
            const _HttpsProxyAgent = require('https-proxy-agent');
            _agent = new _HttpsProxyAgent('http://' + _proxy);
        } catch (_e) { return _res(false); }
        let _done = false;
        function _fin(_ok) {
            if (_done) return;
            _done = true;
            clearTimeout(_timer);
            try { if (_ws) _ws.terminate(); } catch (_e) {}
            _res(_ok);
        }
        const _timer = setTimeout(function () { _fin(false); }, _ms);
        try {
            _ws = new _0xws(_serverUrl, {
                agent: _agent,
                handshakeTimeout: _ms,
                headers: {
                    'Origin': 'https://slither.io',
                    'Host': new URL(_serverUrl).host
                }
            });
            _ws.on('open', function () { _fin(true); });
            _ws.on('error', function () { _fin(false); });
        } catch (_e) { _fin(false); }
    });
}

// Mesmo teste para SOCKS4/SOCKS5 (agente SOCKS + handshake real).
function _testarProxySocks(_proxy, _serverUrl, _ms) {
    return new Promise(function (_res) {
        const _p = _okParseProxy(_proxy);
        let _agent, _ws;
        try {
            const _cfg = { ipaddress: _p.host, port: _p.port, type: _p.tipo || 5 };
            if (_p.user !== null) {
                _cfg.userId = _p.user;
                _cfg.password = _p.pass || '';
            }
            _agent = new _0xsocks.Agent({ proxy: _cfg });
        } catch (_e) { return _res(false); }
        let _done = false;
        function _fin(_ok) {
            if (_done) return;
            _done = true;
            clearTimeout(_timer);
            try { if (_ws) _ws.terminate(); } catch (_e) {}
            _res(_ok);
        }
        const _timer = setTimeout(function () { _fin(false); }, _ms);
        try {
            _ws = new _0xws(_serverUrl, {
                agent: _agent,
                handshakeTimeout: _ms,
                headers: {
                    'Origin': 'https://slither.io',
                    'Host': new URL(_serverUrl).host
                }
            });
            _ws.on('open', function () { _fin(true); });
            _ws.on('error', function () { _fin(false); });
        } catch (_e) { _fin(false); }
    });
}

// Valida HTTP e SOCKS com handshake WebSocket real e devolve uma unica lista.
// SOCKS entra como ip:porta:tipo; HTTP como ip:porta (o Bot.js decide pelo formato).
function _prepararProxies(_server, _cb) {
    console.log('[ProxyScrape] validando WS para ' + _server + ' (' + _proxiesHttp.length + ' HTTP / ' + _proxiesSocks.length + ' SOCKS)');
    const _hp = _hostPortaDoServidor(_server);
    if (!_hp || (!_proxiesHttp.length && !_proxiesSocks.length)) return _cb([]);
    let _caminho = '';
    try { _caminho = new URL(_server).pathname; } catch (_e) {}
    const _chave = _hp.host + ':' + _hp.porta + _caminho;
    const _cached = _cacheProxiesValidos.get(_chave);
    if (_cached && Date.now() - _cached.ts < 5 * 60 * 1000) return _cb(_cached.lista);
    // Testa ate 600 de cada tipo em lotes (evita abrir milhares de sockets de uma vez).
    const _amostraHttp = _proxiesHttp.slice(0, 600);
    const _amostraSocks = _proxiesSocks.slice(0, 600);
    const _validos = [];
    (async function () {
        for (const _grupo of [
            { lista: _amostraHttp, teste: _testarProxyWs },
            { lista: _amostraSocks, teste: _testarProxySocks }
        ]) {
            for (let _i = 0; _i < _grupo.lista.length; _i += 400) {
                const _lote = _grupo.lista.slice(_i, _i + 400);
                const _resultados = await Promise.all(_lote.map(function (_p) { return _grupo.teste(_p, _server, 2500); }));
                for (let _j = 0; _j < _lote.length; _j++) if (_resultados[_j]) _validos.push(_lote[_j]);
            }
        }
        _cacheProxiesValidos.set(_chave, { ts: Date.now(), lista: _validos });
        _registrarDebugBot('[ProxyScrape] ' + _validos.length + ' proxies validos (WS) para ' + _chave + ' (HTTP ' + _amostraHttp.length + ' + SOCKS ' + _amostraSocks.length + ')');
        _cb(_validos);
    })().catch(function (_e) {
        _registrarDebugBot('[ProxyScrape] falha na validacao: ' + (_e && _e.message ? _e.message : _e));
        _cb([]);
    });
}

function _statusProxies() {
    const _cache = {};
    for (const [_k, _v] of _cacheProxiesValidos) _cache[_k] = { validos: _v.lista.length, idade: Date.now() - _v.ts };
    return { httpBrutos: _proxiesHttp.length, socksBrutos: _proxiesSocks.length, validados: _cache };
}

function _parseProxyLinha(_linha) {
    const _s = String(_linha || '').trim();
    if (!_s) return null;
    let _m = _s.match(/^(socks4|socks5|http):\/\/([^:\/]+):(\d+)/i);
    if (_m) return { tipo: _m[1].toLowerCase(), ip: _m[2], porta: _m[3] };
    _m = _s.match(/^([^:\/]+):(\d+)$/);
    if (_m) return { tipo: 'socks5', ip: _m[1], porta: _m[2] };
    return null;
}

async function _atualizarProxiesAutomaticamente() {
    if (_atualizandoProxies) return;
    _atualizandoProxies = true;
    let _cacheS = [];
    let _cacheH = [];
    // Declaradas fora do try: o proxy autenticado deve funcionar mesmo se as
    // fontes publicas estiverem fora do ar.
    let _authS = [];
    let _authH = [];
    try {
        const _c = JSON.parse(_0x3c2d.readFileSync(_cacheProxiesPath, 'utf8'));
        if (Array.isArray(_c.socks)) _cacheS = _c.socks;
        if (Array.isArray(_c.http)) _cacheH = _c.http;
    } catch (_ec) {}

    // Lista autenticada opcional (proxy pago com login/senha). O caminho vem
    // de OKBOTS_PROXY_AUTH_FILE (arquivo local) ou o conteudo vem de
    // OKBOTS_PROXY_AUTH_CONTEUDO (variavel secreta na nuvem). Nada disso fica
    // no codigo nem no chat.
    // Linhas repetidas sao descartadas (o arquivo pode ter milhares de copias
    // do mesmo endpoint).
    try {
        const _arquivoAuth = String(process.env.OKBOTS_PROXY_AUTH_FILE || '').trim();
        const _conteudoAuth = String(process.env.OKBOTS_PROXY_AUTH_CONTEUDO || '').trim();
        const _textoAuth = _conteudoAuth || (_arquivoAuth ? _0x3c2d.readFileSync(_arquivoAuth, 'utf8') : '');
        if (_textoAuth) {
            const _vAuthS = new Set();
            const _vAuthH = new Set();
            for (const _linha of _textoAuth.split(/\r?\n/)) {
                const _s = _linha.trim();
                if (!_s || _s.indexOf('@') === -1) continue;
                const _p = _okParseProxy(_s);
                if (!_p.host || !Number.isFinite(_p.port)) continue;
                if (_p.tipo > 0) {
                    if (!_vAuthS.has(_s)) { _vAuthS.add(_s); _authS.push(_s); }
                } else if (!_vAuthH.has(_s)) {
                    _vAuthH.add(_s); _authH.push(_s);
                }
            }
            console.log('[ProxyAuth] ' + _authS.length + ' SOCKS / ' + _authH.length + ' HTTP (unicos)');
        }
    } catch (_ea) {
        console.warn('[ProxyAuth] falha ao ler credencial: ' + (_ea && _ea.message ? _ea.message : _ea));
    }

    // Nuvem com memoria limitada: quando ha credencial paga, nao carrega as
    // listas publicas (dezenas de milhares de linhas). Somente a linha paga.
    if (String(process.env.OKBOTS_SO_PROXY_PAGO || '').trim() === '1' && (_authS.length || _authH.length)) {
        _porFonte.vip.socks = _authS;
        _porFonte.vip.http = _authH;
        _proxiesSocks = _authS;
        _proxiesHttp = _authH;
        _proxiesReservaS = _authS;
        _proxiesReservaH = _authH;
        console.log('[Proxies] modo somente-pago: ' + _authS.length + ' SOCKS / ' + _authH.length + ' HTTP');
        _atualizandoProxies = false;
        return;
    }

    try {
        const _resp = await fetch('https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text', {
            signal: AbortSignal.timeout(15000)
        });
        if (!_resp.ok) throw new Error('HTTP ' + _resp.status);
        const _texto = await _resp.text();
        const _scrapeS = [];
        const _scrapeH = [];
        for (const _linha of _texto.split(/\r?\n/)) {
            const _p = _parseProxyLinha(_linha);
            if (!_p) continue;
            if (_p.tipo === 'http') {
                _scrapeH.push(_p.ip + ':' + _p.porta);
            } else {
                _scrapeS.push(_p.ip + ':' + _p.porta + ':' + (_p.tipo === 'socks4' ? '4' : '5'));
            }
        }
        // Segunda fonte (proxifly): ~12 mil proxies. Fica GUARDADA SEPARADA
        // para poder ser dada inteira a uma sessao sem dividir em fatias.
        const _flyS = [];
        const _flyH = [];
        try {
            const _r2 = await fetch('https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt', {
                signal: AbortSignal.timeout(15000)
            });
            if (_r2.ok) {
                const _t2 = await _r2.text();
                for (const _linha of _t2.split(/\r?\n/)) {
                    const _p = _parseProxyLinha(_linha);
                    if (!_p) continue;
                    if (_p.tipo === 'http') {
                        _flyH.push(_p.ip + ':' + _p.porta);
                    } else {
                        _flyS.push(_p.ip + ':' + _p.porta + ':' + (_p.tipo === 'socks4' ? '4' : '5'));
                    }
                }
            }
        } catch (_e2) {}

        // Terceira fonte (TheSpeedX): exclusiva das pessoas. Sao ~5 mil proxies
        // extras, somados ao ProxyScrape, sem dividir com a divulgacao.
        const _speedS = [];
        const _speedH = [];
        for (const _url of [
            'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
            'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt'
        ]) {
            try {
                const _r3 = await fetch(_url, { signal: AbortSignal.timeout(15000) });
                if (!_r3.ok) continue;
                const _t3 = await _r3.text();
                const _ehHttp = _url.indexOf('/http.txt') !== -1;
                for (const _linha of _t3.split(/\r?\n/)) {
                    const _p = _parseProxyLinha(_linha);
                    if (!_p) continue;
                    if (_ehHttp) _speedH.push(_p.ip + ':' + _p.porta);
                    else _speedS.push(_p.ip + ':' + _p.porta + ':5');
                }
            } catch (_e3) {}
        }

        // Servidores em porta nao padrao (ex.: 475) so conectam com SOCKS.
        // Por isso as pessoas recebem TODAS estas fontes SOCKS extras, alem
        // do ProxyScrape/TheSpeedX. Duplicatas sao removidas mais abaixo.
        await Promise.all([
            'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=socks5',
            'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=socks4',
            'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt',
            'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt',
            'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
            'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
            'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt',
            'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt',
            'https://raw.githubusercontent.com/UptimerBot/proxy-list/main/proxies/socks5.txt',
            'https://raw.githubusercontent.com/UptimerBot/proxy-list/main/proxies/http.txt',
            'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5.txt',
            'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http.txt',
            'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt'
        ].map(async (_url) => {
            try {
                const _r4 = await fetch(_url, { signal: AbortSignal.timeout(10000) });
                if (!_r4.ok) return;
                const _t4 = await _r4.text();
                const _ehS4 = _url.indexOf('protocol=socks4') !== -1;
                const _ehHttp = /\/http|http\.txt|proxy-list-raw/i.test(_url);
                for (const _linha of _t4.split(/\r?\n/)) {
                    const _p = _parseProxyLinha(_linha);
                    if (!_p) continue;
                    if (_ehHttp) _speedH.push(_p.ip + ':' + _p.porta);
                    else _speedS.push(_p.ip + ':' + _p.porta + ':' + (_ehS4 ? '4' : '5'));
                }
            } catch (_e4) {}
        }));

        // Reaproveita o ultimo cache das pessoas, mas NUNCA um IP que pertença
        // a Proxifly (mesmo que tenha vindo de uma versao antiga do servidor).
        const _vistosFlyCacheS = new Set(_flyS);
        const _vistosFlyCacheH = new Set(_flyH);
        for (const _v of _cacheS) if (!_vistosFlyCacheS.has(_v)) _speedS.push(_v);
        for (const _v of _cacheH) if (!_vistosFlyCacheH.has(_v)) _speedH.push(_v);

        // Lista das pessoas = SOMENTE fontes proprias (ProxyScrape + extras).
        // Proxifly fica guardada para a divulgacao: ZERO disputa de IPs entre
        // os tipos de sessao, mesmo com a divulgacao desligada.
        const _vistosFlyS = new Set(_flyS);
        const _vistosFlyH = new Set(_flyH);
        const _usrS = [];
        const _usrH = [];
        const _vistosS = new Set();
        const _vistosH = new Set();
        for (const _v of _scrapeS.concat(_speedS)) {
            if (!_vistosS.has(_v) && !_vistosFlyS.has(_v)) { _vistosS.add(_v); _usrS.push(_v); }
        }
        for (const _v of _scrapeH.concat(_speedH)) {
            if (!_vistosH.has(_v) && !_vistosFlyH.has(_v)) { _vistosH.add(_v); _usrH.push(_v); }
        }
        try {
            _0x3c2d.writeFileSync(_cacheProxiesPath, JSON.stringify({ socks: _usrS, http: _usrH }));
        } catch (_ec) {}
        // Lista 'vip' so e usada quando NAO ha divulgacao ativa. E a uniao
        // completa das duas listas, sem fatias e sem repetidos internamente.
        const _vipS = [];
        const _vipH = [];
        const _vistosVipS = new Set();
        const _vistosVipH = new Set();
        for (const _v of _usrS.concat(_flyS)) {
            if (!_vistosVipS.has(_v)) { _vistosVipS.add(_v); _vipS.push(_v); }
        }
        for (const _v of _usrH.concat(_flyH)) {
            if (!_vistosVipH.has(_v)) { _vistosVipH.add(_v); _vipH.push(_v); }
        }
        _porFonte.vip.socks = _vipS;
        _porFonte.vip.http = _vipH;
        // Guarda a lista gratuita antes de substituir a fonte pelo proxy pago.
        _proxiesReservaS = _vipS;
        _proxiesReservaH = _vipH;
        if (_usrS.length || _usrH.length) {
            _porFonte.proxyscrape.socks = _usrS;
            _porFonte.proxyscrape.http = _usrH;
        }
        if (_flyS.length || _flyH.length) {
            _porFonte.proxifly.socks = _flyS;
            _porFonte.proxifly.http = _flyH;
        }

        // Quando um arquivo autenticado e fornecido (teste isolado), ele
        // substitui as fontes normais: a sessao usa somente esses proxies.
        if (_authS.length || _authH.length) {
            _porFonte.vip.socks = _authS;
            _porFonte.vip.http = _authH;
            // 'proxyscrape' fica GRATUITA de proposito: e para onde as pessoas
            // vao quando a divulgacao liga. Se ela também virasse a credencial
            // do gateway, divulgacao e pessoas disputariam a MESMA linha.
        }

        // Lista global (usada apenas como compatibilidade / fallback).
        const _socks = _usrS.slice();
        const _http = _usrH.slice();
        const _todosS = new Set(_socks);
        const _todosH = new Set(_http);
        for (const _v of _flyS) if (!_todosS.has(_v)) { _todosS.add(_v); _socks.push(_v); }
        for (const _v of _flyH) if (!_todosH.has(_v)) { _todosH.add(_v); _http.push(_v); }
        if (_authS.length || _authH.length) {
            _proxiesSocks = _authS;
            _proxiesHttp = _authH;
        } else {
            if (_socks.length) _proxiesSocks = _socks;
            if (_http.length) _proxiesHttp = _http;
        }
        console.log('[Proxies] usuarios=' + _usrS.length + ' SOCKS / ' + _usrH.length + ' HTTP | opencode=' +
            _flyS.length + ' SOCKS / ' + _flyH.length + ' HTTP | total=' + _socks.length + '/' + _http.length);
    } catch (_e) {
        console.warn('[ProxyScrape] falha ao atualizar: ' + (_e && _e.message ? _e.message : _e));
    } finally {
        // Aplica a fonte autenticada mesmo se as listas publicas falharam.
        if (_authS.length || _authH.length) {
            _porFonte.vip.socks = _authS;
            _porFonte.vip.http = _authH;
            // proxyscrape continua gratuita (ver acima).
            _proxiesSocks = _authS;
            _proxiesHttp = _authH;
        }
        _atualizandoProxies = false;
    }
}
setInterval(_atualizarProxiesAutomaticamente, 30 * 60 * 1000);
_atualizarProxiesAutomaticamente();

class _0x9e4b {
    constructor() {
        this._0x2a7c = [];
        this._0x5f8e = "";
        this._0x1d3b = null;
        this._0x4c6f = null;
        this._0x8a2e = null;
        // Follow: ponto a frente da cabeca calculado uma unica vez por
        // movimento do jogador, compartilhado por todos os bots.
        this._playerLeadX = 0;
        this._playerLeadY = 0;
        this._playerPrevMoveX = null;
        this._playerPrevMoveY = null;
        this._0x6d9c = null;
        this._0x7b4f = null;
        this._0x3e1a = 0;
        this._0x9f2c = 30;
        this._0x5a8d = false;
        this._0x2c7e = false;
        this._0x1f8c = false;
        // Modo autonomo da tecla L (comida no chao + evasao).
        this._foodMode = false;
        // Reserva de alimento por bot para todos nao correrem para o mesmo pellet.
        this._foodClaims = Object.create(null);
        this._0xtornadoSettings = {
            size: 2000,
            separation: 800,
            finalAng: 90,
            rOC: 0.5,
            rotationDir: 1
        };
        // Aba Bot Settings (rotation / random / tornado / wigwag).
        this._movementSettings = {
            rotation: 'snakey',
            randomRate: 1000,
            tornadoSize: 2000,
            tornadoSeparation: 800,
            tornadoFinalAngle: 90,
            tornadoRateOfChange: 0.5,
            tornadoRotationDir: 1,
            wigwagPeriod: 2000,
            wigwagAmplitude: 45
        };
        this._0x8f3a = null;
        this._0xfixedCircleActive = false;
        this._0xfixedCircleX = null;
        this._0xfixedCircleY = null;
        this._0xfixedCircleSettings = {
            size: 1712,
            separation: 6000,
            finalAng: 110,
            rOC: 0.3,
            rotationDir: 1
        };
        // Usa a lista atualizada do ProxyScrape; se ainda nao tiver carregado,
        // cai para os arquivos locais (ou segue direto se nao houver nenhum).
        this._0x4b6c = _proxiesSocks.length ? _proxiesSocks.slice() : this._lerLinhas("./config/proxies.txt");
        this._0x7d9e = _proxiesHttp.length ? _proxiesHttp.slice() : this._lerLinhas("./config/httpProxy.txt");
        this._0x5b7c = -1;
        // -1 = sem tag (nao forca a tag 12 em todos os bots).
        this._0x9d1e = -1;
        // Detectado no cliente NTL e repassado aos bots para servidores custom.
        this._protocol = 14;
        this._spawnLayout = 'ntl';
        this._bypassProxy = false;
        this._0xboostState = false;
        this._0xbotInterval = null;
        this._0xskinCodes = [];
        this._0xbotNames = [];
        this._0xkillMode = false;
        this._0xtargetPlayer = null;
        this._0xkillTargetX = null;
        this._0xkillTargetY = null;
        this._0xkillTargetBroadcast = 0;
        this._0xknownPlayers = {};
        this._0xbotSnakeIds = {};
        // Proxies que falharam recently ficam de fora da roleta por um tempo.
        // Sem isso o spawn fica lento: o gerador cria bots a cada 5ms e quase
        // todos escolhem proxies mortos da lista bruta do ProxyScrape.
        this._proxyFalhas = Object.create(null);
        this._0x6e4a();
    }

    _lerLinhas(_arquivo) {
        try {
            return _0x3c2d.readFileSync(_arquivo, 'utf8').split(/\r?\n/).filter(function (linha) { return !!linha; });
        } catch (e) {
            return [];
        }
    }

    _0x3f7b(_0x4c8d, _0x9e2f) {
        this._0x5f8e = _0x4c8d;
        this._0x1d3b = _0x9e2f;
        let _host = '', _porta = '';
        try {
            const _u = new URL(_0x4c8d);
            _porta = String(_u.port || '');
            _host = String(_u.hostname || '');
        } catch (e) {}
        // Alvo DESTA sessao. As variaveis globais ficam so por compatibilidade:
        // duas sessoes em servidores diferentes nao podem disputar entre si
        // qual tipo de proxy (HTTP/SOCKS) vai ser usado.
        this._alvoHost = _host;
        this._alvoPorta = _porta;
        _portaAlvo = _porta;
        _hostAlvo = _host;
    }

    _setSpawnInfo(protocol, layout, bypassProxy) {
        if (protocol === 11 || protocol === 12 || protocol === 14) this._protocol = protocol;
        if (layout === 'ntl' || layout === 'official') this._spawnLayout = layout;
        if (typeof bypassProxy === 'boolean') this._bypassProxy = bypassProxy;
    }

    // Escolhe um proxy vivo. Falhas recentes ficam bloqueadas por um curto
    // periodo (cresce com o numero de falhas) para nao gastar slots de spawn
    // em proxies que ja provaram que nao completam o handshake.
    _0xgetProxy() {
        const _lista = (this._0x7d9e && this._0x7d9e.length) ? this._0x7d9e : this._0x4b6c;
        if (!_lista || !_lista.length) return null;
        const _agora = Date.now();
        const _boa = [];
        for (let _i = 0; _i < _lista.length; _i++) {
            const _p = _lista[_i];
            const _f = this._proxyFalhas[String(_p)];
            if (!_f || _agora - _f.ts >= _f.espera) _boa.push(_p);
        }
        let _pool;
        if (_boa.length) {
            _pool = _boa;
        } else if (this._proxyReserva && this._proxyReserva.length) {
            // Fonte autenticada esgotou (timeouts do gateway): cai para a
            // lista gratuita sem liberar o cooldown do proxy pago.
            const _reservaBoa = [];
            for (const _p of this._proxyReserva) {
                const _f = this._proxyFalhas[String(_p)];
                if (!_f || _agora - _f.ts >= _f.espera) _reservaBoa.push(_p);
            }
            if (_reservaBoa.length) {
                _pool = _reservaBoa;
            } else {
                this._proxyFalhas = Object.create(null);
                _pool = _lista;
            }
        } else {
            this._proxyFalhas = Object.create(null);
            _pool = _lista;
        }
        // Usa TODA a lista. O limite antigo de 800 descartava a maior parte
        // dos SOCKS em portas nao padrao (475, 444) e deixava poucos bots.
        return _pool[~~(Math.random() * _pool.length)];
    }

    _0xproxyFalhou(_proxy) {
        if (!_proxy) return;
        const _chave = String(_proxy);
        const _atual = this._proxyFalhas[_chave] || { falhas: 0, ts: 0, espera: 0 };
        _atual.falhas = Math.min((_atual.falhas || 0) + 1, 8);
        _atual.ts = Date.now();
        // Reciclagem rapida: em vez de bloquear por ate 5 min, volta a tentar
        // em 4s/8s/12s... (max 45s). Evita ficar sem proxies na porta 444.
        _atual.espera = Math.min(4000 * _atual.falhas, 45000);
        this._proxyFalhas[_chave] = _atual;
    }

    _0xproxyFuncionou(_proxy) {
        if (!_proxy) return;
        delete this._proxyFalhas[String(_proxy)];
    }

    _0x2a5c(_0x7f3a, _0x1e4b) {
        this._0x4c6f = _0x7f3a;
        this._0x8a2e = _0x1e4b;
        if (Number.isFinite(_0x7f3a) && Number.isFinite(_0x1e4b)) {
            var _0dx = (this._playerPrevMoveX === null) ? 0 : _0x7f3a - this._playerPrevMoveX;
            var _0dy = (this._playerPrevMoveY === null) ? 0 : _0x1e4b - this._playerPrevMoveY;
            // Suaviza o delta entre packets para todos os bots mirarem o mesmo
            // ponto, sem oscilar por causa do timing individual de cada moveTo.
            this._playerLeadX = (this._playerLeadX * 0.4) + (_0dx * 0.6);
            this._playerLeadY = (this._playerLeadY * 0.4) + (_0dy * 0.6);
            this._playerPrevMoveX = _0x7f3a;
            this._playerPrevMoveY = _0x1e4b;
        }
    }

    _0x6e4a() {
        setInterval(() => {
            if (this._0x4c6f !== undefined && this._0x8a2e !== undefined) {
                this._0x6d9c = this._0x4c6f;
                this._0x7b4f = this._0x8a2e;
            }
        }, 10);
    }

    // Troca as listas de proxy SEM parar os bots. Bots que ja entraram no jogo
    // continuam nos IPs atuais; bots ainda conectando passam a usar a lista
    // nova. Nenhuma sessao e reiniciada quando outra pessoa liga/desliga.
    _trocarProxies(_lista, _reserva) {
        if (!Array.isArray(_lista) || !_lista.length) return;
        this._0x7d9e = _lista.slice();
        this._0x4b6c = this._0x7d9e;
        this._proxyReserva = _reserva || null;
        this._proxyFalhas = Object.create(null);
        for (const _bot of this._0x2a7c) {
            if (!_bot || _bot.haveSnakeID) continue;
            if (Array.isArray(_bot.proxies)) _bot.proxies = this._0x4b6c;
            if (Array.isArray(_bot.Proxies)) _bot.Proxies = this._0x7d9e;
        }
    }

    _0x8c7f() {
        this._0xstopAllBots();
        this._parado = false;
        
        var _0x3b6d = this;
        var _0x8f1a = 0;
        this._0xbotInterval = setInterval(() => {
            // Spawn em lote so com proxy. No IP direto entra um de cada vez.
            const _porTickMax = _0x3b6d._bypassProxy ? 1 : _BOTS_POR_TICK;
            for (let _0xporTick = 0; _0xporTick < _porTickMax; _0xporTick++) {
                if (_0x3b6d.getConnectedCount() >= _0x3b6d._0x9f2c) break;
                _0x8f1a++;
            var _0x2c4b = new _0x7f4a(_0x8f1a);
            _0x2c4b.server = _0x3b6d._0x5f8e;
            _0x2c4b.origin = _0x3b6d._0x1d3b;
            _0x2c4b.protocol = _0x3b6d._protocol;
            _0x2c4b.spawnLayout = _0x3b6d._spawnLayout;
            _0x2c4b.bypassProxy = _0x3b6d._bypassProxy;
            
            _0x2c4b.proxies = _0x3b6d._0x4b6c;
            _0x2c4b.Proxies = _0x3b6d._0x7d9e;
            _0x2c4b.socketHandler = _0x3b6d._0x9f2a;
            _0x2c4b.botManager = _0x3b6d;
            _0x2c4b.cosmetic = _0x3b6d._0x5b7c;
            _0x2c4b.tag = _0x3b6d._0x9d1e;
            _0x2c4b.persistentBoost = _0x3b6d._0xboostState;
            
            _0x2c4b.shouldRandomize = _0x3b6d._0x5a8d;
            _0x2c4b.isZigZag = _0x3b6d._0x2c7e;
            _0x2c4b.tornadoActive = _0x3b6d._0x1f8c;
            _0x2c4b.foodMode = _0x3b6d._foodMode;
            _0x2c4b.setTornadoSettings(_0x3b6d._0xtornadoSettings);
            _0x2c4b.setRandomRate(_0x3b6d._movementSettings.randomRate);
            _0x2c4b.setWigwagSettings(_0x3b6d._movementSettings);
            _0x2c4b.setRotationMode(_0x3b6d._movementSettings.rotation);
            _0x2c4b.skinCodes = _0x3b6d._0xskinCodes;
            _0x2c4b.botNames = _0x3b6d._0xbotNames;
            
            if (_0x3b6d._0xfixedCircleActive) {
                _0x2c4b.setFixedCircleMovement(_0x3b6d._0xfixedCircleActive);
                _0x2c4b.setFixedCircleSettings(_0x3b6d._0xfixedCircleSettings, _0x3b6d._0xfixedCircleX, _0x3b6d._0xfixedCircleY);
            }
            _0x2c4b.killMode = _0x3b6d._0xkillMode;
            _0x2c4b.targetPlayer = _0x3b6d._0xtargetPlayer;
            if (_0x3b6d._0xtargetPlayer && _0x3b6d._0xkillTargetX !== null && _0x3b6d._0xkillTargetY !== null) {
                _0x2c4b.targetX = _0x3b6d._0xkillTargetX;
                _0x2c4b.targetY = _0x3b6d._0xkillTargetY;
                _0x2c4b.targetPrevX = _0x3b6d._0xkillTargetX;
                _0x2c4b.targetPrevY = _0x3b6d._0xkillTargetY;
            }
            _0x2c4b.connect();
            if (_0x3b6d._0x6d9c !== undefined && _0x3b6d._0x7b4f !== undefined && _0x3b6d._0x6d9c !== null && _0x3b6d._0x7b4f !== null) {
                _0x2c4b.moveTo(_0x3b6d._0x6d9c, _0x3b6d._0x7b4f);
            }
                _0x3b6d._0x2a7c.push(_0x2c4b);
            }
        }, _0x3b6d._bypassProxy ? _DIRETO_SPAWN_MS : _SPAWN_INTERVAL_MS);
    }

    _0xstopAllBots() {
        // Bandeira LOCAL desta sessao: nenhum outro manager e afetado.
        this._parado = true;
        if (this._0xbotInterval) {
            clearInterval(this._0xbotInterval);
            this._0xbotInterval = null;
        }

        var _0xbots = this._0x2a7c.slice();
        for (var _0x5d2a = 0; _0x5d2a < _0xbots.length; _0x5d2a++) {
            if (_0xbots[_0x5d2a] && typeof _0xbots[_0x5d2a].disconnect === 'function') {
                _0xbots[_0x5d2a].disconnect();
            }
        }

        this._0x2a7c = [];
        
        this._0x3e1a = 0;
        this._0xbotSnakeIds = {};
        this._foodClaims = Object.create(null);
        
        if (this._0x9f2a) {
            this._0x9f2a._0x6d4e();
        }
    }

    _0xremoveBot(_0xbot) {
        var _0xidx = this._0x2a7c.indexOf(_0xbot);
        if (_0xidx !== -1) {
            this._0x2a7c.splice(_0xidx, 1);
        }
        this._releaseBotFoods(_0xbot);
    }

    _foodClaimedByOther(foodId, bot) {
        var _owner = this._foodClaims[String(foodId)];
        return !!_owner && _owner !== bot;
    }

    _claimFood(bot, foodId) {
        this._foodClaims[String(foodId)] = bot;
    }

    _releaseFood(bot, foodId) {
        var _key = String(foodId);
        if (this._foodClaims[_key] === bot) delete this._foodClaims[_key];
    }

    _releaseBotFoods(bot) {
        for (var _key in this._foodClaims) {
            if (this._foodClaims[_key] === bot) delete this._foodClaims[_key];
        }
    }

    _0xsetBotLimit(_0xlimit) {
        this._0x9f2c = _0xlimit;
        var _0xexcess = this.getConnectedCount() - _0xlimit;
        for (var _0xi = this._0x2a7c.length - 1; _0xi >= 0 && _0xexcess > 0; _0xi--) {
            var _0xbot = this._0x2a7c[_0xi];
            if (_0xbot && _0xbot.hasConnected && typeof _0xbot.disconnect === 'function') {
                _0xbot.disconnect();
                _0xexcess--;
            }
        }
    }

    _0x1f3e() {
        this._0x5a8d = !this._0x5a8d;
        if (this._0x5a8d) {
            this._0x6d9c = this._0x4c6f;
            this._0x7b4f = this._0x8a2e;
        }
        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.setRandomMovement(this._0x5a8d);
            if (!this._0x5a8d && Number.isFinite(this._0x4c6f) && Number.isFinite(this._0x8a2e)) {
                _0x4a7b.moveTo(this._0x4c6f, this._0x8a2e);
            }
        });
    }

    _0x9c2d() {
        this._0x2c7e = !this._0x2c7e;
    }

    _toggleFoodMode() {
        this._foodMode = !this._foodMode;
        this._foodClaims = Object.create(null);
        this._0x2a7c.forEach((_0x4a7b) => {
            if (_0x4a7b && typeof _0x4a7b.setFoodMode === 'function') {
                _0x4a7b.setFoodMode(this._foodMode);
            }
        });
        return this._foodMode;
    }

    _getFoodMode() {
        return this._foodMode;
    }


    _0x4e7c() {
        if (this._0x9f2a) {
            this._0x9f2a._0x4e7c();
        }
    }

    _0x2d5e(_0x7a4b) {
        this._0x9f2a = _0x7a4b;
    }

    _0x8b5c() {
        return this._0x2a7c;
    }

    _0x1a2b() {
        return this._0x3e1a;
    }

    _0xsetBoostState(_0xstate) {
        this._0xboostState = !!_0xstate;
        // Propaga para os bots atuais e para os que conectarem depois (o
        // estado fica em _0xboostState e e lido no _0xupdateBoost).
        for (var _0xbot of this._0x2a7c) {
            if (!_0xbot) continue;
            _0xbot.persistentBoost = this._0xboostState;
            if (typeof _0xbot.boostSpeed === 'function') {
                _0xbot.boostSpeed(this._0xboostState);
            }
        }
    }

    _0xgetBoostState() {
        return this._0xboostState;
    }

    _0x6f4c(_0x9d8e) {
        this._0x3e1a = _0x9d8e;
    }

    getConnectedCount() {
        return this._0x1a2b();
    }

    setConnectedCount(_0x2a8b) {
        this._0x6f4c(_0x2a8b);
    }

    incrementConnectedCount() {
        this._0x3e1a++;
        this.sendCountUpdate();
    }

    decrementConnectedCount() {
        if (this._0x3e1a > 0) this._0x3e1a--;
        this.sendCountUpdate();
    }

    sendCountUpdate() {
        if (this._0x9f2a) {
            this._0x9f2a._0x6d4e();
        }
    }

    get botCount() {
        return this._0x9f2c;
    }

    updatePosition(_0x7f3a, _0x1e4b) {
        this._0x2a5c(_0x7f3a, _0x1e4b);
    }

    get xPos() {
        return this._0x4c6f;
    }

    get yPos() {
        return this._0x8a2e;
    }

    get playerLeadX() {
        return this._playerLeadX;
    }

    get playerLeadY() {
        return this._playerLeadY;
    }

    _0x3f8b(_0x1c5d) {
        this._0x5b7c = _0x1c5d;
        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.cosmetic = _0x1c5d;
        });
    }

    _0x7a9c(_0x2d6e) {
        this._0x9d1e = _0x2d6e;
        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.tag = _0x2d6e;
        });
    }

    _0x4e8f() {
        return this._0x5b7c;
    }

    _0x9b2a() {
        return this._0x9d1e;
    }

    _0x3d8f() {
        this._0x1f8c = !this._0x1f8c;
        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.setTornadoMovement(this._0x1f8c);
        });
    }

    _0x4f2a(_0x8c3d) {
        this._0xtornadoSettings = _0x8c3d;
        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.setTornadoSettings(this._0xtornadoSettings);
        });
    }

    // Evento da aba Bot Settings. Aplica a todos os bots ativos e aos proximos.
    _setMovementSettings(settings) {
        if (!settings) return this._movementSettings;
        var s = this._movementSettings;
        function num(value, def, min) {
            // Aceita decimal com virgula (ex.: "0,5" do teclado em PT-BR).
            if (typeof value === 'string') value = value.replace(',', '.');
            var n = parseFloat(value);
            return isFinite(n) && n >= min ? n : def;
        }
        if (typeof settings.rotation === 'string') {
            s.rotation = ['snakey', 'random', 'tornado', 'wigwag'].indexOf(settings.rotation) !== -1
                ? settings.rotation : 'snakey';
        }
        s.randomRate = num(settings.randomRate, s.randomRate, 50);
        s.tornadoSize = num(settings.tornadoSize, s.tornadoSize, 100);
        s.tornadoSeparation = num(settings.tornadoSeparation, s.tornadoSeparation, 0);
        s.tornadoFinalAngle = num(settings.tornadoFinalAngle, s.tornadoFinalAngle, 0);
        s.tornadoRateOfChange = num(settings.tornadoRateOfChange, s.tornadoRateOfChange, 0);
        s.tornadoRotationDir = Number(settings.tornadoRotationDir) === 0 ? 0 : 1;
        s.wigwagPeriod = num(settings.wigwagPeriod, s.wigwagPeriod, 50);
        s.wigwagAmplitude = num(settings.wigwagAmplitude, s.wigwagAmplitude, 0);

        // Continua alimentando o formato antigo usado por setTornadoSettings.
        this._0xtornadoSettings = {
            size: s.tornadoSize,
            separation: s.tornadoSeparation,
            finalAng: s.tornadoFinalAngle,
            rOC: s.tornadoRateOfChange,
            rotationDir: s.tornadoRotationDir
        };

        // Só mexe nos atalhos Z/3 quando o modo foi ligado pela propria UI,
        // para nao desligar o que o usuario ja ativou pelo teclado.
        if (s.rotation === 'random') {
            this._0x5a8d = true;
            this._0x1f8c = false;
            this._modeRandom = true;
            this._modeTornado = false;
        } else if (s.rotation === 'tornado') {
            this._0x1f8c = true;
            this._0x5a8d = false;
            this._modeTornado = true;
            this._modeRandom = false;
        } else {
            if (this._modeRandom) this._0x5a8d = false;
            if (this._modeTornado) this._0x1f8c = false;
            this._modeRandom = false;
            this._modeTornado = false;
        }

        this._0x2a7c.forEach((_0x4a7b) => {
            if (!_0x4a7b) return;
            if (typeof _0x4a7b.setTornadoSettings === 'function') _0x4a7b.setTornadoSettings(this._0xtornadoSettings);
            if (typeof _0x4a7b.setRandomRate === 'function') _0x4a7b.setRandomRate(s.randomRate);
            if (typeof _0x4a7b.setWigwagSettings === 'function') _0x4a7b.setWigwagSettings(s);
            if (typeof _0x4a7b.setRotationMode === 'function') _0x4a7b.setRotationMode(s.rotation);
        });
        return s;
    }

    _0xToggleFixedCircle() {
        this._0xfixedCircleActive = !this._0xfixedCircleActive;
        
        if (this._0xfixedCircleActive) {
            this._0xfixedCircleX = this._0x6d9c || this._0x4c6f;
            this._0xfixedCircleY = this._0x7b4f || this._0x8a2e;
            
            this._0x1f8c = false;
            this._0x5a8d = false; 
            this._0x2c7e = false; 
        }

        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.setFixedCircleMovement(this._0xfixedCircleActive);
            if (this._0xfixedCircleActive) {
                _0x4a7b.setFixedCircleSettings(this._0xfixedCircleSettings, this._0xfixedCircleX, this._0xfixedCircleY);
            }
            _0x4a7b.setTornadoMovement(false);
            _0x4a7b.setRandomMovement(false);
        });
    }

    _0xregisterBotSnakeId(_0xid) {
        this._0xbotSnakeIds[_0xid] = true;
        // Avisa o cliente na hora: com a lista so no getPlayerList (700ms),
        // um bot recem-nascido podia ser clicado como se fosse jogador real.
        if (this._0x9f2a && this._0x9f2a._0x1d6e) {
            try {
                this._0x9f2a._0x1d6e.emit('botIds', this._0xgetBotSnakeIds());
            } catch (e) {}
        }
    }

    _0xgetBotSnakeIds() {
        return Object.keys(this._0xbotSnakeIds).map(Number);
    }

    _0xreportPlayer(_0xid, _0xname, _0xx, _0xy) {
        if (!_0xid) return;
        var _0xp = this._0xknownPlayers[_0xid];
        if (!_0xp) {
            this._0xknownPlayers[_0xid] = {
                targetId: _0xid,
                name: _0xname || ('Player ' + _0xid),
                x: typeof _0xx === 'number' ? _0xx : 0,
                y: typeof _0xy === 'number' ? _0xy : 0,
                lastSeen: Date.now()
            };
        } else {
            if (_0xname) _0xp.name = _0xname;
            if (typeof _0xx === 'number' && typeof _0xy === 'number' && (_0xx || _0xy)) {
                _0xp.x = _0xx;
                _0xp.y = _0xy;
            }
            _0xp.lastSeen = Date.now();
        }
    }

    // Jogadores que morreram/sairam nao podem continuar aparecendo na lista.
    // O servidor nao recebe ID confiavel na morte, entao usa o ultimo reporte
    // de posicao: depois de alguns segundos sem update, a entrada some.
    _0xgetLivePlayers() {
        var _0now = Date.now();
        var _0out = [];
        Object.keys(this._0xknownPlayers).forEach((_0id) => {
            var _0xp = this._0xknownPlayers[_0id];
            if (!_0xp) return;
            if (_0xp.lastSeen && (_0now - _0xp.lastSeen) > 8000) {
                delete this._0xknownPlayers[_0id];
                return;
            }
            _0out.push(_0xp);
        });
        return _0out;
    }

    // Atualiza a posicao de um jogador conhecido e, se for o alvo,
    // compartilha essa posicao com TODOS os bots (rastreamento em enxame).
    _0xreportPlayerPos(_0xid, _0xx, _0xy) {
        if (!_0xid || typeof _0xx !== 'number' || typeof _0xy !== 'number') return;
        if (!_0xx && !_0xy) return;
        // Nossos proprios bots nunca podem ser reportados como alvo: isso
        // fazia todos os bots seguirem a si mesmos.
        if (this._0xbotSnakeIds && this._0xbotSnakeIds[_0xid]) return;
        var _0xp = this._0xknownPlayers[_0xid];
        if (_0xp) {
            _0xp.x = _0xx;
            _0xp.y = _0xy;
            _0xp.lastSeen = Date.now();
        }
        if (this._0xtargetPlayer && _0xid == this._0xtargetPlayer.targetId) {
            this._0xreportTargetPosFromBot(_0xid, _0xx, _0xy);
        }
    }

    // Qualquer bot que enxergue o alvo reporta aqui. A posicao e repassada
    // para todos os bots, entao eles continuam seguindo mesmo quando o alvo
    // sai do campo de visao do jogador (desde que algum bot o enxergue).
    _0xreportTargetPosFromBot(_0xid, _0xx, _0xy) {
        if (!this._0xtargetPlayer || _0xid != this._0xtargetPlayer.targetId) return;
        var _0xnow = Date.now();
        if (_0xnow - this._0xkillTargetBroadcast < 80) return;
        this._0xkillTargetBroadcast = _0xnow;

        var _0xprevX = this._0xkillTargetX;
        var _0xprevY = this._0xkillTargetY;
        this._0xkillTargetX = _0xx;
        this._0xkillTargetY = _0xy;

        var _0xvx = (_0xprevX === null) ? 0 : (_0xx - _0xprevX);
        var _0xvy = (_0xprevY === null) ? 0 : (_0xy - _0xprevY);

        this._0x2a7c.forEach((_0x4a7b) => {
            if (_0x4a7b && _0x4a7b.killMode) {
                _0x4a7b.targetVelocityX = (_0x4a7b.targetVelocityX * 0.5) + (_0xvx * 0.5);
                _0x4a7b.targetVelocityY = (_0x4a7b.targetVelocityY * 0.5) + (_0xvy * 0.5);
                _0x4a7b.targetPrevX = _0x4a7b.targetX;
                _0x4a7b.targetPrevY = _0x4a7b.targetY;
                _0x4a7b.targetX = _0xx;
                _0x4a7b.targetY = _0xy;
            }
        });
    }

    _0xsetTargetByName(_0xname) {
        var _0xfound = null;
        var _0xids = Object.keys(this._0xknownPlayers);
        for (var _0xi = 0; _0xi < _0xids.length; _0xi++) {
            var _0xp = this._0xknownPlayers[_0xids[_0xi]];
            // Um dos nossos bots nunca pode ser alvo (seguiria a si mesmo).
            if (this._0xbotSnakeIds && this._0xbotSnakeIds[_0xids[_0xi]]) continue;
            if (_0xp && _0xp.name && _0xp.name.toLowerCase() === _0xname.toLowerCase()) {
                _0xfound = _0xp;
                break;
            }
        }
        if (_0xfound) {
            this._0xsetTargetPlayer(_0xfound);
            if (this._0x9f2a) {
                this._0x9f2a._0x1d6e.emit('targetAcquired', { targetId: _0xfound.targetId, name: _0xfound.name });
            }
            return true;
        }
        return false;
    }

    _0xsetTargetPlayer(_0xdata) {
        if (!_0xdata || !_0xdata.targetId) return false;
        // Um dos nossos bots nunca pode ser alvo: ele mesmo reportaria a
        // posicao e todos os bots passariam a seguir a si mesmos.
        if (this._0xbotSnakeIds && this._0xbotSnakeIds[_0xdata.targetId]) {
            if (this._0x9f2a && this._0x9f2a._0x1d6e) {
                try {
                    this._0x9f2a._0x1d6e.emit('targetRejected', {
                        reason: 'bot', targetId: _0xdata.targetId
                    });
                } catch (e) {}
            }
            return false;
        }
        this._0xtargetPlayer = _0xdata;
        this._0xkillMode = true;
        this._0xkillTargetBroadcast = 0;

        var _0xtx = _0xdata.targetX;
        var _0xty = _0xdata.targetY;
        // Se o alvo foi selecionado sem posicao conhecida, usa a posicao do
        // jogador como ponto de partida (evita mandar todos os bots para 0,0).
        if ((_0xtx === undefined || _0xty === undefined) &&
            Number.isFinite(this._0x4c6f) && Number.isFinite(this._0x8a2e)) {
            _0xtx = this._0x4c6f;
            _0xty = this._0x8a2e;
        }

        if (_0xtx !== undefined && _0xty !== undefined) {
            this._0xkillTargetX = _0xtx;
            this._0xkillTargetY = _0xty;
        }
        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.targetPlayer = _0xdata;
            _0x4a7b.killMode = true;
            // A velocidade pertence ao alvo antigo: zerar evita que o lead
            // continue apontando na direcao anterior durante a troca.
            _0x4a7b.targetVelocityX = 0;
            _0x4a7b.targetVelocityY = 0;
            if (_0xtx !== undefined && _0xty !== undefined) {
                _0x4a7b.targetX = _0xtx;
                _0x4a7b.targetY = _0xty;
                _0x4a7b.targetPrevX = _0xtx;
                _0x4a7b.targetPrevY = _0xty;
            }
            // Nao espera o proximo tick do loop (180ms): redireciona agora.
            if (_0x4a7b && typeof _0x4a7b.moveTo === 'function' &&
                Number.isFinite(_0x4a7b.snakeX) && Number.isFinite(_0x4a7b.snakeY)) {
                var _0xfromX = Number.isFinite(this._0x4c6f) ? this._0x4c6f : _0xtx;
                var _0xfromY = Number.isFinite(this._0x8a2e) ? this._0x8a2e : _0xty;
                if (Number.isFinite(_0xfromX) && Number.isFinite(_0xfromY)) {
                    try { _0x4a7b.moveTo(_0xfromX, _0xfromY); } catch (e) {}
                }
            }
        });
    }

    _0xclearTarget() {
        this._0xtargetPlayer = null;
        this._0xkillMode = false;
        this._0xkillTargetX = null;
        this._0xkillTargetY = null;
        this._0xkillTargetBroadcast = 0;
        this._0x2a7c.forEach((_0x4a7b) => {
            _0x4a7b.targetPlayer = null;
            _0x4a7b.killMode = false;
        });
    }

    _0xupdateTargetPos(_0xx, _0xy, _0xfresh) {
        // Posicao cacheada (alvo fora da visao do jogador) so substitui o
        // rastreamento dos bots quando nenhum bot reportou algo mais recente.
        if (_0xfresh === false && this._0xkillTargetBroadcast &&
            (Date.now() - this._0xkillTargetBroadcast) < 1200) return;
        this._0xkillTargetX = _0xx;
        this._0xkillTargetY = _0xy;
        this._0x2a7c.forEach((_0x4a7b) => {
            if (_0x4a7b && _0x4a7b.killMode) {
                var _0prevTx = Number.isFinite(_0x4a7b.targetX) ? _0x4a7b.targetX : _0xx;
                var _0prevTy = Number.isFinite(_0x4a7b.targetY) ? _0x4a7b.targetY : _0xy;
                var _0xdx = _0xx - _0prevTx;
                var _0xdy = _0xy - _0prevTy;
                _0x4a7b.targetVelocityX = (_0x4a7b.targetVelocityX * 0.6) + (_0xdx * 0.4);
                _0x4a7b.targetVelocityY = (_0x4a7b.targetVelocityY * 0.6) + (_0xdy * 0.4);
                _0x4a7b.targetPrevX = _0x4a7b.targetX;
                _0x4a7b.targetPrevY = _0x4a7b.targetY;
                _0x4a7b.targetX = _0xx;
                _0x4a7b.targetY = _0xy;
            }
        });
    }

}

// Resolve o alvo da sessao que pediu a lista. Se nao vier explicito, usa as
// globais antigas (compatibilidade). Nunca mais uma sessao decide o tipo de
// proxy da outra.
function _alvoEfetivo(_alvo) {
    return {
        host: String((_alvo && _alvo.host) || _hostAlvo || ''),
        porta: String((_alvo && _alvo.porta) || _portaAlvo || '')
    };
}

// Lista bruta imediata: validar com WS abre/fecha milhares de conexoes e o
// servidor do jogo bane os IPs. Teste local: 40/40 bots com brutos vs 5/600
// com validacao. Os bots ja trocam de proxy quando um falha, entao a selecao
// natural e mais rapida e muito mais eficaz.
function _proxiesBrutos(_alvo) {
    const _a = _alvoEfetivo(_alvo);
    // Este servidor em especial so responde bem com proxies HTTP nos testes.
    if (_a.host === '45.158.39.114' && _a.porta === '444' && _proxiesHttp.length) {
        return _proxiesHttp.slice();
    }
    // Porta 444/475 etc.: proxies HTTP quase sempre negam CONNECT. Nesses
    // casos usamos apenas SOCKS, que aceita qualquer porta de destino.
    if (_a.porta && _a.porta !== '443' && _a.porta !== '80' && _proxiesSocks.length) {
        return _proxiesSocks.slice();
    }
    const _lista = _proxiesHttp.concat(_proxiesSocks);
    // Intercala HTTP e SOCKS para nao concentrar todos de um tipo no inicio.
    const _misturada = [];
    const _max = Math.max(_proxiesHttp.length, _proxiesSocks.length);
    for (let _i = 0; _i < _max; _i++) {
        if (_proxiesHttp[_i]) _misturada.push(_proxiesHttp[_i]);
        if (_proxiesSocks[_i]) _misturada.push(_proxiesSocks[_i]);
    }
    return _misturada.length ? _misturada : _lista;
}

// Lista INTEIRA de uma unica fonte. Cada sessao recebe a sua, sem fatias e sem
// dividir IPs com outra sessao. Se a fonte estiver vazia, usa a lista global.
function _proxiesBrutosPorFonte(_fonte, _alvo) {
    const _f = _porFonte[_fonte];
    const _a = _alvoEfetivo(_alvo);
    if (!_f) return _proxiesBrutos(_alvo);
    const _socks = _f.socks.slice();
    const _http = _f.http.slice();
    if (!_socks.length && !_http.length) return _proxiesBrutos(_alvo);
    if (_a.host === '45.158.39.114' && _a.porta === '444' && _http.length) return _http;
    if (_a.porta && _a.porta !== '443' && _a.porta !== '80' && _socks.length) return _socks;
    const _misturada = [];
    const _max = Math.max(_http.length, _socks.length);
    for (let _i = 0; _i < _max; _i++) {
        if (_http[_i]) _misturada.push(_http[_i]);
        if (_socks[_i]) _misturada.push(_socks[_i]);
    }
    return _misturada.length ? _misturada : _socks.concat(_http);
}

_0x9e4b._registrarDebugBot = _registrarDebugBot;
_0x9e4b._listarDebugBots = _listarDebugBots;
_0x9e4b._prepararProxies = _prepararProxies;
_0x9e4b._statusProxies = _statusProxies;
_0x9e4b._proxiesBrutos = _proxiesBrutos;
_0x9e4b._proxiesBrutosPorFonte = _proxiesBrutosPorFonte;

// Lista gratuita guardada como reserva quando a fonte autenticada falha.
function _proxiesReserva(_alvo) {
    const _a = _alvoEfetivo(_alvo);
    if (_a.porta && _a.porta !== '443' && _a.porta !== '80' && _proxiesReservaS.length) {
        return _proxiesReservaS.slice();
    }
    return _proxiesReservaH.concat(_proxiesReservaS);
}
_0x9e4b._proxiesReserva = _proxiesReserva;

module.exports = _0x9e4b;