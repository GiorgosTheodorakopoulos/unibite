const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public'), { index: false }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/ratings',  require('./routes/ratings'));
app.use('/api/admin',    require('./routes/admin'));

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Εσωτερικό σφάλμα server' });
});

async function start() {
  await db.initDb();

  setInterval(async () => {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const unrated = await db.prepare(`
      SELECT r.id, r.consumer_id FROM requests r
      WHERE r.status = 'completed'
        AND r.rating_penalty_applied = 0
        AND r.pickup_time IS NOT NULL
        AND r.pickup_time < ?
        AND NOT EXISTS (SELECT 1 FROM ratings rt WHERE rt.request_id = r.id)
    `).all(cutoff);
    for (const req of unrated) {
      await db.transaction(async (tx) => {
        const result = await tx.prepare(
          'UPDATE requests SET rating_penalty_applied = 1 WHERE id = ? AND rating_penalty_applied = 0'
        ).run(req.id);
        if (result.rowCount > 0) {
          await tx.prepare('UPDATE users SET points = GREATEST(0, points - 1) WHERE id = ?').run(req.consumer_id);
          console.log(`Rating penalty: consumer ${req.consumer_id}, request ${req.id}`);
        }
      });
    }
  }, 60 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🍽️  UniBite server running on http://localhost:${PORT}`);
    console.log(`   Admin login: admin@unibite.gr / admin123\n`);
    const { exec } = require('child_process');
    exec(`start http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
