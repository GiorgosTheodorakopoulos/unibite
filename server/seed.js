/**
 * Seed script — γεμίζει τη βάση με δείγμα δεδομένων για development/testing.
 * Εκτέλεση: node --experimental-sqlite server/seed.js
 *
 * ΠΡΟΣΟΧΗ: Διαγράφει όλα τα υπάρχοντα δεδομένα (εκτός admin).
 */

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'unibite.db'));
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

// ── Καθαρισμός (διατηρεί admin) ────────────────────────────────────────────
db.exec(`DELETE FROM ratings;`);
db.exec(`DELETE FROM requests;`);
db.exec(`DELETE FROM listings;`);
db.exec(`DELETE FROM users WHERE role != 'admin';`);

// ── Βοηθητικές συναρτήσεις ──────────────────────────────────────────────────
const hash = (pw) => bcrypt.hashSync(pw, 10);
const insertUser = db.prepare(
  `INSERT INTO users (username, email, password_hash, role, points)
   VALUES (?, ?, ?, ?, ?)`
);
const insertListing = db.prepare(
  `INSERT INTO listings
     (user_id, title, notes, portions_total, portions_available,
      location, lat, lng, pickup_time, allergens, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertRequest = db.prepare(
  `INSERT INTO requests (listing_id, consumer_id, status, rating_penalty_applied, created_at)
   VALUES (?, ?, ?, ?, ?)`
);
const insertRating = db.prepare(
  `INSERT INTO ratings (request_id, score, created_at) VALUES (?, ?, ?)`
);

// ── Users ────────────────────────────────────────────────────────────────────
// password: test1234 για όλους τους χρήστες

const nikos  = insertUser.run('nikos_cook',  'nikos@student.gr',   hash('test1234'), 'cook',     8).lastInsertRowid;
const maria  = insertUser.run('maria_cook',  'maria@student.gr',   hash('test1234'), 'cook',    12).lastInsertRowid;
const petros = insertUser.run('petros_cook', 'petros@student.gr',  hash('test1234'), 'cook',     6).lastInsertRowid;
const anna   = insertUser.run('anna',        'anna@student.gr',    hash('test1234'), 'consumer', 3).lastInsertRowid;
const kostas = insertUser.run('kostas',      'kostas@student.gr',  hash('test1234'), 'consumer', 5).lastInsertRowid;
const eleni  = insertUser.run('eleni',       'eleni@student.gr',   hash('test1234'), 'consumer', 4).lastInsertRowid;
const giorgos = insertUser.run('giorgos_cook','giorgos@student.gr',hash('test1234'), 'cook',     7).lastInsertRowid;

console.log('✓ Users inserted');

// ── Listings ─────────────────────────────────────────────────────────────────
// Μερικά ενεργά (created_at πρόσφατα), μερικά ληγμένα (>48h πριν)
const now       = new Date();
const fresh     = (h) => new Date(now - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);
const expired   = (h) => new Date(now - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);

// Ενεργές αγγελίες
const l1 = insertListing.run(
  nikos, 'Παστίτσιο', 'Σπιτικό παστίτσιο με κιμά και μπεσαμέλ.',
  4, 2, 'Εστία Α - Αθήνα', 37.9838, 23.7275,
  '13:00 - 14:00', '["gluten","milk","eggs"]', fresh(2)
).lastInsertRowid;

const l2 = insertListing.run(
  maria, 'Μουσακάς', 'Κλασικός μουσακάς με μελιτζάνες.',
  3, 3, 'Φοιτητική Εστία ΑΠΘ', 40.6401, 22.9444,
  '12:30 - 13:30', '["gluten","milk","eggs"]', fresh(5)
).lastInsertRowid;

const l3 = insertListing.run(
  petros, 'Φακές σούπα', 'Χορταστικές φακές με καρότο και λεμόνι.',
  5, 5, 'Πολυτεχνείο Κρήτης', 35.5138, 24.0180,
  '14:00 - 15:00', '[]', fresh(1)
).lastInsertRowid;

const l4 = insertListing.run(
  giorgos, 'Σπαγγέτι με κιμά', 'Μπολονέζ με παρμεζάνα.',
  6, 4, 'Εστία ΕΜΠ - Ζωγράφου', 37.9760, 23.7838,
  '13:00 - 13:45', '["gluten","milk"]', fresh(3)
).lastInsertRowid;

const l5 = insertListing.run(
  nikos, 'Κοτόπουλο με ρύζι', 'Ψητό κοτόπουλο με λαχανικά και basmati.',
  4, 4, 'Εστία Α - Αθήνα', 37.9838, 23.7275,
  '12:00 - 13:00', '[]', fresh(10)
).lastInsertRowid;

const l6 = insertListing.run(
  maria, 'Χορτόσουπα', 'Βελουτέ σούπα με λαχανικά εποχής.',
  3, 1, 'Φοιτητική Εστία ΑΠΘ', 40.6401, 22.9444,
  '12:00 - 13:00', '[]', fresh(20)
).lastInsertRowid;

// Ληγμένες αγγελίες (>48h)
const l7 = insertListing.run(
  petros, 'Τυρόπιτα', 'Σπιτική τυρόπιτα με φέτα.',
  4, 0, 'Πολυτεχνείο Κρήτης', 35.5138, 24.0180,
  '10:00 - 11:00', '["gluten","milk","eggs"]', expired(60)
).lastInsertRowid;

const l8 = insertListing.run(
  giorgos, 'Ρυζόγαλο', 'Σπιτικό ρυζόγαλο με κανέλα.',
  5, 5, 'Εστία ΕΜΠ - Ζωγράφου', 37.9760, 23.7838,
  '16:00 - 17:00', '["milk"]', expired(72)
).lastInsertRowid;

console.log('✓ Listings inserted');

// ── Requests ──────────────────────────────────────────────────────────────────
const r1 = insertRequest.run(l1, anna,   'completed', 1, fresh(24)).lastInsertRowid;
const r2 = insertRequest.run(l1, kostas, 'approved',  0, fresh(2)).lastInsertRowid;
const r3 = insertRequest.run(l2, eleni,  'completed', 0, fresh(30)).lastInsertRowid;
const r4 = insertRequest.run(l2, anna,   'rejected',  0, fresh(25)).lastInsertRowid;
const r5 = insertRequest.run(l3, kostas, 'pending',   0, fresh(1)).lastInsertRowid;
const r6 = insertRequest.run(l4, eleni,  'completed', 0, fresh(4)).lastInsertRowid;
const r7 = insertRequest.run(l4, anna,   'no_show',   0, fresh(6)).lastInsertRowid;
const r8 = insertRequest.run(l5, kostas, 'completed', 0, fresh(12)).lastInsertRowid;
const r9 = insertRequest.run(l6, eleni,  'approved',  0, fresh(18)).lastInsertRowid;

// Requests για ληγμένες αγγελίες
const r10 = insertRequest.run(l7, anna,   'completed', 1, expired(55)).lastInsertRowid;
const r11 = insertRequest.run(l7, kostas, 'completed', 1, expired(54)).lastInsertRowid;
const r12 = insertRequest.run(l8, eleni,  'completed', 0, expired(68)).lastInsertRowid;

console.log('✓ Requests inserted');

// ── Ratings ───────────────────────────────────────────────────────────────────
// Μόνο για completed requests
insertRating.run(r3, 5, fresh(28));   // eleni → maria, 5★
insertRating.run(r6, 4, fresh(3));    // eleni → giorgos, 4★
insertRating.run(r8, 5, fresh(10));   // kostas → nikos, 5★
insertRating.run(r10, 3, expired(50)); // anna → petros, 3★
insertRating.run(r11, 4, expired(49)); // kostas → petros, 4★
// r1: χωρίς rating (penalty_applied=1), r12: χωρίς rating ακόμα

console.log('✓ Ratings inserted');

// ── Σύνοψη ────────────────────────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 UniBite — Seed ολοκληρώθηκε
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Χρήστες (password: test1234)
   Cook:     nikos@student.gr, maria@student.gr
             petros@student.gr, giorgos@student.gr
   Consumer: anna@student.gr, kostas@student.gr
             eleni@student.gr
   Admin:    admin@unibite.gr / admin123

 Αγγελίες: 8 (6 ενεργές, 2 ληγμένες)
 Αιτήματα: 12 (διάφορα statuses)
 Αξιολογήσεις: 5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
