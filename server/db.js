const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'unibite.db'));

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'consumer',
    points INTEGER NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    consumer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    rating_penalty_applied INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (listing_id) REFERENCES listings(id),
    FOREIGN KEY (consumer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL UNIQUE,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (request_id) REFERENCES requests(id)
  );
`);

// Seed admin
const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    "INSERT INTO users (username, email, password_hash, role, points) VALUES (?, ?, ?, 'admin', 0)"
  ).run('admin', 'admin@unibite.gr', hash);
  console.log('Admin seeded: admin@unibite.gr / admin123');
}

module.exports = db;
