const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function computeStatus(listing) {
  const created = new Date(listing.created_at + 'Z');
  const expiry = new Date(created.getTime() + 48 * 3600 * 1000);
  if (new Date() > expiry) return 'expired';
  return listing.portions_available > 0 ? 'active' : 'inactive';
}

// POST /api/requests — consumer requests a portion
router.post('/', authenticate, (req, res) => {
  const { listing_id } = req.body;
  if (!listing_id) return res.status(400).json({ error: 'Λείπει το listing_id' });

  if (req.user.role === 'cook') return res.status(403).json({ error: 'Οι μάγειρες δεν μπορούν να κάνουν κράτηση' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.points < 1) return res.status(400).json({ error: 'Δεν έχεις αρκετούς πόντους (χρειάζεσαι τουλάχιστον 1)' });

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
  if (!listing) return res.status(404).json({ error: 'Αγγελία δεν βρέθηκε' });
  if (listing.user_id === req.user.id) return res.status(400).json({ error: 'Δεν μπορείς να κάνεις αίτημα στη δική σου αγγελία' });

  const status = computeStatus(listing);
  if (status !== 'active') return res.status(400).json({ error: 'Η αγγελία δεν είναι πλέον διαθέσιμη' });

  const existing = db.prepare(
    "SELECT id FROM requests WHERE listing_id = ? AND consumer_id = ? AND status NOT IN ('rejected')"
  ).get(listing_id, req.user.id);
  if (existing) return res.status(400).json({ error: 'Έχεις ήδη κάνει αίτημα για αυτή την αγγελία' });

  // Deduct 1 point from consumer
  db.prepare('UPDATE users SET points = points - 1 WHERE id = ?').run(req.user.id);

  const result = db.prepare(
    'INSERT INTO requests (listing_id, consumer_id, status) VALUES (?, ?, ?)'
  ).run(listing_id, req.user.id, 'pending');

  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(request);
});

// GET /api/requests/my — consumer's own requests
router.get('/my', authenticate, (req, res) => {
  const requests = db.prepare(`
    SELECT r.*, l.title AS listing_title, l.location, l.pickup_time, l.photo,
           u.username AS cook_username,
           (SELECT score FROM ratings WHERE request_id = r.id) AS rating
    FROM requests r
    JOIN listings l ON r.listing_id = l.id
    JOIN users u ON l.user_id = u.id
    WHERE r.consumer_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json(requests);
});

// GET /api/requests/incoming — cook's incoming requests
router.get('/incoming', authenticate, (req, res) => {
  const requests = db.prepare(`
    SELECT r.*, l.title AS listing_title, l.portions_available,
           u.username AS consumer_username
    FROM requests r
    JOIN listings l ON r.listing_id = l.id
    JOIN users u ON r.consumer_id = u.id
    WHERE l.user_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json(requests);
});

// PUT /api/requests/:id/approve
router.put('/:id/approve', authenticate, (req, res) => {
  const request = db.prepare(`
    SELECT r.*, l.user_id AS cook_id, l.portions_available
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Το αίτημα δεν είναι σε αναμονή' });
  if (request.portions_available < 1) return res.status(400).json({ error: 'Δεν υπάρχουν διαθέσιμες μερίδες' });

  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('approved', request.id);
  db.prepare('UPDATE listings SET portions_available = portions_available - 1 WHERE id = ?').run(request.listing_id);
  res.json({ message: 'Αποδοχή αιτήματος' });
});

// PUT /api/requests/:id/reject
router.put('/:id/reject', authenticate, (req, res) => {
  const request = db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Το αίτημα δεν είναι σε αναμονή' });

  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('rejected', request.id);
  // Refund consumer
  db.prepare('UPDATE users SET points = points + 1 WHERE id = ?').run(request.consumer_id);
  res.json({ message: 'Απόρριψη αιτήματος' });
});

// PUT /api/requests/:id/complete
router.put('/:id/complete', authenticate, (req, res) => {
  const request = db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'approved') return res.status(400).json({ error: 'Το αίτημα πρέπει να είναι αποδεκτό' });

  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('completed', request.id);
  // Base point for cook
  db.prepare('UPDATE users SET points = points + 1 WHERE id = ?').run(req.user.id);
  res.json({ message: 'Η παράδοση ολοκληρώθηκε' });
});

// PUT /api/requests/:id/no_show
router.put('/:id/no_show', authenticate, (req, res) => {
  const request = db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'approved') return res.status(400).json({ error: 'Το αίτημα πρέπει να είναι αποδεκτό' });

  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('no_show', request.id);
  // Penalize consumer, restore portion
  db.prepare('UPDATE users SET points = MAX(0, points - 1) WHERE id = ?').run(request.consumer_id);
  db.prepare('UPDATE listings SET portions_available = portions_available + 1 WHERE id = ?').run(request.listing_id);
  res.json({ message: 'No-show καταχωρήθηκε' });
});

module.exports = router;
