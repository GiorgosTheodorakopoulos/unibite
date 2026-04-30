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
router.post('/register', (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'Όλα τα πεδία είναι υποχρεωτικά' });
  }
  if (!['cook', 'consumer'].includes(role)) {
    return res.status(400).json({ error: 'Μη έγκυρος ρόλος' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, role, points) VALUES (?, ?, ?, ?, 5)'
    ).run(username, email, hash, role);
    const user = db.prepare('SELECT id, username, email, role, points FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ token: makeToken(user), user });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Το email ή username χρησιμοποιείται ήδη' });
    }
    res.status(500).json({ error: 'Σφάλμα server' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password, role: selectedRole } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Συμπλήρωσε email και password' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Λάθος email ή password' });
  }
  const activeRole = user.role === 'admin'
    ? 'admin'
    : (selectedRole && ['cook', 'consumer'].includes(selectedRole) ? selectedRole : user.role);
  const { password_hash, ...safeUser } = user;
  res.json({ token: makeToken(user, activeRole), user: { ...safeUser, role: activeRole } });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, username, email, role, points FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

module.exports = router;
