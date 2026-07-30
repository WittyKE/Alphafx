const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

app.use(cors());
app.use(express.json());
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

// One-time password reset codes for end users (email → { otp, expiry })
const passwordResets = {};

// ─── In-Memory Store ────────────────────────────────────────────────────────
// Demo accounts share the password "Demo1234!" purely so reviewers can sign
// in without registering. Real registrations (POST /api/register) hash a
// password the user chooses themselves.
const DEMO_PASSWORD_HASH = hashPassword('Demo1234!');

let db = {
  users: {
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
  },
  trades: [],
  binaryOptions: [],
  transactions: [
    { id: uuidv4(), type: 'deposit', amount: 10000, method: 'Demo', status: 'completed', date: new Date(Date.now()-86400000).toISOString(), userId: 'demo-user-1' },
    { id: uuidv4(), type: 'deposit', amount: 25000, method: 'Bank', status: 'completed', date: new Date(Date.now()-172800000).toISOString(), userId: 'demo-user-2' },
    { id: uuidv4(), type: 'withdrawal', amount: 3000, method: 'M-Pesa', status: 'pending', date: new Date(Date.now()-3600000).toISOString(), userId: 'demo-user-2' },
    { id: uuidv4(), type: 'deposit', amount: 5500, method: 'Card', status: 'completed', date: new Date(Date.now()-43200000).toISOString(), userId: 'demo-user-3' },
    { id: uuidv4(), type: 'deposit', amount: 50000, method: 'Bank', status: 'completed', date: new Date(Date.now()-2592000000).toISOString(), userId: 'demo-user-4' },
  ],
  adminLogs: [],
  admins: {},
  cryptoWallets: {}
};

// ─── Seed admin accounts ────────────────────────────────────────────────────
// Superuser — manages every other admin, hidden from the admin list.
seedAdmin(db.admins, 'admin-root', process.env.SUPERADMIN_USERNAME || 'root', process.env.SUPERADMIN_PASSWORD || 'Anonymous@7682!', 'Root Super Admin', 'superadmin');
// Regular admins — day-to-day operations (users, finance, support).
seedAdmin(db.admins, 'admin-001', 'admin_amina', 'Amina#Adm2026!', 'Amina Cheruiyot', 'admin');
seedAdmin(db.admins, 'admin-002', 'admin_brian', 'Brian#Adm2026!', 'Brian Otieno', 'admin');
seedAdmin(db.admins, 'admin-003', 'admin_grace', 'Grace#Adm2026!', 'Grace Wanjiru', 'admin');

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
  'XAU/USD': 2338.50, 'BTC/USD': 67421.00, 'ETH/USD': 3542.00
};

// Decimal precision used to derive the "last digit" for Digits contracts
// (Over/Under, Matches/Differs, Even/Odd) — mirrors the client's fmtPrice().
function digitDecimals(pair) {
  if (pair.includes('BTC') || pair.includes('ETH')) return 0;
  if (pair.includes('XAU') || pair.includes('XAG')) return 2;
  if (pair.includes('JPY')) return 3;
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
    case 'rise_fall':
    default:
      return opt.direction === 'call' ? cur > opt.entryPrice : cur < opt.entryPrice;
  }
}

