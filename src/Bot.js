'use strict';
const WebSocket = require('ws');
const _0x2e5a = require('fs');

const _0x4f8a = ['QnJ1bmV4IGhhYmlsaWRvc28=',];

function _0x2b4c(index) {
    return atob(_0x4f8a[index]);
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getHost(a) {
    // Servidores custom podem usar hostname (nao apenas IP). O codigo antigo
    // usava classes de caracteres (/[/slither]/g) e corrompia o Host header.
    try {
        if (a && a.indexOf('://') !== -1) return new URL(a).host;
    } catch (e) {}
    return String(a || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
}

function _okIsLocalServer(url) {
    try {
        var hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
        if (!hostname) return false;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
        // IPv4 privado (10/8, 172.16/12, 192.168/16, 169.254/16)
        var m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (m) {
            var a = +m[1], b = +m[2];
            if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
                (a === 192 && b === 168) || (a === 169 && b === 254)) return true;
        }
        // Hostnames locais comuns
        if (/\.local$|\.localhost$|\.internal$|\.lan$/i.test(hostname)) return true;
    } catch (e) {}
    return false;
}

function _okIsCustomServer(url) {
    // O cliente NTL usa o mesmo handshake [1]/[4]/[99] em qualquer servidor,
    // mas os servidores oficiais respondem ao challenge em um formato antigo
    // (tipo no byte 2). Para nao alterar o fluxo oficial, o handshake NTL
    // completo so e ativado em hosts custom.
    try {
        var hostname = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (!hostname) return false;
        if (hostname === 'slither.io' || hostname === 'www.slither.io' ||
            hostname === 'slither.com' || hostname === 'www.slither.com') return false;
        return true;
    } catch (e) {}
    return false;
}

function createAgent(b) {
    const Socks = require('socks');
    let proxy = b.split(':');
    return new Socks.Agent({
        proxy: {
            ipaddress: proxy[0],
            port: parseInt(proxy[1]),
            type: parseInt(proxy[2]) || 5
        }
    });
}

function createHttpAgent(b) {
    const HttpsProxyAgent = require('https-proxy-agent');
    var proxy = b.split(':');
    return new HttpsProxyAgent("http://" + proxy[0] + ":" + proxy[1]);
}

function Bot(id) {
    this.id = id;
    this.fixedDirection = null;
    this.isBoosting = false;
    this.shouldRandomize = false;
    this.botManager = null;
    this.cosmetic = -1;
    this.tag = -1;
    // Protocolo/layout do spawn. Servidores custom usam 14 por padrao;
    // 11 e 12 continuam aceitos quando detectados no cliente NTL.
    this.protocol = 14;
    this.spawnLayout = 'ntl';
    this.bypassProxy = false;

    // Servidores custom (NTL) usam o handshake completo antes do spawn:
    // [1], [4], [99,3|4] -> challenge "6..." -> resposta -> spawn.
    // O spawn fica pendente enquanto o challenge nao e respondido.
    this.pendingSpawn = null;
    this.customHandshake = false;
    this.challengeAnswered = false;
    this.persistentBoost = false;
    // Boost da tecla E: continuo, sem ciclo e sem pausa por tempo.
    this.isBoosting = false;
    this.botNames = [];
    this.skinCodes = [];
    
    this.targetPlayer = null;
    this.killMode = false;
    this.targetX = 0;
    this.targetY = 0;
    this.targetPrevX = 0;
    this.targetPrevY = 0;
    this.targetVelocityX = 0;
    this.targetVelocityY = 0;
    this.playerPrevX = 0;
    this.playerPrevY = 0;
    this.playerVelocityX = 0;
    this.playerVelocityY = 0;
    
    this.tornadoSize = 2000;
    this.tornadoSeparation = 800;
    this.tornadoFinalAngle = 90;
    this.tornadoRateOfChange = 0.5;
    this.tornadoRotationDir = 1;
    this.tornadoCurrentAngle = 0;
    this.tornadoActive = false;

    // Aba Bot Settings: rotacao e taxa do movimento aleatorio (fora do modo L).
    this.rotationMode = 'snakey';
    this.randomRate = 1000;
    this._randomDir = null;
    this._randomDirAt = 0;
    this.wigwagActive = false;
    this.wigwagPeriod = 2000;
    this.wigwagAmplitude = 45;
    this.wigwagStart = Date.now();

    this.fixedCircleActive = false;
    this.fixedCircleX = null;
    this.fixedCircleY = null;
    this.fixedCircleSize = 1712;
    this.fixedCircleSeparation = 6000;
    this.fixedCircleFinalAngle = 110;
    this.fixedCircleRateOfChange = 0.3;
    this.fixedCircleRotationDir = 1;
    this.fixedCircleCurrentAngle = 0;
    this.fixedCircleLastUpdate = Date.now();
    this.fixedCircleOffsetAngle = Math.random() * Math.PI * 2;

    // Modo autonomo (tecla L): o bot come comida do chao e evita corpos/borda.
    this.foodMode = false;
    this.foods = [];
    this.foodById = Object.create(null);
    this.snakeBodies = Object.create(null);
    this._foodTarget = null;
    this._foodBlocked = Object.create(null);
    this._foodTargetDist = 0;
    this._foodTargetSince = 0;
    this._foodDanger = false;
    this._foodCaution = false;
    this._recentDeaths = [];
    // Cobras que morreram: ignora atualizacoes de corpo por alguns segundos
    // para o bot nao evitar o proprio resto que quer comer.
    this._deadSnakes = Object.create(null);
    this._foodLastSX = 0;
    this._foodLastSY = 0;
    this._foodLastCV = 0;
    this._foodLastPrune = 0;
    // Valores vindos do pacote "a" do protocolo oficial.
    this.worldCenter = 16384;
    this.worldRadius = 16000;
    this.sectorSize = 480;
    this.protocolVersion = 15;
    this.defaultMSL = 42;
    // Timers de movimento/ping precisam morrer junto com o bot; senao bots
    // mortos/reconectados acumulam loops e o contador trava.
    this._moveLoopTimer = null;
    this._moveLoopSpeedTimer = null;
    this._moveLoopDelay = 180;
    this._moveLoopStopped = false;
    this._ping251Interval = null;
}

Bot.prototype = {
    needPing: false,
    snakeID: null,
    snakeX: 0,
    snakeY: 0,
    headX: 0,
    headY: 0,
    snakeAngle: 0,
    haveSnakeID: false,
    isBoost: false,
    hasConnected: false,
    
    send: function (buf) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(buf);
    },

    _stopRuntimeTimers: function() {
        this._moveLoopStopped = true;
        if (this._moveLoopTimer) {
            clearTimeout(this._moveLoopTimer);
            this._moveLoopTimer = null;
        }
        if (this._moveLoopSpeedTimer) {
            clearTimeout(this._moveLoopSpeedTimer);
            this._moveLoopSpeedTimer = null;
        }
        if (this._ping251Interval) {
            clearInterval(this._ping251Interval);
            this._ping251Interval = null;
        }
    },
    
    connect: function() {
        const _0x3a1b = Math.random() >= 0.5;
        // Servidores custom locais/privados nao podem ser alcancados pelos
        // proxies publicos do config: conecta direto nesses casos.
        const direct = this.bypassProxy || _okIsLocalServer(this.server) ||
            !(this.proxies && this.proxies.length) || !(this.Proxies && this.Proxies.length);
        let agent;
        if (!direct) {
            agent = _0x3a1b ? createAgent(this.proxies[~~(Math.random() * this.proxies.length)]) : createHttpAgent(this.Proxies[~~(Math.random() * this.Proxies.length)]);
        }
        
        this.ws = new WebSocket(this.server, {
            headers: {
                'Origin': this.origin,
                'Accept-Encoding': 'gzip, deflate',
                'Accept-Language': 'en-US,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Connection': 'Upgrade',
                'Host': getHost(this.server),
                'Pragma': 'no-cache',
                'Upgrade': 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/localhost Safari/537.36'
            },
            agent: agent
        });
    
        this.binaryType = "nodebuffer";
        this.ws.onmessage = this.onMessage.bind(this);
        this.ws.onopen = this.onOpen.bind(this);
        this.ws.onclose = this.onClose.bind(this);
        this.ws.onerror = this.onError.bind(this);
        
        if (this.botManager) {
            this.shouldRandomize = this.botManager._0x5a8d;
            this.isZigZag = this.botManager._0x2c7e;
        }
    },
    
    setRandomMovement: function(shouldRandomize) {
        this.shouldRandomize = shouldRandomize;
        this._randomDir = null;
        this._randomDirAt = 0;
    },

    buildSpawnPacket: function() {
        var name;
        if (this.botNames && this.botNames.length > 0) {
            name = this.botNames[getRandomInt(0, this.botNames.length - 1)].trim();
        } else {
            name = 'OK Bot ' + (this.id || '');
        }
        name = name.substr(0, 40);

        var skin;
        // Cada entrada pode ser { code, tag, name }. A tag salva na skin vence;
        // tag:-1 (ou formato antigo, array puro) usa a tag global como fallback.
        var skinTag = -1;
        if (this.skinCodes && this.skinCodes.length > 0) {
            var entry = this.skinCodes[~~(Math.random() * this.skinCodes.length)];
            if (entry && Array.isArray(entry.code)) {
                skin = entry.code.slice();
                if (typeof entry.tag === 'number') skinTag = entry.tag;
            } else if (Array.isArray(entry)) {
                skin = entry.slice();
            } else {
                skin = [11, 255, 38, 255, 0, 0, 0, 143, 0, 10, 22, 6, 24];
            }
        } else {
            skin = [11, 255, 38, 255, 0, 0, 0, 143, 0, 10, 22, 6, 24];
        }

        // Tag do NTL no cabecalho do skin customizado.
        // Formato original do cliente NTL (main-mt.js):
        //   tags embutidas 0..59   -> e[0]=254, e[1]=18, e[6]=id
        //   fstags 200..367        -> e[0]=255, e[1]=38, e[6]=id-200
        //   fstags estendidas 668+ -> e[0]=255, e[1]=38, e[6]=id-500
        var tag = skinTag >= 0 ? skinTag : Math.floor(Number(this.tag));
        if (!isFinite(tag)) tag = -1;
        if (tag >= 0) {
            while (skin.length < 10) skin.push(0);
            if (tag < 60) {
                skin[0] = 254;
                skin[1] = 18;
                skin[2] = 255;
                skin[6] = tag & 255;
            } else if (tag >= 200 && tag < 368) {
                skin[0] = 255;
                skin[1] = 38;
                skin[2] = 255;
                skin[6] = (tag - 200) & 255;
            } else if (tag >= 668 && tag < 756) {
                skin[0] = 255;
                skin[1] = 38;
                skin[2] = 255;
                skin[6] = (tag - 500) & 255;
            }
        }

        // Cosmetico (acessorio oficial). 255 = nenhum.
        var cosmetic = 255;
        if (typeof this.cosmetic === 'number' && this.cosmetic >= 0 && this.cosmetic <= 31) {
            cosmetic = this.cosmetic;
        }

        var nameBytes = name.split('').map(function(c) { return c.charCodeAt(0); });
        var buf;
        if (this.spawnLayout === 'official') {
            // Layout do cliente oficial (slither.io e IPs "normais"):
            // [0]=115 [1]=30 [2..3]=versao(291) [4..23]=cpw[20] [24]=cv
            // [25]=nameLen [26..]=nome, 0, 255, skin...
            // O cpw e uma "senha" fixa do cliente; enviar 20 zeros faz o
            // servidor fechar a conexao logo apos o challenge.
            var cpw = [54, 206, 204, 169, 97, 178, 74, 136, 124, 117, 14,
                       210, 106, 236, 8, 208, 136, 213, 140, 111];
            var head = [115, 30, 1, 35];
            for (var _z = 0; _z < 20; _z++) head.push(cpw[_z]);
            head.push(0, nameBytes.length);
            buf = new Uint8Array(head.concat(nameBytes).concat([0, 255]).concat(skin));
        } else {
            // Layout NTL v11/v12/v14: [115, protocolo, skinId, nameLen, nome..., 0, cosmetico, skin...]
            var protocol = this.protocol === 11 ? 11 : 14;
            buf = new Uint8Array([115, protocol, 0, nameBytes.length].concat(nameBytes).concat([0, cosmetic]).concat(skin));
        }
        return Buffer.from(buf);
    },

    sendSpawn: function() {
        var buf = this.buildSpawnPacket();
        this.send(buf);
        if (this.botManager && this.botManager.targetXPos !== undefined && this.botManager.targetYPos !== undefined) {
            this.moveTo(this.botManager.targetXPos, this.botManager.targetYPos);
        }
    },

    spawn: function() {
        this.sendSpawn();
    },

    setZigZagMovement: function(shouldZigZag) {
      this.isZigZag = shouldZigZag;
      if (this.isZigZag) {
        this.fixedDirection = null;
        this.globalFixedDirection = null;
      } else {     
        this.fixedDirection = this.snakeAngle;
        this.globalFixedDirection = this.snakeAngle;
      }
    },

    setTornadoMovement: function(shouldTornado) {
        this.tornadoActive = shouldTornado;
        if (shouldTornado) {
            this.shouldRandomize = false;
            this.isZigZag = false;
        }
    },

    setTornadoSettings: function(settings) {
        this.tornadoSize = settings.size || 2000;
        this.tornadoSeparation = settings.separation || 800;
        this.tornadoFinalAngle = settings.finalAng || 90;
        this.tornadoRateOfChange = settings.rOC || 0.5;
        // 0 = CCW (inverte o angulo); 1 = CW (sentido padrao).
        this.tornadoRotationDir = Number(settings.rotationDir) === 0 ? 0 : 1;
    },

    setRandomRate: function(rate) {
        var n = parseFloat(rate);
        this.randomRate = isFinite(n) && n > 0 ? n : 1000;
        this._randomDir = null;
        this._randomDirAt = 0;
    },

    setWigwagSettings: function(settings) {
        if (!settings) return;
        var period = parseFloat(settings.wigwagPeriod);
        var amplitude = parseFloat(settings.wigwagAmplitude);
        this.wigwagPeriod = isFinite(period) && period > 0 ? period : 2000;
        this.wigwagAmplitude = isFinite(amplitude) && amplitude >= 0 ? amplitude : 45;
    },

    // "snakey" mantem o comportamento normal e os atalhos de teclado antigos;
    // os outros modos trocam a rotacao ativa dos bots.
    setRotationMode: function(mode) {
        this.rotationMode = mode || 'snakey';
        if (this.rotationMode === 'wigwag') {
            this.wigwagActive = true;
            this.wigwagStart = Date.now();
            this.shouldRandomize = false;
            this.tornadoActive = false;
            this.isZigZag = false;
            this.fixedCircleActive = false;
            this._modeRandom = false;
            this._modeTornado = false;
        } else if (this.rotationMode === 'random') {
            this.shouldRandomize = true;
            this.wigwagActive = false;
            this.tornadoActive = false;
            this.isZigZag = false;
            this.fixedCircleActive = false;
            this._randomDir = null;
            this._modeRandom = true;
            this._modeTornado = false;
        } else if (this.rotationMode === 'tornado') {
            this.tornadoActive = true;
            this.wigwagActive = false;
            this.shouldRandomize = false;
            this.isZigZag = false;
            this.fixedCircleActive = false;
            this._modeRandom = false;
            this._modeTornado = true;
        } else {
            // Só desliga o que foi ligado pelo seletor; atalhos Z/3 continuam.
            if (this._modeRandom) this.shouldRandomize = false;
            if (this._modeTornado) this.tornadoActive = false;
            this._modeRandom = false;
            this._modeTornado = false;
            this.wigwagActive = false;
        }
    },

    // Oscilacao esquerda-direita:periodo em ms e amplitude em graus,
    // convertida para a escala 0..250 usada pelo protocolo do jogo.
    _wigwagAngle: function() {
        var period = this.wigwagPeriod > 0 ? this.wigwagPeriod : 2000;
        var phase = ((Date.now() - this.wigwagStart) % period) / period;
        var amplitude = this.wigwagAmplitude * 125 / 180;
        var value = (this.snakeAngle || 0) + amplitude * Math.sin(phase * 2 * Math.PI);
        while (value < 0) value += 250;
        while (value >= 250) value -= 250;
        return value;
    },

    setFixedCircleMovement: function(shouldFixedCircle) {
        this.fixedCircleActive = shouldFixedCircle;
        if (shouldFixedCircle) {
            this.shouldRandomize = false;
            this.isZigZag = false;
            this.tornadoActive = false;
        }
    },

    setFixedCircleSettings: function(settings, centerX, centerY) {
        this.fixedCircleSize = settings.size || 1712;
        this.fixedCircleSeparation = settings.separation || 6000;
        this.fixedCircleFinalAngle = settings.finalAng || 110;
        this.fixedCircleRateOfChange = settings.rOC || 0.3;
        this.fixedCircleRotationDir = settings.rotationDir || 1;
        this.fixedCircleX = centerX;
        this.fixedCircleY = centerY;
    },


    getValue: function(originX, originY, targetX, targetY, shouldRandomize) {
        if (this.fixedDirection !== null) return this.fixedDirection;
        if (shouldRandomize) {
          var _0x3e2f = [0, 45, 90, 135, 180, 225];
          return _0x3e2f[Math.floor(Math.random() * _0x3e2f.length)];
        }
        var _0x8f1a = targetX - originX, _0x2c4b = targetY - originY;
        var _0x5d7c = Math.atan2(_0x2c4b, _0x8f1a) * 125 / Math.PI;
        return _0x5d7c < 0 ? _0x5d7c + 250 : _0x5d7c;
    },
          
    moveTo: function(x, y) {
        if (x === undefined || y === undefined || isNaN(x) || isNaN(y) || x === null || y === null) {
            var directions = [0, 45, 90, 135, 180, 225];
            var randomIndex = Math.floor(Math.random() * directions.length);
            var value = directions[randomIndex];
            var buf = Buffer.from([Math.floor(value)]);
            if (this.isBoost) buf = Buffer.concat([buf, Buffer.from([253])]);
            this.send(buf);
            return;
        }

        var shouldRandomize = this.shouldRandomize;
        var value;

        // Alvo selecionado (chave ou clique) tem prioridade maxima: modos como
        // L/food, random, wigwag e tornado nao podem roubar os bots do alvo.
        if (this.killMode && this.targetPlayer &&
            Number.isFinite(this.targetX) && Number.isFinite(this.targetY)) {
            // Sem posicao do alvo, cai no follow normal do jogador em vez de
            // mandar todos os bots para (0,0).
            // Mira um pouco a frente da cabeca do alvo. O lead vem da
            // velocidade reportada, nao da distancia: antigamente o lead
            // crescia com a distancia e os bots orbitavam/perdiam o alvo
            // quando ele saia do campo de visao.
            var leadX = this.targetVelocityX * 1.2;
            var leadY = this.targetVelocityY * 1.2;
            var leadMag = Math.sqrt(leadX * leadX + leadY * leadY);
            var MAX_TARGET_LEAD = 120;
            if (leadMag > MAX_TARGET_LEAD) {
                leadX = leadX * MAX_TARGET_LEAD / leadMag;
                leadY = leadY * MAX_TARGET_LEAD / leadMag;
            }
            var aheadX = this.targetX + leadX;
            var aheadY = this.targetY + leadY;

            var aimDx = aheadX - this.snakeX;
            var aimDy = aheadY - this.snakeY;
            var aimAngle = Math.atan2(aimDy, aimDx);

            while (aimAngle < 0) aimAngle += 2 * Math.PI;
            while (aimAngle >= 2 * Math.PI) aimAngle -= 2 * Math.PI;

            value = (aimAngle * 125) / Math.PI;
            if (value < 0) value += 250;
        } else if (this.foodMode) {
            value = this._foodAngle();
        } else if (this.wigwagActive) {
            value = this._wigwagAngle();
        } else if (shouldRandomize) {
            // Rate = tempo (ms) que cada direcao aleatoria e mantida. Nao cria
            // timer novo: a troca acontece naturalmente a cada chamada de moveTo.
            var now = Date.now();
            if (this._randomDir === null || now - this._randomDirAt >= this.randomRate) {
                var directions = [0, 45, 90, 135, 180, 225];
                this._randomDir = directions[Math.floor(Math.random() * directions.length)];
                this._randomDirAt = now;
            }
            value = this._randomDir;
        } else if (this.tornadoActive) {
            var dx = x - this.snakeX;
            var dy = y - this.snakeY;
            var distanceToPlayer = Math.sqrt(dx * dx + dy * dy);
            
            var baseAngle = Math.atan2(dy, dx);
            
            var safeZoneRadius = this.tornadoSeparation;
            
            
            if (distanceToPlayer <= safeZoneRadius) {
                var maxAngleRad = (this.tornadoFinalAngle * Math.PI) / 180;
                var angleModification = maxAngleRad * this.tornadoRateOfChange;
                
                if (this.tornadoRotationDir === 0) {
                    angleModification = -angleModification;
                }
                
                var finalAngle = baseAngle + (Math.PI / 2) + angleModification;
                
                while (finalAngle < 0) finalAngle += 2 * Math.PI;
                while (finalAngle >= 2 * Math.PI) finalAngle -= 2 * Math.PI;
                
                value = (finalAngle * 125) / Math.PI;
                if (value < 0) value += 250;
                
            } else if (distanceToPlayer <= this.tornadoSize) {
                var distanceRatio = (distanceToPlayer - safeZoneRadius) / (this.tornadoSize - safeZoneRadius);
                var maxAngleRad = (this.tornadoFinalAngle * Math.PI) / 180;
                
                var angleModification = maxAngleRad * (1 - distanceRatio) * this.tornadoRateOfChange;
                
                if (this.tornadoRotationDir === 0) {
                    angleModification = -angleModification;
                }
                
                var finalAngle = baseAngle + angleModification;
                
                while (finalAngle < 0) finalAngle += 2 * Math.PI;
                while (finalAngle >= 2 * Math.PI) finalAngle -= 2 * Math.PI;
                
                value = (finalAngle * 125) / Math.PI;
                if (value < 0) value += 250;
                
            } else {
                value = baseAngle * 125 / Math.PI;
                if (value < 0) value += 250;
            }
        } else if (this.fixedCircleActive && this.fixedCircleX !== null && this.fixedCircleY !== null) {
            var dx = this.fixedCircleX - this.snakeX;
            var dy = this.fixedCircleY - this.snakeY;
            var distanceToTarget = Math.sqrt(dx * dx + dy * dy);
            
            var angleToTarget = Math.atan2(dy, dx);
            
            var spiralZone = this.fixedCircleSize;
            var maxSpiralRotation = Math.PI * (this.fixedCircleFinalAngle / 180);
            var rotationDirection = this.fixedCircleRotationDir;
            
            var isExtremeAngle = this.fixedCircleFinalAngle > 180;
            
            if (distanceToTarget <= spiralZone) {
                var proximityRatio = 1 - (distanceToTarget / spiralZone);
                var currentSpiralRotation = maxSpiralRotation * proximityRatio * this.fixedCircleRateOfChange;
                
                var separationFactor = this.fixedCircleSeparation / 6000;
                
                if (separationFactor < 0.5) {
                    currentSpiralRotation *= (0.3 + separationFactor * 0.4);
                } else {
                    var circularBoost = 1 + (separationFactor - 0.5) * 1.5;
                    currentSpiralRotation *= circularBoost;
                    
                    if (this.fixedCircleSeparation >= 5000) {
                        currentSpiralRotation += (Math.PI / 4) * ((this.fixedCircleSeparation - 5000) / 1000);
                    }
                }
                
                if (isExtremeAngle) {
                    var extremeFactor = (this.fixedCircleFinalAngle - 180) / 180;
                    
                    var time = Date.now() / 1000;
                    var orbitalOffset = Math.sin(time * this.fixedCircleRateOfChange) * extremeFactor * (Math.PI / 4);
                    currentSpiralRotation += orbitalOffset;
                    
                    if (this.fixedCircleFinalAngle >= 320) {
                        var fullRotationBoost = Math.cos(time * 0.3) * extremeFactor * (Math.PI / 2);
                        currentSpiralRotation += fullRotationBoost;
                    }
                }
                
                if (rotationDirection === 1) {
                    angleToTarget += currentSpiralRotation;
                } else {
                    angleToTarget -= currentSpiralRotation;
                }
                
            } else {
                // Fora da zona espiral: movimento direto ao centro
            }
            
            while (angleToTarget < 0) angleToTarget += 2 * Math.PI;
            while (angleToTarget >= 2 * Math.PI) angleToTarget -= 2 * Math.PI;
            
            value = (angleToTarget * 125) / Math.PI;
            if (value < 0) value += 250;
        } else {
            // Follow padrao: lead compartilhado calculado no BotManager a cada
            // evento de movement, para todos os bots seguirem o mesmo ponto a
            // frente da cabeca do jogador sem formacao/offset por bot.
            var hasSharedLead = this.botManager && typeof this.botManager.playerLeadX === 'number';
            var leadX = hasSharedLead ? this.botManager.playerLeadX : this.playerVelocityX;
            var leadY = hasSharedLead ? this.botManager.playerLeadY : this.playerVelocityY;
            if (!hasSharedLead && this.playerPrevX !== 0 && this.playerPrevY !== 0) {
                this.playerVelocityX = (this.playerVelocityX * 0.7) + ((x - this.playerPrevX) * 0.3);
                this.playerVelocityY = (this.playerVelocityY * 0.7) + ((y - this.playerPrevY) * 0.3);
                leadX = this.playerVelocityX;
                leadY = this.playerVelocityY;
            }
            this.playerPrevX = x;
            this.playerPrevY = y;

            var predX = x + leadX * 1.5;
            var predY = y + leadY * 1.5;
            var dx = predX - this.snakeX;
            var dy = predY - this.snakeY;
            var theta = Math.atan2(dy, dx);
            value = theta * 125 / Math.PI;
            if (value < 0) value += 250;
        }
        
        this.snakeAngle = value;

        if (value < 0 || value > 250) {
            // console.log("Error!"); // Removed log
        }

        var buf = Buffer.from([Math.floor(value)]);
        if (this.isBoost && !(this.foodMode && (this._foodDanger || this._foodCaution))) {
            buf = Buffer.concat([buf, Buffer.from([253])]);
        }

        this.send(buf);
    },

    onOpen: function(b) {
        if (this.botManager && this.botManager.getConnectedCount() >= this.botManager.botCount) {
            this.disconnect();
            return;
        }
        this.client = this;
        this.customHandshake = _okIsCustomServer(this.server);
        this.challengeAnswered = false;
        // Formato de pacote detectado pelo challenge. custom usa u9 (tipo no
        // byte 0); oficial usa o cabecalho de 2 bytes (tipo no byte 2). A
        // deteccao final acontece em _processFrame e sobrescreve este default.
        this.u9Mode = this.customHandshake;
        this.pendingSpawn = null;
        if (this.customHandshake) {
            // Sequencia exata do NTL (AA no main-mt.js): [1], [4], [99,4|3].
            // O spawn fica pendente ate o challenge "6..." ser respondido.
            this.pendingSpawn = this.buildSpawnPacket();
            this.send(Buffer.from([1]));
            this.send(Buffer.from([4]));
            this.send(Buffer.from(this.protocol === 11 ? [99, 3] : [99, 4]));
        } else {
            this.send(Buffer.from([99]));
        }
        this.hasConnected = true;
        if (this.botManager) {
            this.botManager.incrementConnectedCount();
        }
        // Boost so e ligado quando a cobra ja existe (haveSnakeID). Antes o
        // [253] era enviado antes do spawn, o que derrubava o bot.
        this.isBoosting = false;

        // boostInterval mantido: apenas sincroniza o estado do boost com a
        // tecla E. Nao ha ciclo, pulso nem desligamento por tempo.
        this.boostInterval = setInterval(() => {
            try { this._0xupdateBoost(); } catch (e) {}
        }, 300);
    },

    onClose: function() {
        this.client = this;
        this._stopRuntimeTimers();
        this.isBoosting = false;
        if (this.boostInterval) {
            clearInterval(this.boostInterval);
            this.boostInterval = null;
        }
        this.needPing = false;
        this.haveSnakeID = false;
        if (this.botManager) {
            if (this.hasConnected) {
                this.botManager.decrementConnectedCount();
            }
            this.hasConnected = false;
            if (typeof this.botManager._0xremoveBot === 'function') {
                this.botManager._0xremoveBot(this);
            }
        }
        setTimeout(function() {}, 200);
    },

    onError: function(e) {
        this.needPing = false;
        this._stopRuntimeTimers();
        this.isBoosting = false;
        if (this.boostInterval) {
            clearInterval(this.boostInterval);
            this.boostInterval = null;
        }
        if (this.ws) {
            try { this.ws.terminate(); } catch (_0xerr) {}
        }
        if (this.botManager) {
            // Erro depois do onOpen precisa liberar o contador aqui tambem:
            // se o "close" nao chegar, o slot ficaria inflado e a reposicao
            // pararia de criar bots novos.
            if (this.hasConnected) {
                this.botManager.decrementConnectedCount();
            }
            this.hasConnected = false;
            if (typeof this.botManager._0xremoveBot === 'function') {
                this.botManager._0xremoveBot(this);
            }
        }
    },

    decodeSecrect: function(secret) {
        var _0x4e7c = new Uint8Array(24), _0x9f2a = 0;
        for (var i = 0; i < 24; i++) {
            var _0x3b6d = secret[17 + i * 2];
            if (_0x3b6d <= 96) _0x3b6d += 32;
            _0x3b6d = (_0x3b6d - 98 - i * 34) % 26;
            if (_0x3b6d < 0) _0x3b6d += 26;
            var _0x8c1f = secret[18 + i * 2];
            if (_0x8c1f <= 96) _0x8c1f += 32;
            _0x8c1f = (_0x8c1f - 115 - i * 34) % 26;
            if (_0x8c1f < 0) _0x8c1f += 26;
            var _0x2d5e = (_0x3b6d << 4) | _0x8c1f;
            var _0x7a4b = _0x2d5e >= 97 ? 97 : 65;
            _0x2d5e -= _0x7a4b;
            if (i == 0) _0x9f2a = 2 + _0x2d5e;
            _0x4e7c[i] = ((_0x2d5e + _0x9f2a) % 26 + _0x7a4b);
            _0x9f2a += 3 + _0x2d5e;
        }
        return _0x4e7c;
    },

    decodeNtlChallenge: function(secret) {
        // Copia literal de qA() do main-mt.js do NTL. O byte de tipo ("6")
        // ja foi removido pelo chamador. Retorna os 24 bytes da resposta.
        var text = '';
        try { text = Buffer.from(secret).toString('latin1'); } catch (e) { text = String(secret); }
        var out = '', d = 0, e = 23, b = 0, g = 0, z;
        while (g < text.length) {
            z = text.charCodeAt(g); g++;
            if (96 >= z) z += 32;
            z = (z - 97 - e) % 26;
            if (0 > z) z += 26;
            d *= 16; d += z; e += 17;
            if (1 == b) { out += String.fromCharCode(d); b = d = 0; }
            else b++;
        }
        // O challenge pode vir em dois formatos:
        //  1) NTL puro: string unica entre aspas -> 'XXXXXXXXXXXXXXXXXXXXXXXX'
        //  2) Vanilla/official (IPs "normais"): codigo JS com varias strings,
        //     ex.: var a = "3'jV2";a+="]Gs<-zJMgs'f!H<Lm5()*l";for(...){idba[i]=a.charCodeAt(i);}
        //     O cliente original faz eval e concatena todas as strings antes de
        //     gerar os 24 bytes (idba). O regex antigo so pegava a primeira
        //     aspas simples e gerava uma resposta invalida -> servidor fechava.
        var inner = null;
        var match = out.match(/'([^']+)'/);
        if (match && match[1].length >= 24) {
            inner = match[1];
        } else {
            // Extrai TODAS as strings entre aspas (simples ou duplas) e concatena,
            // emulando o eval() do cliente. Isso cobre o formato de codigo JS.
            var parts = [];
            var strRe = /(["'])([\s\S]*?)\1/g;
            var m;
            while ((m = strRe.exec(out)) !== null) parts.push(m[2]);
            if (parts.length) inner = parts.join('');
        }
        if (!inner) return null;
        var n0 = new Uint8Array(24);
        for (var i = 0; i < 24; i++) n0[i] = inner.charCodeAt(i) || 65;
        z = 0;
        for (var U = 0; U < n0.length; U++) {
            d = 65;
            var a = n0[U];
            if (97 <= a) { d += 32; a -= 32; }
            a -= 65;
            if (0 == U) z = 2 + a;
            e = (a + z) % 26;
            z += 3 + a;
            n0[U] = e + d;
        }
        return n0;
    },

    // Muda o boost no servidor somente quando o estado realmente muda.
    // [253] liga, [254] desliga. Nunca desliga por tempo.
    _0xsetBoost: function(want) {
        want = !!want;
        if (want === this.isBoosting) return;
        this.isBoosting = want;
        this._boostSentAt = want ? Date.now() : 0;
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send(Buffer.from([want ? 253 : 254]));
            }
        } catch (e) {}
    },

    // Boost 100% continuo: ligado enquanto a tecla E estiver ativa e a cobra
    // existir. Nao existe ciclo, pausa, distancia ou limite de massa.
    // A cada 2s o [253] e reafirmado: isso garante que TODOS os bots fiquem
    // acelerando juntos, mesmo se um pacote se perdeu ou o estado do servidor
    // ficou preso. Reafirmar nunca desliga o boost (so o [254] desliga).
    _0xupdateBoost: function() {
        var live = !!(this.ws && this.ws.readyState === WebSocket.OPEN && this.haveSnakeID);
        // O BotManager e a fonte unica do estado da tecla E. Bots que nacem
        // depois de E ligado (ou que ficaram com o flag local desatualizado)
        // aceleram da mesma forma, sem precisar apertar a tecla de novo.
        var want = this.persistentBoost;
        if (this.botManager && typeof this.botManager._0xgetBoostState === 'function' &&
            this.botManager._0xgetBoostState()) {
            want = true;
        }
        if (!want || !live) {
            this._0xsetBoost(false);
            return;
        }
        if (this.isBoosting && Date.now() - (this._boostSentAt || 0) < 2000) return;
        this.isBoosting = true;
        this._boostSentAt = Date.now();
        try { this.send(Buffer.from([253])); } catch (e) {}
    },

    boostSpeed: function(shouldBoost) {
        this.client = this;
        this.persistentBoost = !!shouldBoost;
        this._0xupdateBoost();
    },


    disconnect: function() {
        this._stopRuntimeTimers();
        if (this.ws) {
            // close() pode lancar em socket ainda CONNECTING/terminated; nao
            // pode impedir a liberacao do contador e do slot de reposicao.
            try { this.ws.close(); } catch (e) {}
        }
        this.haveSnakeID = false;
        if (this.botManager) {
            if (this.hasConnected) {
                this.botManager.decrementConnectedCount();
            }
            this.hasConnected = false;
            if (typeof this.botManager._0xremoveBot === 'function') {
                this.botManager._0xremoveBot(this);
            }
            this.botManager = null;
        }
        this.isBoosting = false;
        if (this.boostInterval) {
            clearInterval(this.boostInterval);
            this.boostInterval = null;
        }
    },

    onMessage: function(b) {
        this.client = this;
        this._processFrame(new Uint8Array(b.data));
    },

    // Servidores normais e custom usam o mesmo parser. A diferenca e o
    // formato do pacote, detectado pelo proprio challenge:
    //   NTL/u9  -> tipo no byte 0, dados a partir do byte 1.
    //   oficial -> cabecalho de 2 bytes, tipo no byte 2.
    // Ambos podem agrupar varios pacotes em um frame quando raw[0] < 32.
    _processFrame: function(_0xraw) {
        if (!_0xraw || !_0xraw.length) return;
        if (this.u9Mode === undefined) this.u9Mode = !!this.customHandshake;
        // O agrupamento so existe no formato u9. No formato oficial os
        // 2 primeiros bytes sao cabecalho e podem comecar com 0.
        if (this.u9Mode && _0xraw[0] < 32) {
            for (var _0xc = 0; _0xc < _0xraw.length;) {
                var _0xt;
                if (_0xraw[_0xc] < 32) {
                    if (_0xc + 2 > _0xraw.length) break;
                    _0xt = (_0xraw[_0xc] << 8) | _0xraw[_0xc + 1];
                    _0xc += 2;
                } else {
                    _0xt = _0xraw[_0xc] - 32;
                    _0xc++;
                }
                if (_0xt < 1 || _0xc + _0xt > _0xraw.length) break;
                this._processFrame(_0xraw.subarray(_0xc, _0xc + _0xt));
                _0xc += _0xt;
            }
            return;
        }
        if (!this.challengeAnswered) {
            if (_0xraw[0] === 54) {
                var _0xanswer = this.decodeNtlChallenge(_0xraw.subarray(1));
                if (_0xanswer) {
                    this.u9Mode = true;
                    this.challengeAnswered = true;
                    this.send(Buffer.from(_0xanswer));
                    if (this.pendingSpawn) {
                        this.send(this.pendingSpawn);
                        this.pendingSpawn = null;
                    } else {
                        this.spawn();
                    }
                }
                return;
            }
            if (_0xraw[2] === 54) {
                this.u9Mode = false;
                this.challengeAnswered = true;
                this.send(this.decodeSecrect(_0xraw));
                this.spawn();
                return;
            }
        }
        if (this.u9Mode) {
            var _0xnorm = new Uint8Array(_0xraw.length + 2);
            _0xnorm.set(_0xraw, 2);
            this._onPacket(_0xnorm);
        } else {
            this._onPacket(_0xraw);
        }
    },

    // ------------------------------------------------------------------
    // Modo autonomo (tecla L)
    // ------------------------------------------------------------------
    // Em _onPacket o tipo esta em [2]. O cliente oficial le o tipo em a[0],
    // entao a[m] do cliente corresponde a pkt[m+2] aqui.
    _pb: function(pkt, m) { return pkt[m + 2] | 0; },
    _pu16: function(pkt, m) { return ((this._pb(pkt, m) << 8) | this._pb(pkt, m + 1)) >>> 0; },
    _pu24: function(pkt, m) {
        return ((this._pb(pkt, m) << 16) | (this._pb(pkt, m + 1) << 8) | this._pb(pkt, m + 2)) >>> 0;
    },

    setFoodMode: function(enabled) {
        this.foodMode = !!enabled;
        this._releaseFoodTarget();
        this._foodBlocked = Object.create(null);
        this._foodTargetDist = 0;
        this._foodTargetSince = 0;
        if (this.foodMode) {
            this.foods.length = 0;
            this.foodById = Object.create(null);
            this.snakeBodies = Object.create(null);
            this._recentDeaths.length = 0;
            this._deadSnakes = Object.create(null);
        }
    },

    _releaseFoodTarget: function() {
        if (this._foodTarget && this.botManager && typeof this.botManager._releaseFood === 'function') {
            this.botManager._releaseFood(this, this._foodTarget.id);
        }
        this._foodTarget = null;
        this._foodTargetSince = 0;
    },

    _pruneWorld: function(now) {
        var alive = [];
        for (var i = 0; i < this.foods.length; i++) {
            var f = this.foods[i];
            if (!f.dead && now - f.t < 60000) alive.push(f);
        }
        if (alive.length > 7500) alive = alive.slice(-7500);
        this.foods = alive;
        this.foodById = Object.create(null);
        for (var j = 0; j < alive.length; j++) {
            this.foodById[String(alive[j].id)] = alive[j];
        }
        for (var key in this.snakeBodies) {
            var b = this.snakeBodies[key];
            if (!b || !b.pts.length || now - b.last > 8000) delete this.snakeBodies[key];
        }
        var deaths = [];
        for (var d = 0; d < this._recentDeaths.length; d++) {
            if (now - this._recentDeaths[d].t < 20000) deaths.push(this._recentDeaths[d]);
        }
        this._recentDeaths = deaths;
        for (var dk in this._deadSnakes) {
            if (now - this._deadSnakes[dk] > 12000) delete this._deadSnakes[dk];
        }
    },

    _addFood: function(id, x, y, rad, sx, sy) {
        if (!isFinite(x) || !isFinite(y)) return;
        var k = String(id >>> 0);
        var now = Date.now();
        var corpse = false;
        for (var i = 0; i < this._recentDeaths.length; i++) {
            var death = this._recentDeaths[i];
            var dx = x - death.x, dy = y - death.y;
            if (dx * dx + dy * dy < 900 * 900) { corpse = true; break; }
        }
        var old = this.foodById[k];
        if (old) {
            old.x = x; old.y = y; old.r = rad; old.sx = sx; old.sy = sy; old.dead = false;
            old.t = now;
            if (corpse) { old.corpse = true; old.corpseT = now; }
            return;
        }
        var f = { id: id >>> 0, x: x, y: y, r: rad, sx: sx, sy: sy, t: now,
            dead: false, corpse: corpse, corpseT: corpse ? now : 0 };
        this.foods.push(f);
        this.foodById[k] = f;
    },

    _removeFoodById: function(id) {
        var k = String(id >>> 0);
        var f = this.foodById[k];
        if (f) { f.dead = true; delete this.foodById[k]; }
    },

    _removeFoodInSector: function(sx, sy) {
        for (var i = 0; i < this.foods.length; i++) {
            var f = this.foods[i];
            if (!f.dead && f.sx === sx && f.sy === sy) {
                f.dead = true;
                if (this.foodById[String(f.id)] === f) delete this.foodById[String(f.id)];
            }
        }
    },

    // Pacote "a": configuracao inicial do mapa (centro, setores, protocolo).
    _parseConfigPacket: function(pkt) {
        var m = 1;
        this.worldCenter = this._pu24(pkt, m); m += 3;
        m += 2; // nmscps
        this.sectorSize = this._pu16(pkt, m); m += 2;
        m += 2; // sector_count_along_edge
        m += 1; // spangdv
        m += 6; // nsp1, nsp2, nsp3
        m += 4; // mamu, mamu2
        m += 2; // cst
        var alen = pkt.length - 2;
        if (m < alen) { this.protocolVersion = this._pb(pkt, m); m++; }
        if (m < alen) { this.defaultMSL = this._pb(pkt, m); m++; }
        m += 2; // real_sid
        if (m + 3 <= alen) {
            this.worldRadius = this._pu24(pkt, m); // flux_grd
        } else {
            this.worldRadius = this.worldCenter * 0.98;
        }
        this.foods.length = 0;
        this.foodById = Object.create(null);
        this.snakeBodies = Object.create(null);
        this._foodTarget = null;
    },

    // F/b/f: comida nova. Os formatos seguem exatamente o cliente oficial.
    _parseFoodPacket: function(pkt, cmd) {
        var alen = pkt.length - 2;
        var dlen = alen - 1;
        var m = 1;
        var pv = this.protocolVersion;
        var ss = this.sectorSize || 480;
        var scale = ss / 256;
        var sx, sy, rx, ry, x, y, rad, id, cv, i;
        if (cmd === 'F') {
            if (pv >= 14) {
                if (m + 2 > alen) return;
                sx = this._pb(pkt, m++); sy = this._pb(pkt, m++);
                x = sx * ss; y = sy * ss;
                while (m + 4 <= alen) {
                    cv = this._pb(pkt, m++);
                    rx = this._pb(pkt, m++); ry = this._pb(pkt, m++);
                    rad = this._pb(pkt, m++) / 5;
                    id = (((sx << 24) | (sy << 16) | (rx << 8) | ry) >>> 0);
                    this._addFood(id, x + rx * scale, y + ry * scale, rad, sx, sy);
                }
            } else if (pv >= 4) {
                while (m + 5 <= alen) {
                    cv = this._pb(pkt, m++);
                    x = this._pu16(pkt, m); m += 2;
                    y = this._pu16(pkt, m); m += 2;
                    rad = this._pb(pkt, m++) / 5;
                    id = ((y * this.worldCenter * 3 + x) >>> 0);
                    this._addFood(id, x, y, rad, Math.floor(x / ss), Math.floor(y / ss));
                }
            } else {
                if (m + 2 > alen) return;
                sx = this._pu16(pkt, m); m += 2;
                sy = this._pu16(pkt, m); m += 2;
                while (m + 5 <= alen) {
                    id = this._pu24(pkt, m); m += 3;
                    cv = this._pb(pkt, m++);
                    rx = this._pb(pkt, m++); ry = this._pb(pkt, m++);
                    rad = this._pb(pkt, m++) / 5;
                    this._addFood(id, ss * (sx + rx / 255), ss * (sy + ry / 255), rad, sx, sy);
                }
            }
            return;
        }
        // b / f: uma unica comida (b = rapid).
        if (pv >= 14) {
            if (dlen >= 5) {
                sx = this._pb(pkt, m++); sy = this._pb(pkt, m++);
                this._foodLastSX = sx; this._foodLastSY = sy;
            } else {
                sx = this._foodLastSX; sy = this._foodLastSY;
            }
            if (m + 2 > alen) return;
            rx = this._pb(pkt, m++); ry = this._pb(pkt, m++);
            x = sx * ss + rx * scale;
            y = sy * ss + ry * scale;
            id = (((sx << 24) | (sy << 16) | (rx << 8) | ry) >>> 0);
            if (dlen === 4 || dlen === 6) {
                cv = this._pb(pkt, m++); this._foodLastCV = cv;
            } else {
                cv = this._foodLastCV;
            }
            rad = this._pb(pkt, m++) / 5;
            this._addFood(id, x, y, rad, sx, sy);
        } else if (pv >= 4) {
            cv = this._pb(pkt, m++);
            if (dlen > 4 && m + 5 <= alen) {
                x = this._pu16(pkt, m); m += 2;
                y = this._pu16(pkt, m); m += 2;
                rad = this._pb(pkt, m++) / 5;
                id = ((y * this.worldCenter * 3 + x) >>> 0);
                this._addFood(id, x, y, rad, Math.floor(x / ss), Math.floor(y / ss));
            }
        } else {
            id = this._pu24(pkt, m); m += 3;
            if (dlen > 4 && m + 9 <= alen) {
                cv = this._pb(pkt, m++);
                sx = this._pu16(pkt, m); m += 2;
                sy = this._pu16(pkt, m); m += 2;
                rx = this._pb(pkt, m++); ry = this._pb(pkt, m++);
                rad = this._pb(pkt, m++) / 5;
                this._addFood(id, ss * (sx + rx / 255), ss * (sy + ry / 255), rad, sx, sy);
            }
        }
    },

    // c/C/<: comida comida (ou em processo de ser comida).
    _parseFoodEat: function(pkt, cmd) {
        var alen = pkt.length - 2;
        var dlen = alen - 1;
        var m = 1;
        var pv = this.protocolVersion;
        var sx, sy, rx, ry, x, y, id;
        if (pv >= 14) {
            if ((cmd === 'c' && dlen === 2) || (cmd === '<' && dlen === 4) || (cmd === 'C' && dlen === 2)) {
                sx = this._foodLastSX; sy = this._foodLastSY;
            } else {
                if (m + 2 > alen) return;
                sx = this._pb(pkt, m++); sy = this._pb(pkt, m++);
                this._foodLastSX = sx; this._foodLastSY = sy;
            }
            if (m + 2 > alen) return;
            rx = this._pb(pkt, m++); ry = this._pb(pkt, m++);
            id = (((sx << 24) | (sy << 16) | (rx << 8) | ry) >>> 0);
        } else if (pv >= 4) {
            if (m + 4 > alen) return;
            x = this._pu16(pkt, m); m += 2;
            y = this._pu16(pkt, m); m += 2;
            id = ((y * this.worldCenter * 3 + x) >>> 0);
        } else {
            if (m + 3 > alen) return;
            id = this._pu24(pkt, m); m += 3;
        }
        this._removeFoodById(id);
    },

    // w: remove toda a comida de um setor. z: atualiza o raio da borda.
    _parseSectorPacket: function(pkt, cmd) {
        var m = 1;
        var pv = this.protocolVersion;
        if (cmd === 'z') {
            if (pkt.length >= 5) this.worldRadius = this._pu24(pkt, m);
            return;
        }
        var xx, yy;
        if (pv >= 8) {
            xx = this._pb(pkt, m); yy = this._pb(pkt, m + 1);
        } else {
            m++; // mode
            xx = this._pu16(pkt, m); m += 2;
            yy = this._pu16(pkt, m); m += 2;
        }
        this._removeFoodInSector(xx, yy);
    },

    // s: corpo inteiro de uma cobra que entrou na visao.
    _parseSpawnBody: function(pkt, id) {
        var alen = pkt.length - 2;
        if (alen < 22) return;
        var deadAt = this._deadSnakes[String(id)];
        if (deadAt && Date.now() - deadAt < 12000) return;
        var m = 3; // depois dos 2 bytes de id
        m += 3 + 1 + 3 + 2 + 3 + 1; // ang, dir, wang, speed, fam, cv
        var x = this._pu24(pkt, m) / 5; m += 3;
        var y = this._pu24(pkt, m) / 5; m += 3;
        var nl = this._pb(pkt, m++);
        if (nl > 40 || m + nl > alen) return;
        m += nl;
        var pv = this.protocolVersion;
        if (pv >= 11) { var skl = this._pb(pkt, m++); m += skl; }
        if (pv >= 12) m++;
        var now = Date.now();
        var pts = [];
        if (m + 6 <= alen) {
            x = this._pu24(pkt, m) / 5; m += 3;
            y = this._pu24(pkt, m) / 5; m += 3;
        }
        pts.push({ x: x, y: y, t: now });
        while (m + 2 <= alen) {
            if (pv >= 15 && m + 2 === alen) break; // ultimos 2 bytes = iang
            x += (this._pb(pkt, m++) - 127) / 2;
            y += (this._pb(pkt, m++) - 127) / 2;
            if (pts.length < 200) pts.push({ x: x, y: y, t: now });
        }
        if (pts.length > 140) pts = pts.slice(-140);
        this.snakeBodies[String(id)] = { pts: pts, last: now };
    },

    // g/n/G/N/+/=: ponto novo do corpo de cada cobra.
    _parseSnakeUpdate: function(pkt, cmd) {
        var alen = pkt.length - 2;
        var dlen = alen - 1;
        var m = 1;
        var pv = this.protocolVersion;
        var isSelf;
        if (pv >= 15) {
            isSelf = (cmd === 'G' || cmd === 'N' || (cmd === '=' && dlen === 6) || (cmd === '+' && dlen === 9));
        } else {
            isSelf = ((cmd === 'g' && dlen === 4) || (cmd === 'G' && dlen === 2) ||
                      (cmd === 'n' && dlen === 7) || (cmd === 'N' && dlen === 5));
        }
        var id;
        if (isSelf) {
            if (this.snakeID === null || this.snakeID === undefined) return;
            id = this.snakeID;
        } else {
            if (m + 2 > alen) return;
            id = this._pu16(pkt, m); m += 2;
        }
        var key = String(id);
        var deadAt = this._deadSnakes[key];
        if (deadAt && Date.now() - deadAt < 12000) return;
        var body = this.snakeBodies[key];
        if (!body) { body = { pts: [], last: 0 }; this.snakeBodies[key] = body; }
        var last = body.pts[body.pts.length - 1];
        var x, y, iang;
        if (pv >= 15) {
            if (m + 2 > alen) return;
            iang = this._pu16(pkt, m); m += 2;
            if (cmd === '+' || cmd === '=') {
                if (m + 4 > alen) return;
                x = this._pu16(pkt, m); m += 2;
                y = this._pu16(pkt, m); m += 2;
            } else {
                if (!last) return;
                var ang = iang * (2 * Math.PI / 65535);
                x = last.x + Math.cos(ang) * this.defaultMSL;
                y = last.y + Math.sin(ang) * this.defaultMSL;
            }
        } else if (pv >= 3) {
            if (cmd === 'g' || cmd === 'n') {
                if (m + 4 > alen) return;
                x = this._pu16(pkt, m); m += 2;
                y = this._pu16(pkt, m); m += 2;
            } else {
                if (!last) return;
                x = last.x + this._pb(pkt, m++) - 128;
                y = last.y + this._pb(pkt, m++) - 128;
            }
        } else {
            if (m + 6 > alen) return;
            x = this._pu24(pkt, m) / 5; m += 3;
            y = this._pu24(pkt, m) / 5; m += 3;
        }
        if (!isFinite(x) || !isFinite(y)) return;
        // No protocolo 15+ a cabeca vem nesses pacotes (+/= tem coordenadas
        // absolutas; g/n vem do ultimo ponto + angulo). Mantem snakeX/Y
        // atualizado para o modo autonomo navegar a partir da posicao certa.
        if (isSelf) {
            this.snakeX = x;
            this.snakeY = y;
        }
        var now = Date.now();
        body.pts.push({ x: x, y: y, t: now });
        if (body.pts.length > 140) body.pts.shift();
        body.last = now;
    },

    // r: mortes de jogadores/bots. O cliente oficial so marca o corpo como
    // "dying" (nao traz coordenadas), entao usamos os pontos que ja tinhamos
    // do corpo para marcar a comida gerada sobre os restos como prioritaria.
    _parseDeath: function(pkt) {
        var id = this._pu16(pkt, 1);
        var key = String(id);
        var body = this.snakeBodies[key];
        delete this.snakeBodies[key];
        var now = Date.now();
        // O servidor continua mandando pontos "dying" por um instante; nao
        // podemos voltar a tratar esse corpo como obstaculo.
        this._deadSnakes[key] = now;
        if (!body || !body.pts.length) return;
        var pts = body.pts;
        var step = Math.max(1, Math.ceil(pts.length / 40));
        for (var i = 0; i < pts.length; i += step) {
            var p = pts[i];
            if (!isFinite(p.x) || !isFinite(p.y)) continue;
            this._recentDeaths.push({ x: p.x, y: p.y, t: now });
            this._markCorpseFoodNear(p.x, p.y, now);
        }
        var head = pts[pts.length - 1];
        if (isFinite(head.x) && isFinite(head.y)) {
            this._recentDeaths.push({ x: head.x, y: head.y, t: now });
            this._markCorpseFoodNear(head.x, head.y, now);
        }
        if (this._recentDeaths.length > 600) {
            this._recentDeaths = this._recentDeaths.slice(-600);
        }
    },

    _markCorpseFoodNear: function(x, y, now) {
        var r2 = 900 * 900;
        for (var i = 0; i < this.foods.length; i++) {
            var f = this.foods[i];
            if (f.dead) continue;
            var dx = f.x - x, dy = f.y - y;
            if (dx * dx + dy * dy < r2) {
                f.corpse = true;
                f.corpseT = now;
            }
        }
    },

    _angleToValue: function(rad) {
        var v = rad * 125 / Math.PI;
        while (v < 0) v += 250;
        while (v >= 250) v -= 250;
        return v;
    },

    // Diferença de angulo no intervalo [-PI, PI].
    _angleDelta: function(a, b) {
        var d = a - b;
        while (d <= -Math.PI) d += 2 * Math.PI;
        while (d > Math.PI) d -= 2 * Math.PI;
        return d;
    },

    // Direcao real da propria cobra. Derivada dos dois ultimos pontos do corpo
    // (o cliente oficial guarda o corpo de cauda para cabeca).
    _currentHeading: function() {
        var body = this.snakeBodies[String(this.snakeID)];
        if (body && body.pts.length >= 2) {
            var last = body.pts[body.pts.length - 1];
            var prev = body.pts[body.pts.length - 2];
            var dx = last.x - prev.x, dy = last.y - prev.y;
            if (dx * dx + dy * dy > 1) return Math.atan2(dy, dx);
        }
        return (this.snakeAngle || 0) * Math.PI / 125;
    },

    _nearObstacle: function(x, y, obs, r) {
        var r2 = r * r;
        for (var i = 0; i < obs.length; i++) {
            var dx = obs[i].x - x, dy = obs[i].y - y;
            if (dx * dx + dy * dy < r2) return true;
        }
        return false;
    },

    _segmentBlocked: function(x1, y1, x2, y2, obs, r) {
        var r2 = r * r;
        var vx = x2 - x1, vy = y2 - y1;
        var len2 = vx * vx + vy * vy;
        if (len2 < 1) return this._nearObstacle(x2, y2, obs, r);
        for (var i = 0; i < obs.length; i++) {
            var p = obs[i];
            var t = ((p.x - x1) * vx + (p.y - y1) * vy) / len2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            var dx = p.x - (x1 + t * vx);
            var dy = p.y - (y1 + t * vy);
            if (dx * dx + dy * dy < r2) return true;
        }
        return false;
    },

    _wanderAngle: function(obs, toCenter, heading, threatAngle) {
        var base = (heading === undefined) ? (this.snakeAngle || 0) * Math.PI / 125 : heading;
        var best = toCenter, bestScore = -Infinity;
        var radius = this.worldRadius || 0;
        for (var i = 0; i < 16; i++) {
            var a = base + (i - 8) * Math.PI / 8;
            var px = this.snakeX + Math.cos(a) * 750;
            var py = this.snakeY + Math.sin(a) * 750;
            var cd = 0, penalty = 0;
            if (radius > 0) {
                cd = Math.sqrt(Math.pow(px - this.worldCenter, 2) + Math.pow(py - this.worldCenter, 2));
                if (cd > radius - 900) penalty = (cd - radius + 900) * 4;
            }
            var clearance = 2400;
            for (var j = 0; j < obs.length; j++) {
                var dx = obs[j].x - px, dy = obs[j].y - py;
                var d2 = dx * dx + dy * dy;
                if (d2 < clearance * clearance) clearance = Math.sqrt(d2);
            }
            var score = Math.min(clearance, 1400) - penalty + (i === 8 ? 120 : 0) + Math.random() * 10;
            if (threatAngle !== undefined) {
                score += Math.abs(this._angleDelta(a, threatAngle)) * 400;
            }
            if (score > bestScore) { bestScore = score; best = a; }
        }
        return best;
    },

    // Decide para onde ir quando o modo autonomo esta ligado.
    _foodAngle: function() {
        var now = Date.now();
        this._foodDanger = false;
        this._foodCaution = false;
        if (now - this._foodLastPrune > 1000) {
            this._pruneWorld(now);
            this._foodLastPrune = now;
        }
        for (var bk in this._foodBlocked) {
            if (now - this._foodBlocked[bk] > 6000) delete this._foodBlocked[bk];
        }
        var hx = this.snakeX, hy = this.snakeY;
        var heading = this._currentHeading();
        var cx = this.worldCenter, cy = this.worldCenter;
        var toCenter = Math.atan2(cy - hy, cx - hx);
        var radius = this.worldRadius || 0;
        if (radius > 0) {
            var ddx = hx - cx, ddy = hy - cy;
            if (Math.sqrt(ddx * ddx + ddy * ddy) > radius - 1000) {
                this._releaseFoodTarget();
                return this._angleToValue(toCenter);
            }
        }

        var obs = [];
        var heads = [];
        var selfKey = String(this.snakeID);
        for (var key in this.snakeBodies) {
            if (key === selfKey) continue;
            var b = this.snakeBodies[key];
            if (!b || now - b.last > 6000) continue;
            var pts = b.pts;
            var start = Math.max(0, pts.length - 100);
            for (var i = start; i < pts.length; i++) {
                var p = pts[i];
                var px = p.x - hx, py = p.y - hy;
                if (px * px + py * py < 1800 * 1800) obs.push(p);
            }
            if (pts.length && now - b.last < 1500) heads.push(pts[pts.length - 1]);
        }

        // Ameaca = corpo muito perto ou corpo na frente no caminho provavel.
        // A fuga usando so "oposto ao ponto mais proximo" chega tarde porque a
        // cobra nao vira instantaneamente.
        var threat = null, threatDist = Infinity;
        for (var n = 0; n < obs.length; n++) {
            var ox = obs[n].x - hx, oy = obs[n].y - hy;
            var od = ox * ox + oy * oy;
            if (od > 900 * 900) continue;
            var oa = Math.atan2(oy, ox);
            var rel = Math.abs(this._angleDelta(oa, heading));
            // Zona de cautela: mais larga, so desliga o boost; a fuga real
            // continua usando o limiar menor abaixo.
            if (od < 350 * 350 || (rel < 0.9 && od < 900 * 900)) {
                this._foodCaution = true;
            }
            if (od < 160 * 160 || (rel < 1.2 && od < 260 * 260) || (rel < 1.0 && od < 600 * 600)) {
                if (od < threatDist) { threatDist = od; threat = obs[n]; }
            }
        }
        this._foodDanger = !!threat;
        if (threat) {
            this._releaseFoodTarget();
            var threatAngle = Math.atan2(threat.y - hy, threat.x - hx);
            var escape = this._wanderAngle(obs, toCenter, heading, threatAngle);
            return this._angleToValue(escape);
        }
        if (this._foodTarget) {
            var tid = String(this._foodTarget.id);
            if (this._foodTarget.dead) {
                this._releaseFoodTarget();
            } else {
                var tdx = this._foodTarget.x - hx, tdy = this._foodTarget.y - hy;
                var td = Math.sqrt(tdx * tdx + tdy * tdy);
                // Qualquer mudanca relevante de distancia (chegando mais perto
                // OU o alvo tendo se afastado) conta como progresso: so entra
                // na blacklist se a distancia ficar parada por muito tempo.
                if (!this._foodTargetSince || !isFinite(this._foodTargetDist) ||
                    this._foodTargetDist === 0 || Math.abs(td - this._foodTargetDist) > 8) {
                    this._foodTargetDist = td;
                    this._foodTargetSince = now;
                } else if (now - this._foodTargetSince > 1600) {
                    this._foodBlocked[tid] = now;
                    this._releaseFoodTarget();
                }
            }
        }

        var candidates = [];
        var maxD2 = 3000 * 3000;
        for (var f = 0; f < this.foods.length; f++) {
            var food = this.foods[f];
            if (food.dead) continue;
            if (this.botManager && typeof this.botManager._foodClaimedByOther === 'function' &&
                this.botManager._foodClaimedByOther(food.id, this)) continue;
            var fid = String(food.id);
            if (this._foodBlocked[fid] && now - this._foodBlocked[fid] <= 6000) continue;
            var fx = food.x - hx, fy = food.y - hy;
            var d2 = fx * fx + fy * fy;
            if (d2 > maxD2 || d2 < 36) continue;
            var d = Math.sqrt(d2);
            // Comida muito perto e de lado/tras exigiria uma curva maior que a
            // propria distancia; o bot ficaria enrolando nela.
            var turn = Math.abs(this._angleDelta(Math.atan2(fy, fx), heading));
            if (d < 260 && turn > 0.9) continue;
            if (radius > 0) {
                var fdx = food.x - cx, fdy = food.y - cy;
                if (Math.sqrt(fdx * fdx + fdy * fdy) > radius - 400) continue;
            }
            if (this._nearObstacle(food.x, food.y, obs, 210)) continue;
            if (d2 > 10000 && this._segmentBlocked(hx, hy, food.x, food.y, obs, 140)) continue;
            var tooClose = false;
            for (var hi = 0; hi < heads.length; hi++) {
                var hdx = heads[hi].x - food.x, hdy = heads[hi].y - food.y;
                if (hdx * hdx + hdy * hdy < 260 * 260) { tooClose = true; break; }
            }
            if (tooClose) continue;
            // Custo combina distancia, esforco de virada e tamanho da comida.
            // Quanto maior o raio, mais massa ela da, entao o custo cai.
            var radiusFood = Math.min(food.r || 1, 6);
            var sizeBonus = (radiusFood - 1) * 180;
            // Restos de cobras mortas valem mais: sao comida concentrada.
            // O bonus expira para o bot nao ficar perseguindo um ponto velho.
            if (food.corpse && now - (food.corpseT || food.t) < 20000) sizeBonus += 900;
            // Igual ao auto-farm do NTL: preferir areas com varias comidas
            // juntas limpa o chao mais rapido do que ir de pellet em pellet.
            var cluster = 0;
            var flim = Math.min(this.foods.length, 2000);
            for (var nf = 0; nf < flim && cluster < 8; nf++) {
                var other = this.foods[nf];
                if (other === food || other.dead) continue;
                var ox = other.x - food.x, oy = other.y - food.y;
                if (ox * ox + oy * oy < 450 * 450) cluster++;
            }
            sizeBonus += cluster * 150;
            candidates.push({ f: food, d: d, cost: d + 700 * turn - sizeBonus });
        }
        if (!candidates.length) {
            this._releaseFoodTarget();
            return this._wanderAngle(obs, toCenter, heading);
        }
        candidates.sort(function(a, b) { return a.cost - b.cost; });
        var chosen = candidates[0].f;
        if (this._foodTarget && !this._foodTarget.dead) {
            for (var c = 0; c < candidates.length && c < 12; c++) {
                if (candidates[c].f === this._foodTarget) {
                    if (candidates[c].cost < candidates[0].cost * 1.25) chosen = this._foodTarget;
                    break;
                }
            }
        }
        var previousTarget = this._foodTarget;
        var changed = previousTarget !== chosen;
        if (changed && previousTarget && this.botManager && typeof this.botManager._releaseFood === 'function') {
            this.botManager._releaseFood(this, previousTarget.id);
        }
        this._foodTarget = chosen;
        if (this.botManager && typeof this.botManager._claimFood === 'function') {
            this.botManager._claimFood(this, chosen.id);
        }
        if (changed || !this._foodTargetSince) {
            this._foodTargetSince = now;
            for (var q = 0; q < candidates.length; q++) {
                if (candidates[q].f === chosen) { this._foodTargetDist = candidates[q].d; break; }
            }
        }
        return this._angleToValue(Math.atan2(chosen.y - hy, chosen.x - hx));
    },
 
    _onPacket: function(_0x4c8d) {
        var _0x9e2f = String.fromCharCode(_0x4c8d[2]);
        // Corpo das cobras (usado pelo modo autonomo para nao bater nelas).
        // Só processa quando a tecla L esta ligada, para nao custar CPU nos
        // bots que estao apenas seguindo o jogador.
        if (this.foodMode && (_0x9e2f === 'g' || _0x9e2f === 'n' || _0x9e2f === 'G' ||
            _0x9e2f === 'N' || _0x9e2f === '+' || _0x9e2f === '=')) {
            try { this._parseSnakeUpdate(_0x4c8d, _0x9e2f); } catch (e) {}
        }
        // r: uma cobra morreu. O corpo deixa de ser obstaculo e a comida que
        // aparecer no local e tratada como resto (prioridade no modo L).
        if (this.foodMode && _0x9e2f === 'r' && _0x4c8d.length >= 4) {
            try { this._parseDeath(_0x4c8d); } catch (e) {}
        }
        if (2 <= _0x4c8d.length) {
            if ("6" == _0x9e2f) {
                this.send(this.decodeSecrect(_0x4c8d));
                this.spawn();
            } else if ("p" == _0x9e2f) {
                this.needPing = true;
            } else if ("a" == _0x9e2f) {
                this._parseConfigPacket(_0x4c8d);
                this._stopRuntimeTimers();
                var self = this;
                this._moveLoopStopped = false;
                this._moveLoopDelay = 180;
                function _0x7f3a() {
                    if (self._moveLoopStopped) return;
                    if (self.client && self.botManager) { 
                        self.client.moveTo(self.botManager.xPos, self.botManager.yPos);
                    }
                    self._moveLoopTimer = setTimeout(_0x7f3a, self._moveLoopDelay);
                }
                _0x7f3a();
                this._moveLoopSpeedTimer = setTimeout(function() {
                    self._moveLoopDelay = 190;
                }, 60 * 1000);
                this._ping251Interval = setInterval(function() {
                    self.send(Buffer.from([251]));
                }, 150);
            } else if ("v" == _0x9e2f) {
                this.haveSnakeID = false;
                this.disconnect();
            } else if ("g" == _0x9e2f) {
                var _0xpacketId = ((_0x4c8d[3] & 0xff) << 8 | (_0x4c8d[4] & 0xff));
                if (_0xpacketId == this.snakeID) {
                    this.snakeX = ((_0x4c8d[5] & 0xff) << 8) | (_0x4c8d[6] & 0xff);
                    this.snakeY = ((_0x4c8d[7] & 0xff) << 8) | (_0x4c8d[8] & 0xff);
                }
                if (this.killMode && this.targetPlayer && _0xpacketId != this.snakeID && _0xpacketId == this.targetPlayer.targetId) {
                    this.targetPrevX = this.targetX;
                    this.targetPrevY = this.targetY;
                    this.targetX = ((_0x4c8d[5] & 0xff) << 8) | (_0x4c8d[6] & 0xff);
                    this.targetY = ((_0x4c8d[7] & 0xff) << 8) | (_0x4c8d[8] & 0xff);
                    this.targetVelocityX = this.targetX - this.targetPrevX;
                    this.targetVelocityY = this.targetY - this.targetPrevY;
                    if (this.botManager && this.botManager._0xreportPlayerPos) {
                        this.botManager._0xreportPlayerPos(_0xpacketId, this.targetX, this.targetY);
                    }
                }
            } else if ("n" == _0x9e2f) {
                var _0xpacketId = ((_0x4c8d[3] & 0xff) << 8 | (_0x4c8d[4] & 0xff));
                if (_0xpacketId == this.snakeID) {
                    this.snakeX = ((_0x4c8d[5] & 0xff) << 8) | (_0x4c8d[6] & 0xff);
                    this.snakeY = ((_0x4c8d[7] & 0xff) << 8) | (_0x4c8d[8] & 0xff);
                }
                if (this.killMode && this.targetPlayer && _0xpacketId != this.snakeID && _0xpacketId == this.targetPlayer.targetId) {
                    this.targetPrevX = this.targetX;
                    this.targetPrevY = this.targetY;
                    this.targetX = ((_0x4c8d[5] & 0xff) << 8) | (_0x4c8d[6] & 0xff);
                    this.targetY = ((_0x4c8d[7] & 0xff) << 8) | (_0x4c8d[8] & 0xff);
                    this.targetVelocityX = this.targetX - this.targetPrevX;
                    this.targetVelocityY = this.targetY - this.targetPrevY;
                    if (this.botManager && this.botManager._0xreportPlayerPos) {
                        this.botManager._0xreportPlayerPos(_0xpacketId, this.targetX, this.targetY);
                    }
                }
            } else if ("G" == _0x9e2f) {
                var _0xpacketId = ((_0x4c8d[3] & 0xff) << 8 | (_0x4c8d[4] & 0xff));
                if (_0xpacketId == this.snakeID) {
                    if (this.snakeX && this.snakeY) {
                        this.snakeX = _0x4c8d[5] - 128 + this.snakeX;
                        this.snakeY = _0x4c8d[6] - 128 + this.snakeY;
                    }
                }
                if (this.killMode && this.targetPlayer && _0xpacketId != this.snakeID && _0xpacketId == this.targetPlayer.targetId) {
                    if (this.targetX && this.targetY) {
                        this.targetPrevX = this.targetX;
                        this.targetPrevY = this.targetY;
                        this.targetX = _0x4c8d[5] - 128 + this.targetX;
                        this.targetY = _0x4c8d[6] - 128 + this.targetY;
                        this.targetVelocityX = this.targetX - this.targetPrevX;
                        this.targetVelocityY = this.targetY - this.targetPrevY;
                        if (this.botManager && this.botManager._0xreportPlayerPos) {
                            this.botManager._0xreportPlayerPos(_0xpacketId, this.targetX, this.targetY);
                        }
                    }
                }
            } else if ("N" == _0x9e2f) {
                var _0xpacketId = ((_0x4c8d[3] & 0xff) << 8 | (_0x4c8d[4] & 0xff));
                if (_0xpacketId == this.snakeID) {
                    if (this.snakeX && this.snakeY) {
                        this.snakeX = _0x4c8d[5] - 128 + this.snakeX;
                        this.snakeY = _0x4c8d[6] - 128 + this.snakeY;
                    }
                }
                if (this.killMode && this.targetPlayer && _0xpacketId != this.snakeID && _0xpacketId == this.targetPlayer.targetId) {
                    if (this.targetX && this.targetY) {
                        this.targetPrevX = this.targetX;
                        this.targetPrevY = this.targetY;
                        this.targetX = _0x4c8d[5] - 128 + this.targetX;
                        this.targetY = _0x4c8d[6] - 128 + this.targetY;
                        this.targetVelocityX = this.targetX - this.targetPrevX;
                        this.targetVelocityY = this.targetY - this.targetPrevY;
                        if (this.botManager && this.botManager._0xreportPlayerPos) {
                            this.botManager._0xreportPlayerPos(_0xpacketId, this.targetX, this.targetY);
                        }
                    }
                }
            } else if ("s" == _0x9e2f) {
                var _0xspawnId = ((_0x4c8d[3] & 0xff) << 8) | (_0x4c8d[4] & 0xff);
                if (this.foodMode) { try { this._parseSpawnBody(_0x4c8d, _0xspawnId); } catch (e) {} }
                var _0xspawnName = '';
                var _0xnameLen1 = _0x4c8d[5] || 0;
                if (_0xnameLen1 > 0 && _0xnameLen1 < 40 && _0x4c8d.length >= 6 + _0xnameLen1) {
                    for (var _0xi = 0; _0xi < _0xnameLen1; _0xi++) {
                        _0xspawnName += String.fromCharCode(_0x4c8d[6 + _0xi]);
                    }
                }
                if (_0xspawnName.length < 2 || !/^[ -~]+$/.test(_0xspawnName)) {
                    _0xspawnName = '';
                    for (var _0xi = 8; _0xi < _0x4c8d.length - 2; _0xi++) {
                        var _0xnameLen2 = _0x4c8d[_0xi] || 0;
                        if (_0xnameLen2 > 0 && _0xnameLen2 < 40 && _0x4c8d.length >= _0xnameLen2 + _0xi + 1) {
                            var _0xtmp = '';
                            for (var _0j = 0; _0j < _0xnameLen2; _0j++) {
                                _0xtmp += String.fromCharCode(_0x4c8d[_0xi + 1 + _0j]);
                            }
                            if (/^[ -~]{2,}$/.test(_0xtmp)) { _0xspawnName = _0xtmp; break; }
                        }
                    }
                }
                if (_0xspawnName && this.botManager) {
                    var _0xspawnX = 0, _0xspawnY = 0;
                    if (_0x4c8d.length >= 24) {
                        _0xspawnX = ((_0x4c8d[18] << 16) | (_0x4c8d[19] << 8) | _0x4c8d[20]) / 5;
                        _0xspawnY = ((_0x4c8d[21] << 16) | (_0x4c8d[22] << 8) | _0x4c8d[23]) / 5;
                    }
                    this.botManager._0xreportPlayer(_0xspawnId, _0xspawnName, _0xspawnX, _0xspawnY);
                }
                if (!this.haveSnakeID) {
                    this.snakeID = _0xspawnId;
                    this.haveSnakeID = true;
                    if (this.botManager) this.botManager._0xregisterBotSnakeId(this.snakeID);
                    if (_0x4c8d.length >= 24) {
                        this.snakeX = ((_0x4c8d[18] << 16) | (_0x4c8d[19] << 8) | _0x4c8d[20]) / 5;
                        this.snakeY = ((_0x4c8d[21] << 16) | (_0x4c8d[22] << 8) | _0x4c8d[23]) / 5;
                    }
                    
                    // Bot que nasceu com a tecla E ligada entra ja acelerando,
                    // mas somente agora que a cobra existe (haveSnakeID).
                    if (this.persistentBoost) {
                        setTimeout(() => {
                            try { this._0xupdateBoost(); } catch (e) {}
                        }, 300);
                    }
                }
                if (this.killMode && this.targetPlayer && _0xspawnId == this.targetPlayer.targetId) {
                    if (_0x4c8d.length >= 24) {
                        this.targetX = ((_0x4c8d[18] << 16) | (_0x4c8d[19] << 8) | _0x4c8d[20]) / 5;
                        this.targetY = ((_0x4c8d[21] << 16) | (_0x4c8d[22] << 8) | _0x4c8d[23]) / 5;
                        this.targetPrevX = this.targetX;
                        this.targetPrevY = this.targetY;
                        if (this.botManager && this.botManager._0xreportPlayerPos) {
                            this.botManager._0xreportPlayerPos(_0xspawnId, this.targetX, this.targetY);
                        }
                    }
                }
            } else if ("F" == _0x9e2f || "b" == _0x9e2f || "f" == _0x9e2f) {
                if (this.foodMode) { try { this._parseFoodPacket(_0x4c8d, _0x9e2f); } catch (e) {} }
            } else if ("c" == _0x9e2f || "C" == _0x9e2f || "<" == _0x9e2f) {
                if (this.foodMode) { try { this._parseFoodEat(_0x4c8d, _0x9e2f); } catch (e) {} }
            } else if ("w" == _0x9e2f || "z" == _0x9e2f) {
                if (this.foodMode) { try { this._parseSectorPacket(_0x4c8d, _0x9e2f); } catch (e) {} }
            }
        }
    }
};

module.exports = Bot;