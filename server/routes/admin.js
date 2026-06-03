const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', async (req, res) => {
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const [statsMonth, statsListings, statsUsers] = await Promise.all([
    db.prepare(`SELECT COUNT(*)::int AS total_portions_month FROM requests WHERE status = 'completed' AND created_at > ?`).get(monthAgo),
    db.prepare(`SELECT COUNT(*)::int AS active_listings FROM listings WHERE created_at > ? AND portions_available > 0`).get(cutoff),
    db.prepare(`SELECT COUNT(*)::int AS total_users FROM users WHERE role != 'admin'`).get()
  ]);

  res.json({
    total_portions_month: statsMonth.total_portions_month,
    active_listings: statsListings.active_listings,
    total_users: statsUsers.total_users
  });
});

router.get('/leaderboard', async (req, res) => {
  const [top_donor, top_rated_listings] = await Promise.all([
    db.prepare(`
      SELECT u.username, COUNT(r.id)::int AS count
      FROM requests r
      JOIN listings l ON r.listing_id = l.id
      JOIN users u ON l.user_id = u.id
      WHERE r.status = 'completed'
      GROUP BY u.id, u.username
      ORDER BY count DESC
      LIMIT 1
    `).get(),
    db.prepare(`
      SELECT l.title, u.username AS cook_username,
             ROUND(AVG(rt.score)::numeric, 2)::float AS avg_score,
             COUNT(rt.id)::int AS rating_count
      FROM ratings rt
      JOIN requests r ON rt.request_id = r.id
      JOIN listings l ON r.listing_id = l.id
      JOIN users u ON l.user_id = u.id
      GROUP BY l.id, l.title, u.username
      HAVING COUNT(rt.id) >= 1
      ORDER BY avg_score DESC
      LIMIT 3
    `).all()
  ]);

  res.json({ top_donor: top_donor || null, top_rated_listings });
});

router.get('/users', async (req, res) => {
  const users = await db.prepare(`
    SELECT id, username, email, role, points, created_at
    FROM users
    WHERE role != 'admin'
    ORDER BY created_at DESC
  `).all();
  res.json(users);
});

module.exports = router;
