# ⚡ QueueFlow 3.0 — Node.js + Python Microservice Backend

**Fullstack Queue Management System — Backend Server**

This is the standalone **Node.js Express + SQLite/PostgreSQL** backend server paired with a **Python FastAPI analytics microservice** for QueueFlow 3.0.

---

## ⚡ API Endpoints

### 🔑 Authentication
- `POST /api/auth/register` — Register a new manager
- `POST /api/auth/login` — Sign in & receive JWT token

### 📋 Queue Management
- `GET /api/queues` — List all active queues
- `POST /api/queues` — Create a new queue
- `GET /api/queues/:id` — Get queue status & token list
- `POST /api/queues/:id/reset` — **Reset queue to default sequence**
- `POST /api/queues/:id/serve-next` — Serve the next waiting customer

### 🎟️ Token Operations
- `POST /api/queues/:id/tokens` — Issue a new token
- `PATCH /api/tokens/:id/move` — Re-order priority (`direction: "up" | "down"`)
- `PATCH /api/tokens/:id/cancel` — Cancel a token

### 📊 Analytics Microservice
- `GET /api/queues/:id/analytics` — Fetch Python FastAPI wait-time estimations & throughput metrics

---

## ☁️ Deploy to Render

1. Create a new **Web Service** on [Render.com](https://render.com).
2. Connect this repository: `https://github.com/girirag/Rugas-Technologies-Backend.git`
3. Configuration:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Set Environment Variables:
   - `PORT` = `5000`
   - `JWT_SECRET` = `your_jwt_secret_key`
5. Click **Create Web Service**.

---

## 📁 Repository Structure
```
backend-node/
├── src/
│   └── standalone-server.js   # Express API, Auth, Database & Analytics logic
├── data/
│   └── queue_flow.db          # Persistent SQLite storage
├── package.json
└── .gitignore
```
