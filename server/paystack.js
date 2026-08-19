'use strict';

// ─── Paystack — card checkout + M-Pesa mobile money, one account ─────────
// New card deposits go through Paystack's Inline/Popup widget on the
// client — the raw card number/CVV/expiry and any bank OTP/3DS challenge
// are entered directly into Paystack's hosted overlay and never reach this
// server at all. Only Paystack's reusable authorization_code (never the PAN
// or CVV, which card networks forbid storing under any circumstance) is
// saved when a user opts to save a card, and it's used here to charge saved
// cards server-to-server on repeat deposits. M-Pesa deposits go through the
// Charge API (mobile_money, provider=mpesa), which relays an STK push to
// Safaricom on our behalf. In all cases this server independently verifies
// the transaction (via the secret key) before crediting any balance — a
// client-reported "success" is never trusted on its own.
//
// This account runs in KES: both card and M-Pesa amounts are collected in
// KES and converted to the platform's USD balances at USD_KES_RATE.

const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';

const {
  PAYSTACK_PUBLIC_KEY,
  PAYSTACK_SECRET_KEY,
} = process.env;

const configured = !!(PAYSTACK_PUBLIC_KEY && PAYSTACK_SECRET_KEY);

if (!configured) {
  console.warn('[paystack] Not fully configured — card and M-Pesa deposits are disabled. ' +
    'Set PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY in .env (see .env.example).');
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
  publicKey: PAYSTACK_PUBLIC_KEY || null,
  verifyTransaction,
  normalizeMsisdn,
  chargeMpesa,
  chargeAuthorization,
  verifyWebhookSignature,
};
