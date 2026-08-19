require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { WebSocketServer } = require('ws');
const paystack = require('./paystack');
const { startDerivFeed } = require('./derivFeed');
const { createPersistedStore } = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

// NODE_ENV=production changes two things: seeded demo accounts (users,
// regular admins, the sample crypto wallet) are skipped entirely, and the
// server refuses to start unless real superadmin credentials are supplied —
// see the seeding block below. Unset (the default) keeps today's dev/demo
// behavior exactly as-is.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION && (!process.env.SUPERADMIN_USERNAME || !process.env.SUPERADMIN_PASSWORD)) {
  console.error('[startup] Refusing to start: SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD must be set via environment variables when NODE_ENV=production (no falling back to the defaults baked into source).');
  process.exit(1);
}

// Required when running behind a reverse proxy/load balancer (Render, Heroku,
// Nginx, ...) so express-rate-limit keys on the real client IP instead of the
// proxy's. Leave unset for plain local/single-instance deployments.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// Origins allowed to call this API cross-site. Empty/unset keeps today's
// fully-open behavior (fine for local/dev); set a comma-separated list in
// production once you know your real frontend origin(s).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : {}));
// CSP is left off — the page loads several third-party scripts (Deriv WS,
// chart/icon CDNs) that a strict default-src would break without
// individually auditing and allow-listing each one. The other
// headers (HSTS, X-Content-Type-Options, frameguard, ...) still apply.
app.use(helmet({ contentSecurityPolicy: false }));
// Captures the raw request bytes alongside the parsed body — the Paystack
// webhook signature is an HMAC over the exact raw payload, not the
// re-serialized JSON, which can differ (key order, whitespace).
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

// ─── Admin accounts ──────────────────────────────────────────────────────
// Credentials are hashed at startup and never exposed to the client or any
// page in /public. The superuser ("root") manages every other admin but is
// excluded from the admin list returned by /api/admin/admins. Override the
// defaults via environment variables in production.
function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

function seedAdmin(target, id, username, password, name, role) {
  target[id] = {
    id,
    username,
    passwordHash: hashPassword(password),
    name,
    role, // 'superadmin' | 'admin'
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLogin: null
  };
}

// Active admin sessions (token → { adminId, expiry })
const adminSessions = {};

// Active regular-user sessions (token → { userId, expiry }). Every
// user-scoped route below requires one of these instead of trusting a
// client-supplied userId — see requireUser/requireOwnParam further down.
const userSessions = {};
const USER_SESSION_MS = 30 * 24 * 3600 * 1000; // 30 days

function issueUserSession(userId) {
  const token = uuidv4();
  userSessions[token] = { userId, expiry: Date.now() + USER_SESSION_MS };
  return token;
}

function killUserSessions(userId) {
  Object.keys(userSessions).forEach(t => { if (userSessions[t].userId === userId) delete userSessions[t]; });
}

// One-time password reset codes for end users (email → { otp, expiry })
const passwordResets = {};

// ─── In-Memory Store (persisted to data/db.json — see server/store.js) ─────
// Demo accounts share the password "Demo1234!" purely so reviewers can sign
// in without registering. Real registrations (POST /api/register) hash a
// password the user chooses themselves. In production none of this demo
// data is seeded at all (see IS_PRODUCTION below) — only whatever's already
// in data/db.json, plus the superadmin from env vars.
const DEMO_PASSWORD_HASH = hashPassword('Demo1234!');

const DEMO_USERS = IS_PRODUCTION ? {} : {
  'demo-user-1': {
      id: 'demo-user-1',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+254 712 345 678',
      passwordHash: DEMO_PASSWORD_HASH,
      balance: 10000.00,
      demoMode: true,
      status: 'active',
      kycVerified: true,
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      lastLogin: new Date().toISOString(),
      notes: ''
    },
    'demo-user-2': {
      id: 'demo-user-2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+254 798 765 432',
      passwordHash: DEMO_PASSWORD_HASH,
      balance: 25000.00,
      demoMode: false,
      status: 'active',
      kycVerified: true,
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      lastLogin: new Date(Date.now() - 3600000).toISOString(),
      notes: 'VIP client'
    },
    'demo-user-3': {
      id: 'demo-user-3',
      name: 'Michael Ochieng',
      email: 'michael@example.com',
      phone: '+254 733 111 222',
      passwordHash: DEMO_PASSWORD_HASH,
      balance: 5500.00,
      demoMode: true,
      status: 'suspended',
      kycVerified: false,
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      lastLogin: new Date(Date.now() - 86400000).toISOString(),
      notes: 'Pending KYC docs'
    },
    'demo-user-4': {
      id: 'demo-user-4',
      name: 'Aisha Mwangi',
      email: 'aisha@example.com',
      phone: '+254 722 999 888',
      passwordHash: DEMO_PASSWORD_HASH,
      balance: 50000.00,
      demoMode: false,
      status: 'active',
      kycVerified: true,
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      lastLogin: new Date(Date.now() - 7200000).toISOString(),
      notes: 'Premium account'
    }
};

const DEMO_TRANSACTIONS = IS_PRODUCTION ? [] : [
  { id: uuidv4(), type: 'deposit', amount: 10000, method: 'Demo', status: 'completed', date: new Date(Date.now()-86400000).toISOString(), userId: 'demo-user-1' },
  { id: uuidv4(), type: 'deposit', amount: 25000, method: 'Bank', status: 'completed', date: new Date(Date.now()-172800000).toISOString(), userId: 'demo-user-2' },
  { id: uuidv4(), type: 'withdrawal', amount: 3000, method: 'M-Pesa', status: 'pending', date: new Date(Date.now()-3600000).toISOString(), userId: 'demo-user-2' },
  { id: uuidv4(), type: 'deposit', amount: 5500, method: 'Card', status: 'completed', date: new Date(Date.now()-43200000).toISOString(), userId: 'demo-user-3' },
  { id: uuidv4(), type: 'deposit', amount: 50000, method: 'Bank', status: 'completed', date: new Date(Date.now()-2592000000).toISOString(), userId: 'demo-user-4' },
];

// Default receiving wallet, seeded on first boot in every environment
// (including production) so USDT deposits always have a live address to
// show. Additional wallets can still be added via the superadmin's Wallets
// panel (POST /api/admin/wallets); this one persists to data/db.json after
// first boot, so editing it here won't change an already-running deploy —
// use the Wallets panel to update or replace it instead.
const DEMO_WALLETS = {
  'wallet-binance-usdt': {
    id: 'wallet-binance-usdt', currency: 'USDT', network: 'TRC20',
    address: 'TL3mEf4G74Vodc9kroFt8jUMfFUV443Rev', label: 'Binance',
    status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
};

// Override with DATA_DIR on hosts whose default filesystem is ephemeral
// (e.g. Render web services wipe local disk on every deploy/restart unless
// a persistent disk is attached and mounted at a path you point this at).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// The wrapped object below is a Proxy — every read/write anywhere in its
// tree (db.users[id].balance = x, db.transactions.push(tx), ...) behaves
// exactly like a plain object, but every mutation also debounce-persists
// the whole tree to data/db.json (see server/store.js) so balances, trades
// and transactions survive a restart instead of resetting to this seed data.
const persisted = createPersistedStore({
  db: {
    users: DEMO_USERS,
    trades: [],
    binaryOptions: [],
    investments: [],
    transactions: DEMO_TRANSACTIONS,
    adminLogs: [],
    admins: {},
    cryptoWallets: DEMO_WALLETS
  },
  platformSettings: { priceUpdateSpeedMs: 500 },
  brokerConfig: { apiUrl: '', apiKey: '', connected: false, updatedAt: null }
}, DB_PATH);

let db = persisted.db;

// ─── Seed admin accounts ────────────────────────────────────────────────────
// Superuser — manages every other admin, hidden from the admin list. Always
// seeded (or re-seeded with the same env-supplied credentials on restart);
// in production this is required to be a real username/password, checked at
// startup above.
seedAdmin(db.admins, 'admin-root', process.env.SUPERADMIN_USERNAME || 'root', process.env.SUPERADMIN_PASSWORD || 'Anonymous@7682!', 'Root Super Admin', 'superadmin');
// Regular admins — day-to-day operations (users, finance, support). Demo
// credentials only; skipped in production. Once live, the superadmin
// creates real admin accounts via /api/admin/admins.
if (!IS_PRODUCTION) {
  seedAdmin(db.admins, 'admin-001', 'admin_amina', 'Amina#Adm2026!', 'Amina Cheruiyot', 'admin');
  seedAdmin(db.admins, 'admin-002', 'admin_brian', 'Brian#Adm2026!', 'Brian Otieno', 'admin');
  seedAdmin(db.admins, 'admin-003', 'admin_grace', 'Grace#Adm2026!', 'Grace Wanjiru', 'admin');
}

// ─── Admin log helper ────────────────────────────────────────────────────────
function logAdmin(action, targetUserId, details, actor) {
  db.adminLogs.unshift({
    id: uuidv4(),
    action,
    targetUserId,
    details,
    actor: actor || 'System',
    timestamp: new Date().toISOString()
  });
  if (db.adminLogs.length > 200) db.adminLogs.pop();
}

// ─── Sanitizers (never leak password hashes to the client) ─────────────────
function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}
function publicAdmin(a) {
  const { passwordHash, ...rest } = a;
  return rest;
}

// ─── Live prices ─────────────────────────────────────────────────────────────
let prices = {
  'EUR/USD': 1.08542, 'GBP/USD': 1.26813, 'USD/JPY': 149.423,
  'USD/CHF': 0.90145, 'AUD/USD': 0.64872, 'USD/CAD': 1.36541,
  'XAU/USD': 2338.50, 'BTC/USD': 67421.00, 'ETH/USD': 3542.00,
  // Deriv's synthetic Volatility Indices — seeded with plausible starting
  // levels; derivFeed.js overwrites these with Deriv's real spot/ticks the
  // moment the live feed connects.
  'Volatility 10 Index': 6512.34, 'Volatility 25 Index': 1847.92,
  'Volatility 50 Index': 981.45, 'Volatility 75 Index': 148230.67,
  'Volatility 100 Index': 6403.18
};

// Timestamp of the last real tick received from Deriv for each pair. The
// random-walk simulator below only touches a pair once it's been quiet for
// LIVE_STALE_MS — so live data wins whenever Deriv is connected and
// streaming, and the simulator transparently takes back over if the feed
// drops, without either trades or binary-option settlement ever stalling.
const lastTickAt = {};
const LIVE_STALE_MS = 8000;

// Deriv's full public instrument catalog (every market it lists — Forex,
// Derived/Synthetic Indices, Stock Indices, Commodities, Cryptocurrencies),
// refreshed every 30s by derivFeed.js. Read-only reference data for the
// "Live Deriv Markets" browser — not all of it is tradable on AlphaFX (see
// `prices` above for the actual tradable/live-priced set).
let derivCatalog = [];

