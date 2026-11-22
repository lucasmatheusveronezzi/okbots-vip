'use strict';

process.on('uncaughtException', (err) => {
    const code = err && err.code;
    const ignorar = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];
    if (code && ignorar.indexOf(code) !== -1) return;
    console.error('[Erro nao tratado]', err && err.message ? err.message : err);
});
process.on('unhandledRejection', (reason) => {
    const code = reason && reason.code;
    const ignorar = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];
    if (code && ignorar.indexOf(code) !== -1) return;
    console.error('[Promise rejeitada]', reason && reason.message ? reason.message : reason);
});
const _0x7e3f = require('colors');
const _0x9b4a = require('readline');
const _0x1d6e = require('chalk');
const _0x8c7f = require('ascii-art');
const _http = require('http');
const _fs = require('fs');
const _path = require('path');
const PORT = Number(process.env.PORT || 8420);

// Painel de monitoramento sem senha: acesso direto em /admin.
const _eventos = [];
function registrarEvento(_ev) {
    _eventos.push(Object.assign({ ts: Date.now() }, _ev));
    if (_eventos.length > 300) _eventos.splice(0, _eventos.length - 300);
}

let _painelHandler = null;

function _json(_res, _status, _obj, _extra) {
    const _body = JSON.stringify(_obj);
    const _headers = Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
    }, _extra || {});
    _res.writeHead(_status, _headers);
    _res.end(_body);
}

function _resumo(_sessoes) {
    const _servidores = new Set();
    _sessoes.forEach(function (s) { if (s.servidorIp) _servidores.add(s.servidorIp); });
    return {
        conectados: _sessoes.length,
        comBots: _sessoes.filter(function (s) { return s.ativo; }).length,
        bots: _sessoes.reduce(function (t, s) { return t + (s.bots || 0); }, 0),
        servidoresUnicos: _servidores.size
    };
}

// Agrupa QUANTOS bots estao indo para cada pessoa e em QUAL IP DO JOGO.
// O IP da pessoa que ativou os bots NAO e exposto no painel.
function _ataques(_sessoes) {
    const _mapa = new Map();
    _sessoes.forEach(function (s) {
        if (!s.alvoId && !s.alvoNome) return;
        const _chave = String(s.alvoId || s.alvoNome);
        if (!_mapa.has(_chave)) {
            _mapa.set(_chave, {
                alvoId: s.alvoId,
                alvoNome: s.alvoNome,
                pessoas: 0,
                bots: 0,
                servidoresIp: []
            });
        }
        const _e = _mapa.get(_chave);
        _e.pessoas += 1;
        _e.bots += (s.botsAoAlvo || 0);
        if (s.servidorIp && _e.servidoresIp.indexOf(s.servidorIp) === -1) _e.servidoresIp.push(s.servidorIp);
    });
    return Array.from(_mapa.values()).sort(function (a, b) { return b.bots - a.bots; });
}

