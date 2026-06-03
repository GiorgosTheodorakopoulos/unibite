const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/ratings — consumer rates a completed (picked-up) request
// +1 bonus point to cook if score > 3, inside the same transaction as the INSERT.
// Example trace: consumer rates 4/5 → INSERT rating, cook.points += 1 (bonus).
//                consumer rates 2/5 → INSERT rating, no bonus.
router.post('/', authenticate, async (req, res) => {
  const { request_id, score } = req.body;
  if (!request_id || !score) return res.status(400).json({ error: 'Λείπουν πεδία' });
  const s = parseInt(score, 10);
  if (isNaN(s) || s < 1 || s > 5) return res.status(400).json({ error: 'Βαθμολογία 1-5' });

  const request = await db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(request_id);

  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.consumer_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'completed') {
    return res.status(400).json({ error: 'Μπορείς να αξιολογήσεις μόνο ολοκληρωμένες παραλαβές' });
  }

  const existing = await db.prepare('SELECT id FROM ratings WHERE request_id = ?').get(request_id);
  if (existing) return res.status(400).json({ error: 'Έχεις ήδη αξιολογήσει αυτή την παραλαβή' });

  const cook = await db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO ratings (request_id, score) VALUES (?, ?)').run(request_id, s);
    if (s > 3) {
      await tx.prepare('UPDATE users SET points = points + 1 WHERE id = ?').run(request.cook_id);
    }
    return tx.prepare('SELECT points FROM users WHERE id = ?').get(request.cook_id);
  });

  res.status(201).json({ message: 'Αξιολόγηση καταχωρήθηκε', score: s, cookPoints: cook.points });
});

// GET /api/ratings/pending — completed requests by consumer with no rating yet
router.get('/pending', authenticate, async (req, res) => {
  const pending = await db.prepare(`
    SELECT r.id AS request_id, r.created_at, r.pickup_time, l.title AS listing_title, u.username AS cook_username
    FROM requests r
    JOIN listings l ON r.listing_id = l.id
    JOIN users u ON l.user_id = u.id
    WHERE r.consumer_id = ?
      AND r.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM ratings rt WHERE rt.request_id = r.id)
    ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json(pending);
});

module.exports = router;
