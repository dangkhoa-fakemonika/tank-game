import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://localhost:3000");

function App() {
    const canvasRef = useRef(null);
    const mapRef = useRef(null);

    // Visual States
    const [leaderboard, setLeaderboard] = useState([]);
    const [myInventory, setMyInventory] = useState([null, null, null]);
    const [myActive, setMyActive] = useState(null);
    const [, setExplosions] = useState([]);
    const [, setLasers] = useState([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        // let animationFrameId;

        const keys = { w: false, a: false, s: false, d: false, arrowleft: false, arrowright: false, " ": false };

        // --- SOCKET LISTENERS ---

        socket.on('map', (data) => {
            mapRef.current = data;
        });

        socket.on('laser', (data) => {
            setLasers(prev => [...prev, { ...data, opacity: 1.0 }]);
        });

        socket.on('explosion', (data) => {
            setExplosions(prev => [...prev, { x: data.x, y: data.y, radius: 10, alpha: 1.0 }]);
        });

        socket.on('state', (gameState) => {
            // 1. UPDATE UI
            const me = gameState.players[socket.id];
            if (me) {
                setMyInventory(me.inventory);
                setMyActive(me.activeItem);
            }
            const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score).slice(0, 5);
            setLeaderboard(sorted);

            // 2. RENDER LOOP
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw Map
            if (mapRef.current) {
                const { grid, tileSize } = mapRef.current;
                ctx.fillStyle = "#222"; // Slightly lighter background for visibility
                for (let r = 0; r < grid.length; r++) {
                    for (let c = 0; c < grid[r].length; c++) {
                        if (grid[r][c] === 1) {
                            // Wall Style (Bevel effect)
                            ctx.fillStyle = "#444";
                            ctx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
                            ctx.strokeStyle = "#555";
                            ctx.strokeRect(c * tileSize, r * tileSize, tileSize, tileSize);
                        }
                    }
                }
            }

            // Draw Items
            gameState.mapItems.forEach(item => {
                // Glowing Box effect
                ctx.shadowBlur = 10;
                ctx.shadowColor = "#00ffff";
                ctx.fillStyle = "#00ffff";
                ctx.fillRect(item.x - 6, item.y - 6, 12, 12);
                ctx.shadowBlur = 0; // Reset

                ctx.fillStyle = "black";
                ctx.font = "bold 10px Arial";
                ctx.textAlign = "center";
                ctx.fillText(item.type[0].toUpperCase(), item.x, item.y + 4);
            });

            // Draw Explosions
            setExplosions(prev => prev.filter(e => e.alpha > 0).map(e => {
                ctx.save();
                ctx.globalAlpha = e.alpha;
                ctx.fillStyle = '#ff4500';
                ctx.beginPath();
                ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                return { ...e, radius: e.radius + 2, alpha: e.alpha - 0.05 };
            }));

            // Draw Lasers
            setLasers(prev => prev.filter(l => l.opacity > 0).map(l => {
                ctx.save();
                ctx.shadowBlur = 10;
                ctx.shadowColor = "red";
                ctx.strokeStyle = `rgba(255, 0, 0, ${l.opacity})`;
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(l.x1, l.y1);
                ctx.lineTo(l.x2, l.y2);
                if (l.x3) ctx.lineTo(l.x3, l.y3);
                ctx.stroke();
                ctx.restore();
                return { ...l, opacity: l.opacity - 0.1 };
            }));

            // Draw Bullets
            gameState.bullets.forEach(b => {
                ctx.fillStyle = b.type === 'explosion' ? "#ffaa00" : "red";
                ctx.beginPath();
                ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); // Slightly larger
                ctx.fill();
            });

            // Draw Players
            for (const id in gameState.players) {
                const p = gameState.players[id];

                // Stealth Logic
                if (p.invisible) {
                    if (id !== socket.id) continue;
                    ctx.globalAlpha = 0.5;
                } else {
                    ctx.globalAlpha = 1.0;
                }

                if (p.isDead) continue;

                // Visual Effects
                if (p.activeItem === 'shield') {
                    ctx.strokeStyle = 'cyan';
                    ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, Math.PI*2); ctx.stroke();
                }
                if (p.activeItem === 'rush') {
                    ctx.fillStyle = 'rgba(255,0,0,0.3)';
                    ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, Math.PI*2); ctx.fill();
                }
                if (p.activeItem === 'parry') {
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 20, Date.now() % 2000 / 1000 * Math.PI, Date.now() % 2000 / 1000 * Math.PI + Math.PI); ctx.stroke();
                }

                // Tank Body
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); // Larger tank (12px radius)
                ctx.fill();
                // Outline
                ctx.strokeStyle = "black";
                ctx.lineWidth = 2;
                ctx.stroke();

                // Cannon
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.fillStyle = "black";
                ctx.fillRect(0, -4, 24, 8); // Longer, thicker cannon
                ctx.restore();

                // Score
                ctx.fillStyle = "white";
                ctx.font = "bold 12px Arial";
                ctx.textAlign = "center";
                ctx.fillText(p.score, p.x, p.y - 20);

                // Timer Bar
                if (p.buffTimer > 0) {
                    ctx.fillStyle = '#444';
                    ctx.fillRect(p.x - 15, p.y + 18, 30, 4);
                    ctx.fillStyle = 'yellow';
                    ctx.fillRect(p.x - 15, p.y + 18, 30 * (p.buffTimer/600), 4);
                }

                ctx.globalAlpha = 1.0; // Reset
            }
        });

        // --- INPUTS ---
        const handleKeyDown = (e) => {
            if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight", " "].indexOf(e.key) > -1) {
                e.preventDefault();
            }

            const k = e.key.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(keys, k)) {
                keys[k] = true;
                socket.emit('input', keys);
            }
            if (k === '1') socket.emit('equip', 0);
            if (k === '2') socket.emit('equip', 1);
            if (k === '3') socket.emit('equip', 2);
        };

        const handleKeyUp = (e) => {
            const k = e.key.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(keys, k)) {
                keys[k] = false;
                socket.emit('input', keys);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            socket.off('state');
            socket.off('map');
            socket.off('laser');
            socket.off('explosion');
        };
    }, []);

    return (
        <div style={{
            background: '#1a1a1a',
            height: '100vh',
            width: '100vw',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden'
        }}>

            <canvas
                ref={canvasRef}
                width={800}
                height={600}
                style={{
                    background: '#000',
                    border: '4px solid #333',
                    borderRadius: '8px',
                    boxShadow: '0 0 20px rgba(0,0,0,0.5)',
                    maxHeight: '95vh',
                    maxWidth: '95vw',
                    height: '100%',
                    width: 'auto',
                    aspectRatio: '4/3'
                }}
            />

            <div style={{
                position: 'absolute', top: 20, right: 20,
                background: 'rgba(0,0,0,0.7)', padding: '15px', borderRadius: '8px',
                color: 'white', fontFamily: 'monospace', minWidth: '150px'
            }}>
                <h3 style={{margin: '0 0 10px 0', borderBottom: '1px solid #555', paddingBottom: '5px'}}>LEADERBOARD</h3>
                {leaderboard.map((p, i) => (
                    <div key={i} style={{ color: p.color, fontSize: '1.2em', marginBottom: '4px' }}>
                        #{i+1} <span style={{float:'right'}}>{p.score}pts</span>
                    </div>
                ))}
            </div>

            <div style={{ position: 'absolute', bottom: 30, display: 'flex', gap: 20, alignItems: 'end' }}>
                {myInventory.map((item, i) => (
                    <div key={i} style={{
                        width: 70, height: 70,
                        border: '3px solid #666',
                        borderRadius: '8px',
                        background: item ? '#008888' : 'rgba(0,0,0,0.8)',
                        color: 'white',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: '14px',
                        position: 'relative'
                    }}>
                <span style={{
                    position:'absolute', top: -10, left: 10,
                    background: '#333', padding: '0 5px', fontSize: '12px', borderRadius: '4px'
                }}>KEY {i+1}</span>
                        {item ? item.toUpperCase() : ""}
                    </div>
                ))}

                <div style={{
                    width: 90, height: 90,
                    border: '4px solid gold',
                    borderRadius: '8px',
                    background: myActive ? '#880088' : 'rgba(0,0,0,0.8)',
                    color: 'white',
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    marginLeft: 30,
                    fontSize: '18px', fontWeight: 'bold', position: 'relative',
                    boxShadow: myActive ? '0 0 15px gold' : 'none'
                }}>
             <span style={{
                 position:'absolute', top: -12,
                 background: 'gold', color: 'black', padding: '2px 8px',
                 fontSize: '12px', fontWeight: 'bold', borderRadius: '4px'
             }}>ACTIVE</span>
                    {myActive ? myActive.toUpperCase() : "EMPTY"}
                </div>
            </div>

            {myActive === 'stealth' && (
                <div style={{
                    position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)',
                    color: '#0f0', fontSize: 32, fontWeight: 'bold', textShadow: '0 0 10px #0f0'
                }}>
                    [ STEALTH MODE ]
                </div>
            )}
        </div>
    );
}

export default App;