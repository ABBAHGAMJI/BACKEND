const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/analytics/summary — admin: everything the dashboard's
// analytics view needs in a single call (revenue trend, top products,
// low-stock alerts, customer stats).
router.get('/summary', requireAdmin, async (req, res) => {
  const [{ data: orders, error: ordersErr }, { data: products, error: productsErr }, { count: totalCustomers, error: usersErr }] = await Promise.all([
    db.from('orders').select('*'),
    db.from('products').select('*'),
    db.from('users').select('*', { count: 'exact', head: true })
  ]);
  if (ordersErr || productsErr || usersErr) return res.status(500).json({ error: 'Could not load analytics.' });

  const paidOrders = orders.filter(o => o.paid);

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const revenueByDay = days.map(day => ({
    day,
    revenue: paidOrders.filter(o => o.created_at.slice(0, 10) === day).reduce((s, o) => s + Number(o.total), 0)
  }));

  const unitsSold = {};
  paidOrders.forEach(o => (o.items || []).forEach(i => { unitsSold[i.productId] = (unitsSold[i.productId] || 0) + i.qty; }));
  const topProducts = Object.entries(unitsSold)
    .map(([productId, qty]) => {
      const product = products.find(p => p.id === Number(productId));
      return product ? { id: product.id, name: product.name, qty, revenue: qty * Number(product.price) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const lowStock = products
    .filter(p => (p.stock ?? 0) <= (p.low_stock_threshold ?? 5))
    .map(p => ({ id: p.id, name: p.name, stock: p.stock, threshold: p.low_stock_threshold }));

  const totalRevenue = paidOrders.reduce((s, o) => s + Number(o.total), 0);

  res.json({
    revenueByDay,
    totalRevenue,
    totalOrders: orders.length,
    paidOrders: paidOrders.length,
    avgOrderValue: paidOrders.length ? Math.round(totalRevenue / paidOrders.length) : 0,
    topProducts,
    lowStock,
    totalCustomers: totalCustomers || 0,
    totalProducts: products.length
  });
});

module.exports = router;