// ─── Platform-wide settings (superadmin-managed) ────────────────────────────
// Single shared source of truth — every user reads the same values via
// /api/config, so an admin's change here is instantly the whole platform's
// behavior rather than something each account configures for itself.
// Persisted the same way as db (see server/store.js) — an admin's platform
// settings and broker config now survive a restart instead of resetting to
// these defaults every time.
let platformSettings = persisted.platformSettings; // { priceUpdateSpeedMs: 500|1500|3000 }
const ALLOWED_PRICE_SPEEDS = [500, 1500, 3000];

// Real-broker connection details, set by the superadmin once the platform is
// licensed to trade through an actual broker instead of the demo feed. Not
// exposed to regular users — this is configuration, not something any
// account should see or control.
let brokerConfig = persisted.brokerConfig; // { apiUrl, apiKey, connected, updatedAt }

function maskSecret(s) {
  if (!s) return '';
  if (s.length <= 6) return '•'.repeat(s.length);
  return s.slice(0, 3) + '•'.repeat(Math.max(4, s.length - 5)) + s.slice(-2);
}

// Decimal precision used to derive the "last digit" for Digits contracts
// (Over/Under, Matches/Differs, Even/Odd) — mirrors the client's fmtPrice().
function digitDecimals(pair) {
  if (pair.includes('BTC') || pair.includes('ETH')) return 0;
  if (pair.includes('XAU') || pair.includes('XAG')) return 2;
  if (pair.includes('JPY')) return 3;
  if (pair.includes('Volatility')) return 2;
  return 5;
}
function lastDigitOf(pair, price) {
  const str = Math.abs(price).toFixed(digitDecimals(pair)).replace('.', '');
  return parseInt(str[str.length - 1], 10);
}

function resolveBinaryWin(opt, cur) {
  const digit = lastDigitOf(opt.pair, cur);
  switch (opt.contractType) {
    case 'over_under':
      return opt.direction === 'over' ? digit > opt.prediction : digit < opt.prediction;
    case 'matches_differs':
      return opt.direction === 'matches' ? digit === opt.prediction : digit !== opt.prediction;
    case 'even_odd':
      return opt.direction === 'even' ? digit % 2 === 0 : digit % 2 === 1;
    case 'higher_lower':
      return opt.direction === 'higher' ? cur > opt.barrier : cur < opt.barrier;
    case 'rise_fall':
    default:
      // "Allow equals" (Deriv's Rise/Fall Equals variant): a close that lands
      // exactly on the entry price counts as a win for whichever side was
      // taken, instead of settling as a loss for both.
      if (opt.allowEquals && cur === opt.entryPrice) return true;
      return opt.direction === 'call' ? cur > opt.entryPrice : cur < opt.entryPrice;
  }
}

// Payout for Vanillas/Turbos scales with how far the exit price finishes
// beyond the strike/barrier (like a real option premium), instead of the
// fixed stake*(1+payoutPercent) every other contract type uses. Returns 0
// (a total loss) when the contract finished out of the money.
function scaledPayout(opt, cur) {
  const strike = opt.barrier; // strike (Vanillas) / knockout barrier (Turbos) — same field
  const distance = Math.abs(opt.entryPrice - strike) || (opt.entryPrice * 0.0001) || 0.0001;
  const favorable = (opt.direction === 'call' || opt.direction === 'higher')
    ? cur - strike
    : strike - cur;
  const ratio = Math.max(0, favorable / distance);
  return parseFloat((opt.stake * Math.min(ratio, SCALED_PAYOUT_CAP)).toFixed(2));
}

// SmartTrader AI investment durations, expressed in 24hr compounding periods.
// Each period compounds the running value by its own random 30%-35% rate,
// so a 1-month stake isn't a single flat payout — it's that rate re-applied
// on top of itself once per day for the full term.
const SMART_DURATIONS = { '24h': 24 * 3600 * 1000, '72h': 72 * 3600 * 1000, '1w': 7 * 24 * 3600 * 1000 };
const SMART_PERIOD_MS = 24 * 3600 * 1000;
function smartPeriodsFor(duration) {
  return SMART_DURATIONS[duration] / SMART_PERIOD_MS;
}

// One-time insurance deduction taken from the stake before it starts
// compounding — a flat 5% regardless of duration.
const SMART_INSURANCE_RATES = { '24h': 5, '72h': 5, '1w': 5 };

function updatePrices() {
  const now = Date.now();
  Object.keys(prices).forEach(pair => {
    const live = lastTickAt[pair] && (now - lastTickAt[pair]) < LIVE_STALE_MS;
    if (live) return; // Deriv is actively streaming this pair — don't fight it with random walk
    const v = prices[pair] > 1000 ? 0.003 : 0.0003;
    prices[pair] = parseFloat((prices[pair] * (1 + (Math.random() - 0.499) * v)).toFixed(prices[pair] > 100 ? 2 : 5));
  });
  broadcastPrices();
  db.binaryOptions.forEach(opt => {
    if (opt.status !== 'open') return;
    const cur = prices[opt.pair];

    // Touch/No Touch and Turbos react the instant the barrier is crossed,
    // not just at expiry — checked on every price tick regardless of how
    // much time is left on the contract.
    if (opt.contractType === 'touch_no_touch' && !opt.touched) {
      const crossed = opt.barrier >= opt.entryPrice ? cur >= opt.barrier : cur <= opt.barrier;
      if (crossed) opt.touched = true;
    }
    if (opt.contractType === 'turbos' && !opt.knockedOut) {
      const knocked = opt.direction === 'higher' ? cur <= opt.barrier : cur >= opt.barrier;
      if (knocked) {
        opt.knockedOut = true;
        opt.status = 'lost';
        opt.exitPrice = cur;
        opt.settledAt = new Date().toISOString();
        return;
      }
    }

    if (now < opt.expiresAt) return;

    let won, payout = opt.payout;
    switch (opt.contractType) {
      case 'touch_no_touch':
        won = opt.direction === 'touch' ? opt.touched : !opt.touched;
        break;
      case 'vanillas':
        payout = scaledPayout(opt, cur);
        won = payout > 0;
        break;
      case 'turbos':
        // Only reaches expiry if it survived without knocking out.
        payout = scaledPayout(opt, cur);
        won = true;
        break;
      default:
        won = resolveBinaryWin(opt, cur);
    }
    opt.status = won ? 'won' : 'lost';
    opt.payout = won ? payout : opt.payout;
    opt.exitPrice = cur;
    opt.exitDigit = lastDigitOf(opt.pair, cur);
    opt.settledAt = new Date().toISOString();
    if (won && db.users[opt.userId]) {
      db.users[opt.userId].balance = parseFloat((db.users[opt.userId].balance + payout).toFixed(2));
    }
  });
  db.investments.forEach(inv => {
    if (inv.status !== 'active') return;
    // Catch the running value up to however many full 24hr periods have
    // elapsed since it started, applying that period's own random rate.
    const elapsedPeriods = Math.min(inv.periods, Math.floor((now - inv.startedAtMs) / SMART_PERIOD_MS));
    while (inv.periodsCompleted < elapsedPeriods) {
      const rate = inv.dailyRates[inv.periodsCompleted];
      inv.currentValue = parseFloat((inv.currentValue * (1 + rate / 100)).toFixed(2));
      inv.periodsCompleted++;
    }
    if (now >= inv.maturesAt) {
      inv.status = 'completed';
      inv.completedAt = new Date().toISOString();
      inv.payout = inv.currentValue;
      if (db.users[inv.userId]) {
        db.users[inv.userId].balance = parseFloat((db.users[inv.userId].balance + inv.payout).toFixed(2));
      }
    }
  });
}
setInterval(updatePrices, 1500);

// ─── Admin Auth Middleware ───────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const session = token && adminSessions[token];
  if (!session || session.expiry < Date.now()) {
    return res.status(401).json({ error: 'Unauthorized. Please log in as admin.' });
  }
  const admin = db.admins[session.adminId];
  if (!admin || admin.status !== 'active') {
    delete adminSessions[token];
    return res.status(401).json({ error: 'Your admin account is no longer active.' });
  }
  req.admin = admin;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superuser access required for this action.' });
  }
  next();
}

// ─── User Auth Middleware ────────────────────────────────────────────────────
// Every user-scoped route (deposits, withdrawals, trades, profile/history
// reads, ...) requires one of these instead of trusting a client-supplied
// userId — without it, anyone who knew or guessed another user's id could
// act as them (withdraw their funds, read their transaction history, ...).
// req.userId is the only trustworthy source of "who is making this request"
// from here down.
function requireUser(req, res, next) {
  const token = req.headers['x-user-token'];
  const session = token && userSessions[token];
  if (!session || session.expiry < Date.now()) {
    return res.status(401).json({ error: 'Please log in again.' });
  }
  const user = db.users[session.userId];
  if (!user) {
    delete userSessions[token];
    return res.status(401).json({ error: 'Please log in again.' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
  }
  req.userId = session.userId;
  req.user = user;
  next();
}

// For routes with a :paramName in the URL that's supposed to be "my own"
// user id (e.g. /api/transactions/:userId) — requireUser only proves who's
// asking, this proves they're asking about themselves and not someone else.
function requireOwnParam(paramName) {
  return (req, res, next) => {
    if (req.params[paramName] !== req.userId) {
      return res.status(403).json({ error: 'Not authorized to access this resource.' });
    }
    next();
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = Object.values(db.admins).find(a => a.username === username);
  if (!admin || !bcrypt.compareSync(password || '', admin.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (admin.status !== 'active') {
    return res.status(403).json({ error: 'This admin account has been suspended.' });
  }
  const token = uuidv4();
  adminSessions[token] = { adminId: admin.id, expiry: Date.now() + 8 * 3600 * 1000 }; // 8hr session
  admin.lastLogin = new Date().toISOString();
  logAdmin('LOGIN', null, `${admin.name} logged in`, admin.name);
  res.json({ success: true, token, name: admin.name, role: admin.role });
});

// Admin logout
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  delete adminSessions[req.headers['x-admin-token']];
  res.json({ success: true });
});

// Current admin profile (used by the UI to know the role after a refresh)
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json(publicAdmin(req.admin));
});

// ── Admin management ─────────────────────────────────────────────────────
// All admins may read the roster (view-only). The superadmin account is
// always filtered out — its existence is never revealed through this endpoint.
// Write operations (create, suspend, delete, reset password) remain superadmin-only.
app.get('/api/admin/admins', requireAdmin, (req, res) => {
  const admins = Object.values(db.admins)
    .filter(a => a.role !== 'superadmin')
    .map(publicAdmin);
  res.json(admins);
});

// Create a new admin (superuser only)
app.post('/api/admin/admins', requireAdmin, requireSuperAdmin, (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Name, username and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const exists = Object.values(db.admins).some(a => a.username.toLowerCase() === username.toLowerCase());
  if (exists) return res.status(400).json({ error: 'That username is already taken.' });
  const id = 'admin-' + uuidv4().slice(0, 8);
  seedAdmin(db.admins, id, username, password, name, 'admin');
  logAdmin('CREATE_ADMIN', id, `Created admin ${name} (${username})`, req.admin.name);
  res.json({ success: true, admin: publicAdmin(db.admins[id]) });
});

