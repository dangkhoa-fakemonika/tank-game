const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*" }
});

// --- CONFIGURATION ---
const TICK_RATE = 60; // Physics updates per second
const SEND_RATE = 30; // Network broadcasts per second
const TICK_DT = 1000 / TICK_RATE;

const TILE_SIZE = 25;
const COLS = 32; // 800 / 25
const ROWS = 24; // 600 / 25

const TANK_RADIUS = 10;
const BULLET_RADIUS = 4;
const PAD = 4; // Wall collision tolerance
const MOVE_SPEED = 3;
const BULLET_SPEED = 7;
const RELOAD_TIME = 30; // 0.5s at 60 ticks

const HIT_DIST_SQ = (TANK_RADIUS + BULLET_RADIUS) ** 2;
const PICKUP_DIST_SQ = (20) ** 2;
const RUSH_DIST_SQ = (30) ** 2;

const ROTATION_SPEED = 0.1;

const PLAYERS = {};
let bullets = [];
let mapItems = [];
const MAP = [];

const POWERUP_TYPES = [
    'speed',
    'shield',
    'bounce',
    'rush',
    'autofire',
    'stealth',
    'parry',
    'laser',
    'explosion'
];
const MAX_POWERUPS = 5;

// --- MAP GENERATION ---
for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
        // Borders OR 10% chance of random obstacle
        if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) {
            row.push(1);
        } else if (Math.random() < 0.1) {
            row.push(1);
        } else {
            row.push(0);
        }
    }
    MAP.push(row);
}

// --- HELPER FUNCTIONS ---

function isColliding(x, y) {
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
    return MAP[row][col] === 1;
}

function canMove(x, y, oldVal) {
    // Check two corners of the tank in the direction of movement
    if (x < oldVal) { // Moving Left/Up relative to axis
        return !(isColliding(x - TANK_RADIUS, y - TANK_RADIUS + PAD) ||
            isColliding(x - TANK_RADIUS, y + TANK_RADIUS - PAD));
    } else if (x > oldVal) { // Moving Right/Down
        return !(isColliding(x + TANK_RADIUS, y - TANK_RADIUS + PAD) ||
            isColliding(x + TANK_RADIUS, y + TANK_RADIUS - PAD));
    }
    return true;
}

function isSafeSpawn(x, y) {
    if (isColliding(x, y)) return false;
    const R = 10;
    if (isColliding(x - R, y - R)) return false;
    if (isColliding(x + R, y - R)) return false;
    if (isColliding(x - R, y + R)) return false;
    if (isColliding(x + R, y + R)) return false;
    return true;
}

function createExplosion(x, y, ownerId) {
    const RADIUS_SQ = 60 * 60; // 60px radius
    io.volatile.emit('explosion', { x, y });

    for (const id in PLAYERS) {
        const p = PLAYERS[id];
        if (p.isDead) continue;

        const distSq = (p.x - x)**2 + (p.y - y)**2;
        if (distSq < RADIUS_SQ) {
            if (p.invulnerableTimer > 0) continue;
            if (p.activeItem === 'shield') {
                p.activeItem = null;
                p.invulnerableTimer = 60;
                continue;
            }

            killPlayer(p, ownerId);
        }
    }
}

function castRay(startX, startY, angle, shooterId, maxDist = 1000) {
    let x = startX;
    let y = startY;
    const step = 5;
    const dx = Math.cos(angle) * step;
    const dy = Math.sin(angle) * step;
    let dist = 0;

    while (dist < maxDist) {
        x += dx;
        y += dy;
        dist += step;

        if (isColliding(x, y)) return { x, y, hit: 'wall', dist };

        for (const targetId in PLAYERS) {
            if (targetId === shooterId) continue;
            const target = PLAYERS[targetId];
            if (target.isDead) continue;

            const dSq = (target.x - x)**2 + (target.y - y)**2;
            if (dSq < 225) {
                return { x, y, hit: 'player', playerId: targetId, dist };
            }
        }
    }
    return { x, y, hit: null, dist };
}

function killPlayer(victim, killerId) {
    victim.isDead = true;
    victim.hp = 0;
    victim.respawnTimer = 180;

    if (killerId && PLAYERS[killerId] && killerId !== victim.id) {
        PLAYERS[killerId].score++;
    }
}

// --- MAIN LOGIC ---

