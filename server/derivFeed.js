// ─── Deriv live price feed ────────────────────────────────────────────────
// One outbound connection to Deriv's public WebSocket API, fanned out into
// the server's in-memory `prices` object. `active_symbols` tells us which
// of our candidate symbol codes actually exist before we subscribe to
// anything — a renamed/delisted symbol is skipped, not guessed at. Ticks
// then update `prices[pair]` directly and stamp `lastTickAt[pair]` so
// index.js's simulator (updatePrices) knows to leave that pair alone while
// live data is flowing, and only fall back to the random walk once a pair
// goes quiet.
//
// The same `active_symbols` response also carries Deriv's full instrument
// catalog (every market Deriv lists — Forex, Derived/Synthetic Indices,
// Stock Indices, Commodities, Cryptocurrencies), which we cache verbatim
// and hand to index.js via `onCatalog` for the "Live Deriv Markets" browser.
// That catalog is read-only reference data — we don't subscribe ticks for
// all ~100+ of those symbols, only for the tradable candidates below.
const WebSocket = require('ws');

const DERIV_WS_URL = process.env.DERIV_WS_URL || 'wss://ws.derivws.com/websockets/v3';
const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';

// Our pair name -> Deriv's symbol code. Only used as a lookup table; the
// live active_symbols response is the actual source of truth. Names match
// Deriv's own display_name exactly so prices, dropdowns and settlement all
// speak the same vocabulary Deriv does.
const SYMBOL_CANDIDATES = {
  'EUR/USD': 'frxEURUSD',
  'GBP/USD': 'frxGBPUSD',
  'USD/JPY': 'frxUSDJPY',
  'USD/CHF': 'frxUSDCHF',
  'AUD/USD': 'frxAUDUSD',
  'USD/CAD': 'frxUSDCAD',
  'XAU/USD': 'frxXAUUSD',
  'BTC/USD': 'cryBTCUSD',
  'ETH/USD': 'cryETHUSD',
  // Deriv's synthetic Volatility Indices — the actual underlyings Deriv
  // offers Digits contracts (Over/Under, Matches/Differs, Even/Odd) on.
  'Volatility 10 Index': 'R_10',
  'Volatility 25 Index': 'R_25',
  'Volatility 50 Index': 'R_50',
  'Volatility 75 Index': 'R_75',
  'Volatility 100 Index': 'R_100'
};

const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 30000;
const CATALOG_REFRESH_MS = 30000;

function startDerivFeed({ prices, lastTickAt, onTick, onCatalog }) {
  let ws = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let symbolToPair = {};
  let catalogTimer = null;

  const url = `${DERIV_WS_URL}?app_id=${DERIV_APP_ID}`;

  function requestSymbols() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ active_symbols: 'full' }));
    }
  }

  function connect() {
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log('[deriv] connected:', DERIV_WS_URL);
      reconnectDelay = RECONNECT_MIN_MS;
      requestSymbols();
      clearInterval(catalogTimer);
      catalogTimer = setInterval(requestSymbols, CATALOG_REFRESH_MS);
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.error) {
        console.error('[deriv] api error:', msg.error.message || msg.error.code || msg.error);
        return;
      }

      if (msg.msg_type === 'active_symbols') {
        const list = msg.active_symbols || [];

        // Full catalog, exactly as Deriv presents it — every market/submarket,
        // handed off untouched for the read-only "Live Deriv Markets" browser.
        if (onCatalog) {
          onCatalog(list.map(s => ({
            symbol: s.symbol,
            pair: s.display_name,
            market: s.market,
            marketDisplay: s.market_display_name,
            submarket: s.submarket,
            submarketDisplay: s.submarket_display_name,
            pip: parseFloat(s.pip),
            exchangeOpen: !!s.exchange_is_open,
            spot: s.spot !== undefined ? parseFloat(s.spot) : null
          })));
        }

        // Tradable subset: only subscribe ticks for our known candidates,
        // and only once Deriv confirms the symbol code is actually live.
        symbolToPair = {};
        const bySymbol = new Map(list.map(s => [s.symbol, s]));
        Object.entries(SYMBOL_CANDIDATES).forEach(([pair, symbol]) => {
          const entry = bySymbol.get(symbol);
          if (!entry) {
            console.warn(`[deriv] symbol ${symbol} (${pair}) not found in active_symbols, skipping`);
            return;
          }
          symbolToPair[symbol] = pair;
          if (prices[pair] === undefined && Number.isFinite(parseFloat(entry.spot))) {
            prices[pair] = parseFloat(entry.spot);
          }
          ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        });
        return;
      }

      if (msg.msg_type === 'tick' && msg.tick) {
        const pair = symbolToPair[msg.tick.symbol];
        if (!pair) return;
        const quote = parseFloat(msg.tick.quote);
        if (!Number.isFinite(quote)) return;
        prices[pair] = quote;
        lastTickAt[pair] = Date.now();
        if (onTick) onTick(pair, quote);
      }
    });

    ws.on('close', () => { clearInterval(catalogTimer); scheduleReconnect(); });
    ws.on('error', (err) => {
      console.error('[deriv] socket error:', err.message);
      ws.close();
    });
  }

  function scheduleReconnect() {
    console.log(`[deriv] disconnected, retrying in ${reconnectDelay}ms`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  connect();
}

module.exports = { startDerivFeed, SYMBOL_CANDIDATES };
