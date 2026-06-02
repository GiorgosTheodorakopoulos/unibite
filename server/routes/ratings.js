const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/ratings — consumer rates a completed request
router.post('/', authenticate, (req, res) => {
  const { request_id, score } = req.body;
  if (!request_id || !score) return res.status(400).json({ error: 'Λείπουν πεδία' });
  const s = parseInt(score, 10);
  if (isNaN(s) || s < 1 || s > 5) return res.status(400).json({ error: 'Βαθμολογία 1-5' });

  const request = db.prepare(`
    SELECT r.*, l.user_id AS cook_id
    FROM requests r JOIN listings l ON r.listing_id = l.id
    WHERE r.id = ?
  `).get(request_id);

  if (!request) return res.status(404).json({ error: 'Αίτημα δεν βρέθηκε' });
  if (request.consumer_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  if (request.status !== 'completed') return res.status(400).json({ error: 'Μπορείς να αξιολογήσεις μόνο ολοκληρωμένες παραλαβές' });

  const existing = db.prepare('SELECT id FROM ratings WHERE request_id = ?').get(request_id);
  if (existing) return res.status(400).json({ error: 'Έχεις ήδη αξιολογήσει αυτή την παραλαβή' });

  db.prepare('INSERT INTO ratings (request_id, score) VALUES (?, ?)').run(request_id, s);

  // Bonus point for cook if score > 3
  if (s > 3) {
    db.prepare('UPDATE users SET points = points + 1 WHERE id = ?').run(request.cook_id);
  }

  res.status(201).json({ message: 'Αξιολόγηση καταχωρήθηκε', score: s });
});

// GET /api/ratings/pending — completed requests by consumer with no rating yet
router.get('/pending', authenticate, (req, res) => {
  const pending = db.prepare(`
    SELECT r.id AS request_id, r.created_at, l.title AS listing_title, u.username AS cook_username
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