function updatePhysics() {
    // 1. PLAYERS
    for (const id in PLAYERS) {
        const p = PLAYERS[id];

        // Dead Logic
        if (p.isDead) {
            p.respawnTimer--;
            if (p.respawnTimer <= 0) {
                // Respawn
                p.isDead = false;
                p.hp = 1;
                p.invisible = false;
                p.activeItem = null;
                p.invulnerableTimer = 120;

                let startX, startY, attempts = 0;
                do {
                    startX = 20 + Math.random() * 760;
                    startY = 20 + Math.random() * 560;
                    attempts++;
                } while (!isSafeSpawn(startX, startY) && attempts < 50);
                p.x = startX;
                p.y = startY;
            }
            continue;
        }

        // Timers
        if (p.invulnerableTimer > 0) p.invulnerableTimer--;
        if (p.reloadTimer > 0) p.reloadTimer--;
        if (p.buffTimer > 0) {
            p.buffTimer--;
            if (p.buffTimer <= 0) p.activeItem = null;
        }

        // Movement Speed
        let currentSpeed = MOVE_SPEED;
        if (p.activeItem === 'speed') currentSpeed *= 1.5;
        if (p.activeItem === 'rush') currentSpeed *= 2.0;

        // Input
        let newX = p.x;
        let newY = p.y;
        if (p.input.w) newY -= currentSpeed;
        if (p.input.s) newY += currentSpeed;
        if (p.input.a) newX -= currentSpeed;
        if (p.input.d) newX += currentSpeed;

        // Collision Check & Move
        if (canMove(newX, p.y, p.x)) p.x = newX;
        if (canMove(p.x, newY, p.y)) p.y = newY;

        // Rotation
        if (p.input.arrowleft) p.angle -= ROTATION_SPEED;
        if (p.input.arrowright) p.angle += ROTATION_SPEED;

        // Boundaries
        p.x = Math.max(20, Math.min(780, p.x));
        p.y = Math.max(20, Math.min(580, p.y));

        // Shooting Logic
        if (p.input[' '] && p.reloadTimer === 0) {
            handleShooting(p, id);
        }
    }

    // 2. BULLETS
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];

        // Move X
        b.x += b.vx;
        if (isColliding(b.x, b.y)) {
            if (b.type === 'explosion') {
                createExplosion(b.x, b.y, b.ownerId);
                bullets.splice(i, 1); continue;
            }
            b.x -= b.vx; b.vx *= -1; b.bounces--;
        }

        // Move Y
        b.y += b.vy;
        if (isColliding(b.x, b.y)) {
            if (b.type === 'explosion') {
                createExplosion(b.x, b.y, b.ownerId);
                bullets.splice(i, 1); continue;
            }
            b.y -= b.vy; b.vy *= -1; b.bounces--;
        }

        if (b.bounces < 0 || b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) {
            bullets.splice(i, 1);
        }
    }
}

function handleShooting(p, id) {
    if (p.activeItem === 'rush') return;

    // Stealth Break
    if (p.invisible) {
        p.invisible = false;
        p.activeItem = null;
    }

    // Default Reload
    p.reloadTimer = RELOAD_TIME;

    // LASER LOGIC
    if (p.activeItem === 'laser') {
        p.reloadTimer = 60;
        const beam1 = castRay(p.x, p.y, p.angle, id);
        if (beam1.hit === 'player' && beam1.playerId) handleLaserHit(beam1.playerId, id);

        let beam2 = null;
        if (beam1.hit === 'wall') {
            // Simple bounce calculation
            const testX = beam1.x - Math.cos(p.angle) * 5;
            const isVerticalHit = isColliding(testX, beam1.y);
            const bounceAngle = isVerticalHit ? -p.angle : Math.PI - p.angle;

            beam2 = castRay(beam1.x, beam1.y, bounceAngle, id);
            if (beam2.hit === 'player' && beam2.playerId) handleLaserHit(beam2.playerId, id);
        }

        io.volatile.emit('laser', { x1: p.x, y1: p.y, x2: beam1.x, y2: beam1.y, x3: beam2?.x, y3: beam2?.y });
        return;
    }

    // NORMAL/EXPLOSIVE LOGIC
    if (p.activeItem === 'autofire') p.reloadTimer = 15;

    let bSpeed = BULLET_SPEED;
    if (p.activeItem === 'speed') bSpeed *= 1.5;

    let bBounces = 1;
    if (p.activeItem === 'bounce') bBounces = 3;
    if (p.activeItem === 'explosion') bBounces = 0;

    bullets.push({
        id: Math.random().toString(36),
        x: p.x + Math.cos(p.angle) * 20,
        y: p.y + Math.sin(p.angle) * 20,
        vx: Math.cos(p.angle) * bSpeed,
        vy: Math.sin(p.angle) * bSpeed,
        type: p.activeItem === 'explosion' ? 'explosion' : 'normal',
        bounces: bBounces,
        ownerId: id
    });
}

function handleLaserHit(victimId, shooterId) {
    const victim = PLAYERS[victimId];
    if (!victim || victim.isDead) return;

    if (victim.invulnerableTimer > 0) return;

    if (victim.activeItem === 'parry') {
        victim.activeItem = null;
        const shooter = PLAYERS[shooterId];
        if (shooter) killPlayer(shooter, victimId);
    } else {
        killPlayer(victim, shooterId);
    }
}

