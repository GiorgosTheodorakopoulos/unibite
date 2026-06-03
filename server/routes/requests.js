const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function computeStatus(listing) {
  const created = new Date(listing.created_at);
  const expiry = new Date(created.getTime() + 48 * 3600 * 1000);
  if (new Date() > expiry) return 'expired';
  return listing.portions_available > 0 ? 'active' : 'inactive';
}

// Checks for completed requests where the consumer never rated within 48h of pickup.
// Uses pickup_time (set when cook marks complete) — not created_at.
// Idempotent: rating_penalty_applied flag prevents double-deduction.
// Example: request completed at T, consumer hasn't rated by T+48h → deduct 1 point, set flag.
async function applyRatingPenalties(consumerId) {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const unrated = await db.prepare(`
    SELECT r.id, r.consumer_id FROM requests r
    WHERE r.consumer_id = ?
      AND r.status = 'completed'
      AND r.rating_penalty_applied = 0
      AND r.pickup_time IS NOT NULL
      AND r.pickup_time < ?
      AND NOT EXISTS (SELECT 1 FROM ratings rt WHERE rt.request_id = r.id)
  `).all(consumerId, cutoff);

  for (const r of unrated) {
    await db.transaction(async (tx) => {
      // Atomic check-and-set: if another concurrent request already set the flag, rowCount = 0 and we skip.
      const result = await tx.prepare(
        'UPDATE requests SET rating_penalty_applied = 1 WHERE id = ? AND rating_penalty_applied = 0'
      ).run(r.id);
      if (result.rowCount > 0) {
        await tx.prepare('UPDATE users SET points = GREATEST(0, points - 1) WHERE id = ?').run(r.consumer_id);
      }
    });
  }
}

// POST /api/requests — consumer reserves a portion
// Requires ≥ 1 point to reserve (reputation gate). Points are NOT deducted on reservation.
// Points are only lost as penalties (no-show, no-rating within 48h).
router.post('/', authenticate, async (req, res) => {
  const { listing_id } = req.body;
  if (!listing_id) return res.status(400).json({ error: 'Λείπει το listing_id' });

  if (req.user.role === 'cook') {
    return res.status(403).json({ error: 'Οι μάγειρες δεν μπορούν να κάνουν κράτηση' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.points < 1) {
    return res.status(400).json({ error: 'Δεν έχεις αρκετούς πόντους (χρειάζεσαι τουλάχιστον 1)' });
  }

  const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);

  if (!listing) return res.status(404).json({ error: 'Αγγελία δεν βρέθηκε' });
  if (listing.user_id === req.user.id) {
    return res.status(400).json({ error: 'Δεν μπορείς να κάνεις αίτημα στη δική σου αγγελία' });
  }

  const status = computeStatus(listing);
  if (status !== 'active') return res.status(400).json({ error: 'Η αγγελία δεν είναι πλέον διαθέσιμη' });

  const existing = await db.prepare(
    "SELECT id FROM requests WHERE listing_id = ? AND consumer_id = ? AND status NOT IN ('rejected')"
  ).get(listing_id, req.user.id);
  if (existing) return res.status(400).json({ error: 'Έχεις ήδη κάνει αίτημα για αυτή την αγγελία' });

  const result = await db.transaction(async (tx) => {
    await tx.prepare('UPDATE users SET points = points - 1 WHERE id = ?').run(req.user.id);
    return tx.prepare(
      'INSERT INTO requests (listing_id, consumer_id, status) VALUES (?, ?, ?)'
    ).run(listing_id, req.user.id, 'pending');
  });

  const request = await db.prepare('SELECT * FROM requests WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(request);
});

// GET /api/requests/my — consumer's own requests
// Applies rating penalties before returning so the consumer sees accurate points.
router.get('/my', authenticate, async (req, res) => {
  await applyRatingPenalties(req.user.id);
  const requests = await db.prepare(`
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
router.get('/incoming', authenticate, async (req, res) => {
  if (req.user.role !== 'cook') return res.status(403).json({ error: 'Πρόσβαση μόνο για μάγειρες' });
  const requests = await db.prepare(`
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
router.put('/:id/approve', authenticate, async (req, res) => {
  const request = await db.prepare(`
    SELECT r.*, l.user_id AS cook_id, l.portions_available
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Το αίτημα δεν είναι σε αναμονή' });
  if (request.portions_available < 1) return res.status(400).json({ error: 'Δεν υπάρχουν διαθέσιμες μερίδες' });

  await db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('approved', request.id);
  await db.prepare('UPDATE listings SET portions_available = portions_available - 1 WHERE id = ?').run(request.listing_id);
  res.json({ message: 'Αποδοχή αιτήματος' });
});

// PUT /api/requests/:id/reject
// No point refund — reservation no longer costs a point.
router.put('/:id/reject', authenticate, async (req, res) => {
  const request = await db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Το αίτημα δεν είναι σε αναμονή' });

  await db.transaction(async (tx) => {
    await tx.prepare('UPDATE requests SET status = ? WHERE id = ?').run('rejected', request.id);
    await tx.prepare('UPDATE users SET points = points + 1 WHERE id = ?').run(request.consumer_id);
  });
  res.json({ message: 'Απόρριψη αιτήματος' });
});

// PUT /api/requests/:id/complete — cook marks portion as picked up
// Sets pickup_time (starts the 48h rating window).
// +1 point to cook atomically with the status update.
// Example trace: cook completes request 7 → DB transaction: status='completed', pickup_time=NOW(),
//   cook.points += 1. Response includes cookPoints for immediate UI update.
router.put('/:id/complete', authenticate, async (req, res) => {
  const request = await db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'approved') return res.status(400).json({ error: 'Το αίτημα πρέπει να είναι αποδεκτό' });

  const cook = await db.transaction(async (tx) => {
    await tx.prepare(
      'UPDATE requests SET status = ?, pickup_time = NOW() WHERE id = ?'
    ).run('completed', request.id);
    await tx.prepare('UPDATE users SET points = points + 1 WHERE id = ?').run(req.user.id);
    return tx.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
  });

  res.json({ message: 'Η παράδοση ολοκληρώθηκε', cookPoints: cook.points });
});

// PUT /api/requests/:id/no_show — cook marks consumer as no-show
// -1 point from consumer (floor 0) atomically. Restores the portion.
// Example trace: consumer 12 no-shows request 5 → DB transaction: status='no_show',
//   consumer.points = GREATEST(0, points-1), listing.portions_available += 1.
router.put('/:id/no_show', authenticate, async (req, res) => {
  const request = await db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.cook_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'approved') return res.status(400).json({ error: 'Το αίτημα πρέπει να είναι αποδεκτό' });

  const consumer = await db.transaction(async (tx) => {
    await tx.prepare('UPDATE requests SET status = ? WHERE id = ?').run('no_show', request.id);
    await tx.prepare('UPDATE users SET points = GREATEST(0, points - 1) WHERE id = ?').run(request.consumer_id);
    await tx.prepare(
      'UPDATE listings SET portions_available = portions_available + 1 WHERE id = ?'
    ).run(request.listing_id);
    return tx.prepare('SELECT points FROM users WHERE id = ?').get(request.consumer_id);
  });

  res.json({ message: 'No-show καταχωρήθηκε', consumerPoints: consumer.points });
});

module.exports = router;
