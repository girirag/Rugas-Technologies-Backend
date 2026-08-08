const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let pgPool = null;
let sqliteDb = null;
let usePg = false;

if (process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER)) {
  usePg = true;
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
  });
} else {
  const dbDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'queue_flow.db');
  sqliteDb = new sqlite3.Database(dbPath);
}

// Database helper functions supporting both PostgreSQL and SQLite seamlessly
const db = {
  isPg: () => usePg,
  query: (text, params = []) => {
    return new Promise((resolve, reject) => {
      if (usePg) {
        pgPool.query(text, params, (err, res) => {
          if (err) return reject(err);
          resolve(res.rows);
        });
      } else {
        // Convert PostgreSQL $1, $2 syntax to SQLite ? syntax
        let sqliteText = text;
        params.forEach((_, idx) => {
          sqliteText = sqliteText.replace(new RegExp(`\\$${idx + 1}\\b`, 'g'), '?');
        });

        const trimmed = text.trim().toUpperCase();
        if (trimmed.startsWith('SELECT') || trimmed.includes('RETURNING')) {
          sqliteDb.all(sqliteText, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
          });
        } else {
          sqliteDb.run(sqliteText, params, function (err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes });
          });
        }
      }
    });
  },
  exec: (sql) => {
    return new Promise((resolve, reject) => {
      if (usePg) {
        pgPool.query(sql, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      } else {
        sqliteDb.exec(sql, (err) => {
          if (err) return reject(err);
          resolve();
        });
      }
    });
  }
};

async function initDb() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY ${usePg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS queues (
      id INTEGER PRIMARY KEY ${usePg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT DEFAULT 'T',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY ${usePg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
      queue_id INTEGER NOT NULL,
      token_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      status TEXT DEFAULT 'WAITING',
      position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      served_at TIMESTAMP,
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analytics_logs (
      id INTEGER PRIMARY KEY ${usePg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
      queue_id INTEGER NOT NULL,
      token_id INTEGER NOT NULL,
      wait_seconds INTEGER DEFAULT 0,
      service_seconds INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await db.exec(schema);
  console.log(`Database initialized using ${usePg ? 'PostgreSQL' : 'SQLite'}`);
}

module.exports = { db, initDb };