function updateGameLogic() {
    // 1. Spawning
    if (mapItems.length < MAX_POWERUPS && Math.random() < 0.01) {
        const px = 20 + Math.random() * 760;
        const py = 20 + Math.random() * 560;
        if (isSafeSpawn(px, py)) {
            const isStacked = mapItems.some(i => (i.x-px)**2 + (i.y-py)**2 < 900);
            if (!isStacked) {
                const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
                mapItems.push({ id: Math.random().toString(36), x: px, y: py, type });
            }
        }
    }

    // 2. Combat (Bullets vs Players)
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        for (const id in PLAYERS) {
            const p = PLAYERS[id];
            if (p.isDead || b.ownerId === id) continue;

            const distSq = (b.x - p.x)**2 + (b.y - p.y)**2;
            if (distSq < HIT_DIST_SQ) {
                // EXPLOSION
                if (b.type === 'explosion') {
                    createExplosion(b.x, b.y, b.ownerId);
                    bullets.splice(i, 1);
                    break;
                }

                // PARRY
                if (p.activeItem === 'parry') {
                    p.activeItem = null;
                    b.vx = -b.vx; b.vy = -b.vy;
                    b.ownerId = id; // Steal ownership
                    b.bounces = 2;
                    b.x += b.vx * 2; b.y += b.vy * 2;
                    continue;
                }

                // SHIELD / INVULNERABLE
                if (p.activeItem === 'shield') {
                    p.activeItem = null;
                    p.invulnerableTimer = 90;
                    bullets.splice(i, 1);
                    continue;
                }
                if (p.invulnerableTimer > 0) {
                    bullets.splice(i, 1);
                    continue;
                }

                // STEALTH BREAK
                if (p.invisible) { p.invisible = false; p.activeItem = null; }

                // KILL
                killPlayer(p, b.ownerId);
                bullets.splice(i, 1);
                break;
            }
        }
    }

    // 3. Tank vs Tank (Rush)
    const ids = Object.keys(PLAYERS);
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const p1 = PLAYERS[ids[i]];
            const p2 = PLAYERS[ids[j]];
            if (p1.isDead || p2.isDead) continue;

            const distSq = (p1.x - p2.x)**2 + (p1.y - p2.y)**2;
            if (distSq < RUSH_DIST_SQ) {
                if (p1.activeItem === 'rush' && p2.activeItem !== 'rush') killPlayer(p2, ids[i]);
                else if (p2.activeItem === 'rush' && p1.activeItem !== 'rush') killPlayer(p1, ids[j]);
            }
        }
    }

    // 4. Pickups
    for (let i = mapItems.length - 1; i >= 0; i--) {
        const item = mapItems[i];
        for (const id in PLAYERS) {
            const p = PLAYERS[id];
            if (p.isDead) continue;
            const distSq = (p.x - item.x)**2 + (p.y - item.y)**2;
            if (distSq < PICKUP_DIST_SQ) {
                let picked = false;
                if (!p.activeItem) {
                    p.activeItem = item.type;
                    p.buffTimer = 0;
                    picked = true;

                    if (item.type === 'rush') p.buffTimer = 600;
                    if (item.type === 'stealth') { p.invisible = true; }
                } else {
                    for (let s = 0; s < 3; s++) {
                        if (p.inventory[s] === null) { p.inventory[s] = item.type; picked = true; break; }
                    }
                }
                if (picked) { mapItems.splice(i, 1); break; }
            }
        }
    }
}

// --- SOCKETS ---

io.on('connection', (socket) => {
    console.log('Player joined:', socket.id);
    socket.emit('map', { grid: MAP, tileSize: TILE_SIZE });

    // Spawn Logic
    let startX, startY, attempts = 0;
    do {
        startX = 20 + Math.random() * 760;
        startY = 20 + Math.random() * 560;
        attempts++;
    } while (!isSafeSpawn(startX, startY) && attempts < 100);

    PLAYERS[socket.id] = {
        id: socket.id,
        x: startX, y: startY, angle: 0,
        color: '#' + Math.floor(Math.random() * 16777215).toString(16),
        input: { w: false, a: false, s: false, d: false, arrowleft: false, arrowright: false },
        hp: 1, maxHp: 1, score: 0, isDead: false, respawnTimer: 0,
        inventory: [null, null, null], activeItem: null, buffTimer: 0,
        reloadTimer: 0, invulnerableTimer: 0, invisible: false
    };

    socket.on('input', (data) => {
        if (PLAYERS[socket.id]) PLAYERS[socket.id].input = data;
    });

    socket.on('equip', (slotIndex) => {
        const p = PLAYERS[socket.id];
        if (!p || p.isDead) return;
        if (p.inventory[slotIndex]) {
            const type = p.inventory[slotIndex];
            p.activeItem = type;
            p.inventory[slotIndex] = null;

            // Reset Stealth if switching away
            p.invisible = (type === 'stealth');
            p.reloadTimer = 0;

            // Set Timers
            if (type === 'rush') p.buffTimer = 600;
            if (type === 'autofire') p.reloadTimer = 0;
        }
    });

    socket.on('disconnect', () => {
        delete PLAYERS[socket.id];
    });
});

// --- GAME LOOP ---
let tickCount = 0;
setInterval(() => {
    tickCount++;
    updatePhysics();
    updateGameLogic();

    // Throttle Network
    if (tickCount % 2 === 0) {
        io.volatile.emit('state', { players: PLAYERS, bullets, mapItems });
    }
}, TICK_DT);

httpServer.listen(3000, () => {
    console.log("Server running on port 3000");
});