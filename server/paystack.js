'use strict';

// ─── Paystack — card checkout + M-Pesa mobile money, one account ─────────
// Fresh-card deposits go through Paystack's Inline widget (PaystackPop,
// loaded client-side): card number/CVV/expiry are entered inside Paystack's
// own popup, never in a field on our page, so raw PAN/CVV never transits
// this server at all — that keeps the deployment in PCI DSS SAQ-A scope.
// The widget's own "payment succeeded" callback is never trusted by itself:
// this server independently re-verifies the transaction reference (via the
// secret key) before crediting anything. Saved-card repeat charges use
// Paystack's reusable authorization_code (never the PAN/CVV, which card
// networks forbid storing under any circumstance) via the Charge API
// server-to-server — no widget needed since the card was already tokenized.
// Neither path walks the user through a PIN/OTP/3DS challenge: only an
// outright 'success' (no-3DS or 3DS2-frictionless, both resolved entirely on
// Paystack/the issuer's side) is accepted — anything else is reported as a
// failed charge. M-Pesa deposits go through the Charge API (mobile_money,
// provider=mpesa), which relays an STK push to Safaricom on our behalf.
//
// This account runs in KES: both card and M-Pesa amounts are collected in
// KES and converted to the platform's USD balances at USD_KES_RATE.

const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';
// Bounds every outbound call so a stalled connection (routing issue,
// half-open TLS handshake, ...) fails fast with a clear timeout error
// instead of hanging until the platform's own gateway timeout kicks in.
const FETCH_TIMEOUT_MS = 15000;

const { PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY } = process.env;

// Server-to-server calls (verify, saved-card charge, M-Pesa STK push,
// webhook signature check) only need the secret key.
const configured = !!PAYSTACK_SECRET_KEY;
// The Inline widget additionally needs the public key exposed to the
// client — that's what "public" means for a Paystack key, safe to hand out.
const cardConfigured = configured && !!PAYSTACK_PUBLIC_KEY;

if (!configured) {
  console.warn('[paystack] Not fully configured — card and M-Pesa deposits are disabled. ' +
    'Set PAYSTACK_SECRET_KEY in .env (see .env.example).');
} else if (!cardConfigured) {
  console.warn('[paystack] PAYSTACK_PUBLIC_KEY not set — card deposits (Inline widget) are disabled. ' +
    'M-Pesa is unaffected.');
}

// Confirms what actually happened to a transaction, straight from Paystack,
// using our secret key. Callers must still check the returned
// status/amount/currency/reference themselves before crediting anything.
async function verifyTransaction(reference) {
  if (!configured) {
    const err = new Error('Paystack is not configured on this server.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(`${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.status) {
    const message = (data && data.message) || `Paystack verify failed (HTTP ${res.status})`;
    const err = new Error(message);
    err.upstream = data;
    throw err;
  }
  return data.data; // { id, reference, amount (subunits), currency, status, customer, ... }
}

// Normalizes Kenyan mobile numbers (07xxxxxxxx, 01xxxxxxxx, +2547xxxxxxxx,
// 2547xxxxxxxx, ...) to the +254XXXXXXXXX format Paystack's mobile_money
// charge expects. Returns null if the input isn't a plausible Kenyan mobile
// number.
function normalizeMsisdn(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^254[71]\d{8}$/.test(digits)) return '+' + digits;
  if (/^0[71]\d{8}$/.test(digits)) return '+254' + digits.slice(1);
  if (/^[71]\d{8}$/.test(digits)) return '+254' + digits;
  return null;
}

// Initiates an M-Pesa STK push via Paystack's Charge API. Paystack pushes
// the prompt straight to the customer's phone — the returned status is
// 'pending'/'send_otp' until they enter their PIN; final outcome still
// needs verifyTransaction() to confirm.
async function chargeMpesa({ phone, amountKES, email, txRef }) {
  if (!configured) {
    const err = new Error('M-Pesa is not configured on this server.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(`${BASE_URL}/charge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      amount: String(Math.round(amountKES * 100)), // Paystack amounts are in subunits (cents)
      currency: 'KES',
      reference: txRef,
      mobile_money: { phone, provider: 'mpesa' }
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.status) {
    const message = (data && data.message) || `M-Pesa charge failed (HTTP ${res.status})`;
    const err = new Error(message);
    err.upstream = data;
    throw err;
  }
  return data.data; // { id, reference, status: 'pending' | 'send_pin' | ..., display_text, ... }
}

// POST to Paystack's /charge endpoint. Returns a `status` the caller must
// branch on — 'success', or anything else (a PIN/OTP/phone/birthday
// challenge step, an 'open_url' 3-D Secure redirect, or a failure) which
// this server treats uniformly as a failed charge rather than walking the
// user through it.
async function chargeRequest(path, body) {
  if (!configured) {
    const err = new Error('Paystack is not configured on this server.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.status) {
    const message = (data && data.message) || `Paystack charge failed (HTTP ${res.status})`;
    const err = new Error(message);
    err.upstream = data;
    throw err;
  }
  return data.data;
}

// Charges a previously-saved card using Paystack's reusable
// authorization_code — never the raw PAN/CVV, which we don't store.
async function chargeAuthorization({ email, amountKES, txRef, authorizationCode }) {
  return chargeRequest('/charge', {
    email,
    amount: String(Math.round(amountKES * 100)),
    currency: 'KES',
    reference: txRef,
    authorization_code: authorizationCode
  });
}

// Verifies a Paystack webhook came from Paystack: the x-paystack-signature
// header is an HMAC-SHA512 of the *raw* request body, signed with our
// secret key. Needs the raw bytes (not the re-serialized JSON), so callers
// must pass req.rawBody captured by the express.json() verify hook.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!configured || !rawBody || !signatureHeader) return false;
  const expected = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signatureHeader), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  configured,
  cardConfigured,
  publicKey: PAYSTACK_PUBLIC_KEY || null,
  verifyTransaction,
  normalizeMsisdn,
  chargeMpesa,
  chargeAuthorization,
  verifyWebhookSignature,
};