function updatePrices() {
  Object.keys(prices).forEach(pair => {
    const v = prices[pair] > 1000 ? 0.003 : 0.0003;
    prices[pair] = parseFloat((prices[pair] * (1 + (Math.random() - 0.499) * v)).toFixed(prices[pair] > 100 ? 2 : 5));
  });
  const now = Date.now();
  db.binaryOptions.forEach(opt => {
    if (opt.status === 'open' && now >= opt.expiresAt) {
      const cur = prices[opt.pair];
      const won = resolveBinaryWin(opt, cur);
      opt.status = won ? 'won' : 'lost';
      opt.exitPrice = cur;
      opt.exitDigit = lastDigitOf(opt.pair, cur);
      opt.settledAt = new Date().toISOString();
      if (won && db.users[opt.userId]) {
        db.users[opt.userId].balance = parseFloat((db.users[opt.userId].balance + opt.payout).toFixed(2));
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

// Dashboard summary
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const users = Object.values(db.users);
  const totalBalance = users.reduce((s, u) => s + u.balance, 0);
  const totalDeposits = db.transactions.filter(t => t.type === 'deposit' && t.status === 'completed').reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = db.transactions.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
  const pendingWithdrawals = db.transactions.filter(t => t.type === 'withdrawal' && t.status === 'pending');
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
    recentTransactions: db.transactions.slice(-10).reverse()
  });
});

// List all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = Object.values(db.users).map(u => ({
    ...publicUser(u),
    tradeCount: db.trades.filter(t => t.userId === u.id).length,
    binaryCount: db.binaryOptions.filter(t => t.userId === u.id).length
  }));
  res.json(users);
});

// Get single user detail
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const forex = db.trades.filter(t => t.userId === req.params.id);
  const binary = db.binaryOptions.filter(t => t.userId === req.params.id);
  const txs = db.transactions.filter(t => t.userId === req.params.id);
  res.json({ ...publicUser(user), forex, binary, transactions: txs.reverse() });
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
  tx.status = req.body.status;
  tx.adminNote = req.body.note || '';
  tx.processedAt = new Date().toISOString();
  logAdmin('TX_STATUS', tx.userId, `Transaction ${tx.id} changed from ${prev} to ${req.body.status}`, req.admin.name);
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
  res.json({ success: true, user: publicUser(user) });
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
  res.json({ success: true, user: publicUser(user) });
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
  delete passwordResets[email];
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXISTING USER ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/prices', (req, res) => res.json({ prices, timestamp: Date.now() }));

app.get('/api/user/:id', (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(user));
});

app.post('/api/deposit', (req, res) => {
  const { userId = 'demo-user-1', amount, method } = req.body;
  const user = db.users[userId];
  if (!user) return res.status(404).json({ error: 'User not found. Please log in again.' });
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum deposit is $10' });
  user.balance = parseFloat((user.balance + parseFloat(amount)).toFixed(2));
  const tx = { id: uuidv4(), type: 'deposit', amount: parseFloat(amount), method: method||'Demo', status: 'completed', date: new Date().toISOString(), userId };
  db.transactions.push(tx);
  res.json({ success: true, newBalance: user.balance, transaction: tx });
});

app.post('/api/withdraw', (req, res) => {
  const { userId = 'demo-user-1', amount, destination } = req.body;
  const user = db.users[userId];
  if (!user) return res.status(404).json({ error: 'User not found. Please log in again.' });
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum withdrawal is $10' });
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  user.balance = parseFloat((user.balance - parseFloat(amount)).toFixed(2));
  const tx = { id: uuidv4(), type: 'withdrawal', amount: parseFloat(amount), destination: destination||'Bank', status: 'pending', date: new Date().toISOString(), userId };
  db.transactions.push(tx);
  res.json({ success: true, newBalance: user.balance, transaction: tx });
});

app.post('/api/trade/forex', (req, res) => {
  const { userId = 'demo-user-1', pair, direction, amount, leverage = 50, stopLoss, takeProfit } = req.body;
  const user = db.users[userId];
  if (!user) return res.status(404).json({ error: 'User not found. Please log in again.' });
  if (!prices[pair]) return res.status(400).json({ error: 'Invalid pair' });
  if (!['buy', 'sell'].includes(direction)) return res.status(400).json({ error: 'Invalid direction' });
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum trade is $10' });
  const margin = parseFloat((amount / leverage).toFixed(2));
  if (margin > user.balance) return res.status(400).json({ error: 'Insufficient margin' });
  const trade = { id: uuidv4(), userId, type: 'forex', pair, direction, amount: parseFloat(amount), leverage, margin, entryPrice: prices[pair], currentPrice: prices[pair], stopLoss: parseFloat(stopLoss)||null, takeProfit: parseFloat(takeProfit)||null, pnl: 0, status: 'open', openedAt: new Date().toISOString() };
  db.trades.push(trade);
  res.json({ success: true, trade });
});

