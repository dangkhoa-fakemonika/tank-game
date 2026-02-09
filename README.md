
# 🛡️ Tank Maze: Real-Time Multiplayer Arena

> A server-authoritative, high-performance 2D multiplayer shooter built with Node.js, Socket.io, and React.

![Game Status](https://img.shields.io/badge/Status-Beta-orange) ![Tech](https://img.shields.io/badge/Engine-Custom_Physics-red)


## 🎮 Game Footage

![Gameplay Demo](./screenshots/tank-demo.gif)

---

## 📖 Overview
This is a top-down arcade shooter where players navigate a procedural grid-based maze to eliminate opponents. Unlike simple client-side games, this project utilizes a **Server-Authoritative Architecture**, meaning the server runs the entire physics simulation (movement, ballistics, collision) to prevent cheating and ensure consistency across all clients.

The game features a custom-built physics engine handling vector reflections, raycasting for beam weapons, and an entity-component-system (ECS) style state manager for power-ups.

---

## ⚙️ Technical Architecture

### 1. The Tech Stack
* **Backend:** Node.js, Express.
* **Networking:** Socket.io (WebSockets) with binary serialization optimizations.
* **Frontend:** React (UI Overlay), Vite (Bundler), HTML5 Canvas API (Rendering).
* **Protocol:** UDP-like behavior using `socket.volatile` for high-frequency position updates.

### 2. Network Engineering (The "Netcode")
To ensure smooth gameplay over the internet (LAN/VPN), the engine uses a decoupled loop architecture:
* **Physics Loop (60Hz):** The server calculates movement, collision, and game logic 60 times per second.
* **Network Loop (30Hz):** State snapshots are broadcast at 30Hz to conserve bandwidth.
* **Client Interpolation:** The frontend buffers server states and interpolates entity positions between updates, rendering at the user's native refresh rate (60/144fps) to eliminate visual stutter ("jitter").
* **Latency Handling:** Input is processed asynchronously, and "volatility" flags are used to drop outdated packets during lag spikes.

### 3. Custom Physics Engine
External physics libraries (Matter.js/Box2D) were avoided to maintain lightweight performance.
* **AABB Collision with Corner Sliding:** Tanks use Axis-Aligned Bounding Boxes. A custom algorithm checks two collision points per axis with tolerance padding, allowing tanks to "slide" past wall corners rather than getting stuck.
* **Vector Reflection:** Projectiles calculate incident angles against grid walls to determine reflection vectors (`vx *= -1` or `vy *= -1`), supporting multi-bounce mechanics.
* **Raycasting:** The **Laser** weapon utilizes a step-based raycasting algorithm. It traces a trajectory until it intersects a wall or player hitbox, calculates the surface normal, and recursively casts a secondary "bounce" ray within the same frame.

### 4. Game State Management
The server manages complex entity states including:
* **Inventory System:** 3-slot storage + 1 Active slot queue.
* **Status Effects:** Timed buffs (Speed/Rush), boolean states (Stealth/Invisible), and conditional triggers (Parry/Reflect).
* **Spatial Hashing:** Entities are tracked via grid coordinates for O(1) collision lookups.

---

## 🕹️ Controls & Mechanics

| Key | Action |
| :--- | :--- |
| **W A S D** | Move Tank |
| **← →** | Rotate Turret |
| **SPACE** | Shoot / Activate Power |
| **1, 2, 3** | Equip Item from Inventory |

### Power-Ups
* **Speed:** 1.5x Movement & Projectile velocity.
* **Shield:** Blocks one hit (1.5s invulnerability).
* **Rush:** Disables shooting but kills enemies on collision (Ramming).
* **Stealth:** Renders player invisible to enemies (ghost opacity for self).
* **Parry:** Reflects incoming projectiles and steals ownership (kill credit).
* **Laser:** Instant-hit beam that bounces once.
* **Explosion:** AOE damage that penetrates walls.
* **Shotgun/Bounce:** Modified projectile behaviors.

---

## 🚀 Installation & Setup

### Prerequisites
* Node.js (v18+ recommended)
* npm or yarn

### 1. Clone & Install
```bash
git clone https://github.com/dangkhoa-fakemonika/tank-game.git
cd tank-game
```

### 2. Setup Server

```bash
cd server
npm install
npm run dev
# Server starts on port 3000

```

### 3. Setup Client

Open a new terminal:

```bash
cd client
npm install
npm run dev
# Client starts on localhost:5173

```

### 4. Multiplayer (LAN/VPN)

To play with friends:

1. Connect via same Wi-Fi or Radmin VPN.
2. Update `client/src/App.jsx`:
```javascript
const socket = io("http://<YOUR_HOST_IP>:3000");

```


3. Share the link `http://<YOUR_HOST_IP>:5173` with friends.

---

## 🗺️ Roadmap / Upcoming Features

The following features are currently in development for the v1.0 release:

* [ ] **Lobby & Identity:**
* Name entry screen before joining.
* Persistent user stats/sessions.


* [ ] **Enhanced Visuals:**
* 64x64 pixel art icons for Skill Slots (UI).
* Particle systems for trail effects and debris.


* [ ] **Map Editor & Presets:**
* Loading maps from `.txt` or `.json` files instead of random generation.
* Implementation of "Hole" tiles (shoot-through but impassable terrain).