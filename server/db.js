const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, 'unibite.db');
const conn = new DatabaseSync(dbPath);
conn.exec('PRAGMA journal_mode = WAL;');
conn.exec('PRAGMA foreign_keys = ON;');

// Postgres compatibility shims — the routes were written against the Postgres
// dialect (GREATEST(), NOW(), ::type casts); this is the local SQLite stand-in.
conn.function('GREATEST', { varargs: true }, (...args) => Math.max(...args));
conn.function('NOW', () => new Date().toISOString().replace('T', ' ').slice(0, 19));

function stripPgCasts(sql) {
  return sql.replace(/::\w+/g, '');
}

function makeStmt(connection) {
  return function prepare(sql) {
    const stmt = connection.prepare(stripPgCasts(sql));
    return {
      async get(...args) {
        return stmt.get(...args.flat()) ?? null;
      },
      async all(...args) {
        return stmt.all(...args.flat());
      },
      async run(...args) {
        try {
          const result = stmt.run(...args.flat());
          return { lastInsertRowid: result.lastInsertRowid, rowCount: result.changes };
        } catch (e) {
          if (/UNIQUE constraint failed/.test(e.message)) e.code = '23505';
          throw e;
        }
      }
    };
  };
}

const db = {
  prepare: makeStmt(conn),

  async exec(sql) {
    conn.exec(sql);
  },

  // Runs fn(tx) inside a BEGIN/COMMIT block. tx.prepare() has the same API as db.prepare().
  // On error, rolls back and re-throws.
  async transaction(fn) {
    conn.exec('BEGIN');
    try {
      const tx = { prepare: makeStmt(conn) };
      const result = await fn(tx);
      conn.exec('COMMIT');
      return result;
    } catch (e) {
      conn.exec('ROLLBACK');
      throw e;
    }
  },

  async initDb() {
    conn.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    // Idempotent migration: pickup_time was added after schema.sql was first written.
    const columns = conn.prepare('PRAGMA table_info(requests)').all();
    if (!columns.some((c) => c.name === 'pickup_time')) {
      conn.exec('ALTER TABLE requests ADD COLUMN pickup_time TEXT');
    }

    const adminExists = await db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    if (!adminExists) {
      const hash = bcrypt.hashSync('admin123', 10);
      await db.prepare(
        "INSERT INTO users (username, email, password_hash, role, points) VALUES (?, ?, ?, 'admin', 0)"
      ).run('admin', 'admin@unibite.gr', hash);
      console.log('Admin seeded: admin@unibite.gr / admin123');
    }
  }
};

module.exports = db;
