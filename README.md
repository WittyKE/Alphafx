# AlphaFX — Forex & Binary Options Trading Platform

A full demo trading platform with live price simulation, binary options, portfolio tracking, and an admin-ready REST API backend.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
cd alphafx
npm install
```

### 2. Run the server
```bash
npm start
```

### 3. Open in browser
```
http://localhost:3000
```

---

## 📁 Project Structure

```
alphafx/
├── server/
│   └── index.js          ← Express REST API (port 3000)
├── public/
│   ├── index.html        ← Main SPA entry point
│   ├── css/
│   │   └── main.css      ← Full dark/light theme
│   └── js/
│       └── app.js        ← Frontend logic & API calls
└── package.json
```

---

## 🔌 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Create a real account (hashed password, $10,000 demo balance) |
| POST | `/api/login` | Sign in with email + password |
| POST | `/api/password-reset/request` | Request a one-time reset code |
| POST | `/api/password-reset/confirm` | Confirm code + set a new password |
| GET | `/api/prices` | Live simulated prices for all pairs |
| GET | `/api/user/:id` | User profile + balance (no password data) |
| POST | `/api/deposit` | Add funds (demo) |
| POST | `/api/withdraw` | Request withdrawal |
| POST | `/api/trade/forex` | Open a forex trade |
| POST | `/api/trade/close/:id` | Close a forex trade |
| POST | `/api/trade/binary` | Place a binary option |
| GET | `/api/trades/:userId` | All open/closed trades |
| GET | `/api/stats/:userId` | Portfolio stats & P&L |
| GET | `/api/transactions/:userId` | Deposit/withdrawal history |

### Admin API (requires `x-admin-token` header)
| Method | Endpoint | Who |
|--------|----------|-----|
| POST | `/api/admin/login` | Anyone with valid admin credentials |
| GET | `/api/admin/me` | Any admin |
| GET / POST | `/api/admin/users`, `/api/admin/transactions`, `/api/admin/logs`, etc. | Any admin |
| GET / POST / DELETE | `/api/admin/admins...` | **Superuser only** — create, suspend, reset password, or delete other admins |

---

## 📊 Features

- **Real accounts** — Registration and login are backed by the server (bcrypt-hashed passwords); every new signup gets its own $10,000 demo balance and trades independently, just like the seeded demo users
- **Live price feed** — Simulated tick-by-tick prices for 9 pairs (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, XAU/USD, BTC/USD, ETH/USD)
- **Forex trading** — Buy/Sell with configurable leverage (1:10 to 1:200), stop loss & take profit
- **Binary options** — Call/Put with 1min to 1hr expiry, 75–85% payout, auto-settlement
- **Live P&L** — Positions update in real time as prices move
- **Portfolio chart** — Balance history plotted live
- **Deposit/Withdraw** — Card, Bank, Crypto, M-Pesa (demo mode; wire up real payment APIs)
- **Transaction history** — Full ledger of deposits & withdrawals
- **Help Center** — In-app FAQ accordion plus support contact details (email, WhatsApp, Telegram, phone)
- **Tiered admin system** — A hidden superuser manages every other admin (create, suspend, reset password, delete); regular admins handle day-to-day operations only
- **Light/Dark theme** — Toggle in Settings
- **Mobile responsive** — Sidebar collapses on small screens

---

## 🔧 Going Live (Checklist)

### Replace the price feed
In `server/index.js`, replace `updatePrices()` with a real broker WebSocket or REST feed:
```js
// Example: OANDA streaming API
// wss://stream-fxtrade.oanda.com/v3/accounts/{id}/pricing/stream
```

### Add real payments
- **M-Pesa & Card**: [Paystack](https://paystack.com) — one Kenya (KES) account covers both: M-Pesa via its Charge API (STK push), cards via Paystack Standard (hosted checkout redirect) for fresh cards plus the Charge API's authorization_code for saved-card replays — raw-card charging via the Charge API's `card` object was tried first but needs a separate PCI DSS AOC approval from Paystack, so Standard is used instead. No separate Safaricom Daraja registration needed. See `PAYSTACK_*` in `.env.example`.
  - Money collected via Paystack lands in your Paystack balance and is *settled* (paid out) to whatever bank account is registered on your Paystack dashboard — this isn't a code/`.env` setting. Register your bank there: **Dashboard → Settings → Preferences → Bank Account**.
- **Crypto**: [Binance Pay](https://merchant.binance.com) or [NOWPayments](https://nowpayments.io)

### Add a real database
Replace the in-memory `db` object in `server/index.js` with:
- **MongoDB**: `npm install mongoose`
- **PostgreSQL**: `npm install pg` + `sequelize`
- **SQLite** (simple): `npm install better-sqlite3`

### Send real emails/SMS for password resets
`/api/password-reset/request` currently returns the one-time code directly in
the API response (and the UI displays it) because no email/SMS provider is
connected. Before going live, wire this up to a real provider (e.g. SendGrid,
Africa's Talking) and stop returning the code in the response.

### Connect a real email/SMS provider for support too
The Help Center's contact details (email, WhatsApp, Telegram, phone) in
`public/index.html` are placeholders — replace them with your real channels.

### Rotate admin credentials
Admin and superuser passwords are hashed with bcrypt and seeded in
`server/index.js` via `seedAdmin(...)` calls (with optional `SUPERADMIN_USERNAME`
/ `SUPERADMIN_PASSWORD` environment variable overrides). Change the seeded
passwords — or better, set the environment variables — before deploying
anywhere public.

### Get licensed
- Kenya: Apply to the **Capital Markets Authority (CMA)**
- Binary options are regulated — check laws in your target markets before enabling real money trading

---

## 🛠 Development Mode (auto-restart)

```bash
npm run dev
```
*(requires `nodemon` — installed automatically via `npx`)*

---

## 📝 Default Demo Account

- **Email**: `john@example.com`
- **Password**: `Demo1234!`
- **Starting balance**: $10,000 (simulated)
- **Name**: John Doe

Three more seeded demo users (`jane@example.com`, `michael@example.com`,
`aisha@example.com`) share the same password and are visible in the admin
panel for testing user management features.

Anyone can also create a brand-new account from the Registration page —
it's stored on the server exactly like the accounts above, with its own
$10,000 demo balance.

---

## 🔐 Admin Accounts

The admin panel (`/admin`) now supports multiple admins with two roles:

- **Superuser** (`root`) — manages every other admin: create, suspend,
  reactivate, reset password, and delete. The superuser does not appear in
  the regular admin list and cannot be deleted or suspended through the API.
- **Admin** — day-to-day operations (users, transactions, withdrawals,
  activity log). Three regular admins are seeded for testing.

No admin credentials are displayed anywhere in the UI or printed to the
server console — they're hashed with bcrypt in `server/index.js`. The
superuser's username/password can be overridden with the
`SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` environment variables. Ask
whoever set up this project for the seeded login details, or use the
superuser account to create your own admin and rotate the rest.

---

Built with Node.js + Express + Chart.js + Vanilla JS.
