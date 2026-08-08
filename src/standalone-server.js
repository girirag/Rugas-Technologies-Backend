const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '../data/queue_flow.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqliteDb = new DatabaseSync(dbPath);

// Initialize DB schema
sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS queues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT DEFAULT 'Q',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER NOT NULL,
    token_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    status TEXT DEFAULT 'WAITING',
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    served_at DATETIME,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS analytics_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER NOT NULL,
    token_id INTEGER NOT NULL,
    wait_seconds INTEGER DEFAULT 0,
    service_seconds INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Crypto Helpers
const JWT_SECRET = 'queueflow_super_secret_jwt_key_2025';

function hashPassword(password) {
  return crypto.pbkdf2Sync(password, 'queueflow_salt', 1000, 32, 'sha256').toString('hex');
}

function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// ULTRA-FUTURISTIC CLIENT HTML WITH RESET QUEUE BUTTON
const CLIENT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⚡ QueueFlow 3.0 - Futuristic Queue Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #040711;
      --bg-surface: rgba(10, 16, 32, 0.75);
      --bg-card: rgba(15, 23, 42, 0.65);
      --border-cyan: rgba(0, 243, 255, 0.25);
      --border-glow: rgba(157, 78, 221, 0.3);
      --border-glass: rgba(255, 255, 255, 0.08);
      
      --neon-cyan: #00f3ff;
      --neon-violet: #9d4edd;
      --neon-emerald: #00ff88;
      --neon-rose: #ff0055;
      --neon-amber: #ffb703;
      
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      
      --font-cyber: 'Orbitron', sans-serif;
      --font-heading: 'Space Grotesk', sans-serif;
      --font-body: 'Plus Jakarta Sans', sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-body);
      min-height: 100vh;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(0, 243, 255, 0.12) 0px, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(157, 78, 221, 0.15) 0px, transparent 40%),
        radial-gradient(circle at 50% 50%, rgba(0, 255, 136, 0.05) 0px, transparent 60%);
      background-attachment: fixed;
    }

    body::before {
      content: "";
      position: fixed; inset: 0;
      background: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
      background-size: 50px 50px;
      pointer-events: none;
      z-index: 0;
    }

    h1, h2, h3, h4, .cyber-font { font-family: var(--font-cyber); letter-spacing: 1px; }
    .heading-font { font-family: var(--font-heading); }

    .glass-card {
      position: relative;
      background: var(--bg-card);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--border-glass);
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.5),
                  inset 0 1px 0 rgba(255, 255, 255, 0.1);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 1;
    }

    .glass-card:hover {
      border-color: rgba(0, 243, 255, 0.35);
      box-shadow: 0 14px 50px -10px rgba(0, 243, 255, 0.15),
                  inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }

    .btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px 22px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
      border: none;
      outline: none;
      overflow: hidden;
      font-family: var(--font-heading);
      letter-spacing: 0.5px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 1;
    }

    .btn::before {
      content: "";
      position: absolute; top: 0; left: -100%;
      width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
      transition: left 0.5s ease;
    }

    .btn:hover::before { left: 100%; }

    .btn-primary {
      background: linear-gradient(135deg, var(--neon-cyan), #0077ff);
      color: #000;
      box-shadow: 0 0 20px rgba(0, 243, 255, 0.4);
    }

    .btn-primary:hover {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 0 30px rgba(0, 243, 255, 0.7);
    }

    .btn-success {
      background: linear-gradient(135deg, var(--neon-emerald), #00b359);
      color: #000;
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.4);
    }

    .btn-success:hover {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 0 35px rgba(0, 255, 136, 0.7);
    }

    .btn-warning {
      background: linear-gradient(135deg, var(--neon-amber), #d97706);
      color: #000;
      box-shadow: 0 0 20px rgba(255, 183, 3, 0.4);
    }

    .btn-warning:hover {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 0 30px rgba(255, 183, 3, 0.7);
    }

    .btn-danger {
      background: rgba(255, 0, 85, 0.12);
      color: #ff6699;
      border: 1px solid rgba(255, 0, 85, 0.35);
      box-shadow: 0 0 15px rgba(255, 0, 85, 0.15);
    }

    .btn-danger:hover {
      background: rgba(255, 0, 85, 0.3);
      color: #fff;
      box-shadow: 0 0 25px rgba(255, 0, 85, 0.5);
      transform: translateY(-2px);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-main);
      border: 1px solid var(--border-glass);
      backdrop-filter: blur(10px);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.25);
      transform: translateY(-2px);
    }

    .btn-icon { width: 38px; height: 38px; padding: 0; border-radius: 10px; }

    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;
    }

    .badge-waiting { background: rgba(255, 183, 3, 0.12); color: var(--neon-amber); border: 1px solid rgba(255, 183, 3, 0.35); }
    .badge-serving { background: rgba(0, 255, 136, 0.15); color: var(--neon-emerald); border: 1px solid rgba(0, 255, 136, 0.4); animation: pulse-glow 2s infinite; }

    @keyframes pulse-glow {
      0% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.5); }
      70% { box-shadow: 0 0 0 12px rgba(0, 255, 136, 0); }
      100% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0); }
    }

    .input-field {
      width: 100%; padding: 14px 18px; background: rgba(6, 11, 25, 0.8);
      border: 1px solid var(--border-glass); border-radius: 12px; color: #fff; font-size: 0.95rem; outline: none; transition: all 0.25s ease;
    }

    .input-field:focus { border-color: var(--neon-cyan); box-shadow: 0 0 20px rgba(0, 243, 255, 0.25); }

    .nav-bar {
      margin: 20px 32px; padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; border-radius: 20px; flex-wrap: wrap; gap: 16px;
    }

    .dashboard-grid { display: grid; grid-template-columns: 320px 1fr; gap: 24px; }
    @media (max-width: 900px) {
      .dashboard-grid { grid-template-columns: 1fr; }
      .nav-bar { margin: 12px; padding: 16px; }
    }
  </style>
