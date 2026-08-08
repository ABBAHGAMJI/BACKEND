const express = require('express');
const db = require('../db');
const { sendPaymentConfirmedEmail } = require('../mailer');
const { createOrderTrackingLink } = require('./orderLinks');

const router = express.Router();

const POINTS_PER_NAIRA_SPENT = 1 / 1000; // 1 loyalty point per ₦1,000 spent

function toPublicOrder(o) {
  return {
    id: o.id, items: o.items, subtotal: Number(o.subtotal), discount: Number(o.discount),
    couponCode: o.coupon_code, pointsRedeemed: o.points_redeemed, pointsEarned: o.points_earned,
    total: Number(o.total), customer: o.customer, estimatedDelivery: o.estimated_delivery,
    userId: o.user_id, status: o.status, paid: o.paid, txRef: o.tx_ref, createdAt: o.created_at
  };
}

// POST /api/payments/verify  { transaction_id, order_id }
router.post('/verify', async (req, res) => {
  const { transaction_id, order_id } = req.body;
  if (!transaction_id || !order_id) {
    return res.status(400).json({ error: 'transaction_id and order_id are required.' });
  }

  const { data: order } = await db.from('orders').select('*').eq('id', order_id).maybeSingle();
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.paid) {
    return res.json({ ok: true, order: toPublicOrder(order) });
  }

  try {
    const flwRes = await fetch(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const flwData = await flwRes.json();

    const tx = flwData.data;
    const isGenuine = flwData.status === 'success'
      && tx
      && tx.status === 'successful'
      && tx.currency === 'NGN'
      && tx.amount >= order.total
      && tx.tx_ref === order_id;

    if (!isGenuine) {
      return res.status(400).json({ error: 'Payment could not be verified.', detail: flwData });
    }

    // Decrement stock now that payment is genuinely confirmed.
    for (const item of order.items) {
      const { data: product } = await db.from('products').select('stock').eq('id', item.productId).maybeSingle();
      if (product) {
        const newStock = Math.max(0, (product.stock || 0) - item.qty);
        await db.from('products').update({ stock: newStock }).eq('id', item.productId);
      }
    }

    // Credit loyalty points, if this order is linked to an account.
    let pointsEarned = 0;
    if (order.user_id) {
      pointsEarned = Math.floor(order.total * POINTS_PER_NAIRA_SPENT);
      const { data: user } = await db.from('users').select('loyalty_points').eq('id', order.user_id).maybeSingle();
      if (user) {
        const remaining = Math.max(0, (user.loyalty_points || 0) - (order.points_redeemed || 0));
        await db.from('users').update({ loyalty_points: remaining + pointsEarned }).eq('id', order.user_id);
      }
    }

    const { data: paidOrder } = await db.from('orders')
      .update({ paid: true, tx_ref: tx.tx_ref, points_earned: pointsEarned })
      .eq('id', order_id).select().single();

    const publicOrder = toPublicOrder(paidOrder);
    res.json({ ok: true, order: publicOrder });

    const link = await createOrderTrackingLink(publicOrder);
    if (link) {
      sendPaymentConfirmedEmail(link.email, publicOrder, link.trackUrl).catch(err =>
        console.error(`[order-link] Failed to send payment-confirmed email for ${order_id}:`, err.message)
      );
    }
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Flutterwave to verify this payment.', detail: err.message });
  }
});

module.exports = router;