// Suspend / reactivate an admin (superuser only)
app.post('/api/admin/admins/:id/status', requireAdmin, requireSuperAdmin, (req, res) => {
  const admin = db.admins[req.params.id];
  if (!admin || admin.role === 'superadmin') return res.status(404).json({ error: 'Admin not found.' });
  admin.status = req.body.status === 'suspended' ? 'suspended' : 'active';
  if (admin.status === 'suspended') {
    Object.keys(adminSessions).forEach(t => { if (adminSessions[t].adminId === admin.id) delete adminSessions[t]; });
  }
  logAdmin('ADMIN_STATUS', admin.id, `${admin.name} set to ${admin.status}`, req.admin.name);
  res.json({ success: true, status: admin.status });
});

// Reset an admin's password (superuser only)
app.post('/api/admin/admins/:id/reset-password', requireAdmin, requireSuperAdmin, (req, res) => {
  const admin = db.admins[req.params.id];
  if (!admin || admin.role === 'superadmin') return res.status(404).json({ error: 'Admin not found.' });
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  admin.passwordHash = hashPassword(password);
  logAdmin('RESET_ADMIN_PASSWORD', admin.id, `Password reset for ${admin.name}`, req.admin.name);
  res.json({ success: true });
});

// Delete an admin (superuser only)
app.delete('/api/admin/admins/:id', requireAdmin, requireSuperAdmin, (req, res) => {
  const admin = db.admins[req.params.id];
  if (!admin || admin.role === 'superadmin') return res.status(404).json({ error: 'Admin not found.' });
  Object.keys(adminSessions).forEach(t => { if (adminSessions[t].adminId === admin.id) delete adminSessions[t]; });
  delete db.admins[req.params.id];
  logAdmin('DELETE_ADMIN', req.params.id, `Deleted admin ${admin.name}`, req.admin.name);
  res.json({ success: true });
});

// ── Central crypto wallets (superuser only) ─────────────────────────────────
// These are the platform's own receiving addresses for centrally-managed
// crypto deposits — financial configuration, so only the superuser may
// view, add, edit, or remove them.
app.get('/api/admin/wallets', requireAdmin, requireSuperAdmin, (req, res) => {
  res.json(Object.values(db.cryptoWallets).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post('/api/admin/wallets', requireAdmin, requireSuperAdmin, (req, res) => {
  const { currency, network, address, label } = req.body;
  if (!currency || !network || !address) {
    return res.status(400).json({ error: 'Currency, network and address are required.' });
  }
  const id = 'wallet-' + uuidv4().slice(0, 8);
  const wallet = {
    id, currency: currency.toUpperCase(), network, address, label: label || '',
    status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  db.cryptoWallets[id] = wallet;
  logAdmin('CREATE_WALLET', null, `Added ${wallet.currency} (${wallet.network}) wallet${label ? ' — ' + label : ''}`, req.admin.name);
  res.json({ success: true, wallet });
});

app.post('/api/admin/wallets/:id', requireAdmin, requireSuperAdmin, (req, res) => {
  const wallet = db.cryptoWallets[req.params.id];
  if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });
  const allowed = ['currency', 'network', 'address', 'label', 'status'];
  allowed.forEach(k => { if (req.body[k] !== undefined) wallet[k] = req.body[k]; });
  if (wallet.currency) wallet.currency = wallet.currency.toUpperCase();
  wallet.updatedAt = new Date().toISOString();
  logAdmin('UPDATE_WALLET', null, `Updated ${wallet.currency} wallet${wallet.label ? ' — ' + wallet.label : ''}`, req.admin.name);
  res.json({ success: true, wallet });
});

app.delete('/api/admin/wallets/:id', requireAdmin, requireSuperAdmin, (req, res) => {
  const wallet = db.cryptoWallets[req.params.id];
  if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });
  delete db.cryptoWallets[req.params.id];
  logAdmin('DELETE_WALLET', null, `Removed ${wallet.currency} wallet${wallet.label ? ' — ' + wallet.label : ''}`, req.admin.name);
  res.json({ success: true });
});

// ── Platform settings (superadmin only) ─────────────────────────────────────
// Was previously a per-account control in the user Settings page; now one
// shared value every client reads from /api/config, so a change here takes
// effect for the whole platform rather than a single browser session.
app.get('/api/admin/platform-settings', requireAdmin, requireSuperAdmin, (req, res) => {
  res.json(platformSettings);
});

app.post('/api/admin/platform-settings', requireAdmin, requireSuperAdmin, (req, res) => {
  const { priceUpdateSpeedMs } = req.body;
  const speed = parseInt(priceUpdateSpeedMs, 10);
  if (!ALLOWED_PRICE_SPEEDS.includes(speed)) {
    return res.status(400).json({ error: 'Price update speed must be 500 (Fast), 1500 (Normal) or 3000 (Slow) ms.' });
  }
  const prev = platformSettings.priceUpdateSpeedMs;
  platformSettings.priceUpdateSpeedMs = speed;
  logAdmin('PLATFORM_SETTINGS', null, `Price update speed changed from ${prev}ms to ${speed}ms`, req.admin.name);
  res.json({ success: true, platformSettings });
});

// ── Real broker connection (superadmin only) ─────────────────────────────────
// Was previously a decorative card in the user Settings page; centralizing it
// here means the credentials live in exactly one place, never a regular
// user's browser, and a saved change is immediately the platform's live
// broker configuration for every account.
app.get('/api/admin/broker-config', requireAdmin, requireSuperAdmin, (req, res) => {
  res.json({
    apiUrl: brokerConfig.apiUrl,
    apiKeyMasked: maskSecret(brokerConfig.apiKey),
    hasApiKey: !!brokerConfig.apiKey,
    connected: brokerConfig.connected,
    updatedAt: brokerConfig.updatedAt
  });
});

app.post('/api/admin/broker-config', requireAdmin, requireSuperAdmin, (req, res) => {
  const { apiUrl, apiKey } = req.body;
  if (!apiUrl || !/^https?:\/\/.+/i.test(apiUrl)) {
    return res.status(400).json({ error: 'Enter a valid broker API URL (starting with http:// or https://).' });
  }
  brokerConfig.apiUrl = apiUrl.trim();
  // Blank API key on save means "keep the existing one" — the field is
  // never pre-filled with the real secret, only a masked preview.
  if (apiKey && apiKey.trim()) brokerConfig.apiKey = apiKey.trim();
  brokerConfig.connected = !!(brokerConfig.apiUrl && brokerConfig.apiKey);
  brokerConfig.updatedAt = new Date().toISOString();
  logAdmin('BROKER_CONFIG', null, `Broker config updated (${brokerConfig.apiUrl})`, req.admin.name);
  res.json({
    success: true,
    apiUrl: brokerConfig.apiUrl,
    apiKeyMasked: maskSecret(brokerConfig.apiKey),
    connected: brokerConfig.connected,
    updatedAt: brokerConfig.updatedAt
  });
});

// Public read of the active receiving addresses — this is the whole point
// of configuring them: depositing users need to see where to send funds.
app.get('/api/wallets/active', (req, res) => {
  res.json(Object.values(db.cryptoWallets)
    .filter(w => w.status === 'active')
    .map(({ id, currency, network, address, label }) => ({ id, currency, network, address, label })));
});

// Dashboard summary
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const users = Object.values(db.users);
  const totalBalance = users.reduce((s, u) => s + u.balance, 0);
  const totalDeposits = db.transactions.filter(t => t.type === 'deposit' && t.status === 'completed').reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = db.transactions.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
  const pendingWithdrawals = db.transactions.filter(t => t.type === 'withdrawal' && t.status === 'pending');
  const activeInvestments = db.investments.filter(i => i.status === 'active');
  res.json({
    totalUsers: users.length,
    activeUsers: users.filter(u => u.status === 'active').length,
    suspendedUsers: users.filter(u => u.status === 'suspended').length,
    totalBalance: parseFloat(totalBalance.toFixed(2)),
    totalDeposits: parseFloat(totalDeposits.toFixed(2)),
    totalWithdrawals: parseFloat(totalWithdrawals.toFixed(2)),
    pendingWithdrawals: pendingWithdrawals.length,
    pendingWithdrawalAmount: pendingWithdrawals.reduce((s,t)=>s+t.amount,0),
    openTrades: db.trades.filter(t => t.status === 'open').length,
    openBinary: db.binaryOptions.filter(t => t.status === 'open').length,
    activeInvestments: activeInvestments.length,
    activeInvestmentValue: parseFloat(activeInvestments.reduce((s,i)=>s+i.currentValue,0).toFixed(2)),
    recentTransactions: db.transactions.slice(-10).reverse()
  });
});

// List all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = Object.values(db.users).map(u => ({
    ...publicUser(u),
    tradeCount: db.trades.filter(t => t.userId === u.id).length,
    binaryCount: db.binaryOptions.filter(t => t.userId === u.id).length,
    realFundsAvailable: realFundsAvailable(u)
  }));
  res.json(users);
});

// Get single user detail
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const forex = db.trades.filter(t => t.userId === req.params.id);
  const binary = db.binaryOptions.filter(t => t.userId === req.params.id);
  const investments = db.investments.filter(i => i.userId === req.params.id).map(publicInvestment).reverse();
  const txs = db.transactions.filter(t => t.userId === req.params.id);
  res.json({ ...publicUser(user), forex, binary, investments, transactions: txs.reverse(), realFundsAvailable: realFundsAvailable(user) });
});

// Update user balance
app.post('/api/admin/users/:id/balance', requireAdmin, (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { amount, type, note } = req.body; // type: 'set' | 'add' | 'subtract'
  const prev = user.balance;
  if (type === 'set') user.balance = parseFloat(parseFloat(amount).toFixed(2));
  else if (type === 'add') user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(2));
  else if (type === 'subtract') user.balance = parseFloat((user.balance - parseFloat(amount)).toFixed(2));
  if (user.balance < 0) user.balance = 0;
  const tx = { id: uuidv4(), type: 'admin_adjustment', amount: parseFloat(amount), adjustType: type, note: note || 'Admin adjustment', status: 'completed', date: new Date().toISOString(), userId: user.id };
  db.transactions.push(tx);
  logAdmin('BALANCE_CHANGE', user.id, `${type} $${amount} (was $${prev} → now $${user.balance}). Note: ${note||'—'}`, req.admin.name);
  res.json({ success: true, newBalance: user.balance, transaction: tx });
});

// Update user profile
app.post('/api/admin/users/:id/profile', requireAdmin, (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const allowed = ['name', 'email', 'phone', 'status', 'kycVerified', 'demoMode', 'notes'];
  allowed.forEach(k => { if (req.body[k] !== undefined) user[k] = req.body[k]; });
  logAdmin('PROFILE_UPDATE', user.id, `Updated: ${Object.keys(req.body).filter(k=>allowed.includes(k)).join(', ')}`, req.admin.name);
  res.json({ success: true, user: publicUser(user) });
});

