const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers — admin: list accounts created on the storefront
router.get('/', requireAdmin, async (req, res) => {
  const { data, error } = await db.from('users').select('id, name, email, measurements');
  if (error) return res.status(500).json({ error: 'Could not load customers.' });
  res.json(data);
});

module.exports = router;
