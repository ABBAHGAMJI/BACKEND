// Shared magic-link helpers for order tracking/verification — used by both
// routes/orders.js (order-received email) and routes/payments.js (payment-
// confirmed email) so there's exactly one place that knows how these tokens
// are minted, hashed and redeemed.

const crypto = require('crypto');
const db = require('../db');

const ORDER_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || '').replace(/\/$/, '');
}

// Mints a fresh tracking token for an order + email, stores only its hash
// (never the raw token), and returns the full URL to put in an email.
// Returns null if the order has no usable email on it.
async function createOrderTrackingLink(order) {
  const email = order.customer?.email && String(order.customer.email).trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return null;

  const rawToken = crypto.randomBytes(32).toString('hex');
  await db.from('order_links').insert({
    token_hash: hashToken(rawToken),
    order_id: order.id,
    email,
    expires_at: Date.now() + ORDER_LINK_TTL_MS,
    verified_at: null
  });

  return { email, trackUrl: `${frontendBaseUrl()}/?orderToken=${rawToken}` };
}

// Redeems a raw token from the URL: validates it, marks first-use as email
// verification, and returns the matching order row (snake_case, as stored —
// callers map it to the public shape) or null if invalid/expired.
async function redeemOrderTrackingLink(rawToken) {
  const tokenHash = hashToken(rawToken);
  const { data: link } = await db.from('order_links').select('*').eq('token_hash', tokenHash).maybeSingle();
  if (!link || link.expires_at < Date.now()) return null;

  const { data: order } = await db.from('orders').select('*').eq('id', link.order_id).maybeSingle();
  if (!order) return null;

  if (!link.verified_at) {
    await db.from('order_links').update({ verified_at: new Date().toISOString() }).eq('token_hash', tokenHash);
  }
  return order;
}

module.exports = { createOrderTrackingLink, redeemOrderTrackingLink };