// Suspend / activate user
app.post('/api/admin/users/:id/status', requireAdmin, (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { status } = req.body;
  user.status = status;
  if (status === 'suspended') killUserSessions(user.id);
  logAdmin('STATUS_CHANGE', user.id, `Status set to ${status}`, req.admin.name);
  res.json({ success: true, status });
});

// Force close all trades for a user
app.post('/api/admin/users/:id/close-trades', requireAdmin, (req, res) => {
  const userId = req.params.id;
  const open = db.trades.filter(t => t.userId === userId && t.status === 'open');
  open.forEach(t => {
    const exitPrice = prices[t.pair];
    const diff = t.direction === 'buy' ? exitPrice - t.entryPrice : t.entryPrice - exitPrice;
    t.pnl = parseFloat((diff * t.amount * t.leverage).toFixed(2));
    t.status = 'closed'; t.exitPrice = exitPrice; t.closedAt = new Date().toISOString();
    if (db.users[userId]) db.users[userId].balance = parseFloat((db.users[userId].balance + t.pnl).toFixed(2));
  });
  logAdmin('CLOSE_TRADES', userId, `Force-closed ${open.length} forex trade(s)`, req.admin.name);
  res.json({ success: true, closed: open.length });
});

// Approve / reject withdrawal
app.post('/api/admin/transactions/:txId/status', requireAdmin, (req, res) => {
  const tx = db.transactions.find(t => t.id === req.params.txId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  const prev = tx.status;
  const nextStatus = req.body.status;
  if (tx.type === 'withdrawal' && prev === 'pending' && nextStatus === 'rejected') {
    const user = db.users[tx.userId];
    if (user) user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
  }
  if (tx.type === 'deposit' && prev === 'pending' && nextStatus === 'completed') {
    const user = db.users[tx.userId];
    if (user) user.balance = parseFloat((user.balance + tx.amount).toFixed(2));
  }
  tx.status = nextStatus;
  tx.adminNote = req.body.note || '';
  tx.processedAt = new Date().toISOString();
  logAdmin('TX_STATUS', tx.userId, `Transaction ${tx.id} changed from ${prev} to ${nextStatus}`, req.admin.name);
  res.json({ success: true, transaction: tx });
});

// All transactions (admin view)
app.get('/api/admin/transactions', requireAdmin, (req, res) => {
  const txs = [...db.transactions].reverse();
  res.json(txs);
});

// Admin activity log — superuser only (contains sensitive ops history)
app.get('/api/admin/logs', requireAdmin, requireSuperAdmin, (req, res) => {
  res.json(db.adminLogs);
});

// Create new user
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { name, email, phone, password, balance, demoMode } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const emailTaken = Object.values(db.users).some(u => u.email.toLowerCase() === email.toLowerCase());
  if (emailTaken) return res.status(400).json({ error: 'A user with this email already exists.' });
  const id = 'user-' + uuidv4().slice(0, 8);
  const user = {
    id, name, email, phone: phone || '',
    passwordHash: hashPassword(password),
    balance: parseFloat(balance) || 0,
    demoMode: !!demoMode,
    status: 'active', kycVerified: false,
    createdAt: new Date().toISOString(), lastLogin: null, notes: ''
  };
  db.users[id] = user;
  if (user.balance > 0) db.transactions.push({ id: uuidv4(), type: 'deposit', amount: user.balance, method: 'Admin', status: 'completed', date: new Date().toISOString(), userId: id });
  logAdmin('CREATE_USER', id, `Created user ${name} (${email}) with balance $${user.balance}`, req.admin.name);
  res.json({ success: true, user: publicUser(user) });
});

