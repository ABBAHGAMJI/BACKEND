const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// DB rows are snake_case; the frontend (unchanged from the original project)
// expects the same camelCase shape it always has.
function toPublicProduct(p) {
  return {
    id: p.id, cat: p.cat, name: p.name, price: Number(p.price),
    oldPrice: p.old_price !== null && p.old_price !== undefined ? Number(p.old_price) : null,
    img: p.img, desc: p.description,
    stock: p.stock, lowStockThreshold: p.low_stock_threshold
  };
}

// GET /api/products — public catalog, optional ?category=Kaftan filter
router.get('/', async (req, res) => {
  const { category } = req.query;
  let query = db.from('products').select('*').order('id', { ascending: true });
  if (category && category !== 'all') query = query.eq('cat', category);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load products.' });
  res.json(data.map(toPublicProduct));
});

// POST /api/products — admin: add a product
router.post('/', requireAdmin, async (req, res) => {
  const { name, cat, price, img, desc, stock, lowStockThreshold, oldPrice } = req.body;
  if (!name || !cat || !price) return res.status(400).json({ error: 'Name, category and price are required.' });
  if (Number(price) <= 0) return res.status(400).json({ error: 'Price must be greater than zero.' });

  const parsedOldPrice = oldPrice !== undefined && oldPrice !== null && oldPrice !== '' ? Number(oldPrice) : null;
  if (parsedOldPrice !== null && (!Number.isFinite(parsedOldPrice) || parsedOldPrice <= Number(price))) {
    return res.status(400).json({ error: 'Old price must be a number greater than the current price.' });
  }

  const { data: product, error } = await db.from('products').insert({
    name, cat, price: Number(price), old_price: parsedOldPrice, img: img || '', description: desc || '',
    stock: Number.isFinite(Number(stock)) ? Number(stock) : 20,
    low_stock_threshold: Number.isFinite(Number(lowStockThreshold)) ? Number(lowStockThreshold) : 5
  }).select().single();
  if (error) return res.status(500).json({ error: 'Could not create product.' });

  res.status(201).json(toPublicProduct(product));
});

// PUT /api/products/:id — admin: edit a product
router.put('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { data: existing } = await db.from('products').select('id').eq('id', id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const body = { ...req.body };
  const updates = {};
  if ('name' in body) updates.name = body.name;
  if ('cat' in body) updates.cat = body.cat;
  if ('price' in body) updates.price = Number(body.price);
  if ('img' in body) updates.img = body.img;
  if ('desc' in body) updates.description = body.desc;
  if ('stock' in body) updates.stock = Number(body.stock);
  if ('lowStockThreshold' in body) updates.low_stock_threshold = Number(body.lowStockThreshold);
  if ('oldPrice' in body) {
    updates.old_price = body.oldPrice !== undefined && body.oldPrice !== null && body.oldPrice !== ''
      ? Number(body.oldPrice) : null;
  }

  const { data: product, error } = await db.from('products').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: 'Could not update product.' });
  res.json(toPublicProduct(product));
});

// DELETE /api/products/:id — admin: remove a product
router.delete('/:id', requireAdmin, async (req, res) => {
  await db.from('products').delete().eq('id', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
module.exports.toPublicProduct = toPublicProduct;