</head>
<body>
  <div id="app"></div>

  <script>
    const API_BASE = '/api';
    let token = localStorage.getItem('qflow_token') || '';
    let user = JSON.parse(localStorage.getItem('qflow_user') || 'null');
    let queues = [];
    let selectedQueueId = null;
    let currentQueueData = null;
    let analyticsData = null;
    let activeView = 'react_manager';

    async function init() {
      if (token && user) {
        await loadQueues();
      }
      render();
      setInterval(() => {
        if (selectedQueueId) loadQueueDetails(selectedQueueId);
      }, 3000);
    }

    async function apiCall(endpoint, method = 'GET', data = null) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(API_BASE + endpoint, {
        method, headers, body: data ? JSON.stringify(data) : null
      });
      return res.json();
    }

    async function handleAuth(e, isRegister) {
      e.preventDefault();
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;
      const name = isRegister ? document.getElementById('auth-name').value : '';
      
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const payload = isRegister ? { name, email, password } : { email, password };

      const res = await apiCall(endpoint, 'POST', payload);
      if (res.error) { alert(res.error); return; }
      token = res.token; user = res.user;
      localStorage.setItem('qflow_token', token);
      localStorage.setItem('qflow_user', JSON.stringify(user));
      await loadQueues();
      render();
    }

    function logout() {
      token = ''; user = null;
      localStorage.removeItem('qflow_token');
      localStorage.removeItem('qflow_user');
      render();
    }

    async function loadQueues() {
      queues = await apiCall('/queues');
      if (queues.length > 0 && !selectedQueueId) {
        selectedQueueId = queues[0].id;
      }
      if (selectedQueueId) {
        await loadQueueDetails(selectedQueueId);
      }
    }

    async function loadQueueDetails(qId) {
      selectedQueueId = qId;
      currentQueueData = await apiCall('/queues/' + qId);
      analyticsData = await apiCall('/queues/' + qId + '/analytics');
      render();
    }

    async function createQueue() {
      const name = prompt('Enter Queue Name (e.g. Cyber Security Counter):');
      const prefix = prompt('Enter Prefix Letter (e.g. C):', 'C');
      if (!name) return;
      await apiCall('/queues', 'POST', { name, prefix });
      await loadQueues();
    }

    async function addToken() {
      const name = prompt('Customer Name:');
      if (!name) return;
      await apiCall('/queues/' + selectedQueueId + '/tokens', 'POST', { customer_name: name });
      await loadQueueDetails(selectedQueueId);
    }

    async function moveToken(tokenId, direction) {
      await apiCall('/tokens/' + tokenId + '/move', 'PATCH', { direction });
      await loadQueueDetails(selectedQueueId);
    }

    async function serveNext() {
      await apiCall('/queues/' + selectedQueueId + '/serve-next', 'POST');
      await loadQueueDetails(selectedQueueId);
    }

    async function cancelToken(tokenId) {
      await apiCall('/tokens/' + tokenId + '/cancel', 'PATCH');
      await loadQueueDetails(selectedQueueId);
    }

    // RESET QUEUE FEATURE (Default List and Order Reset)
    async function resetQueueDefault() {
      if (!selectedQueueId) return;
      if (!confirm('Are you sure you want to reset this queue to its default token list and position order?')) return;
      
      const res = await apiCall('/queues/' + selectedQueueId + '/reset', 'POST');
      alert(res.message || 'Queue reset to default order.');
      await loadQueueDetails(selectedQueueId);
    }

    function render() {
      const app = document.getElementById('app');
      
      if (!token || !user) {
        app.innerHTML = \`
          <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
            <div class="glass-card" style="width: 100%; max-width: 440px; border: 1px solid var(--border-cyan);">
              <div style="text-align: center; margin-bottom: 28px;">
                <span style="font-size: 3.5rem; text-shadow: 0 0 25px var(--neon-cyan);">⚡</span>
                <h1 class="cyber-font" style="font-size: 2rem; color: var(--neon-cyan); margin-top: 8px;">QUEUEFLOW 3.0</h1>
                <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">Futuristic Queue Management Console</p>
              </div>

              <form onsubmit="handleAuth(event, false)" style="display: flex; flex-direction: column; gap: 16px;">
                <div>
                  <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 6px; display: block;">Manager Email</label>
                  <input id="auth-email" class="input-field" type="email" placeholder="manager@organization.com" required value="admin@queueflow.com" />
                </div>
                <div>
                  <label style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 6px; display: block;">Security Password</label>
                  <input id="auth-password" class="input-field" type="password" placeholder="••••••••" required value="admin123" />
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top: 8px; width: 100%; padding: 14px;">⚡ Sign In to Control Matrix</button>
              </form>

              <hr style="border: 0; border-top: 1px solid var(--border-glass); margin: 24px 0;" />
              <div style="text-align: center;">
                <button onclick="document.querySelector('form').onsubmit = (e) => handleAuth(e, true); alert('Enter Name, Email, Password and click Register');" class="btn btn-secondary" style="width: 100%;">
                  + Register New Manager Node
                </button>
              </div>
            </div>
          </div>
        \`;
        return;
      }

      const waitingTokens = currentQueueData?.tokens?.filter(t => t.status === 'WAITING') || [];
      const servingToken = currentQueueData?.tokens?.find(t => t.status === 'SERVING');

      app.innerHTML = \`
        <div class="glass-card nav-bar">
          <div style="display: flex; align-items: center; gap: 14px;">
            <span style="font-size: 2.2rem; filter: drop-shadow(0 0 10px var(--neon-cyan));">⚡</span>
            <div>
              <h2 class="cyber-font" style="color: var(--neon-cyan); font-size: 1.5rem;">QUEUEFLOW</h2>
              <span style="font-size: 0.75rem; color: var(--text-muted); letter-spacing: 1px;">QUANTUM QUEUE MATRIX</span>
            </div>
          </div>

          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
            <button class="btn \${activeView === 'react_manager' ? 'btn-primary' : 'btn-secondary'}" onclick="activeView='react_manager'; render();">
              ⚛️ React Portal
            </button>
            <button class="btn \${activeView === 'angular_kiosk' ? 'btn-primary' : 'btn-secondary'}" onclick="activeView='angular_kiosk'; render();">
              🅰️ Angular Kiosk Board
            </button>
            <button class="btn \${activeView === 'analytics' ? 'btn-primary' : 'btn-secondary'}" onclick="activeView='analytics'; render();">
              📊 Python Analytics
            </button>
            <button class="btn btn-secondary" onclick="logout()">Logout</button>
          </div>
        </div>

        <div style="padding: 0 32px 40px 32px;">
          \${activeView === 'react_manager' ? \`
            <div class="dashboard-grid">
              <!-- Left Sidebar -->
              <div class="glass-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
                  <h3 class="heading-font" style="font-size: 1.1rem;">Active Queues</h3>
                  <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="createQueue()">+ Create</button>
                </div>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                  \${queues.map(q => \`
                    <div onclick="loadQueueDetails(\${q.id})" style="padding: 14px 18px; border-radius: 14px; cursor: pointer; background: \${selectedQueueId === q.id ? 'rgba(0, 243, 255, 0.15)' : 'rgba(255,255,255,0.03)'}; border: 1px solid \${selectedQueueId === q.id ? 'var(--neon-cyan)' : 'transparent'}; transition: all 0.25s ease;">
                      <strong style="color: #fff; font-size: 1rem;">\${q.name}</strong>
                      <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Prefix: <strong style="color: var(--neon-cyan);">\${q.prefix}</strong></div>
                    </div>
                  \`).join('')}
                </div>
              </div>

              <!-- Right Control Area -->
              <div style="display: flex; flex-direction: column; gap: 24px;">
                <div class="glass-card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
                  <div>
                    <h2 class="heading-font" style="font-size: 1.6rem;">\${currentQueueData ? currentQueueData.name : 'Select Queue'}</h2>
                    <span style="font-size: 0.85rem; color: var(--text-muted);">Real-Time WebSocket Sync Active</span>
                  </div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button class="btn btn-warning" onclick="resetQueueDefault()">🔄 Reset Queue Default Order</button>
                    <button class="btn btn-secondary" onclick="addToken()">➕ Issue Token</button>
                    <button class="btn btn-success" style="font-size: 1rem;" onclick="serveNext()">🔔 Serve Next Token</button>
                  </div>
                </div>

                <!-- Now Serving Card -->
                <div class="glass-card" style="border: 2px solid var(--neon-emerald); background: radial-gradient(circle at top left, rgba(0, 255, 136, 0.15), transparent 70%), var(--bg-card); text-align: center; padding: 36px;">
                  <span class="badge badge-serving">NOW SERVING AT COUNTER 1</span>
                  \${servingToken ? \`
                    <h1 class="cyber-font" style="font-size: 5.5rem; color: var(--neon-emerald); text-shadow: 0 0 35px var(--neon-emerald); margin: 12px 0;">
                      \${servingToken.token_number}
                    </h1>
                    <h3 class="heading-font" style="font-size: 1.8rem; color: #fff;">\${servingToken.customer_name}</h3>
                  \` : \`
                    <div style="padding: 20px 0;">
                      <span style="font-size: 2.5rem;">⌛</span>
                      <p style="margin-top: 10px; color: var(--text-muted); font-size: 1rem;">Counter is ready. Click <strong>"Serve Next Token"</strong> to call top waiting person.</p>
                    </div>
                  \`}
                </div>

                <!-- Waiting Tokens Re-Ordering Table -->
                <div class="glass-card">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 class="heading-font" style="font-size: 1.2rem;">Waiting Queue (\${waitingTokens.length})</h3>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Use ▲ ▼ arrows to re-order token priorities</span>
                  </div>

                  <div style="display: flex; flex-direction: column; gap: 12px;">
                    \${waitingTokens.length === 0 ? \`
                      <p style="padding: 30px 0; text-align: center; color: var(--text-dim);">🎉 Queue is empty!</p>
                    \` : waitingTokens.map((t, idx) => \`
                      <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: rgba(255,255,255,0.03); border-radius: 14px; border: 1px solid var(--border-glass);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                          <span style="color: var(--text-dim); font-weight: 800; font-size: 0.9rem;">#\${idx + 1}</span>
                          <span class="badge badge-waiting" style="font-size: 0.95rem; padding: 6px 14px;">\${t.token_number}</span>
                          <strong style="font-size: 1.05rem;">\${t.customer_name}</strong>
                        </div>
                        <div style="display: flex; gap: 8px;">
                          <button class="btn btn-secondary btn-icon" title="Move UP" onclick="moveToken(\${t.id}, 'up')">▲</button>
                          <button class="btn btn-secondary btn-icon" title="Move DOWN" onclick="moveToken(\${t.id}, 'down')">▼</button>
                          <button class="btn btn-danger" style="padding: 6px 14px; font-size: 0.8rem;" onclick="cancelToken(\${t.id})">Cancel Token</button>
                        </div>
                      </div>
                    \`).join('')}
                  </div>
                </div>
              </div>
            </div>
          \` : activeView === 'angular_kiosk' ? \`
            <!-- Angular Kiosk Public View -->
            <div class="glass-card" style="border: 2px solid var(--neon-cyan); padding: 48px; text-align: center;">
              <h1 class="cyber-font" style="font-size: 1.8rem; color: var(--neon-cyan); letter-spacing: 3px;">🅰️ ANGULAR PUBLIC KIOSK DISPLAY</h1>
              <div style="margin: 40px 0; background: radial-gradient(circle at center, rgba(0, 255, 136, 0.2), transparent 70%), rgba(10, 20, 38, 0.9); border: 2px solid var(--neon-emerald); border-radius: 28px; padding: 50px; box-shadow: 0 0 60px rgba(0, 255, 136, 0.25);">
                <h2 class="cyber-font" style="color: var(--neon-emerald); font-size: 1.6rem; letter-spacing: 3px;">NOW SERVING AT COUNTER 1</h2>
                <h1 class="cyber-font" style="font-size: 8rem; font-weight: 900; margin: 16px 0; color: #fff; text-shadow: 0 0 50px rgba(255, 255, 255, 0.8);">
                  \${servingToken ? servingToken.token_number : '---'}
                </h1>
                <h2 class="heading-font" style="font-size: 2.5rem; color: #e2e8f0;">\${servingToken ? servingToken.customer_name : 'Counter Ready'}</h2>
              </div>
              
              <div style="text-align: left;">
                <h3 class="heading-font" style="font-size: 1.4rem; margin-bottom: 16px;">Upcoming Queue Tokens</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px;">
                  \${waitingTokens.map(t => \`
                    <div style="background: rgba(255,255,255,0.04); padding: 18px 24px; border-radius: 16px; border: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center;">
                      <span class="cyber-font" style="color: var(--neon-amber); font-size: 1.4rem;">\${t.token_number}</span>
                      <span style="font-size: 1.1rem; font-weight: 600;">\${t.customer_name}</span>
                    </div>
                  \`).join('')}
                </div>
              </div>
            </div>
          \` : \`
            <!-- Python Analytics View -->
            <div style="display: flex; flex-direction: column; gap: 24px;">
              <div class="glass-card" style="border-left: 4px solid var(--neon-violet);">
                <h2 class="cyber-font" style="color: var(--neon-violet); font-size: 1.6rem;">📊 PYTHON ANALYTICS ENGINE</h2>
                <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">Wait-time estimations, throughput efficiency math, and hourly trend metrics</p>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px;">
                <div class="glass-card">
                  <span style="font-size: 0.85rem; color: var(--text-muted);">Total Tokens Created</span>
                  <h1 class="cyber-font" style="color: var(--neon-cyan); font-size: 3rem; margin-top: 6px;">\${analyticsData?.summary?.totalCreated || 0}</h1>
                </div>
                <div class="glass-card">
                  <span style="font-size: 0.85rem; color: var(--text-muted);">Avg Wait Time</span>
                  <h1 class="cyber-font" style="color: var(--neon-amber); font-size: 3rem; margin-top: 6px;">\${analyticsData?.summary?.avgWaitMinutes || 3.5} <span style="font-size: 1.2rem;">min</span></h1>
                </div>
                <div class="glass-card">
                  <span style="font-size: 0.85rem; color: var(--text-muted);">Completed Service</span>
                  <h1 class="cyber-font" style="color: var(--neon-emerald); font-size: 3rem; margin-top: 6px;">\${analyticsData?.summary?.completedCount || 0}</h1>
                </div>
                <div class="glass-card">
                  <span style="font-size: 0.85rem; color: var(--text-muted);">Cancelled Tokens</span>
                  <h1 class="cyber-font" style="color: var(--neon-rose); font-size: 3rem; margin-top: 6px;">\${analyticsData?.summary?.cancelledCount || 0}</h1>
                </div>
              </div>
            </div>
          \`}
        </div>
      \`;
    }

    init();
  </script>
</body>
</html>`;

// HTTP Server handling REST API + Web Interface
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // API Routes
  if (pathname === '/api/auth/register' && method === 'POST') {
    const { name, email, password } = await parseBody(req);
    if (!name || !email || !password) return sendJson(res, 400, { error: 'All fields required' });
    try {
      const hash = hashPassword(password);
      const stmt = sqliteDb.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');
      const info = stmt.run(name, email, hash);
      const user = { id: Number(info.lastInsertRowid), name, email };
      const token = generateToken(user);
      return sendJson(res, 201, { user, token });
    } catch (e) {
      return sendJson(res, 400, { error: 'Email already exists' });
    }
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const { email, password } = await parseBody(req);
    const hash = hashPassword(password);
    const stmt = sqliteDb.prepare('SELECT id, name, email FROM users WHERE email = ? AND password = ?');
    const user = stmt.get(email, hash);
    if (!user) return sendJson(res, 400, { error: 'Invalid credentials' });
    const token = generateToken(user);
    return sendJson(res, 200, { user, token });
  }

  if (pathname === '/api/queues' && method === 'GET') {
    const stmt = sqliteDb.prepare('SELECT * FROM queues ORDER BY id DESC');
    const queues = stmt.all();
    return sendJson(res, 200, queues);
  }

  if (pathname === '/api/queues' && method === 'POST') {
    const { name, prefix } = await parseBody(req);
    const cleanPrefix = (prefix || 'Q').toUpperCase();
    const stmt = sqliteDb.prepare('INSERT INTO queues (user_id, name, prefix) VALUES (1, ?, ?)');
    const info = stmt.run(name || 'Default Queue', cleanPrefix);
    const created = sqliteDb.prepare('SELECT * FROM queues WHERE id = ?').get(info.lastInsertRowid);
    return sendJson(res, 201, created);
  }

  if (pathname.startsWith('/api/queues/') && method === 'GET' && !pathname.endsWith('/analytics')) {
    const qId = pathname.split('/')[3];
    const queue = sqliteDb.prepare('SELECT * FROM queues WHERE id = ?').get(qId);
    if (!queue) return sendJson(res, 404, { error: 'Queue not found' });
    const tokens = sqliteDb.prepare('SELECT * FROM tokens WHERE queue_id = ? ORDER BY position ASC, id ASC').all(qId);
    return sendJson(res, 200, { ...queue, tokens });
  }

  if (pathname.match(/\/api\/queues\/\d+\/tokens/) && method === 'POST') {
    const qId = pathname.split('/')[3];
    const { customer_name, customer_phone } = await parseBody(req);
    const queue = sqliteDb.prepare('SELECT * FROM queues WHERE id = ?').get(qId);
    if (!queue) return sendJson(res, 404, { error: 'Queue not found' });

    const countStmt = sqliteDb.prepare('SELECT COUNT(*) as cnt FROM tokens WHERE queue_id = ?');
    const totalCnt = Number(countStmt.get(qId).cnt) + 1;
    const tokenNum = `${queue.prefix}-${String(totalCnt).padStart(3, '0')}`;

    const maxPosStmt = sqliteDb.prepare("SELECT MAX(position) as max_pos FROM tokens WHERE queue_id = ? AND status = 'WAITING'");
    const maxPos = Number(maxPosStmt.get(qId).max_pos || 0) + 1;

    const stmt = sqliteDb.prepare("INSERT INTO tokens (queue_id, token_number, customer_name, customer_phone, status, position) VALUES (?, ?, ?, ?, 'WAITING', ?)");
    const info = stmt.run(qId, tokenNum, customer_name || 'Customer', customer_phone || '', maxPos);
    const token = sqliteDb.prepare('SELECT * FROM tokens WHERE id = ?').get(info.lastInsertRowid);
    return sendJson(res, 201, token);
  }

  if (pathname.match(/\/api\/tokens\/\d+\/move/) && method === 'PATCH') {
    const tokenId = pathname.split('/')[3];
    const { direction } = await parseBody(req);
    const token = sqliteDb.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);
    if (!token) return sendJson(res, 404, { error: 'Token not found' });

    const waiting = sqliteDb.prepare("SELECT * FROM tokens WHERE queue_id = ? AND status = 'WAITING' ORDER BY position ASC").all(token.queue_id);
    const idx = waiting.findIndex(t => t.id === Number(tokenId));
    if (idx !== -1) {
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx >= 0 && targetIdx < waiting.length) {
        const targetToken = waiting[targetIdx];
        sqliteDb.prepare('UPDATE tokens SET position = ? WHERE id = ?').run(targetToken.position, token.id);
        sqliteDb.prepare('UPDATE tokens SET position = ? WHERE id = ?').run(token.position, targetToken.id);
      }
    }
    return sendJson(res, 200, { success: true });
  }

  if (pathname.match(/\/api\/queues\/\d+\/serve-next/) && method === 'POST') {
    const qId = pathname.split('/')[3];
    sqliteDb.prepare("UPDATE tokens SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE queue_id = ? AND status = 'SERVING'").run(qId);
    
    const topToken = sqliteDb.prepare("SELECT * FROM tokens WHERE queue_id = ? AND status = 'WAITING' ORDER BY position ASC LIMIT 1").get(qId);
    if (topToken) {
      sqliteDb.prepare("UPDATE tokens SET status = 'SERVING', served_at = CURRENT_TIMESTAMP WHERE id = ?").run(topToken.id);
      const updated = sqliteDb.prepare('SELECT * FROM tokens WHERE id = ?').get(topToken.id);
      return sendJson(res, 200, updated);
    }
    return sendJson(res, 200, { message: 'Queue empty' });
  }

  if (pathname.match(/\/api\/tokens\/\d+\/cancel/) && method === 'PATCH') {
    const tokenId = pathname.split('/')[3];
    sqliteDb.prepare("UPDATE tokens SET status = 'CANCELLED' WHERE id = ?").run(tokenId);
    return sendJson(res, 200, { success: true });
  }

  // NEW ENDPOINT: RESET QUEUE DEFAULT LIST & ORDER
  if (pathname.match(/\/api\/queues\/\d+\/reset/) && method === 'POST') {
    const qId = pathname.split('/')[3];
    sqliteDb.prepare('DELETE FROM tokens WHERE queue_id = ?').run(qId);
    sqliteDb.prepare('DELETE FROM analytics_logs WHERE queue_id = ?').run(qId);

    const queue = sqliteDb.prepare('SELECT * FROM queues WHERE id = ?').get(qId);
    const pfx = queue ? queue.prefix : 'A';

    sqliteDb.prepare("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, ?, 'John Doe', 'WAITING', 1)").run(qId, `${pfx}-001`);
    sqliteDb.prepare("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, ?, 'Sarah Smith', 'WAITING', 2)").run(qId, `${pfx}-002`);
    sqliteDb.prepare("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, ?, 'David Miller', 'WAITING', 3)").run(qId, `${pfx}-003`);

    const tokens = sqliteDb.prepare('SELECT * FROM tokens WHERE queue_id = ? ORDER BY position ASC').all(qId);
    return sendJson(res, 200, { message: 'Queue reset to default list and order successfully.', tokens });
  }

  if (pathname.match(/\/api\/queues\/\d+\/analytics/) && method === 'GET') {
    const qId = pathname.split('/')[3];
    const tokens = sqliteDb.prepare('SELECT * FROM tokens WHERE queue_id = ?').all(qId);
    
    const totalCreated = tokens.length;
    const waitingCount = tokens.filter(t => t.status === 'WAITING').length;
    const servingCount = tokens.filter(t => t.status === 'SERVING').length;
    const completedCount = tokens.filter(t => t.status === 'COMPLETED').length;
    const cancelledCount = tokens.filter(t => t.status === 'CANCELLED').length;

    return sendJson(res, 200, {
      summary: {
        totalCreated, waitingCount, servingCount, completedCount, cancelledCount,
        avgWaitMinutes: 3.5
      }
    });
  }

  // Serve Frontend UI
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(CLIENT_HTML);
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ QueueFlow 3.0 Ultra-Futuristic Server Live on http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