// Reset a user's password (superuser only)
app.post('/api/admin/users/:id/reset-password', requireAdmin, requireSuperAdmin, (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  user.passwordHash = hashPassword(password);
  killUserSessions(user.id);
  logAdmin('RESET_USER_PASSWORD', user.id, `Password reset for user ${user.name} (${user.email})`, req.admin.name);
  res.json({ success: true });
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  logAdmin('DELETE_USER', req.params.id, `Deleted user ${user.name}`, req.admin.name);
  delete db.users[req.params.id];
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC AUTH ROUTES (registration / login / password reset)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const exists = Object.values(db.users).some(u => u.email.toLowerCase() === email.toLowerCase());
  if (exists) return res.status(400).json({ error: 'An account with this email already exists. Please sign in.' });

  const id = 'user-' + uuidv4().slice(0, 8);
  const user = {
    id, name, email, phone: phone || '',
    passwordHash: hashPassword(password),
    balance: 10000.00, // every new account starts on the same free demo balance as the default users
    demoMode: true,
    status: 'active',
    kycVerified: false,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    notes: ''
  };
  db.users[id] = user;
  db.transactions.push({ id: uuidv4(), type: 'deposit', amount: user.balance, method: 'Demo Bonus', status: 'completed', date: new Date().toISOString(), userId: id });
  logAdmin('REGISTER', id, `New account registered: ${name} (${email})`, 'Self-registration');
  res.json({ success: true, user: publicUser(user), token: issueUserSession(id) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = Object.values(db.users).find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user || !user.passwordHash || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
  }
  user.lastLogin = new Date().toISOString();
  res.json({ success: true, user: publicUser(user), token: issueUserSession(user.id) });
});

app.post('/api/logout', requireUser, (req, res) => {
  delete userSessions[req.headers['x-user-token']];
  res.json({ success: true });
});

// Step 1: request a reset code. Demo mode has no email/SMS provider wired up,
// so the code is returned in the response instead of being sent silently —
// swap this for a real provider before going live.
app.post('/api/password-reset/request', (req, res) => {
  const email = (req.body.email || '').toLowerCase();
  const user = Object.values(db.users).find(u => u.email.toLowerCase() === email);
  if (!user) return res.status(404).json({ error: 'No account found with this email address.' });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  passwordResets[email] = { otp, expiry: Date.now() + 10 * 60 * 1000 };
  res.json({ success: true, otp, demoNotice: 'Demo mode: no email provider is connected, so the code is returned here instead of being sent.' });
});

app.post('/api/password-reset/confirm', (req, res) => {
  const email = (req.body.email || '').toLowerCase();
  const { otp, password } = req.body;
  const entry = passwordResets[email];
  if (!entry || entry.otp !== otp || entry.expiry < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const user = Object.values(db.users).find(u => u.email.toLowerCase() === email);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  user.passwordHash = hashPassword(password);
  killUserSessions(user.id);
  delete passwordResets[email];
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXISTING USER ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Support contact shown on the Help Center card — configurable so going
// live is a .env edit instead of a code change. Falls back to placeholder
// values until real ones are set.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@alphafx.com';
const SUPPORT_TELEGRAM = process.env.SUPPORT_TELEGRAM || '@AlphaFXSupport';
const SUPPORT_WHATSAPP = process.env.SUPPORT_WHATSAPP || '';

// Which pairs are currently on genuine live Deriv ticks vs. the random-walk
// fallback simulator (see updatePrices()) — real-money binary options can
// settle against whichever one is active, so the client surfaces this
// rather than presenting every price as equally "live".
function computeStalePairs() {
  const now = Date.now();
  return Object.keys(prices).filter(pair => !(lastTickAt[pair] && (now - lastTickAt[pair]) < LIVE_STALE_MS));
}

// Non-secret runtime config the client needs to render correctly — never
// put credentials or callback details here, this route has no auth.
app.get('/api/config', (req, res) => {
  res.json({
    mpesaEnabled: paystack.configured,
    usdKesRate: USD_KES_RATE,
    paystackEnabled: paystack.configured,
    priceUpdateSpeedMs: platformSettings.priceUpdateSpeedMs,
    cardMinKes: CARD_MIN_KES,
    cardMaxKes: CARD_MAX_KES,
    supportEmail: SUPPORT_EMAIL,
    supportTelegram: SUPPORT_TELEGRAM,
    supportWhatsapp: SUPPORT_WHATSAPP
  });
});

app.get('/api/prices', (req, res) => res.json({ prices, stalePairs: computeStalePairs(), timestamp: Date.now() }));

// Deriv's full public market catalog, exactly as returned by their
// unauthenticated active_symbols API (no login/OAuth/token involved) —
// every underlying across every market Deriv lists. Cached server-side and
// refreshed every 30s by derivFeed.js so the client doesn't need its own
// second connection just to browse the list.
app.get('/api/deriv/symbols', (req, res) => res.json({ symbols: derivCatalog, timestamp: Date.now() }));

// ─── Live price WebSocket ─────────────────────────────────────────────────
// Pushes the same `prices` object the REST endpoint serves, but the instant
// a Deriv tick (or a simulator step) changes it, instead of clients waiting
// out their next poll. /api/prices remains as the fallback/initial-load
// path — this is a low-latency addition on top of it, not a replacement.
const priceClients = new Set();

function broadcastPrices() {
  if (!priceClients.size) return;
  const payload = JSON.stringify({ type: 'prices', prices, stalePairs: computeStalePairs(), timestamp: Date.now() });
  priceClients.forEach(client => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

app.get('/api/user/:id', requireUser, requireOwnParam('id'), (req, res) => {
  res.json(publicUser(req.user));
});

// Dev/demo-only convenience for topping up the free demo balance with no
// payment involved — disabled in production (see IS_PRODUCTION) since it's
// an unverified balance credit and every real payment method already has
// its own verified flow below (card/M-Pesa via Paystack, crypto via manual
// admin review).
app.post('/api/deposit', requireUser, (req, res) => {
  if (IS_PRODUCTION) return res.status(404).json({ error: 'Not found' });
  const userId = req.userId;
  const { amount } = req.body;
  const user = db.users[userId];
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum deposit is $10' });
  user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(2));
  const tx = { id: uuidv4(), type: 'deposit', amount: parseFloat(amount), method: 'Demo', status: 'completed', date: new Date().toISOString(), userId };
  db.transactions.push(tx);
  res.json({ success: true, newBalance: user.balance, transaction: tx });
});

const WITHDRAW_EXCHANGES = ['Binance', 'OKX'];
const WITHDRAW_NETWORKS = {
  'USDT-TRC20': { min: 20, addressRe: /^T[a-zA-Z0-9]{33}$/ },
  'USDT-BEP20': { min: 20, addressRe: /^0x[a-fA-F0-9]{40}$/ },
  'USDT-ERC20': { min: 50, addressRe: /^0x[a-fA-F0-9]{40}$/ },
  'BTC':        { min: 50, addressRe: /^(bc1[a-z0-9]{25,39}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
  'ETH':        { min: 30, addressRe: /^0x[a-fA-F0-9]{40}$/ },
};

// Shared across every withdrawal route (crypto + M-Pesa below) — payouts are
// real money leaving the platform, so they get the same anti-spam cooldown
// as deposit initiation rather than being left unlimited.
const withdrawLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many withdrawal requests. Please slow down and try again shortly.' }
});

// Real-money deposit methods only — excludes the registration "Demo Bonus"
// credit and admin balance adjustments, which aren't cash a user ever
// actually put in. Used to cap withdrawals below so a fresh account's free
// demo balance (still fine to trade with) can never be cashed out as if it
// were a real deposit.
const REAL_DEPOSIT_METHODS = ['M-Pesa', 'Card', 'Crypto'];
function realFundsAvailable(user) {
  const deposited = db.transactions
    .filter(t => t.userId === user.id && t.type === 'deposit' && t.status === 'completed' && REAL_DEPOSIT_METHODS.includes(t.method))
    .reduce((s, t) => s + t.amount, 0);
  const withdrawn = db.transactions
    .filter(t => t.userId === user.id && t.type === 'withdrawal' && t.status !== 'rejected')
    .reduce((s, t) => s + t.amount, 0);
  return Math.max(0, parseFloat((deposited - withdrawn).toFixed(2)));
}

app.post('/api/withdraw', withdrawLimiter, requireUser, (req, res) => {
  const userId = req.userId;
  const { amount, exchange, network, address } = req.body;
  const user = req.user;
  if (!WITHDRAW_EXCHANGES.includes(exchange)) return res.status(400).json({ error: 'Unsupported exchange' });
  const netConfig = WITHDRAW_NETWORKS[network];
  if (!netConfig) return res.status(400).json({ error: 'Unsupported asset/network' });
  if (!address || !netConfig.addressRe.test(address.trim())) return res.status(400).json({ error: 'Invalid wallet address for the selected network' });
  if (!amount || amount < netConfig.min) return res.status(400).json({ error: `Minimum withdrawal for ${network} is $${netConfig.min}` });
  const withdrawable = Math.min(user.balance, realFundsAvailable(user));
  if (amount > withdrawable) {
    return res.status(400).json({ error: amount <= user.balance
      ? 'You can only withdraw funds you\'ve actually deposited — your demo/bonus balance isn\'t withdrawable.'
      : 'Insufficient balance' });
  }
  user.balance = parseFloat((user.balance - parseFloat(amount)).toFixed(2));
  const destination = `${exchange} - ${network} — ${address.trim()}`;
  const tx = { id: uuidv4(), type: 'withdrawal', amount: parseFloat(amount), destination, exchange, network, address: address.trim(), status: 'pending', date: new Date().toISOString(), userId };
  db.transactions.push(tx);
  res.json({ success: true, newBalance: user.balance, transaction: tx });
});

// ══════════════════════════════════════════════════════════════════════════════
// CRYPTO DEPOSITS (manual review)
// ══════════════════════════════════════════════════════════════════════════════
// A personal Binance address has no deposit webhook we can subscribe to, so
// these can't be auto-credited like the M-Pesa/Paystack flow below. The
// request lands as 'pending' and only credits the user's balance once an
// admin checks the wallet and approves it via /api/admin/transactions/:id/status.
app.post('/api/deposit/crypto/initiate', requireUser, (req, res) => {
  const userId = req.userId;
  const { walletId, amount, txHash } = req.body;
  const wallet = db.cryptoWallets[walletId];
  if (!wallet || wallet.status !== 'active') return res.status(400).json({ error: 'Select a valid deposit address.' });
  const amt = parseFloat(amount);
  if (!amt || amt < 10) return res.status(400).json({ error: 'Minimum deposit is $10' });
  const trimmedHash = (txHash || '').trim();
  // Same on-chain tx shouldn't be able to claim more than one manual
  // credit — across any user, not just this one.
  if (trimmedHash) {
    const dupe = db.transactions.some(t =>
      t.type === 'deposit' && t.method === 'Crypto' && t.status !== 'failed' &&
      t.meta && t.meta.txHash && t.meta.txHash.toLowerCase() === trimmedHash.toLowerCase());
    if (dupe) return res.status(400).json({ error: 'This transaction hash has already been submitted.' });
  }
  const tx = {
    id: uuidv4(), type: 'deposit', amount: amt, method: 'Crypto', status: 'pending',
    date: new Date().toISOString(), userId,
    meta: { currency: wallet.currency, network: wallet.network, address: wallet.address, txHash: trimmedHash }
  };
  db.transactions.push(tx);
  res.json({ success: true, transaction: tx });
});

// ══════════════════════════════════════════════════════════════════════════════
// M-PESA DEPOSITS (via Paystack — no separate Daraja registration needed)
// ══════════════════════════════════════════════════════════════════════════════
// Deposits are collected in KES via Paystack's Charge API (STK push to
// the customer's phone) and credited to the user's USD balance at a fixed
// conversion rate. Swap MPESA_USD_KES_RATE for a live FX feed before
// relying on this in real production — a static rate will drift from the
// market over time.
const USD_KES_RATE = parseFloat(process.env.MPESA_USD_KES_RATE) || 129;
const MPESA_MIN_KES = 10;
const MPESA_MAX_KES = 150000; // Safety cap on a single deposit

// Pending/settled STK requests keyed by CheckoutRequestID. Internal only —
// never returned to the client wholesale, just the fields the status route
// picks out.
const mpesaPending = {};

// Stops the endpoint being used to spam STK prompts at an arbitrary Kenyan
// number: a short cooldown between prompts to the same MSISDN, and a cap on
// how many can be sent to one number per hour, independent of who's asking.
const mpesaPhoneHistory = {}; // msisdn -> timestamps[]
const MPESA_PHONE_WINDOW_MS = 60 * 60 * 1000;
const MPESA_PHONE_MAX_PER_WINDOW = 5;
const MPESA_PHONE_MIN_GAP_MS = 20 * 1000;

function checkPhoneCooldown(msisdn) {
  const now = Date.now();
  const history = (mpesaPhoneHistory[msisdn] || []).filter(t => now - t < MPESA_PHONE_WINDOW_MS);
  if (history.length && now - history[history.length - 1] < MPESA_PHONE_MIN_GAP_MS) {
    return 'Please wait a moment before requesting another STK push to this number.';
  }
  if (history.length >= MPESA_PHONE_MAX_PER_WINDOW) {
    return 'Too many requests to this number recently. Please try again later.';
  }
  history.push(now);
  mpesaPhoneHistory[msisdn] = history;
  return null;
}

function maskMsisdn(msisdn) {
  return msisdn.slice(0, 6) + '****' + msisdn.slice(-2);
}

// Belt-and-braces cap on top of the per-phone cooldown above, keyed by
// source IP, so the endpoint can't be hammered generically either.
const mpesaInitiateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many deposit requests. Please slow down and try again shortly.' }
});

app.post('/api/deposit/mpesa/initiate', mpesaInitiateLimiter, requireUser, async (req, res) => {
  if (!paystack.configured) {
    return res.status(503).json({ error: 'M-Pesa deposits are not configured on this server yet.' });
  }

  const userId = req.userId;
  const user = req.user;
  const { phone, amountKES } = req.body;

  const msisdn = paystack.normalizeMsisdn(phone);
  if (!msisdn) return res.status(400).json({ error: 'Enter a valid Safaricom M-Pesa number, e.g. 0712345678.' });

  const amount = Math.round(parseFloat(amountKES));
  if (!Number.isFinite(amount) || amount < MPESA_MIN_KES || amount > MPESA_MAX_KES) {
    return res.status(400).json({ error: `Enter an amount between KES ${MPESA_MIN_KES} and KES ${MPESA_MAX_KES}.` });
  }

  const alreadyPending = Object.values(mpesaPending).find(p => p.userId === userId && p.status === 'pending');
  if (alreadyPending) {
    return res.status(409).json({
      error: 'You already have a pending M-Pesa request. Please complete it or wait for it to expire before retrying.',
      checkoutRequestId: alreadyPending.txRef
    });
  }

  const cooldownError = checkPhoneCooldown(msisdn);
  if (cooldownError) return res.status(429).json({ error: cooldownError });

  const amountUSD = parseFloat((amount / USD_KES_RATE).toFixed(2));
  const txRef = `AlphaFX-MP-${uuidv4()}`;

  let charge;
  try {
    charge = await paystack.chargeMpesa({
      phone: msisdn,
      amountKES: amount,
      email: user.email,
      txRef
    });
  } catch (err) {
    console.error('[paystack] M-Pesa charge failed:', err.message);
    return res.status(502).json({ error: 'Could not reach M-Pesa right now. Please try again shortly.' });
  }

  const txId = uuidv4();
  const tx = {
    id: txId, type: 'deposit', amount: amountUSD, method: 'M-Pesa', status: 'pending',
    date: new Date().toISOString(), userId,
    meta: { phone: maskMsisdn(msisdn), amountKES: amount, txRef }
  };
  db.transactions.push(tx);
  mpesaPending[txRef] = {
    txRef, userId, txId, amountKES: amount, amountUSD, phone: msisdn,
    createdAt: Date.now(), status: 'pending'
  };

  res.json({
    success: true,
    checkoutRequestId: txRef,
    message: charge.display_text || 'Check your phone and enter your M-Pesa PIN to complete the deposit.'
  });
});

// Credits a pending M-Pesa deposit exactly once, based on a Paystack
// transaction record we fetched ourselves (never based on client input).
function settleMpesaDeposit(pending, txn) {
  if (!pending || pending.status !== 'pending') return pending ? pending.status : 'not_found';
  const tx = db.transactions.find(t => t.id === pending.txId);

  const amountMatches = Math.abs(Number(txn.amount) / 100 - pending.amountKES) < 1;
  const currencyMatches = txn.currency === 'KES';

  if (txn.status !== 'success' || !amountMatches || !currencyMatches) {
    pending.status = 'failed';
    if (tx) {
      tx.status = 'failed';
      tx.adminNote = txn.status !== 'success'
        ? 'Payment not completed'
        : 'Amount/currency mismatch — flagged for manual review';
    }
    return pending.status;
  }

  pending.status = 'completed';
  const user = db.users[pending.userId];
  if (user) user.balance = parseFloat((user.balance + pending.amountUSD).toFixed(2));
  if (tx) { tx.status = 'completed'; tx.meta.paystackRef = txn.reference; tx.meta.paystackId = txn.id; }
  logAdmin('MPESA_DEPOSIT', pending.userId, `M-Pesa deposit KES ${pending.amountKES} confirmed (ref ${txn.reference})`, 'Paystack');
  return pending.status;
}

// Frontend polls this while the user completes the STK prompt on their
// phone. There's no browser-side callback for mobile money (unlike the card
// widget), so each poll actively re-verifies with Paystack rather than
// waiting on the webhook alone.
app.get('/api/deposit/mpesa/status/:checkoutRequestId', requireUser, async (req, res) => {
  const pending = mpesaPending[req.params.checkoutRequestId];
  if (!pending || pending.userId !== req.userId) {
    return res.status(404).json({ error: 'Request not found.' });
  }
  if (pending.status === 'pending') {
    try {
      const txn = await paystack.verifyTransaction(pending.txRef);
      settleMpesaDeposit(pending, txn);
    } catch (err) {
      console.error('[paystack] M-Pesa verify failed:', err.message);
    }
  }
  res.json({ status: pending.status, amountUSD: pending.amountUSD, amountKES: pending.amountKES });
});

// Sweeps stale pending STK requests so a user isn't stuck forever if they
// dismiss the phone prompt without entering a PIN.
setInterval(() => {
  const now = Date.now();
  Object.values(mpesaPending).forEach(p => {
    if (p.status === 'pending' && now - p.createdAt > 3 * 60 * 1000) {
      p.status = 'expired';
      const tx = db.transactions.find(t => t.id === p.txId);
      if (tx && tx.status === 'pending') tx.status = 'expired';
    }
  });
}, 30 * 1000);

// ══════════════════════════════════════════════════════════════════════════════
// M-PESA WITHDRAWALS (payout, via Paystack account — admin-settled)
// ══════════════════════════════════════════════════════════════════════════════
// Unlike the deposit side, this does not call Paystack's Transfer API —
// pushing real money out automatically is a much bigger blast radius than
// pulling it in, so a withdrawal only ever reserves the balance and creates
// a pending request. An admin reviews it (POST
// /api/admin/transactions/:txId/status) and pays the customer's M-Pesa
// number from the Paystack dashboard (or directly) before marking it
// completed — exactly how the Crypto withdrawal above already works, just
// with a phone number in place of a wallet address. Rejecting refunds the
// held balance automatically (shared logic in that route).
const MPESA_WITHDRAW_MIN_USD = 10;
const MPESA_WITHDRAW_MAX_USD = 10000;

app.post('/api/withdraw/mpesa', withdrawLimiter, requireUser, (req, res) => {
  if (!paystack.configured) {
    return res.status(503).json({ error: 'M-Pesa withdrawals are not configured on this server yet.' });
  }

  const userId = req.userId;
  const user = req.user;
  const { phone, amount } = req.body;

  const msisdn = paystack.normalizeMsisdn(phone);
  if (!msisdn) return res.status(400).json({ error: 'Enter a valid Safaricom M-Pesa number, e.g. 0712345678.' });

  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || amt < MPESA_WITHDRAW_MIN_USD || amt > MPESA_WITHDRAW_MAX_USD) {
    return res.status(400).json({ error: `Enter an amount between $${MPESA_WITHDRAW_MIN_USD} and $${MPESA_WITHDRAW_MAX_USD}.` });
  }
  const withdrawable = Math.min(user.balance, realFundsAvailable(user));
  if (amt > withdrawable) {
    return res.status(400).json({ error: amt <= user.balance
      ? 'You can only withdraw funds you\'ve actually deposited — your demo/bonus balance isn\'t withdrawable.'
      : 'Insufficient balance' });
  }

  // Reserve the funds immediately (same as Crypto) so the same balance can't
  // be withdrawn twice while this request is pending review.
  user.balance = parseFloat((user.balance - amt).toFixed(2));
  const amountKES = Math.round(amt * USD_KES_RATE);
  const destination = `M-Pesa — ${msisdn}`;
  const tx = {
    id: uuidv4(), type: 'withdrawal', amount: amt, method: 'M-Pesa', destination, status: 'pending',
    date: new Date().toISOString(), userId, meta: { phone: msisdn, amountKES }
  };
  db.transactions.push(tx);
  res.json({ success: true, newBalance: user.balance, transaction: tx });
});

// ══════════════════════════════════════════════════════════════════════════════
// CARD DEPOSITS (Paystack — Direct Charge API)
// ══════════════════════════════════════════════════════════════════════════════
// Card number, CVV and expiry are entered in our own form and sent here
// directly (see paystack.chargeCard) rather than through Paystack's iframe
// widget — but even so, a client-reported "payment succeeded" is never
// trusted by itself: every route below independently re-verifies the
// outcome with Paystack (via the secret key) before crediting anything.
//
// This Paystack account settles in KES, so card deposits are collected in
// KES (same as M-Pesa) and converted to the USD balance at USD_KES_RATE.
const CARD_MIN_KES = Math.round(10 * USD_KES_RATE);
const CARD_MAX_KES = Math.round(10000 * USD_KES_RATE);

// Pending/settled card charges keyed by reference. Internal only.
const cardPending = {};

const cardInitiateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many deposit requests. Please slow down and try again shortly.' }
});

