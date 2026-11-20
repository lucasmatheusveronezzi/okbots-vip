'use strict';
const _0x7f4a = require('./Bot');
const _0x3c2d = require('fs');

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
        this._0x4b6c = _0x3c2d.readFileSync("./config/proxies.txt", "utf8").split("\n").filter(_0x1a => !!_0x1a);
        this._0x7d9e = _0x3c2d.readFileSync("./config/httpProxy.txt", "utf8").split("\n").filter(_0x2f => !!_0x2f);
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
        this._0x6e4a();
    }

    _0x3f7b(_0x4c8d, _0x9e2f) {
        this._0x5f8e = _0x4c8d;
        this._0x1d3b = _0x9e2f;
    }

    _setSpawnInfo(protocol, layout, bypassProxy) {
        if (protocol === 11 || protocol === 12 || protocol === 14) this._protocol = protocol;
        if (layout === 'ntl' || layout === 'official') this._spawnLayout = layout;
        if (typeof bypassProxy === 'boolean') this._bypassProxy = bypassProxy;
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
        }, 1);
    }

    _0x8c7f() {
        this._0xstopAllBots();
        
        var _0x3b6d = this;
        var _0x8f1a = 0;
        this._0xbotInterval = setInterval(() => {
            // Logica original: cria bots enquanto faltam conexoes abertas.
            if (_0x3b6d.getConnectedCount() >= _0x3b6d._0x9f2c) return;
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
        }, 1);
    }

    _0xstopAllBots() {
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

module.exports = _0x9e4b;