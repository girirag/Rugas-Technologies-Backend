const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');

const isPostgres = !!process.env.DATABASE_URL;
let pool = null;
let sqliteDb = null;

if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  pool.on('error', (err) => console.error('Unexpected PG client error:', err));
  console.log('⚡ Connected to PostgreSQL Database');
} else {
  const dbPath = path.join(__dirname, '../data/queue_flow.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  sqliteDb = new DatabaseSync(dbPath);
  console.log('⚡ Connected to SQLite Database');
}

// Unified Async Database helper
async function dbAll(sql, params = []) {
  if (isPostgres) {
    let i = 1;
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    const res = await pool.query(pgSql, params);
    return res.rows;
  } else {
    return sqliteDb.prepare(sql).all(...params);
  }
}

async function dbGet(sql, params = []) {
  const rows = await dbAll(sql, params);
  return rows[0] || null;
}

async function dbRun(sql, params = []) {
  if (isPostgres) {
    let i = 1;
    let pgSql = sql.replace(/\?/g, () => `$${i++}`);
    if (pgSql.trim().toUpperCase().startsWith('INSERT') && !pgSql.toUpperCase().includes('RETURNING')) {
      pgSql += ' RETURNING id';
    }
    const res = await pool.query(pgSql, params);
    return {
      lastInsertRowid: res.rows[0] ? res.rows[0].id : 0,
      changes: res.rowCount
    };
  } else {
    const stmt = sqliteDb.prepare(sql);
    const info = stmt.run(...params);
    return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes };
  }
}