// Basic sanity checks on raw card input before it's sent to Paystack — not
// a substitute for the issuer's own validation, just enough to reject
// obviously malformed input without wasting a gateway call. Never logs or
// echoes the input back.
function validateCardInput(card) {
  const number = String((card && card.number) || '').replace(/\s+/g, '');
  const cvv = String((card && card.cvv) || '');
  const expiryMonth = String((card && card.expiryMonth) || '');
  const expiryYear = String((card && card.expiryYear) || '');

  if (!/^\d{12,19}$/.test(number)) return 'Enter a valid card number.';
  if (!/^\d{3,4}$/.test(cvv)) return 'Enter a valid CVV.';
  if (!/^\d{1,2}$/.test(expiryMonth) || Number(expiryMonth) < 1 || Number(expiryMonth) > 12) {
    return 'Enter a valid expiry month.';
  }
  if (!/^\d{2}$/.test(expiryYear)) return 'Enter a valid expiry year.';

  const now = new Date();
  const currentYear2 = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  const y = Number(expiryYear);
  const m = Number(expiryMonth);
  if (y < currentYear2 || (y === currentYear2 && m < currentMonth)) return 'This card has expired.';

  return null;
}

// Creates the pending deposit record shared by every card-charge route
// (fresh card entry or a saved-card replay) before we ever call Paystack.
function createCardPending(userId, amountKES) {
  const amountUSD = parseFloat((amountKES / USD_KES_RATE).toFixed(2));
  const txRef = `AlphaFX-${uuidv4()}`;
  const txId = uuidv4();
  const tx = {
    id: txId, type: 'deposit', amount: amountUSD, method: 'Card', status: 'pending',
    date: new Date().toISOString(), userId, meta: { txRef, amountKES }
  };
  db.transactions.push(tx);
  const pending = { txRef, userId, txId, amountKES, amountUSD, status: 'pending', createdAt: Date.now() };
  cardPending[txRef] = pending;
  return { txRef, txId, tx, pending };
}

// Saves only Paystack's reusable authorization_code (plus display metadata
// like last4/bank/expiry) against the user — never the PAN or CVV, which
// this server never writes to disk in the first place.
function saveCardAuthorization(user, auth) {
  if (!auth || !auth.authorization_code) return;
  user.savedCards = user.savedCards || [];
  if (user.savedCards.some(c => c.signature && c.signature === auth.signature)) return;
  user.savedCards.push({
    authorizationCode: auth.authorization_code,
    signature: auth.signature || null,
    last4: auth.last4 || '????',
    bank: auth.bank || '',
    cardType: auth.card_type || 'card',
    expMonth: auth.exp_month || '',
    expYear: auth.exp_year || '',
    addedAt: new Date().toISOString()
  });
}

// Turns a Paystack /charge response into an HTTP outcome. A 'success'
// status still gets independently re-verified before crediting anything.
// Any other status — including a challenge that would need a
// PIN/OTP/phone/birthday step or a 3DS redirect ('send_pin', 'send_otp',
// 'send_phone', 'send_birthday', 'open_url') — is treated as a failed
// charge rather than walked through interactively.
async function resolveChargeOutcome(pending, tx, result, user, saveCard) {
  if (result.status === 'success') {
    let txn;
    try {
      txn = await paystack.verifyTransaction(pending.txRef);
    } catch (err) {
      console.error('[paystack] Card verify failed:', err.message);
      return { code: 502, body: { error: 'Could not confirm payment with Paystack right now. Please try again shortly.' } };
    }
    const status = settleCardDeposit(pending, txn);
    if (status === 'completed') {
      if (saveCard && txn.authorization && txn.authorization.reusable) {
        saveCardAuthorization(user, txn.authorization);
      }
      return { code: 200, body: { status: 'success', newBalance: user.balance, amountUSD: pending.amountUSD } };
    }
    return { code: 402, body: { error: 'Payment could not be confirmed.' } };
  }

  pending.status = 'failed';
  if (tx) { tx.status = 'failed'; tx.adminNote = result.gateway_response || 'Card charge failed'; }
  // Diagnostic only — status/message/gateway_response are Paystack's own
  // response fields, never card data, so this is safe to log.
  console.warn('[paystack] Card charge not successful:', {
    status: result.status, message: result.message, gateway_response: result.gateway_response
  });
  return { code: 402, body: { error: result.gateway_response || 'Card payment failed. Please check your details and try again.' } };
}

// Charges a freshly-entered card via raw number/cvv/expiry, collected in
// our own form (not Paystack's iframe widget). Card fields arrive here,
// pass straight through to paystack.chargeCard(), and are never attached to
// `pending`/`tx`/the request log — only the resolved outcome persists.
app.post('/api/deposit/card/charge-new', cardInitiateLimiter, requireUser, async (req, res) => {
  if (!paystack.configured) {
    return res.status(503).json({ error: 'Card deposits are not configured on this server yet.' });
  }

  const userId = req.userId;
  const user = req.user;
  const { amount, card, saveCard } = req.body;

  const amountKES = parseFloat(amount);
  if (!Number.isFinite(amountKES) || amountKES < CARD_MIN_KES || amountKES > CARD_MAX_KES) {
    return res.status(400).json({ error: `Enter an amount between KES ${CARD_MIN_KES} and KES ${CARD_MAX_KES}.` });
  }

  const cardError = validateCardInput(card);
  if (cardError) return res.status(400).json({ error: cardError });

  const { tx, pending } = createCardPending(userId, amountKES);

  let result;
  try {
    result = await paystack.chargeCard({ email: user.email, amountKES, txRef: pending.txRef, card });
  } catch (err) {
    console.error('[paystack] Card charge failed:', err.message);
    pending.status = 'failed';
    tx.status = 'failed';
    return res.status(502).json({ error: 'Could not reach Paystack right now. Please try again shortly.' });
  }

  const outcome = await resolveChargeOutcome(pending, tx, result, user, !!saveCard);
  return res.status(outcome.code).json(outcome.body);
});

// Lists a user's saved cards (display metadata only — authorization_code is
// an opaque Paystack token, never the PAN).
app.get('/api/deposit/card/saved', requireUser, (req, res) => {
  const cards = (req.user.savedCards || []).map(c => ({
    authorizationCode: c.authorizationCode, last4: c.last4, bank: c.bank,
    cardType: c.cardType, expMonth: c.expMonth, expYear: c.expYear
  }));
  res.json({ cards });
});

