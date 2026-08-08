const test = require('node:test');
const assert = require('node:assert');
const { db, initDb } = require('../config/db');

test('Database & Queue Management Integration Verification', async (t) => {
  await initDb();
  
  await t.test('Initializes tables cleanly', async () => {
    const users = await db.query('SELECT * FROM users');
    assert.strictEqual(Array.isArray(users), true);
  });

  await t.test('Creates Queue and adds tokens', async () => {
    await db.query("INSERT INTO queues (user_id, name, prefix) VALUES (1, 'Test Queue', 'TQ')");
    const queues = await db.query("SELECT * FROM queues WHERE name = 'Test Queue'");
    assert.strictEqual(queues.length, 1);
    const qId = queues[0].id;

    await db.query("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES ($1, 'TQ-001', 'Alice', 'WAITING', 1)", [qId]);
    await db.query("INSERT INTO tokens (queue_id, token_number, customer_name, status, position) VALUES ($1, 'TQ-002', 'Bob', 'WAITING', 2)", [qId]);

    const tokens = await db.query("SELECT * FROM tokens WHERE queue_id = $1 ORDER BY position ASC", [qId]);
    assert.strictEqual(tokens.length, 2);
    assert.strictEqual(tokens[0].customer_name, 'Alice');
    assert.strictEqual(tokens[1].customer_name, 'Bob');
  });
});
