const express = require('express');
const { v4: uuid } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAdmin, attachUserIfPresent } = require('../middleware/auth');
const { evaluateCoupon } = require('./coupons');
const { sendOrderConfirmationEmail } = require('../mailer');
const { createOrderTrackingLink, redeemOrderTrackingLink } = require('./orderLinks');

const router = express.Router();

function toPublicOrder(o) {
  return {
    id: o.id, items: o.items, subtotal: Number(o.subtotal), discount: Number(o.discount),
    couponCode: o.coupon_code, pointsRedeemed: o.points_redeemed, pointsEarned: o.points_earned,
    total: Number(o.total), customer: o.customer, estimatedDelivery: o.estimated_delivery,
    userId: o.user_id, status: o.status, paid: o.paid, txRef: o.tx_ref, createdAt: o.created_at
  };
}

async function issueOrderVerificationEmail(order) {
  const link = await createOrderTrackingLink(order);
  if (!link) return;
  const emailResult = await sendOrderConfirmationEmail(link.email, order, link.trackUrl);
  if (!emailResult.sent) {
    console.log(`[order-link] No email sent for ${order.id} — verify/track link: ${link.trackUrl}`);
  }
}

const POINT_REDEEM_VALUE = 5; // 1 point = ₦5 off

const STAGES = ["Order Placed", "Cutting & Tailoring", "Quality Check", "Out For Delivery", "Delivered"];

const STANDARD_DELIVERY_DAYS = { min: 3, max: 5 };
const MADE_TO_MEASURE_DELIVERY_DAYS = { min: 10, max: 14 };

function estimateDelivery(items) {
  const isMadeToMeasure = (items || []).some(i => i.measurements);
  const { min, max } = isMadeToMeasure ? MADE_TO_MEASURE_DELIVERY_DAYS : STANDARD_DELIVERY_DAYS;
  const now = new Date();
  const earliest = new Date(now); earliest.setDate(earliest.getDate() + min);
  const latest = new Date(now); latest.setDate(latest.getDate() + max);
  return {
    label: `${min}–${max} business days${isMadeToMeasure ? ' (made-to-measure)' : ''}`,
    minDays: min, maxDays: max,
    earliestDate: earliest.toISOString(), latestDate: latest.toISOString()
  };
}

const trackLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// POST /api/orders — create an order (called after checkout, before payment is confirmed)
router.post('/', attachUserIfPresent, async (req, res) => {
  const { items, customer, couponCode, pointsToRedeem } = req.body;
  if (!items || !items.length || !customer) {
    return res.status(400).json({ error: 'Cart items and customer details are required.' });
  }
  if (!customer.name || !customer.phone || !customer.address) {
    return res.status(400).json({ error: 'Name, phone and delivery address are required.' });
  }

  try {
    const productIds = items.map(i => i.productId);
    const { data: products } = await db.from('products').select('*').in('id', productIds);

    let subtotal = 0;
    const orderItems = items.map(i => {
      const product = (products || []).find(p => p.id === i.productId);
      if (!product) throw new Error('One of the items in your cart is no longer available.');
      const qty = Number(i.qty);
      if (!Number.isInteger(qty) || qty < 1) throw new Error('Item quantity must be a whole number of 1 or more.');
      if (typeof product.stock === 'number' && product.stock < qty) {
        throw new Error(`Only ${product.stock} left of "${product.name}" — reduce the quantity in your cart.`);
      }
      subtotal += Number(product.price) * qty;
      return { productId: product.id, name: product.name, qty, price: Number(product.price), measurements: i.measurements || null };
    });

    let discount = 0;
    let appliedCoupon = null;
    if (couponCode) {
      const result = await evaluateCoupon(couponCode, subtotal);
      if (!result.valid) throw new Error(result.error);
      discount += result.discount;
      appliedCoupon = result.coupon.code;
    }

    let pointsRedeemed = 0;
    let user = null;
    if (req.user) {
      const { data } = await db.from('users').select('*').eq('id', req.user.id).maybeSingle();
      user = data;
    }
    if (pointsToRedeem && user) {
      const requested = Math.max(0, Math.floor(Number(pointsToRedeem)));
      const affordable = Math.min(requested, user.loyalty_points || 0);
      const remainingAfterCoupon = subtotal - discount;
      const maxPointsUsable = Math.floor(remainingAfterCoupon / POINT_REDEEM_VALUE);
      pointsRedeemed = Math.min(affordable, maxPointsUsable);
      discount += pointsRedeemed * POINT_REDEEM_VALUE;
    }

    const total = Math.max(0, subtotal - discount);

    let location = null;
    if (customer.location && Number.isFinite(Number(customer.location.lat)) && Number.isFinite(Number(customer.location.lng))) {
      location = { lat: Number(customer.location.lat), lng: Number(customer.location.lng) };
    }

    const orderRow = {
      id: 'ABG-' + uuid().slice(0, 8).toUpperCase(),
      items: orderItems,
      subtotal, discount,
      coupon_code: appliedCoupon,
      points_redeemed: pointsRedeemed,
      points_earned: 0,
      total,
      customer: { ...customer, location },
      estimated_delivery: estimateDelivery(orderItems),
      user_id: user ? user.id : null,
      status: 'Order Placed',
      paid: false,
      tx_ref: null
    };

    const { data: order, error } = await db.from('orders').insert(orderRow).select().single();
    if (error) throw new Error('Could not save your order. Please try again.');

    const publicOrder = toPublicOrder(order);
    res.status(201).json(publicOrder);

    issueOrderVerificationEmail(publicOrder).catch(err =>
      console.error(`[order-link] Failed to send confirmation email for ${order.id}:`, err.message)
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/orders/verify?token=...
router.get('/verify', trackLimiter, async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing verification token.' });

  const order = await redeemOrderTrackingLink(token);
  if (!order) {
    return res.status(401).json({ error: 'This link is invalid or has expired. Use the Track Order form with your order ID or phone number instead.' });
  }
  const o = toPublicOrder(order);
  res.json({ id: o.id, total: o.total, status: o.status, stages: STAGES, createdAt: o.createdAt, estimatedDelivery: o.estimatedDelivery, emailVerified: true });
});

// GET /api/orders/track?query=ABG-XXXX  (matches order id or customer phone)
router.get('/track', trackLimiter, async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Provide an order ID or phone number.' });

  let { data: order } = await db.from('orders').select('*').eq('id', query).maybeSingle();
  if (!order) {
    const { data: byPhone } = await db.from('orders').select('*').eq('customer->>phone', query).limit(1);
    order = byPhone && byPhone[0];
  }
  if (!order) return res.status(404).json({ error: 'No order found for that ID or phone number.' });
  const o = toPublicOrder(order);
  res.json({ id: o.id, total: o.total, status: o.status, stages: STAGES, createdAt: o.createdAt, estimatedDelivery: o.estimatedDelivery });
});

// GET /api/orders — admin: list all orders
router.get('/', requireAdmin, async (req, res) => {
  const { data, error } = await db.from('orders').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load orders.' });
  res.json(data.map(toPublicOrder));
});

// PATCH /api/orders/:id/status — admin: move an order to a new stage
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!STAGES.includes(status)) return res.status(400).json({ error: 'Not a valid order stage.' });
  const { data: existing } = await db.from('orders').select('id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Order not found.' });
  await db.from('orders').update({ status }).eq('id', req.params.id);
  res.json({ ok: true });
});

// GET /api/orders/export — admin: download all orders as CSV
router.get('/export', requireAdmin, async (req, res) => {
  const { data: orders, error } = await db.from('orders').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load orders.' });

  const header = ['Order ID', 'Date', 'Customer', 'Phone', 'Email', 'Items', 'Subtotal', 'Discount', 'Total', 'Status', 'Paid'];
  const escapeCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = orders.map(o => [
    o.id, o.created_at, o.customer.name, o.customer.phone, o.customer.email,
    (o.items || []).map(i => `${i.name} x${i.qty}`).join('; '),
    o.subtotal ?? o.total, o.discount ?? 0, o.total, o.status, o.paid ? 'Yes' : 'No'
  ].map(escapeCsv).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="abbahgamji-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

module.exports = router;