app.delete('/api/deposit/card/saved/:authorizationCode', requireUser, (req, res) => {
  const user = req.user;
  user.savedCards = (user.savedCards || []).filter(c => c.authorizationCode !== req.params.authorizationCode);
  res.json({ success: true });
});

// Charges a previously-saved card via its authorization_code — no raw card
// fields involved.
app.post('/api/deposit/card/charge-saved', cardInitiateLimiter, requireUser, async (req, res) => {
  if (!paystack.configured) {
    return res.status(503).json({ error: 'Card deposits are not configured on this server yet.' });
  }

  const userId = req.userId;
  const user = req.user;
  const { authorizationCode, amount } = req.body;

  const card = (user.savedCards || []).find(c => c.authorizationCode === authorizationCode);
  if (!card) return res.status(404).json({ error: 'Saved card not found.' });

  const amountKES = parseFloat(amount);
  if (!Number.isFinite(amountKES) || amountKES < CARD_MIN_KES || amountKES > CARD_MAX_KES) {
    return res.status(400).json({ error: `Enter an amount between KES ${CARD_MIN_KES} and KES ${CARD_MAX_KES}.` });
  }

  const { txRef, tx, pending } = createCardPending(userId, amountKES);

  let result;
  try {
    result = await paystack.chargeAuthorization({ email: user.email, amountKES, txRef, authorizationCode });
  } catch (err) {
    console.error('[paystack] Saved-card charge failed:', err.message);
    pending.status = 'failed';
    tx.status = 'failed';
    return res.status(502).json({ error: 'Could not reach Paystack right now. Please try again shortly.' });
  }

  const outcome = await resolveChargeOutcome(pending, tx, result, user, false);
  return res.status(outcome.code).json(outcome.body);
});

// Credits a pending card deposit exactly once, based on a Paystack
// transaction record we fetched ourselves (never based on client input).
function settleCardDeposit(pending, txn) {
  if (!pending || pending.status !== 'pending') return pending ? pending.status : 'not_found';
  const tx = db.transactions.find(t => t.id === pending.txId);

  const amountMatches = Math.abs(Number(txn.amount) / 100 - pending.amountKES) < 1;
  const currencyMatches = txn.currency === 'KES';

  if (txn.status !== 'success' || !amountMatches || !currencyMatches) {
    pending.status = 'failed';
    if (tx) {
      tx.status = 'failed';
      tx.adminNote = txn.status !== 'success'
        ? 'Payment not completed'
        : 'Amount/currency mismatch — flagged for manual review';
    }
    return pending.status;
  }

  pending.status = 'completed';
  const user = db.users[pending.userId];
  if (user) user.balance = parseFloat((user.balance + pending.amountUSD).toFixed(2));
  if (tx) { tx.status = 'completed'; tx.meta.paystackRef = txn.reference; tx.meta.paystackId = txn.id; }
  logAdmin('CARD_DEPOSIT', pending.userId, `Card deposit KES ${pending.amountKES} confirmed (ref ${txn.reference})`, 'Paystack');
  return pending.status;
}

// Paystack's server-to-server webhook — fires for both card and M-Pesa
// charges, and is a backstop source of truth if this process crashes or the
// response to /charge-new never makes it back to the client. Verified via
// an HMAC-SHA512 signature of the raw body, signed with our secret key,
// which Paystack sends in the x-paystack-signature header.
app.post('/api/paystack/webhook', async (req, res) => {
  res.sendStatus(200); // ack immediately regardless of what we do with the body

  if (!paystack.verifyWebhookSignature(req.rawBody, req.headers['x-paystack-signature'])) {
    console.warn('[paystack] Webhook rejected: signature mismatch');
    return;
  }

  const event = req.body || {};
  const txRef = event.data && event.data.reference;
  if (!txRef) return;

  const isCard = cardPending[txRef] && cardPending[txRef].status === 'pending';
  const isMpesa = !isCard && mpesaPending[txRef] && mpesaPending[txRef].status === 'pending';
  if (!isCard && !isMpesa) return; // unknown or already settled

  let txn;
  try {
    txn = await paystack.verifyTransaction(txRef);
  } catch (err) {
    console.error('[paystack] Webhook verify failed:', err.message);
    return;
  }
  if (txn.reference !== txRef) return;

  if (isCard) settleCardDeposit(cardPending[txRef], txn);
  else settleMpesaDeposit(mpesaPending[txRef], txn);
});

// Sweeps stale pending card charges — normally /charge-new resolves inline,
// but this catches the rare case where the process dies mid-request and a
// record is left dangling in 'pending'.
setInterval(() => {
  const now = Date.now();
  Object.values(cardPending).forEach(p => {
    if (p.status === 'pending' && now - p.createdAt > 30 * 60 * 1000) {
      p.status = 'expired';
      const tx = db.transactions.find(t => t.id === p.txId);
      if (tx && tx.status === 'pending') tx.status = 'expired';
    }
  });
}, 60 * 1000);

app.post('/api/trade/forex', requireUser, (req, res) => {
  const userId = req.userId;
  const user = req.user;
  const { pair, direction, amount, leverage = 50, stopLoss, takeProfit } = req.body;
  if (!prices[pair]) return res.status(400).json({ error: 'Invalid pair' });
  if (!['buy', 'sell'].includes(direction)) return res.status(400).json({ error: 'Invalid direction' });
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum trade is $10' });
  const margin = parseFloat((amount / leverage).toFixed(2));
  if (margin > user.balance) return res.status(400).json({ error: 'Insufficient margin' });
  const trade = { id: uuidv4(), userId, type: 'forex', pair, direction, amount: parseFloat(amount), leverage, margin, entryPrice: prices[pair], currentPrice: prices[pair], stopLoss: parseFloat(stopLoss)||null, takeProfit: parseFloat(takeProfit)||null, pnl: 0, status: 'open', openedAt: new Date().toISOString() };
  db.trades.push(trade);
  res.json({ success: true, trade });
});

app.post('/api/trade/close/:tradeId', requireUser, (req, res) => {
  const trade = db.trades.find(t => t.id === req.params.tradeId);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (trade.userId !== req.userId) return res.status(403).json({ error: 'Not authorized to close this trade.' });
  if (trade.status !== 'open') return res.status(400).json({ error: 'Trade already closed' });
  const owner = db.users[trade.userId];
  if (!owner) return res.status(404).json({ error: 'Trade owner not found' });
  const exitPrice = prices[trade.pair];
  const diff = trade.direction === 'buy' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
  let pnl = parseFloat((diff * trade.amount * trade.leverage).toFixed(2));
  let credit = pnl;
  // Multipliers/Accumulators collateralize with the stake up front (see
  // /api/trade/multiplier and /api/trade/accumulator below), so unlike a
  // Forex CFD position, the loss can never exceed it and closing refunds
  // the stake plus net P&L instead of P&L alone.
  if (trade.kind === 'multiplier' || trade.kind === 'accumulator') {
    pnl = Math.max(pnl, -trade.amount);
    credit = trade.amount + pnl;
  }
  trade.status = 'closed'; trade.exitPrice = exitPrice; trade.pnl = pnl; trade.closedAt = new Date().toISOString();
  owner.balance = parseFloat((owner.balance + credit).toFixed(2));
  res.json({ success: true, trade, pnl, newBalance: owner.balance });
});

