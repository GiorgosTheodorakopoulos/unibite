const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function makeToken(user, activeRole) {
  return jwt.sign({ id: user.id, role: activeRole || user.role }, JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
// Accepts optional `role` (cook|consumer). Consumer → 5 points, Cook → 0 points.
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Όλα τα πεδία είναι υποχρεωτικά' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.prepare(
      'INSERT INTO users (username, email, password_hash, role, points) VALUES (?, ?, ?, ?, ?)'
    ).run(username, email, hash, 'consumer', 5);
    const user = await db.prepare(
      'SELECT id, username, email, role, points FROM users WHERE id = ?'
    ).get(result.lastInsertRowid);
    res.status(201).json({ token: makeToken(user), user });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Το email ή username χρησιμοποιείται ήδη' });
    }
    res.status(500).json({ error: 'Σφάλμα server' });
  }
});

// PUT /api/auth/role — role picker after first registration (legacy flow)
router.put('/role', authenticate, async (req, res) => {
  const { role } = req.body;
  if (!['cook', 'consumer'].includes(role)) {
    return res.status(400).json({ error: 'Μη έγκυρος ρόλος' });
  }
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.user.id);
  const user = await db.prepare(
    'SELECT id, username, email, role, points FROM users WHERE id = ?'
  ).get(req.user.id);
  res.json({ token: makeToken(user), user });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password, role: selectedRole } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Συμπλήρωσε email και password' });
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Λάθος email ή password' });
  }
  if (user.role !== 'admin' && (!selectedRole || !['cook', 'consumer'].includes(selectedRole))) {
    return res.status(400).json({ error: 'Επίλεξε αν θα συνδεθείς ως Μάγειρας ή Καταναλωτής' });
  }
  const activeRole = user.role === 'admin' ? 'admin' : selectedRole;
  if (activeRole !== 'admin') {
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(activeRole, user.id);
  }
  const { password_hash, ...safeUser } = user;
  res.json({ token: makeToken(user, activeRole), user: { ...safeUser, role: activeRole } });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  const user = await db.prepare(
    'SELECT id, username, email, role, points FROM users WHERE id = ?'
  ).get(req.user.id);
  res.json(user);
});

module.exports = router;
