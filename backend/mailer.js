// Thin email wrapper for the magic-link flow.
//
// If SMTP_HOST / SMTP_USER / SMTP_PASS are set in .env, this sends a real
// email via nodemailer. If they're not set (e.g. while you're still building
// locally), it does nothing and lets the caller fall back to logging /
// returning the link directly — see routes/auth.js.

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null; // package not installed yet — fine, we fall back below
}

function getTransport() {
  if (!nodemailer) return null;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

// Returns { sent: boolean } so callers can decide whether to show the link
// as a fallback (e.g. in dev, or if sending fails).
async function sendMagicLinkEmail(toEmail, magicUrl) {
  const transport = getTransport();
  if (!transport) return { sent: false };

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || '"ABBAHGAMJI" <no-reply@abbahgamji.com>',
      to: toEmail,
      subject: 'Your ABBAHGAMJI login link',
      text: `Tap this link to log in: ${magicUrl}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request this, you can ignore this email.`,
      html: `
        <div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f6f1e4;color:#24211d;">
          <h2 style="font-family:Georgia,serif;color:#141b2e;margin:0 0 16px;">ABBAHGAMJI</h2>
          <p style="margin:0 0 20px;">Tap the button below to log in. This link expires in 15 minutes and works once.</p>
          <a href="${magicUrl}" style="display:inline-block;padding:14px 28px;background:#141b2e;color:#f6f1e4;text-decoration:none;border-radius:4px;letter-spacing:.05em;text-transform:uppercase;font-size:.85rem;">Log In To ABBAHGAMJI</a>
          <p style="margin:24px 0 0;font-size:.8rem;color:#54504a;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Failed to send magic link email:', err.message);
    return { sent: false };
  }
}

// Shared wrapper: builds the branded email shell once so the magic-link,
// order-verification and payment-confirmed emails can't visually drift
// apart from each other.
function renderShell({ heading, bodyHtml, ctaLabel, ctaUrl, footnote }) {
  return `
    <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:32px 26px;background:#f7f2e4;color:#221f1b;">
      <h2 style="font-family:Georgia,serif;color:#0a1f44;margin:0 0 4px;letter-spacing:.04em;">ABBAH<span style="color:#c9a24a;">GAMJI</span></h2>
      <p style="font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:#c9a24a;margin:0 0 22px;">${heading}</p>
      ${bodyHtml}
      ${ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:22px;padding:14px 28px;background:#0a1f44;color:#f7f2e4;text-decoration:none;border-radius:2px;letter-spacing:.05em;text-transform:uppercase;font-size:.82rem;">${ctaLabel}</a>` : ''}
      <p style="margin:26px 0 0;font-size:.78rem;color:#5b564c;border-top:1px dashed rgba(201,162,74,.4);padding-top:16px;">${footnote || "If you didn't expect this email, you can safely ignore it."}</p>
    </div>
  `;
}

function moneyNGN(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

function itemsListHtml(order) {
  return (order.items || []).map(i =>
    `<tr><td style="padding:6px 0;">${i.name} × ${i.qty}${i.measurements ? ' <span style="color:#5b564c;">(made-to-measure)</span>' : ''}</td><td style="padding:6px 0;text-align:right;">${moneyNGN(i.price * i.qty)}</td></tr>`
  ).join('');
}

// Sent right after an order is created (before payment), so the customer
// has written proof the order was received, plus a one-click link to check
// its status later without hunting for their order ID or phone number.
async function sendOrderConfirmationEmail(toEmail, order, trackUrl) {
  const transport = getTransport();
  if (!transport) return { sent: false };

  const deliveryLabel = order.estimatedDelivery?.label || null;
  const addressLine = order.customer?.address
    ? `<p style="margin:0 0 16px;">Delivering to: ${order.customer.address}</p>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi ${order.customer?.name || 'there'}, we've received your order <strong>${order.id}</strong>. Here's what's in it:</p>
    <table style="width:100%;border-collapse:collapse;font-size:.92rem;margin-bottom:12px;">${itemsListHtml(order)}</table>
    <table style="width:100%;border-collapse:collapse;font-size:.92rem;border-top:1px solid rgba(201,162,74,.4);padding-top:8px;">
      <tr><td style="padding-top:10px;font-weight:bold;">Total</td><td style="padding-top:10px;text-align:right;font-weight:bold;">${moneyNGN(order.total)}</td></tr>
    </table>
    ${addressLine}
    ${deliveryLabel ? `<p style="margin:0 0 16px;padding:12px 14px;background:rgba(201,162,74,.12);border-left:3px solid #c9a24a;"><strong>Stipulated delivery time:</strong> ${deliveryLabel}, once payment is confirmed.</p>` : ''}
    <p style="margin:18px 0 0;">Once payment clears, we'll start cutting and tailoring. Verify your email below to unlock one-tap order tracking any time — no need to remember your order ID.</p>
  `;

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || '"ABBAHGAMJI" <no-reply@abbahgamji.com>',
      to: toEmail,
      subject: `Order received — ${order.id}`,
      text: `We've received your order ${order.id}, total ${moneyNGN(order.total)}.${deliveryLabel ? ` Stipulated delivery time: ${deliveryLabel}, once payment is confirmed.` : ''} Verify your email and track your order here: ${trackUrl}\n\nThis link expires in 30 days.`,
      html: renderShell({
        heading: 'Order Received',
        bodyHtml,
        ctaLabel: 'Verify Email & Track Order',
        ctaUrl: trackUrl,
        footnote: "This link expires in 30 days and confirms this email address belongs to the order. If you didn't place this order, you can ignore it."
      })
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Failed to send order confirmation email:', err.message);
    return { sent: false };
  }
}

// Sent once /api/payments/verify has independently confirmed payment with
// Flutterwave — i.e. this only ever goes out for a genuinely paid order.
async function sendPaymentConfirmedEmail(toEmail, order, trackUrl) {
  const transport = getTransport();
  if (!transport) return { sent: false };

  const deliveryLabel = order.estimatedDelivery?.label || null;

  const bodyHtml = `
    <p style="margin:0 0 16px;">Payment for order <strong>${order.id}</strong> is confirmed — ${moneyNGN(order.total)} received. Your tailors are next in line.</p>
    ${deliveryLabel ? `<p style="margin:0 0 16px;padding:12px 14px;background:rgba(201,162,74,.12);border-left:3px solid #c9a24a;"><strong>Stipulated delivery time:</strong> your order should land within ${deliveryLabel}.</p>` : ''}
  `;

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || '"ABBAHGAMJI" <no-reply@abbahgamji.com>',
      to: toEmail,
      subject: `Payment confirmed — ${order.id}`,
      text: `Payment for order ${order.id} is confirmed (${moneyNGN(order.total)}).${deliveryLabel ? ` Stipulated delivery time: ${deliveryLabel}.` : ''} Track it here: ${trackUrl}`,
      html: renderShell({
        heading: 'Payment Confirmed',
        bodyHtml,
        ctaLabel: 'Track My Order',
        ctaUrl: trackUrl
      })
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Failed to send payment confirmation email:', err.message);
    return { sent: false };
  }
}

module.exports = { sendMagicLinkEmail, sendOrderConfirmationEmail, sendPaymentConfirmedEmail };