app.post('/api/trade/close/:tradeId', (req, res) => {
  const trade = db.trades.find(t => t.id === req.params.tradeId);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (trade.status !== 'open') return res.status(400).json({ error: 'Trade already closed' });
  const owner = db.users[trade.userId];
  if (!owner) return res.status(404).json({ error: 'Trade owner not found' });
  const exitPrice = prices[trade.pair];
  const diff = trade.direction === 'buy' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
  const pnl = parseFloat((diff * trade.amount * trade.leverage).toFixed(2));
  trade.status = 'closed'; trade.exitPrice = exitPrice; trade.pnl = pnl; trade.closedAt = new Date().toISOString();
  owner.balance = parseFloat((owner.balance + pnl).toFixed(2));
  res.json({ success: true, trade, pnl, newBalance: owner.balance });
});

const BINARY_DIRECTIONS = {
  rise_fall: ['call', 'put'],
  over_under: ['over', 'under'],
  matches_differs: ['matches', 'differs'],
  even_odd: ['even', 'odd']
};

app.post('/api/trade/binary', (req, res) => {
  const { userId = 'demo-user-1', pair, contractType = 'rise_fall', direction, prediction, stake, expiryMinutes = 15, payoutPercent = 85 } = req.body;
  const user = db.users[userId];
  if (!user) return res.status(404).json({ error: 'User not found. Please log in again.' });
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
  if (!stake || stake < 10) return res.status(400).json({ error: 'Minimum stake is $10' });
  if (stake > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  user.balance = parseFloat((user.balance - parseFloat(stake)).toFixed(2));
  const payout = parseFloat((stake * (1 + payoutPercent / 100)).toFixed(2));
  const option = { id: uuidv4(), userId, type: 'binary', pair, contractType, direction, prediction: digitPrediction, stake: parseFloat(stake), payout, payoutPercent, entryPrice: prices[pair], entryDigit: lastDigitOf(pair, prices[pair]), exitPrice: null, expiryMinutes, expiresAt: Date.now() + expiryMinutes * 60 * 1000, status: 'open', openedAt: new Date().toISOString(), settledAt: null };
  db.binaryOptions.push(option);
  res.json({ success: true, option, newBalance: user.balance });
});

app.get('/api/trades/:userId', (req, res) => {
  const userId = req.params.userId;
  const forex = db.trades.filter(t => t.userId === userId).map(t => {
    if (t.status === 'open') { const d = t.direction === 'buy' ? prices[t.pair] - t.entryPrice : t.entryPrice - prices[t.pair]; t.currentPrice = prices[t.pair]; t.pnl = parseFloat((d * t.amount * t.leverage).toFixed(2)); }
    return t;
  });
  const binary = db.binaryOptions.filter(t => t.userId === userId).map(o => ({ ...o, currentPrice: prices[o.pair], timeLeft: Math.max(0, o.expiresAt - Date.now()) }));
  res.json({ forex, binary });
});

app.get('/api/transactions/:userId', (req, res) => {
  res.json(db.transactions.filter(t => t.userId === req.params.userId).reverse());
});

app.get('/api/stats/:userId', (req, res) => {
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

app.listen(PORT, () => {
  console.log(`\n🚀 AlphaFX Trading Platform`);
  console.log(`   Landing Page:   http://localhost:${PORT}`);
  console.log(`   Sign In:        http://localhost:${PORT}/login`);
  console.log(`   Register:       http://localhost:${PORT}/register`);
  console.log(`   Trading App:    http://localhost:${PORT}/app`);
  console.log(`   Admin Panel:    http://localhost:${PORT}/admin`);
  console.log(`   Admin credentials are not printed here — see your team's secure credential store.\n`);
});
