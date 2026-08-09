require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ---------- Startup env validation ----------
// Fail fast and loud rather than running with a blank JWT_SECRET/ADMIN_TOKEN
// (which would make auth trivially bypassable) or no Supabase connection.
const REQUIRED_ENV = ['JWT_SECRET', 'ADMIN_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = REQUIRED_ENV.filter(key => !process.env[key] || !process.env[key].trim());
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  console.error('Copy .env.example to .env (or set these in your Vercel project settings) before starting the server.');
  if (require.main === module) process.exit(1);
}
if (!process.env.FLW_SECRET_KEY) {
  console.warn('FLW_SECRET_KEY is not set — payment verification will fail until it is configured.');
}

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // this app only serves JSON now — the frontend (a separate static site) owns its own CSP
  crossOriginResourcePolicy: { policy: 'cross-origin' } // this API is called from a different origin (the Vercel frontend)
}));

// Frontend and backend are now two separate Vercel projects/origins, so CORS
// must be open across origins. Auth uses Bearer tokens (not cookies), so a
// wide-open CORS policy here doesn't expose anything session-based.
app.use(cors());

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' }
}));

app.use(express.json({ limit: '200kb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/coupons', require('./routes/coupons').router);
app.use('/api/analytics', require('./routes/analytics'));

// Simple health check — useful to confirm the deploy + env vars are working
// before pointing the frontend at this URL.
app.get('/', (req, res) => res.json({ ok: true, service: 'ABBAHGAMJI API' }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Something went wrong on our end. Please try again.' });
});

// Only start a listener for local development / traditional Node hosts.
// On Vercel, api/index.js imports `app` and exports it directly — Vercel's
// Node runtime invokes it per-request and never calls this block.
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`ABBAHGAMJI API running on port ${PORT}`));
}

module.exports = require('../server';
