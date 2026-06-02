-- UniBite Database Schema
-- SQLite

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- USERS
-- role: 'admin' | 'cook' | 'consumer'
-- points: νόμισμα συναλλαγών (αρχική τιμή: 5)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'consumer'
                        CHECK(role IN ('admin', 'cook', 'consumer')),
  points        INTEGER NOT NULL DEFAULT 5 CHECK(points >= 0),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- LISTINGS
-- Αγγελίες φαγητού από cooks
-- Λήγουν αυτόματα 48 ώρες μετά το created_at
-- allergens: JSON array π.χ. ["gluten","milk","eggs"]
-- ============================================================
CREATE TABLE IF NOT EXISTS listings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  title               TEXT    NOT NULL,
  photo               TEXT,
  notes               TEXT    NOT NULL DEFAULT '',
  portions_total      INTEGER NOT NULL CHECK(portions_total > 0),
  portions_available  INTEGER NOT NULL CHECK(portions_available >= 0),
  location            TEXT    NOT NULL,
  lat                 REAL,
  lng                 REAL,
  pickup_time         TEXT    NOT NULL,
  allergens           TEXT    NOT NULL DEFAULT '[]',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK(portions_available <= portions_total)
);

CREATE INDEX IF NOT EXISTS idx_listings_user_id   ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings(created_at);

-- ============================================================
-- REQUESTS
-- Αιτήματα κράτησης μερίδας από consumers
-- status: 'pending' | 'approved' | 'rejected' | 'completed' | 'no_show'
-- rating_penalty_applied: 1 αφού εφαρμοστεί ποινή μη-αξιολόγησης
-- ============================================================
CREATE TABLE IF NOT EXISTS requests (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id             INTEGER NOT NULL,
  consumer_id            INTEGER NOT NULL,
  status                 TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK(status IN ('pending','approved','rejected','completed','no_show')),
  rating_penalty_applied INTEGER NOT NULL DEFAULT 0 CHECK(rating_penalty_applied IN (0,1)),
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (listing_id)  REFERENCES listings(id) ON DELETE CASCADE,
  FOREIGN KEY (consumer_id) REFERENCES users(id)    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requests_listing_id  ON requests(listing_id);
CREATE INDEX IF NOT EXISTS idx_requests_consumer_id ON requests(consumer_id);
CREATE INDEX IF NOT EXISTS idx_requests_status      ON requests(status);

-- ============================================================
-- RATINGS
-- Αξιολόγηση completed request (1–5 αστέρια)
-- Ένα rating ανά request (UNIQUE constraint)
-- ============================================================
CREATE TABLE IF NOT EXISTS ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE,
  score      INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ratings_request_id ON ratings(request_id);