const _servidorHttp = _http.createServer(function (_req, _res) {
    let _url = '/';
    try { _url = new URL(_req.url, 'http://localhost').pathname; } catch (e) {}

    if (_url === '/api/stats') {
        const _sessoes = _painelHandler ? _painelHandler.listarSessoes() : [];
        return _json(_res, 200, {
            resumo: _resumo(_sessoes),
            sessoes: _sessoes,
            ataques: _ataques(_sessoes),
            eventos: _eventos.slice(-80),
            donoFixo: _painelHandler && _painelHandler.getDonoFixo ? _painelHandler.getDonoFixo() : null,
            semVip: _painelHandler && _painelHandler.getSemVip ? _painelHandler.getSemVip() : [],
            vipTodos: _painelHandler && _painelHandler.getVipTodos ? _painelHandler.getVipTodos() : null,
            agora: Date.now()
        });
    }

    if (_url === '/api/public') {
        const _sessoes = _painelHandler ? _painelHandler.listarSessoes() : [];
        return _json(_res, 200, { resumo: _resumo(_sessoes) });
    }

    // Marcador de versao do deploy (serve para conferir se o Render atualizou).
    if (_url === '/api/versao') {
        return _json(_res, 200, {
            versao: 'v6-cpu-otimizado',
            proxiesAutomaticos: true,
            agora: Date.now()
        });
    }

    // Interruptor do teste "sem proxy": /api/ip-direto?ligado=1&todos=1
    // Para desligar: /api/ip-direto?ligado=0
    if (_url === '/api/ip-direto') {
        const _p = new URL(_req.url, 'http://localhost').searchParams;
        const _op = {};
        if (_p.has('ligado')) _op.ligado = _p.get('ligado') !== '0';
        if (_p.has('todos')) _op.todos = _p.get('todos') !== '0';
        if (_p.get('ip')) _op.ip = _p.get('ip');
        const _modo = _painelHandler ? _painelHandler.setModoIpDireto(_op) : null;
        return _json(_res, 200, { ok: !!_modo, modo: _modo });
    }

    // Fixa a linha paga na sessao escolhida no painel. O painel ja e aberto
    // sem senha, inclusive pelo tunel; por isso o botao precisa funcionar
    // tanto no localhost quanto na URL publica.
    if (_url === '/api/admin/vip') {
        const _p = new URL(_req.url, 'http://localhost').searchParams;
        // desfixar=<id> tira a sessao do pago e a coloca nos gratis.
        if (_p.has('desfixar') && _painelHandler && _painelHandler.desfixarDono) {
            _painelHandler.desfixarDono(_p.get('desfixar'));
            return _json(_res, 200, {
                ok: true,
                donoFixo: _painelHandler.getDonoFixo ? _painelHandler.getDonoFixo() : null
            });
        }
        const _id = _p.get('id') || '';
        const _fixado = _painelHandler ? _painelHandler.fixarDono(_id || null) : null;
        return _json(_res, 200, { ok: true, donoFixo: _fixado });
    }

    // Liga/desliga a linha paga rotativa para TODAS as pessoas.
    // Ex.: /api/admin/vip-todos?ligado=1  |  ?ligado=0 para voltar ao dono.
    if (_url === '/api/admin/vip-todos') {
        const _p = new URL(_req.url, 'http://localhost').searchParams;
        const _op = {};
        if (_p.has('ligado')) _op.ligado = _p.get('ligado') !== '0';
        const _modo = _painelHandler && _painelHandler.setVipTodos
            ? _painelHandler.setVipTodos(_op) : null;
        return _json(_res, 200, { ok: !!_modo, vipTodos: _modo });
    }

    // Teste de alcance ao servidor do jogo a partir da nuvem.
    if (_url === '/api/testar-jogo') {
        const _params = new URL(_req.url, 'http://localhost').searchParams;
        const _host = _params.get('host') || '45.158.39.114';
        const _porta = Number(_params.get('porta') || 475);
        const _net = require('net');
        const _sock = _net.connect({ host: _host, port: _porta });
        let _respondido = false;
        const _fin = function (_ok, _detalhe) {
            if (_respondido) return;
            _respondido = true;
            try { _sock.destroy(); } catch (e) {}
            return _json(_res, 200, { host: _host, porta: _porta, alcancavel: _ok, detalhe: _detalhe || '' });
        };
        _sock.setTimeout(6000);
        _sock.on('connect', function () { _fin(true, 'conectou'); });
        _sock.on('timeout', function () { _fin(false, 'timeout'); });
        _sock.on('error', function (e) { _fin(false, e && e.message ? e.message : 'erro'); });
        return;
    }

    // Testa o handshake WebSocket completo, igual ao usado pelos bots.
    if (_url === '/api/testar-ws') {
        const _params = new URL(_req.url, 'http://localhost').searchParams;
        const _alvo = _params.get('url') || 'ws://45.158.39.114:475/slither';
        let _ws;
        try {
            const _WebSocket = require('ws');
            _ws = new _WebSocket(_alvo, {
                headers: {
                    'Origin': 'https://slither.io',
                    'Accept-Encoding': 'gzip, deflate',
                    'Accept-Language': 'en-US,en;q=0.8',
                    'Connection': 'Upgrade',
                    'Host': new URL(_alvo).host,
                    'Upgrade': 'websocket',
                    'Sec-WebSocket-Version': '13',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 Chrome/localhost Safari/537.36'
                },
                handshakeTimeout: 8000
            });
        } catch (e) {
            return _json(_res, 200, { url: _alvo, ok: false, detalhe: 'erro ao criar ws: ' + e.message });
        }
        let _respondido = false;
        const _fin = function (_ok, _detalhe) {
            if (_respondido) return;
            _respondido = true;
            try { _ws.terminate(); } catch (e) {}
            return _json(_res, 200, { url: _alvo, ok: _ok, detalhe: _detalhe || '' });
        };
        _ws.on('open', function () { _fin(true, 'handshake abriu'); });
        _ws.on('message', function (d) { _fin(true, 'recebeu ' + (d && d.length ? d.length : 0) + ' bytes'); });
        _ws.on('error', function (e) { _fin(false, e && e.message ? e.message : 'erro no ws'); });
        setTimeout(function () { _fin(false, 'timeout no handshake'); }, 10000);
        return;
    }

    // Ultimos erros dos bots (diagnostico).
    if (_url === '/api/debug-bots') {
        const _BotManager = require('./src/BotManager');
        return _json(_res, 200, {
            erros: typeof _BotManager._listarDebugBots === 'function' ? _BotManager._listarDebugBots() : []
        });
    }

    // Estado dos proxies automaticos (ProxyScrape + validacao CONNECT).
    if (_url === '/api/proxies') {
        const _BotManager = require('./src/BotManager');
        return _json(_res, 200, typeof _BotManager._statusProxies === 'function' ? _BotManager._statusProxies() : {});
    }

    if (_url === '/admin' || _url === '/admin/') {
        _fs.readFile(_path.join(__dirname, 'admin-panel.html'), function (_err, _data) {
            if (_err) { _res.writeHead(404); return _res.end('Painel nao encontrado'); }
            _res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            _res.end(_data);
        });
        return;
    }

    if (_url === '/status') {
        _res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return _res.end('<!doctype html><meta charset="utf-8"><title>OK BOTS VIP</title><body style="background:#0b0f19;color:#e8ecf7;font:16px system-ui;padding:40px"><h1>OK BOTS VIP</h1><p>Painel: <a style="color:#22c55e" href="/admin">/admin</a></p><pre id="s">carregando...</pre><script>setInterval(async()=>{const d=await(await fetch("/api/public")).json();document.getElementById("s").textContent="Conectados: "+d.resumo.conectados+"\\nCom bots ligados: "+d.resumo.comBots+"\\nBots ativos: "+d.resumo.bots},2000)</script></body>');
    }

    if (_url === '/' || _url === '/index.html') {
        _res.writeHead(302, { Location: '/admin' });
        return _res.end();
    }

    _res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    _res.end('404');
});

