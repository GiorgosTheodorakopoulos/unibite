const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/ratings',  require('./routes/ratings'));
app.use('/api/admin',    require('./routes/admin'));

// SPA fallback
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Rating penalty job: every hour
setInterval(() => {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  const unrated = db.prepare(`
    SELECT r.id, r.consumer_id FROM requests r
    WHERE r.status = 'completed'
      AND r.rating_penalty_applied = 0
      AND r.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM ratings rt WHERE rt.request_id = r.id)
  `).all(cutoff);
  for (const req of unrated) {
    db.prepare('UPDATE users SET points = MAX(0, points - 1) WHERE id = ?').run(req.consumer_id);
    db.prepare('UPDATE requests SET rating_penalty_applied = 1 WHERE id = ?').run(req.id);
    console.log(`Rating penalty: consumer ${req.consumer_id}, request ${req.id}`);
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🍽️  UniBite server running on http://localhost:${PORT}`);
  console.log(`   Admin login: admin@unibite.gr / admin123\n`);
});
