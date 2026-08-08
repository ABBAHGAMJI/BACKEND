const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendMagicLinkEmail } = require('../mailer');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function toPublicUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

// POST /api/auth/register  { name, email, password }
router.post('/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are all required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: existing } = await db.from('users').select('id').eq('email', normalizedEmail).maybeSingle();
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const { data: user, error } = await db.from('users')
    .insert({ name, email: normalizedEmail, password_hash: passwordHash, loyalty_points: 0 })
    .select().single();
  if (error) return res.status(500).json({ error: 'Could not create account.' });

  res.status(201).json({ token: signToken(user), user: toPublicUser(user) });
});

// POST /api/auth/login  { email, password }
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const { data: user } = await db.from('users').select('*').eq('email', normalizedEmail).maybeSingle();
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  res.json({ token: signToken(user), user: toPublicUser(user) });
});

const magicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many magic link requests. Please wait a few minutes and try again.' }
});

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// POST /api/auth/magic-link  { email }
router.post('/magic-link', magicLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const rawToken = crypto.randomBytes(32).toString('hex');
  await db.from('magic_links').insert({
    token_hash: hashToken(rawToken),
    email: normalizedEmail,
    expires_at: Date.now() + MAGIC_LINK_TTL_MS,
    used: false
  });

  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const magicUrl = `${frontendUrl}/?magicToken=${rawToken}`;

  const emailResult = await sendMagicLinkEmail(normalizedEmail, magicUrl);

  const response = { ok: true, message: 'If that email has an account, a login link is on its way.' };
  if (!emailResult.sent) {
    console.log(`[magic-link] No SMTP configured — login link for ${normalizedEmail}: ${magicUrl}`);
    response.devMagicUrl = magicUrl;
  }
  res.json(response);
});

// POST /api/auth/magic-login  { token }
router.post('/magic-login', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing login link token.' });

  const tokenHash = hashToken(token);
  const { data: record } = await db.from('magic_links').select('*').eq('token_hash', tokenHash).maybeSingle();

  if (!record || record.used || record.expires_at < Date.now()) {
    return res.status(401).json({ error: 'This login link is invalid or has expired. Request a new one.' });
  }
  await db.from('magic_links').update({ used: true }).eq('token_hash', tokenHash);

  let { data: user } = await db.from('users').select('*').eq('email', record.email).maybeSingle();
  if (!user) {
    const placeholderHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
    const { data: newUser, error } = await db.from('users')
      .insert({ name: record.email.split('@')[0], email: record.email, password_hash: placeholderHash, loyalty_points: 0 })
      .select().single();
    if (error) return res.status(500).json({ error: 'Could not create account.' });
    user = newUser;
  }

  res.json({ token: signToken(user), user: toPublicUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { data: user } = await db.from('users').select('*').eq('id', req.user.id).maybeSingle();
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  res.json({ id: user.id, name: user.name, email: user.email, measurements: user.measurements, loyaltyPoints: user.loyalty_points || 0 });
});

// PUT /api/auth/measurements
router.put('/measurements', requireAuth, async (req, res) => {
  await db.from('users').update({ measurements: req.body }).eq('id', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