const _0x4b8c = require('socket.io')(_servidorHttp, {
    origins: '*:*',
    handlePreflightRequest: function (req, res) {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': req.headers.origin || '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'content-type',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Allow-Local-Network': 'true',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
    }
});

_servidorHttp.listen(PORT, function () {
    console.log('[Painel] http://localhost:' + PORT + '/admin');
});

const _0x2f9a = require('./src/BotManager');
const _0x6d4e = require('./src/SocketHandler');

var _0x3e2f = {};
var _0x8f1a = false;
let _0x2c4b = null;
let _0x5d7c = 0;
let _0x6e8f = false;

const _0x9c2d = _0x9b4a.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Cada conexao Socket.IO recebe seu proprio BotManager dentro do
// SocketHandler, mantendo os bots de cada pessoa isolados.
_painelHandler = new _0x6d4e(_0x4b8c, registrarEvento);

function _0x9f2a() {
    console.clear();
    
    const bannerLetters = {
        O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
        K: ['██╗  ██╗', '██║ ██╔╝', '█████╔╝ ', '██╔═██╗ ', '██║  ██╗', '╚═╝  ╚═╝'],
        B: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██████╔╝', '╚═════╝ '],
        T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
        S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
        V: ['██╗   ██╗', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚██╔╝  ', '   ╚═╝   '],
        I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
        P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     ']
    };
    const _0x3b6d = Array.from({ length: 6 }, (_, row) =>
        Array.from('OK BOTS VIP', letter => letter === ' ' ? '   ' : bannerLetters[letter][row]).join(' ')
    ).join('\n');
    console.log(_0x1d6e.red(_0x3b6d));
    
    const _0x3f4d = '═'.repeat(60);
    console.log(_0x1d6e.red(_0x3f4d));
    
    console.log(_0x1d6e.cyan('│') + _0x1d6e.white('  🚀 Servidor de Bots Slither.io') + _0x1d6e.cyan('                          │'));
    console.log(_0x1d6e.cyan('│') + _0x1d6e.white('  🌐 Porta: ' + PORT) + _0x1d6e.cyan('                                          │'));
    console.log(_0x1d6e.cyan('│') + _0x1d6e.white('  💻 OK BOTS VIP') + _0x1d6e.cyan('                                         │'));
    
    console.log(_0x1d6e.red('═'.repeat(60)));
    console.log(_0x1d6e.white('📺 YouTube / Atualizações: https://www.youtube.com/@nikill2717'));
    
    console.log(_0x1d6e.green('\n✅ Sistema inicializado com sucesso!\n'));
}

_0x9f2a();