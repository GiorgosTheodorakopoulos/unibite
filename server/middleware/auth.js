const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = 'unibite_secret_2025';

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, email, role, points FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Χρήστης δεν βρέθηκε' });
    req.user = { ...user, role: payload.role || user.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Μη έγκυρο token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, JWT_SECRET };
