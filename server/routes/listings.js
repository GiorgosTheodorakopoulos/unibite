const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

function computeStatus(listing) {
  const created = new Date(listing.created_at);
  const expiry = new Date(created.getTime() + 48 * 3600 * 1000);
  if (new Date() > expiry) return 'expired';
  return listing.portions_available > 0 ? 'active' : 'inactive';
}

function parseListing(l) {
  if (typeof l.allergens === 'string') {
    try { l.allergens = JSON.parse(l.allergens); } catch { l.allergens = []; }
  }
  l.status = computeStatus(l);
  return l;
}

router.get('/', async (req, res) => {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const listings = await db.prepare(`
    SELECT l.*, u.username AS cook_username
    FROM listings l
    JOIN users u ON l.user_id = u.id
    WHERE l.created_at > ?
    ORDER BY l.created_at DESC
  `).all(cutoff);
  res.json(listings.map(parseListing));
});

router.get('/mine/all', authenticate, async (req, res) => {
  const listings = await db.prepare(`
    SELECT l.*, u.username AS cook_username
    FROM listings l JOIN users u ON l.user_id = u.id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC
  `).all(req.user.id);
  res.json(listings.map(parseListing));
});

router.get('/:id', async (req, res) => {
  const l = await db.prepare(`
    SELECT l.*, u.username AS cook_username
    FROM listings l JOIN users u ON l.user_id = u.id
    WHERE l.id = ?
  `).get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Δεν βρέθηκε' });
  res.json(parseListing(l));
});

router.post('/', authenticate, upload.single('photo'), async (req, res) => {
  if (req.user.role !== 'cook') return res.status(403).json({ error: 'Μόνο οι μάγειρες μπορούν να δημιουργήσουν αγγελίες' });
  const { title, notes, portions, location, lat, lng, pickup_time, allergens } = req.body;
  if (!title || !portions || !location || !pickup_time) {
    return res.status(400).json({ error: 'Λείπουν υποχρεωτικά πεδία' });
  }
  const p = parseInt(portions, 10);
  if (isNaN(p) || p < 1) return res.status(400).json({ error: 'Μη έγκυρος αριθμός μερίδων' });

  let allergensArr = [];
  if (allergens) {
    allergensArr = Array.isArray(allergens) ? allergens : JSON.parse(allergens);
  }
  const photo = req.file ? `/uploads/${req.file.filename}` : null;

  const info = await db.prepare(`
    INSERT INTO listings (user_id, title, photo, notes, portions_total, portions_available, location, lat, lng, pickup_time, allergens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, title, photo, notes || '', p, p,
    location, lat || null, lng || null, pickup_time, JSON.stringify(allergensArr));

  const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(parseListing(listing));
});

router.put('/:id', authenticate, upload.single('photo'), async (req, res) => {
  const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Δεν βρέθηκε' });
  if (listing.user_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });

  const { title, notes, portions, location, lat, lng, pickup_time, allergens } = req.body;
  const p = portions ? parseInt(portions, 10) : listing.portions_total;
  let allergensStr = listing.allergens;
  if (allergens) {
    allergensStr = JSON.stringify(Array.isArray(allergens) ? allergens : JSON.parse(allergens));
  }
  const photo = req.file ? `/uploads/${req.file.filename}` : listing.photo;

  await db.prepare(`
    UPDATE listings SET title=?, photo=?, notes=?, portions_total=?, location=?, lat=?, lng=?, pickup_time=?, allergens=?
    WHERE id=?
  `).run(
    title || listing.title, photo, notes ?? listing.notes, p,
    location || listing.location, lat || listing.lat, lng || listing.lng,
    pickup_time || listing.pickup_time, allergensStr, listing.id
  );

  const updated = await db.prepare('SELECT * FROM listings WHERE id = ?').get(listing.id);
  res.json(parseListing(updated));
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Δεν βρέθηκε' });
    if (listing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
    }
    await db.transaction(async (tx) => {
      // Must delete ratings before requests, then requests before listing (FK order)
      await tx.prepare(`
        DELETE FROM ratings WHERE request_id IN (
          SELECT id FROM requests WHERE listing_id = ?
        )
      `).run(listing.id);
      await tx.prepare('DELETE FROM requests WHERE listing_id = ?').run(listing.id);
      await tx.prepare('DELETE FROM listings WHERE id = ?').run(listing.id);
    });
    res.json({ message: 'Η αγγελία διαγράφηκε' });
  } catch (e) {
    console.error('Delete listing error:', e.message);
    res.status(500).json({ error: 'Σφάλμα κατά τη διαγραφή' });
  }
});

module.exports = router;