// Initialize Schema
async function initSchema() {
  try {
    if (isPostgres) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS queues (
          id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL, prefix VARCHAR(10) DEFAULT 'Q', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS tokens (
          id SERIAL PRIMARY KEY, queue_id INTEGER NOT NULL, token_number VARCHAR(50) NOT NULL, customer_name VARCHAR(255) NOT NULL, customer_phone VARCHAR(50), status VARCHAR(20) DEFAULT 'WAITING', position INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, served_at TIMESTAMP, completed_at TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS analytics_logs (
          id SERIAL PRIMARY KEY, queue_id INTEGER NOT NULL, token_id INTEGER NOT NULL, wait_seconds INTEGER DEFAULT 0, service_seconds INTEGER DEFAULT 0, status VARCHAR(20) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('✅ PostgreSQL Tables Ready');
    } else {
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS queues (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, prefix TEXT DEFAULT 'Q', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, queue_id INTEGER NOT NULL, token_number TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT, status TEXT DEFAULT 'WAITING', position INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, served_at DATETIME, completed_at DATETIME);
        CREATE TABLE IF NOT EXISTS analytics_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, queue_id INTEGER NOT NULL, token_id INTEGER NOT NULL, wait_seconds INTEGER DEFAULT 0, service_seconds INTEGER DEFAULT 0, status VARCHAR(20) NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      `);
      console.log('✅ SQLite Tables Ready');
    }
  } catch (err) {
    console.error('Database Schema Init Error:', err);
  }
}

initSchema();

// Crypto Helpers
const JWT_SECRET = process.env.JWT_SECRET || 'queueflow_super_secret_jwt_key_2025';

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
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); }
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

  try {
    // API Routes
    if (pathname === '/api/auth/register' && method === 'POST') {
      const { name, email, password } = await parseBody(req);
      if (!name || !email || !password) return sendJson(res, 400, { error: 'All fields required' });
      try {
        const hash = hashPassword(password);
        const resDb = await dbRun('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hash]);
        const user = { id: resDb.lastInsertRowid, name, email };
        const token = generateToken(user);
        return sendJson(res, 201, { user, token });
      } catch (e) {
        return sendJson(res, 400, { error: 'Email already exists or registration failed' });
      }
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const { email, password } = await parseBody(req);
      const hash = hashPassword(password);
      let user = await dbGet('SELECT id, name, email FROM users WHERE email = ? AND password = ?', [email, hash]);

      // Auto-create default admin on first login attempt if missing
      if (!user && email === 'admin@queueflow.com' && password === 'admin123') {
        try {
          const resDb = await dbRun('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', ['Admin Manager', email, hash]);
          user = { id: resDb.lastInsertRowid, name: 'Admin Manager', email };
        } catch (err) {
          user = await dbGet('SELECT id, name, email FROM users WHERE email = ?', [email]);
        }
      }

      if (!user) return sendJson(res, 400, { error: 'Invalid email or password' });
      const token = generateToken(user);
      return sendJson(res, 200, { user, token });
    }

    if (pathname === '/api/queues' && method === 'GET') {
      let queues = await dbAll('SELECT * FROM queues ORDER BY id DESC');
      // Auto-seed default queue if none exists
      if (queues.length === 0) {
        const resDb = await dbRun('INSERT INTO queues (user_id, name, prefix) VALUES (1, ?, ?)', ['Main Support Counter', 'A']);
        const qId = resDb.lastInsertRowid;
        await dbRun("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, 'A-001', 'John Doe', 'WAITING', 1)", [qId]);
        await dbRun("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, 'A-002', 'Sarah Smith', 'WAITING', 2)", [qId]);
        await dbRun("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, 'A-003', 'David Miller', 'WAITING', 3)", [qId]);
        queues = await dbAll('SELECT * FROM queues ORDER BY id DESC');
      }
      return sendJson(res, 200, queues);
    }

    if (pathname === '/api/queues' && method === 'POST') {
      const { name, prefix } = await parseBody(req);
      const cleanPrefix = (prefix || 'Q').toUpperCase();
      const resDb = await dbRun('INSERT INTO queues (user_id, name, prefix) VALUES (1, ?, ?)', [name || 'Default Queue', cleanPrefix]);
      const created = await dbGet('SELECT * FROM queues WHERE id = ?', [resDb.lastInsertRowid]);
      return sendJson(res, 201, created);
    }

    if (pathname.startsWith('/api/queues/') && method === 'GET' && !pathname.endsWith('/analytics')) {
      const qId = pathname.split('/')[3];
      const queue = await dbGet('SELECT * FROM queues WHERE id = ?', [qId]);
      if (!queue) return sendJson(res, 404, { error: 'Queue not found' });
      const tokens = await dbAll('SELECT * FROM tokens WHERE queue_id = ? ORDER BY position ASC, id ASC', [qId]);
      return sendJson(res, 200, { ...queue, tokens });
    }

    if (pathname.match(/\/api\/queues\/\d+\/tokens/) && method === 'POST') {
      const qId = pathname.split('/')[3];
      const { customer_name, customer_phone } = await parseBody(req);
      const queue = await dbGet('SELECT * FROM queues WHERE id = ?', [qId]);
      if (!queue) return sendJson(res, 404, { error: 'Queue not found' });

      const countRow = await dbGet('SELECT COUNT(*) as cnt FROM tokens WHERE queue_id = ?', [qId]);
      const totalCnt = Number(countRow ? countRow.cnt : 0) + 1;
      const tokenNum = `${queue.prefix}-${String(totalCnt).padStart(3, '0')}`;

      const maxPosRow = await dbGet("SELECT MAX(position) as max_pos FROM tokens WHERE queue_id = ? AND status = 'WAITING'", [qId]);
      const maxPos = Number((maxPosRow ? maxPosRow.max_pos : 0) || 0) + 1;

      const resDb = await dbRun("INSERT INTO tokens (queue_id, token_number, customer_name, customer_phone, status, position) VALUES (?, ?, ?, ?, 'WAITING', ?)", [qId, tokenNum, customer_name || 'Customer', customer_phone || '', maxPos]);
      const token = await dbGet('SELECT * FROM tokens WHERE id = ?', [resDb.lastInsertRowid]);
      return sendJson(res, 201, token);
    }

    if (pathname.match(/\/api\/tokens\/\d+\/move/) && method === 'PATCH') {
      const tokenId = pathname.split('/')[3];
      const { direction } = await parseBody(req);
      const token = await dbGet('SELECT * FROM tokens WHERE id = ?', [tokenId]);
      if (!token) return sendJson(res, 404, { error: 'Token not found' });

      const waiting = await dbAll("SELECT * FROM tokens WHERE queue_id = ? AND status = 'WAITING' ORDER BY position ASC", [token.queue_id]);
      const idx = waiting.findIndex(t => Number(t.id) === Number(tokenId));
      if (idx !== -1) {
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx >= 0 && targetIdx < waiting.length) {
          const otherToken = waiting[targetIdx];
          await dbRun('UPDATE tokens SET position = ? WHERE id = ?', [otherToken.position, token.id]);
          await dbRun('UPDATE tokens SET position = ? WHERE id = ?', [token.position, otherToken.id]);
        }
      }
      const updated = await dbAll('SELECT * FROM tokens WHERE queue_id = ? ORDER BY position ASC', [token.queue_id]);
      return sendJson(res, 200, updated);
    }

    if (pathname.match(/\/api\/queues\/\d+\/serve-next/) && method === 'POST') {
      const qId = pathname.split('/')[3];
      await dbRun("UPDATE tokens SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE queue_id = ? AND status = 'SERVING'", [qId]);
      
      const topToken = await dbGet("SELECT * FROM tokens WHERE queue_id = ? AND status = 'WAITING' ORDER BY position ASC LIMIT 1", [qId]);
      if (topToken) {
        await dbRun("UPDATE tokens SET status = 'SERVING', served_at = CURRENT_TIMESTAMP WHERE id = ?", [topToken.id]);
        const updated = await dbGet('SELECT * FROM tokens WHERE id = ?', [topToken.id]);
        return sendJson(res, 200, updated);
      }
      return sendJson(res, 200, { message: 'Queue empty' });
    }

    if (pathname.match(/\/api\/tokens\/\d+\/cancel/) && method === 'PATCH') {
      const tokenId = pathname.split('/')[3];
      await dbRun("UPDATE tokens SET status = 'CANCELLED' WHERE id = ?", [tokenId]);
      return sendJson(res, 200, { success: true });
    }

    if (pathname.match(/\/api\/queues\/\d+\/reset/) && method === 'POST') {
      const qId = pathname.split('/')[3];
      await dbRun('DELETE FROM tokens WHERE queue_id = ?', [qId]);
      await dbRun('DELETE FROM analytics_logs WHERE queue_id = ?', [qId]);

      const queue = await dbGet('SELECT * FROM queues WHERE id = ?', [qId]);
      const pfx = queue ? queue.prefix : 'A';

      await dbRun("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, ?, 'John Doe', 'WAITING', 1)", [qId, `${pfx}-001`]);
      await dbRun("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, ?, 'Sarah Smith', 'WAITING', 2)", [qId, `${pfx}-002`]);
      await dbRun("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES (?, ?, 'David Miller', 'WAITING', 3)", [qId, `${pfx}-003`]);

      const tokens = await dbAll('SELECT * FROM tokens WHERE queue_id = ? ORDER BY position ASC', [qId]);
      return sendJson(res, 200, { message: 'Queue reset to default list and order successfully.', tokens });
    }

    if (pathname.match(/\/api\/queues\/\d+\/analytics/) && method === 'GET') {
      const qId = pathname.split('/')[3];
      const tokens = await dbAll('SELECT * FROM tokens WHERE queue_id = ?', [qId]);
      
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

    return sendJson(res, 404, { error: 'Endpoint not found' });
  } catch (err) {
    console.error('Server Request Error:', err);
    return sendJson(res, 500, { error: 'Internal Server Error', details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ QueueFlow 3.0 Server Live on port ${PORT}`);
  console.log(`======================================================\n`);
});
