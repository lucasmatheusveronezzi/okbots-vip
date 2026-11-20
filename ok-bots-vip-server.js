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
            agora: Date.now()
        });
    }

    if (_url === '/api/public') {
        const _sessoes = _painelHandler ? _painelHandler.listarSessoes() : [];
        return _json(_res, 200, { resumo: _resumo(_sessoes) });
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