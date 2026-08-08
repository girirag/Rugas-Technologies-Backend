// PostgreSQL Database Adapter for QueueFlow 3.0
// Uses environment variable DATABASE_URL to connect to PostgreSQL (Render Postgres, Supabase, Neon, etc.)
// Falls back to SQLite for local development if DATABASE_URL is not set.

const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

let pool = null;
let sqliteDb = null;
const isPostgres = !!process.env.DATABASE_URL;

if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
} else {
  const dbPath = path.join(__dirname, '../../data/queue_flow.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  sqliteDb = new DatabaseSync(dbPath);
}

// Initialize tables
async function initDb() {
  if (isPostgres) {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS queues (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          name VARCHAR(255) NOT NULL,
          prefix VARCHAR(10) DEFAULT 'Q',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tokens (
          id SERIAL PRIMARY KEY,
          queue_id INTEGER NOT NULL,
          token_number VARCHAR(50) NOT NULL,
          customer_name VARCHAR(255) NOT NULL,
          customer_phone VARCHAR(50),
          status VARCHAR(20) DEFAULT 'WAITING',
          position INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          served_at TIMESTAMP,
          completed_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS analytics_logs (
          id SERIAL PRIMARY KEY,
          queue_id INTEGER NOT NULL,
          token_id INTEGER NOT NULL,
          wait_seconds INTEGER DEFAULT 0,
          service_seconds INTEGER DEFAULT 0,
          status VARCHAR(20) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('✅ PostgreSQL Schema Initialized');
    } finally {
      client.release();
    }
  } else {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS queues (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, prefix TEXT DEFAULT 'Q', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT, queue_id INTEGER NOT NULL, token_number TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT, status TEXT DEFAULT 'WAITING', position INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, served_at DATETIME, completed_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS analytics_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, queue_id INTEGER NOT NULL, token_id INTEGER NOT NULL, wait_seconds INTEGER DEFAULT 0, service_seconds INTEGER DEFAULT 0, status TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ SQLite Schema Initialized');
  }
}

// Unified query wrapper
async function query(text, params = []) {
  if (isPostgres) {
    // Convert ? to $1, $2 for Postgres compatibility
    let index = 1;
    const pgText = text.replace(/\?/g, () => `$${index++}`);
    const res = await pool.query(pgText, params);
    return res.rows;
  } else {
    const stmt = sqliteDb.prepare(text);
    return stmt.all(...params);
  }
}

module.exports = { initDb, query, isPostgres };