// Multipliers — CFD-style leveraged position with no fixed expiry, closed
// manually via /api/trade/close/:tradeId (shared with Forex). The stake is
// deducted up front and is the hard cap on loss — closing refunds
// stake + net P&L, so the worst case is walking away with $0 rather than a
// negative balance.
const MULTIPLIER_LEVERAGES = [5, 10, 20, 50, 100, 200];
app.post('/api/trade/multiplier', requireUser, (req, res) => {
  const userId = req.userId;
  const user = req.user;
  const { pair, direction, stake, multiplier } = req.body;
  if (!prices[pair]) return res.status(400).json({ error: 'Invalid pair' });
  if (!['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Invalid direction' });
  const lev = parseInt(multiplier, 10);
  if (!MULTIPLIER_LEVERAGES.includes(lev)) return res.status(400).json({ error: 'Invalid multiplier' });
  const stakeAmt = parseFloat(stake);
  if (!stakeAmt || stakeAmt < 10) return res.status(400).json({ error: 'Minimum stake is $10' });
  if (stakeAmt > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  user.balance = parseFloat((user.balance - stakeAmt).toFixed(2));
  const trade = {
    id: uuidv4(), userId, type: 'forex', kind: 'multiplier', pair,
    direction: direction === 'up' ? 'buy' : 'sell', amount: stakeAmt, leverage: lev,
    entryPrice: prices[pair], currentPrice: prices[pair], pnl: 0, status: 'open',
    openedAt: new Date().toISOString()
  };
  db.trades.push(trade);
  res.json({ success: true, trade, newBalance: user.balance });
});

// Accumulators — Deriv's growth-rate product has no directional bet: stake
// grows every tick the market holds inside a barrier and is forfeit if it
// doesn't. Modeled here as a long-only leveraged position (no up/down
// choice) whose effective leverage scales with the chosen growth rate, sized
// so it behaves like the real product's risk/reward without simulating a
// per-tick barrier walk. Closed manually, same capped-loss rule as Multipliers.
const ACCUMULATOR_LEVERAGES = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };
app.post('/api/trade/accumulator', requireUser, (req, res) => {
  const userId = req.userId;
  const user = req.user;
  const { pair, stake, growthRate } = req.body;
  if (!prices[pair]) return res.status(400).json({ error: 'Invalid pair' });
  const lev = ACCUMULATOR_LEVERAGES[parseInt(growthRate, 10)];
  if (!lev) return res.status(400).json({ error: 'Invalid growth rate' });
  const stakeAmt = parseFloat(stake);
  if (!stakeAmt || stakeAmt < 10) return res.status(400).json({ error: 'Minimum stake is $10' });
  if (stakeAmt > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  user.balance = parseFloat((user.balance - stakeAmt).toFixed(2));
  const trade = {
    id: uuidv4(), userId, type: 'forex', kind: 'accumulator', pair, growthRate: parseInt(growthRate, 10),
    direction: 'buy', amount: stakeAmt, leverage: lev,
    entryPrice: prices[pair], currentPrice: prices[pair], pnl: 0, status: 'open',
    openedAt: new Date().toISOString()
  };
  db.trades.push(trade);
  res.json({ success: true, trade, newBalance: user.balance });
});

const BINARY_DIRECTIONS = {
  rise_fall: ['call', 'put'],
  over_under: ['over', 'under'],
  matches_differs: ['matches', 'differs'],
  even_odd: ['even', 'odd'],
  higher_lower: ['higher', 'lower'],
  touch_no_touch: ['touch', 'no_touch'],
  vanillas: ['call', 'put'],
  turbos: ['higher', 'lower']
};
// The four "barrier" contract types settle against an absolute price level
// (entryPrice ± the client-computed offset) rather than the entry price
// itself — Touch/No Touch and Turbos also need continuous monitoring for
// an early knockout/touch, not just a check at expiry (see updatePrices()).
const BARRIER_CONTRACT_TYPES = ['higher_lower', 'touch_no_touch', 'vanillas', 'turbos'];
// Vanillas/Turbos pay out proportionally to how far the exit price finishes
// beyond the strike/barrier (like a real option), capped at this multiple
// of the stake instead of Deriv's uncapped/complex premium math.
const SCALED_PAYOUT_CAP = 5;

// Generic duration bounds, in seconds, applied regardless of which unit the
// ticket was built from (Ticks/Seconds/Minutes/Hours/Days/End Time all
// collapse to a single expirySeconds value before reaching here).
const BINARY_MIN_EXPIRY_SECONDS = 1;
const BINARY_MAX_EXPIRY_SECONDS = 365 * 24 * 3600;

app.post('/api/trade/binary', requireUser, (req, res) => {
  const userId = req.userId;
  const user = req.user;
  const { pair, contractType = 'rise_fall', direction, prediction, stake, expiryMinutes = 15, expirySeconds, payoutPercent = 85, allowEquals = false, barrierOffset } = req.body;
  if (!prices[pair]) return res.status(400).json({ error: 'Invalid pair' });
  const validDirections = BINARY_DIRECTIONS[contractType];
  if (!validDirections) return res.status(400).json({ error: 'Invalid contract type' });
  if (!validDirections.includes(direction)) return res.status(400).json({ error: 'Invalid direction' });
  let digitPrediction = null;
  if (contractType === 'over_under' || contractType === 'matches_differs') {
    digitPrediction = parseInt(prediction, 10);
    if (!Number.isInteger(digitPrediction) || digitPrediction < 0 || digitPrediction > 9) {
      return res.status(400).json({ error: 'Invalid prediction digit' });
    }
    if (contractType === 'over_under' && direction === 'over' && digitPrediction === 9) {
      return res.status(400).json({ error: 'Barrier cannot be 9 for Over' });
    }
    if (contractType === 'over_under' && direction === 'under' && digitPrediction === 0) {
      return res.status(400).json({ error: 'Barrier cannot be 0 for Under' });
    }
  }
  let barrier = null;
  if (BARRIER_CONTRACT_TYPES.includes(contractType)) {
    const offset = parseFloat(barrierOffset);
    if (!Number.isFinite(offset) || offset === 0) {
      return res.status(400).json({ error: 'Invalid barrier' });
    }
    // Turbos knock out the instant the barrier is touched, so the barrier
    // must sit on the losing side of the entry price for the chosen
    // direction — a Long's barrier below spot, a Short's above.
    if (contractType === 'turbos') {
      if (direction === 'higher' && offset >= 0) return res.status(400).json({ error: 'Turbos Long barrier must be below spot' });
      if (direction === 'lower' && offset <= 0) return res.status(400).json({ error: 'Turbos Short barrier must be above spot' });
    }
    barrier = parseFloat((prices[pair] + offset).toFixed(8));
  }
  const useAllowEquals = contractType === 'rise_fall' && !!allowEquals;
  const durationSeconds = Number.isFinite(parseFloat(expirySeconds)) ? parseFloat(expirySeconds) : parseInt(expiryMinutes, 10) * 60;
  if (!Number.isFinite(durationSeconds) || durationSeconds < BINARY_MIN_EXPIRY_SECONDS || durationSeconds > BINARY_MAX_EXPIRY_SECONDS) {
    return res.status(400).json({ error: 'Invalid contract duration' });
  }
  if (!stake || stake < 10) return res.status(400).json({ error: 'Minimum stake is $10' });
  if (stake > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  user.balance = parseFloat((user.balance - parseFloat(stake)).toFixed(2));
  // Allow Equals broadens the win condition, so its payout is discounted a
  // flat 5 points against the base percent the ticket already priced in.
  const effectivePayoutPercent = Math.max(1, useAllowEquals ? payoutPercent - 5 : payoutPercent);
  const payout = parseFloat((stake * (1 + effectivePayoutPercent / 100)).toFixed(2));
  const option = { id: uuidv4(), userId, type: 'binary', pair, contractType, direction, allowEquals: useAllowEquals, prediction: digitPrediction, barrier, touched: false, knockedOut: false, stake: parseFloat(stake), payout, payoutPercent: effectivePayoutPercent, entryPrice: prices[pair], entryDigit: lastDigitOf(pair, prices[pair]), exitPrice: null, expirySeconds: durationSeconds, expiryMinutes: durationSeconds / 60, expiresAt: Date.now() + durationSeconds * 1000, status: 'open', openedAt: new Date().toISOString(), settledAt: null };
  db.binaryOptions.push(option);
  res.json({ success: true, option, newBalance: user.balance });
});

// SmartTrader — AI-managed fixed-term investment. User stakes an amount
// (min $40) for a chosen duration and receives the stake back plus a
// random 30%–35% return once the term matures.
app.post('/api/trade/smart', requireUser, (req, res) => {
  const userId = req.userId;
  const user = req.user;
  const { stake, duration } = req.body;
  if (!SMART_DURATIONS[duration]) return res.status(400).json({ error: 'Invalid investment duration' });
  const stakeAmt = parseFloat(stake);
  if (!stakeAmt || stakeAmt < 40) return res.status(400).json({ error: 'Minimum investment is $40' });
  if (stakeAmt > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  user.balance = parseFloat((user.balance - stakeAmt).toFixed(2));
  const periods = smartPeriodsFor(duration);
  const insuranceRate = SMART_INSURANCE_RATES[duration] || 0;
  const insuranceFee = parseFloat((stakeAmt * insuranceRate / 100).toFixed(2));
  const netPrincipal = parseFloat((stakeAmt - insuranceFee).toFixed(2));
  // One independently-rolled 30%-35% rate per 24hr period, applied to the
  // running value as it compounds rather than a single flat payout.
  const dailyRates = Array.from({ length: periods }, () => parseFloat((30 + Math.random() * 5).toFixed(2)));
  const startedAtMs = Date.now();
  const investment = {
    id: uuidv4(), userId, stake: stakeAmt, duration, periods, dailyRates,
    insuranceRate, insuranceFee, netPrincipal,
    periodsCompleted: 0, currentValue: netPrincipal,
    status: 'active', startedAt: new Date(startedAtMs).toISOString(), startedAtMs,
    maturesAt: startedAtMs + SMART_DURATIONS[duration]
  };
  db.investments.push(investment);
  res.json({ success: true, investment: publicInvestment(investment), newBalance: user.balance });
});

// Future daily rates are deliberately withheld from the client — an
// investment's day-by-day performance should surface once it's realized,
// not be readable in advance from the create/list response.
function publicInvestment(inv) {
  const { dailyRates, ...rest } = inv;
  return { ...rest, timeLeft: Math.max(0, inv.maturesAt - Date.now()) };
}

app.get('/api/investments/:userId', requireUser, requireOwnParam('userId'), (req, res) => {
  const userId = req.params.userId;
  const investments = db.investments.filter(i => i.userId === userId)
    .map(publicInvestment)
    .reverse();
  res.json(investments);
});

app.get('/api/trades/:userId', requireUser, requireOwnParam('userId'), (req, res) => {
  const userId = req.params.userId;
  const forex = db.trades.filter(t => t.userId === userId).map(t => {
    if (t.status === 'open') {
      const d = t.direction === 'buy' ? prices[t.pair] - t.entryPrice : t.entryPrice - prices[t.pair];
      let pnl = parseFloat((d * t.amount * t.leverage).toFixed(2));
      if (t.kind === 'multiplier' || t.kind === 'accumulator') pnl = Math.max(pnl, -t.amount);
      t.currentPrice = prices[t.pair];
      t.pnl = pnl;
    }
    return t;
  });
  const binary = db.binaryOptions.filter(t => t.userId === userId).map(o => ({ ...o, currentPrice: prices[o.pair], timeLeft: Math.max(0, o.expiresAt - Date.now()) }));
  res.json({ forex, binary });
});

app.get('/api/transactions/:userId', requireUser, requireOwnParam('userId'), (req, res) => {
  res.json(db.transactions.filter(t => t.userId === req.params.userId).reverse());
});

app.get('/api/stats/:userId', requireUser, requireOwnParam('userId'), (req, res) => {
  const userId = req.params.userId;
  const user = db.users[userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const allForex = db.trades.filter(t => t.userId === userId);
  const allBinary = db.binaryOptions.filter(t => t.userId === userId);
  const closedBinary = allBinary.filter(t => t.status !== 'open');
  const wonBinary = allBinary.filter(t => t.status === 'won');
  const totalPnl = allForex.reduce((s,t) => s+(t.pnl||0), 0)
    + allBinary.filter(t=>t.status==='won').reduce((s,t)=>s+(t.payout-t.stake),0)
    - allBinary.filter(t=>t.status==='lost').reduce((s,t)=>s+t.stake,0);
  res.json({ balance: user.balance, totalPnl: parseFloat(totalPnl.toFixed(2)), openForex: allForex.filter(t=>t.status==='open').length, openBinary: allBinary.filter(t=>t.status==='open').length, winRate: closedBinary.length ? Math.round((wonBinary.length/closedBinary.length)*100) : 0, totalTrades: allForex.length + allBinary.length });
});

app.get('*', (req, res) => {
  if (req.path === '/admin' || req.path === '/admin/') return res.sendFile(path.join(__dirname, '../public/admin.html'));
  if (req.path === '/login' || req.path === '/login/') return res.sendFile(path.join(__dirname, '../public/login.html'));
  if (req.path === '/register' || req.path === '/register/') return res.sendFile(path.join(__dirname, '../public/register.html'));
  if (req.path === '/forgot-password') return res.sendFile(path.join(__dirname, '../public/forgot-password.html'));
  if (req.path === '/app' || req.path === '/app/') return res.sendFile(path.join(__dirname, '../public/index.html'));
  if (req.path === '/' || req.path === '') return res.sendFile(path.join(__dirname, '../public/landing.html'));
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/prices' });
wss.on('connection', (ws) => {
  priceClients.add(ws);
  ws.send(JSON.stringify({ type: 'prices', prices, stalePairs: computeStalePairs(), timestamp: Date.now() }));
  ws.on('close', () => priceClients.delete(ws));
});

startDerivFeed({
  prices,
  lastTickAt,
  onTick: broadcastPrices,
  onCatalog: (catalog) => { derivCatalog = catalog; }
});

server.listen(PORT, () => {
  console.log(`\n🚀 AlphaFX Trading Platform`);
  console.log(`   Landing Page:   http://localhost:${PORT}`);
  console.log(`   Sign In:        http://localhost:${PORT}/login`);
  console.log(`   Register:       http://localhost:${PORT}/register`);
  console.log(`   Trading App:    http://localhost:${PORT}/app`);
  console.log(`   Admin Panel:    http://localhost:${PORT}/admin`);
  console.log(`   Admin credentials are not printed here — see your team's secure credential store.\n`);
});
