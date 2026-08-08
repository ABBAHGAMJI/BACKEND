const jwt = require('jsonwebtoken');

// Verifies a customer's JWT and attaches the decoded user to req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Log in to continue.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Log in again.' });
  }
}

// Verifies the request carries the admin token from your .env file.
// Swap this for real admin accounts + roles once you have more than one admin.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// Attaches req.user if a valid customer JWT is present, but never blocks the
// request if it's missing/invalid — used on routes like order creation that
// work for guests too, but should link the order to an account when logged in
// (so loyalty points have somewhere to go).
function attachUserIfPresent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch { /* ignore — treat as guest */ }
  }
  next();
}

module.exports = { requireAuth, requireAdmin, attachUserIfPresent };
