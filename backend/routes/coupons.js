const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const couponLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

function toPublicCoupon(c) {
  return {
    code: c.code, type: c.type, value: Number(c.value), active: c.active,
    minSpend: Number(c.min_spend), expiresAt: c.expires_at, usedCount: c.used_count
  };
}

// Shared validity + discount-amount calculation, used here (to preview a
// discount) and from routes/orders.js (to actually apply one at checkout).
async function evaluateCoupon(code, subtotal) {
  const normalized = String(code || '').trim().toUpperCase();
  const { data: coupon } = await db.from('coupons').select('*').eq('code', normalized).maybeSingle();
  if (!coupon) return { valid: false, error: 'Coupon code not recognized.' };
  if (!coupon.active) return { valid: false, error: 'This coupon is no longer active.' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { valid: false, error: 'This coupon has expired.' };
  if (subtotal < (coupon.min_spend || 0)) {
    return { valid: false, error: `This coupon requires a minimum spend of ₦${Number(coupon.min_spend).toLocaleString()}.` };
  }
  const discount = coupon.type === 'percent'
    ? Math.round(subtotal * (coupon.value / 100))
    : Math.min(coupon.value, subtotal);
  return { valid: true, coupon: toPublicCoupon(coupon), discount };
}

// GET /api/coupons/validate?code=WELCOME10&subtotal=45000
router.get('/validate', couponLimiter, async (req, res) => {
  const { code, subtotal } = req.query;
  if (!code) return res.status(400).json({ valid: false, error: 'Enter a coupon code.' });
  const result = await evaluateCoupon(code, Number(subtotal) || 0);
  res.json(result);
});

// GET /api/coupons — admin: list all coupons
router.get('/', requireAdmin, async (req, res) => {
  const { data, error } = await db.from('coupons').select('*').order('code');
  if (error) return res.status(500).json({ error: 'Could not load coupons.' });
  res.json(data.map(toPublicCoupon));
});

// POST /api/coupons — admin: create a coupon
router.post('/', requireAdmin, async (req, res) => {
  const { code, type, value, minSpend, expiresAt } = req.body;
  if (!code || !['percent', 'fixed'].includes(type) || !(Number(value) > 0)) {
    return res.status(400).json({ error: 'Code, type (percent/fixed) and a positive value are required.' });
  }
  const normalized = String(code).trim().toUpperCase();
  const { data: existing } = await db.from('coupons').select('code').eq('code', normalized).maybeSingle();
  if (existing) return res.status(409).json({ error: 'A coupon with this code already exists.' });

  const { data: coupon, error } = await db.from('coupons').insert({
    code: normalized, type, value: Number(value), active: true,
    min_spend: Number(minSpend) || 0, expires_at: expiresAt || null, used_count: 0
  }).select().single();
  if (error) return res.status(500).json({ error: 'Could not create coupon.' });
  res.status(201).json(toPublicCoupon(coupon));
});

// PATCH /api/coupons/:code — admin: toggle active / edit
router.patch('/:code', requireAdmin, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { data: existing } = await db.from('coupons').select('code').eq('code', code).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Coupon not found.' });

  const body = { ...req.body };
  const updates = {};
  if ('type' in body) updates.type = body.type;
  if ('value' in body) updates.value = Number(body.value);
  if ('active' in body) updates.active = body.active;
  if ('minSpend' in body) updates.min_spend = Number(body.minSpend);
  if ('expiresAt' in body) updates.expires_at = body.expiresAt;

  const { data: coupon, error } = await db.from('coupons').update(updates).eq('code', code).select().single();
  if (error) return res.status(500).json({ error: 'Could not update coupon.' });
  res.json(toPublicCoupon(coupon));
});

// DELETE /api/coupons/:code — admin
router.delete('/:code', requireAdmin, async (req, res) => {
  await db.from('coupons').delete().eq('code', req.params.code.toUpperCase());
  res.json({ ok: true });
});

module.exports = { router, evaluateCoupon };
