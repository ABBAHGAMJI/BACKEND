const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many reviews submitted. Please try again later.' }
});

function toPublicReview(r) {
  return { id: r.id, productId: r.product_id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.created_at, approved: r.approved };
}

// GET /api/reviews?productId=17 — public: approved reviews for a product
router.get('/', async (req, res) => {
  const { productId } = req.query;
  let query = db.from('reviews').select('*').eq('approved', true).order('created_at', { ascending: false });
  if (productId) query = query.eq('product_id', Number(productId));
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load reviews.' });

  const reviews = data.map(toPublicReview);
  const count = reviews.length;
  const average = count ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
  res.json({ reviews, average, count });
});

// GET /api/reviews/summary — public: average rating + count per product
router.get('/summary', async (req, res) => {
  const { data, error } = await db.from('reviews').select('product_id, rating').eq('approved', true);
  if (error) return res.status(500).json({ error: 'Could not load reviews.' });

  const byProduct = {};
  data.forEach(r => {
    if (!byProduct[r.product_id]) byProduct[r.product_id] = { total: 0, count: 0 };
    byProduct[r.product_id].total += r.rating;
    byProduct[r.product_id].count += 1;
  });
  const summary = {};
  Object.entries(byProduct).forEach(([productId, { total, count }]) => {
    summary[productId] = { average: Math.round((total / count) * 10) / 10, count };
  });
  res.json(summary);
});

// POST /api/reviews  { productId, name, rating, comment }
router.post('/', reviewLimiter, async (req, res) => {
  const { productId, name, rating, comment } = req.body;
  const { data: product } = await db.from('products').select('id').eq('id', Number(productId)).maybeSingle();
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5.' });
  }
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!comment || !String(comment).trim()) return res.status(400).json({ error: 'A short comment is required.' });
  if (String(comment).length > 800) return res.status(400).json({ error: 'Comment is too long (800 characters max).' });

  const { data: review, error } = await db.from('reviews').insert({
    product_id: Number(productId), name: String(name).trim().slice(0, 80),
    rating: ratingNum, comment: String(comment).trim(), approved: true
  }).select().single();
  if (error) return res.status(500).json({ error: 'Could not save review.' });

  res.status(201).json(toPublicReview(review));
});

// DELETE /api/reviews/:id — admin: unpublish an inappropriate review
router.delete('/:id', requireAdmin, async (req, res) => {
  await db.from('reviews').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
