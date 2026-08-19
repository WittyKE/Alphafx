'use strict';

// ─── Paystack — card checkout + M-Pesa mobile money, one account ─────────
// Fresh-card deposits go through Paystack Standard: initializeTransaction()
// hands back a hosted authorization_url, and the browser does a full-page
// redirect there (not an iframe/widget) — card number/CVV/expiry, and any
// PIN/OTP/3DS step the issuer requires, are all entered on Paystack's own
// page and never reach this server. This replaced an earlier attempt to
// charge raw card fields directly via Paystack's /charge endpoint
// (2026-08-19): that endpoint requires PCI DSS AOC approval from Paystack
// first (https://paystack.com/docs/payments/charge-card/) — without it,
// Paystack may silently fail those charges or close the integration
// outright, which is not a risk worth carrying on a real-money platform.
// Standard sidesteps the whole problem: Paystack's own PCI-certified page
// handles card entry, so no compliance approval is needed on our end.
// Saved cards are still charged server-to-server via the reusable
// authorization_code Paystack hands back after a successful Standard
// checkout — that's a normal, unrestricted use of the Charge API, since no
// raw PAN/CVV is ever involved (never stored, either). M-Pesa deposits go
// through the Charge API too (mobile_money, provider=mpesa), which relays
// an STK push to Safaricom on our behalf. In all cases this server
// independently verifies the transaction (via the secret key) before
// crediting any balance — a client-reported "success" is never trusted on
// its own.
//
// This account runs in KES: both card and M-Pesa amounts are collected in
// KES and converted to the platform's USD balances at USD_KES_RATE.

const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';

const { PAYSTACK_SECRET_KEY } = process.env;

// Every Paystack call this server makes (initialize, saved-card charge,
// verify, webhook signature check) is server-to-server with the secret
// key — there's no client-side widget that needs the public key.
const configured = !!PAYSTACK_SECRET_KEY;

if (!configured) {
  console.warn('[paystack] Not fully configured — card and M-Pesa deposits are disabled. ' +
    'Set PAYSTACK_SECRET_KEY in .env (see .env.example).');
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
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
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
    })
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
    body: JSON.stringify(body)
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

// Starts a Paystack Standard checkout and returns { authorization_url,
// access_code, reference } — the caller redirects the browser to
// authorization_url (a full page navigation, not an iframe). Card entry and
// any PIN/OTP/3DS step happen entirely on that hosted page; Paystack sends
// the browser back to callbackUrl afterwards, but the caller must still
// verifyTransaction() the reference before trusting the outcome.
async function initializeTransaction({ email, amountKES, txRef, callbackUrl }) {
  if (!configured) {
    const err = new Error('Paystack is not configured on this server.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(`${BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      amount: String(Math.round(amountKES * 100)),
      currency: 'KES',
      reference: txRef,
      callback_url: callbackUrl,
      channels: ['card']
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.status) {
    const message = (data && data.message) || `Paystack initialize failed (HTTP ${res.status})`;
    const err = new Error(message);
    err.upstream = data;
    throw err;
  }
  return data.data; // { authorization_url, access_code, reference }
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
  verifyTransaction,
  normalizeMsisdn,
  chargeMpesa,
  chargeAuthorization,
  initializeTransaction,
  verifyWebhookSignature,
};
