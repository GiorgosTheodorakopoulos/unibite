const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ylqftgnvwjifzemxisvv:Iosifarmakolas12345@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Returns a prepare()-style object bound to a given query executor (pool or tx client).
function makeStmt(exec) {
  return function prepare(sql) {
    const pgSql = toPg(sql);
    return {
      async get(...args) {
        const { rows } = await exec(pgSql, args.flat());
        return rows[0] ?? null;
      },
      async all(...args) {
        const { rows } = await exec(pgSql, args.flat());
        return rows;
      },
      async run(...args) {
        let q = pgSql;
        const isInsert = q.trimStart().toUpperCase().startsWith('INSERT');
        if (isInsert) q += ' RETURNING id';
        const { rows, rowCount } = await exec(q, args.flat());
        return { lastInsertRowid: rows[0]?.id, rowCount };
      }
    };
  };
}

const db = {
  prepare: makeStmt((sql, params) => pool.query(sql, params)),

  async exec(sql) {
    await pool.query(sql);
  },

  // Runs fn(tx) inside a BEGIN/COMMIT block. tx.prepare() has the same API as db.prepare().
  // On error, rolls back and re-throws. Prevents double-mutations via ACID guarantees.
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        prepare: makeStmt((sql, params) => client.query(sql, params))
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async initDb() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'consumer',
        points INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS listings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        photo TEXT,
        notes TEXT DEFAULT '',
        portions_total INTEGER NOT NULL,
        portions_available INTEGER NOT NULL,
        location TEXT NOT NULL,
        lat REAL,
        lng REAL,
        pickup_time TEXT NOT NULL,
        allergens TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        consumer_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        rating_penalty_applied INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
        score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Add pickup_time column if it doesn't exist yet (idempotent migration)
    await pool.query(
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP`
    );

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
