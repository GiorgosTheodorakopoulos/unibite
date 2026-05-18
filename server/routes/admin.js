const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const { total_portions_month } = db.prepare(`
    SELECT COUNT(*) AS total_portions_month
    FROM requests
    WHERE status = 'completed' AND created_at > ?
  `).get(monthAgo);

  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const { active_listings } = db.prepare(`
    SELECT COUNT(*) AS active_listings FROM listings
    WHERE created_at > ? AND portions_available > 0
  `).get(cutoff);

  const { total_users } = db.prepare(`
    SELECT COUNT(*) AS total_users FROM users WHERE role != 'admin'
  `).get();

  res.json({ total_portions_month, active_listings, total_users });
});

// GET /api/admin/leaderboard
router.get('/leaderboard', (req, res) => {
  const top_donor = db.prepare(`
    SELECT u.username, COUNT(r.id) AS count
    FROM requests r
    JOIN listings l ON r.listing_id = l.id
    JOIN users u ON l.user_id = u.id
    WHERE r.status = 'completed'
    GROUP BY u.id
    ORDER BY count DESC
    LIMIT 1
  `).get();

  const top_rated_listings = db.prepare(`
    SELECT l.title, u.username AS cook_username, AVG(rt.score) AS avg_score, COUNT(rt.id) AS rating_count
    FROM ratings rt
    JOIN requests r ON rt.request_id = r.id
    JOIN listings l ON r.listing_id = l.id
    JOIN users u ON l.user_id = u.id
    GROUP BY l.id
    HAVING rating_count >= 1
    ORDER BY avg_score DESC
    LIMIT 3
  `).all();

  res.json({ top_donor: top_donor || null, top_rated_listings });
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT id, username, email, role, points, created_at
    FROM users
    WHERE role != 'admin'
    ORDER BY created_at DESC
  `).all();
  res.json(users);
});

module.exports = router;
