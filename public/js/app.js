/* ── Config ─────────────────────────────────────────────────── */
const API = window.location.origin + '/api';
let USER_ID = 'demo-user-1';

/* ── State ──────────────────────────────────────────────────── */
let state = {
  prices: {},
  balance: 10000,
  trades: { forex: [], binary: [] },
  fxDir: 'buy',
  binDir: 'call',
  contractType: 'rise_fall',
  selectedMarketType: 'rise_fall',
  binDigit: 5,
  binaryChart: null,
  portfolioChart: null,
  priceHistory: {},
  tickInterval: null,
  tradeInterval: null,
  balanceHistory: [],
  currentView: 'dashboard',
  smartDuration: '24h',
  smartInvestments: [],
  dash: {
    chart: null,
    series: null,
    initialized: false,
    timeframe: '1m',
    bucketMs: { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1D': 86400000 },
    candles: {}
  },
  mt: {
    pair: 'EUR/USD',
    timeframe: 'H1',
    chart: null,
    series: null,
    chartType: 'candlestick',
    watchlistFilter: '',
    initialized: false,
    candles: {},
    bucketMs: { M1: 60000, M5: 300000, M15: 900000, M30: 1800000, H1: 3600000, H4: 14400000, D1: 86400000, W1: 604800000, MN: 2592000000 },
    tool: 'cursor',
    pendingPoint: null,
    drawCanvas: null,
    drawCtx: null,
    drawings: {},
    activePriceLines: [],
    indicators: {
      sma20: { active: false, series: null, period: 20, type: 'sma', color: '#38bdf8' },
      sma50: { active: false, series: null, period: 50, type: 'sma', color: '#f59e0b' },
      ema20: { active: false, series: null, period: 20, type: 'ema', color: '#a855f7' },
      ema50: { active: false, series: null, period: 50, type: 'ema', color: '#22c55e' }
    },
    alerts: []
  },
  bt: {
    open: false,
    chart: null,
    series: null,
    chartType: 'candlestick',
    candles: {},
    barMs: 60000,
    tool: 'cursor',
    pendingPoint: null,
    previewPoint: null,
    drawCanvas: null,
    drawCtx: null,
    drawings: {},
    activePriceLines: [],
    indicators: {
      sma20: { active: false, series: null, period: 20, type: 'sma', color: '#38bdf8' },
      sma50: { active: false, series: null, period: 50, type: 'sma', color: '#f59e0b' },
      ema20: { active: false, series: null, period: 20, type: 'ema', color: '#a855f7' },
      ema50: { active: false, series: null, period: 50, type: 'ema', color: '#22c55e' }
    }
  }
};

const BT_INDICATOR_LABELS = { sma20: 'SMA 20', sma50: 'SMA 50', ema20: 'EMA 20', ema50: 'EMA 50' };
const BT_DURATION_BOUNDS = { t: [1, 10], s: [15, 59], m: [1, 1440], h: [1, 24], d: [1, 365] };
const BT_HOWTO_TEXT = {
  rise_fall: 'Predict whether the market price will be higher (Rise) or lower (Fall) than the entry spot at expiry. If you select "Allow equals", you also win when the exit spot is exactly equal to the entry spot.',
  over_under: 'Predict whether the last digit of the final price will be over or under a chosen digit (0–9).',
  matches_differs: 'Predict whether the last digit of the final price will match or differ from a chosen digit (0–9).',
  even_odd: 'Predict whether the last digit of the final price will be even or odd.',
  higher_lower: 'Predict whether the market price will be higher or lower than a barrier you choose at expiry.',
  accumulators: 'Your payout grows by a fixed percentage every tick the price stays inside a range — the longer it stays in range, the bigger the payout.',
  multipliers: 'Multiply your position\'s exposure to price movements without an expiry — profit or loss is magnified by the multiplier you choose.',
  touch_no_touch: 'Predict whether the market price will touch (Touch) or never touch (No Touch) a barrier before expiry.',
  vanillas: 'Buy a call or put with a strike price and expiry you choose — works like a traditional option.',
  turbos: 'A leveraged contract that ends automatically if the price touches a barrier — offers higher potential payouts for the same stake.'
};

const MT_INDICATOR_LABELS = { sma20: 'SMA 20', sma50: 'SMA 50', ema20: 'EMA 20', ema50: 'EMA 50' };
const SMART_DURATION_LABELS = { '24h': '24 Hours', '72h': '72 Hours', '1w': '1 Week' };

const MT_PAIR_NAMES = {
  'EUR/USD': 'Euro vs US Dollar',
  'GBP/USD': 'British Pound vs US Dollar',
  'USD/JPY': 'US Dollar vs Japanese Yen',
  'USD/CHF': 'US Dollar vs Swiss Franc',
  'AUD/USD': 'Australian Dollar vs US Dollar',
  'USD/CAD': 'US Dollar vs Canadian Dollar',
  'XAU/USD': 'Gold vs US Dollar',
  'BTC/USD': 'Bitcoin vs US Dollar',
  'ETH/USD': 'Ethereum vs US Dollar',
  'Volatility 10 Index': 'Deriv Synthetic Index',
  'Volatility 25 Index': 'Deriv Synthetic Index',
  'Volatility 50 Index': 'Deriv Synthetic Index',
  'Volatility 75 Index': 'Deriv Synthetic Index',
  'Volatility 100 Index': 'Deriv Synthetic Index'
};

/* ── Init ───────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  await fetchConfig();
  await fetchCryptoWallets();
  await fetchPrices();
  await fetchStats();
  await fetchTrades();
  await fetchSmartInvestments();
  buildBinaryAssetSelect();
  loadDerivMarketCatalog();
  buildTicker();
  buildSidePrices();
  initMainChart();
  updateForexCalc();
  updateBinaryCalc();
  updateSmartCalc();

  // Price update speed is an admin-managed platform setting (see the
  // superadmin Platform Settings panel) — re-checking /api/config
  // periodically means a change there reaches every open session without
  // requiring a page reload. fetchConfig() above already applied it once.
  state.configInterval = setInterval(fetchConfig, 30000);

  state.tradeInterval = setInterval(async () => {
    await fetchTrades();
    await fetchStats();
    await fetchSmartInvestments();
  }, 5000);

  state.smartValueInterval = setInterval(updateSmartLiveValues, 400);
  state.derivCatalogInterval = setInterval(loadDerivMarketCatalog, 30000);
  state.btClockInterval = setInterval(updateBtFooterClock, 1000);

  connectPriceSocket();
});

/* ── Live price refresh ─────────────────────────────────────────────
   Shared by the /api/prices poll above and the push updates from the
   /ws/prices socket below, so both paths drive the same UI refresh. ── */
function refreshLiveUI() {
  updateTicker();
  updateSidePrices();
  updateCharts();
  updateOpenPositions();
  updateBinaryTimers();
  updateSmartTimers();
  checkMtAlerts();
  if (state.currentView === 'forex') {
    renderMtWatchlistRows();
    updateMtLiveCandle();
    mtExecUpdateDisplays();
  }
  if (state.currentView === 'binary') {
    updateDigitStrip();
    renderDigitPad();
    updateDerivMarketPrices();
  }
  if (state.bt.open) {
    updateBtLiveCandle();
    updateBtSymbolHeader();
    updateBtCalc();
    updateBtAccountInfo();
  }
}

function applyPriceUpdate(newPrices) {
  state.prices = newPrices;
  Object.entries(newPrices).forEach(([pair, price]) => {
    if (!state.priceHistory[pair]) state.priceHistory[pair] = [];
    state.priceHistory[pair].push(price);
    if (state.priceHistory[pair].length > 80) state.priceHistory[pair].shift();
  });
}

/* ── Live price WebSocket ───────────────────────────────────────────
   Pushes ticks the instant the server has them (Deriv feed or the
   fallback simulator) instead of waiting out the next 1.5s poll above.
   The poll stays in place as the resync/fallback path if the socket
   drops or never connects. ── */
let priceSocket = null;
let priceSocketRetryMs = 2000;

function connectPriceSocket() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/prices';
  priceSocket = new WebSocket(url);

  priceSocket.onopen = () => { priceSocketRetryMs = 2000; };

  priceSocket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type !== 'prices' || !msg.prices) return;
    applyPriceUpdate(msg.prices);
    refreshLiveUI();
  };

  priceSocket.onclose = () => {
    setTimeout(connectPriceSocket, priceSocketRetryMs);
    priceSocketRetryMs = Math.min(priceSocketRetryMs * 2, 30000);
  };
  priceSocket.onerror = () => priceSocket.close();
}

/* ── API ────────────────────────────────────────────────────── */
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(API + path, opts);
    return await res.json();
  } catch (e) {
    console.error('API error:', path, e);
    return null;
  }
}

async function fetchPrices() {
  const data = await api('/prices');
  if (!data) return;
  applyPriceUpdate(data.prices);
}

async function fetchStats() {
  const data = await api(`/stats/${USER_ID}`);
  if (!data) return;
  state.balance = data.balance;
  state.balanceHistory.push(data.balance);
  if (state.balanceHistory.length > 60) state.balanceHistory.shift();

  document.getElementById('header-balance').textContent = '$' + fmt(data.balance);
  const pnl = data.totalPnl;
  const pnlEl = document.getElementById('stat-pnl');
  if (pnlEl) {
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + fmt(Math.abs(pnl));
    pnlEl.className = 'stat-val ' + (pnl >= 0 ? 'up' : 'down');
  }
  const pct = ((pnl / 10000) * 100).toFixed(2);
  const pctEl = document.getElementById('stat-pnl-pct');
  if (pctEl) pctEl.textContent = (pnl >= 0 ? '+' : '') + pct + '% return';

  const openEl = document.getElementById('stat-open');
  if (openEl) openEl.textContent = data.openForex + data.openBinary;
  const openSub = document.getElementById('stat-open-sub');
  if (openSub) openSub.textContent = `${data.openForex} Forex · ${data.openBinary} Binary`;

  const winEl = document.getElementById('stat-win');
  if (winEl) winEl.textContent = data.winRate ? data.winRate + '%' : '—';

  const portBal = document.getElementById('port-balance');
  if (portBal) portBal.textContent = '$' + fmt(data.balance);
  const portRet = document.getElementById('port-return');
  if (portRet) {
    const r = ((data.balance - 10000) / 100).toFixed(2);
    portRet.textContent = (r >= 0 ? '+' : '') + r + '%';
    portRet.className = 'stat-val ' + (r >= 0 ? 'up' : 'down');
  }

  const bsActive = document.getElementById('bs-active');
  if (bsActive) bsActive.textContent = data.openBinary;

  const stBal = document.getElementById('st-balance');
  if (stBal) stBal.textContent = '$' + fmt(data.balance);
}

async function fetchSmartInvestments() {
  const data = await api(`/investments/${USER_ID}`);
  if (!data) return;
  state.smartInvestments = data;
  renderSmartInvestments();
}

async function fetchTrades() {
  const data = await api(`/trades/${USER_ID}`);
  if (!data) return;
  state.trades = data;
  renderOpenPositions();
  renderBinaryPositions();
  renderPortfolioTrades();
  renderMtPositions();
  updateMtAccountFooter();
}

/* ── Ticker ─────────────────────────────────────────────────── */
const TICKER_PAIRS = ['EUR/USD','GBP/USD','USD/JPY','XAU/USD','BTC/USD'];

function buildTicker() {
  const el = document.getElementById('ticker');
  el.innerHTML = TICKER_PAIRS.map(p => `
    <div class="tick-item" id="tick-${p.replace('/','_')}">
      <div class="tick-pair">${p}</div>
      <div class="tick-price">${fmtPrice(p, state.prices[p] || 0)}</div>
      <div class="tick-chg up">—</div>
    </div>
  `).join('');
}

function updateTicker() {
  TICKER_PAIRS.forEach(p => {
    const id = 'tick-' + p.replace('/','_');
    const el = document.getElementById(id);
    if (!el) return;
    const hist = state.priceHistory[p] || [];
    const cur = hist[hist.length - 1] || 0;
    const prev = hist[hist.length - 2] || cur;
    const chg = prev ? ((cur - prev) / prev * 100) : 0;
    el.querySelector('.tick-price').textContent = fmtPrice(p, cur);
    const chgEl = el.querySelector('.tick-chg');
    chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    chgEl.className = 'tick-chg ' + (chg >= 0 ? 'up' : 'down');
  });

  // Update main price display
  const eur = state.prices['EUR/USD'];
  if (eur) {
    const hist = state.priceHistory['EUR/USD'] || [];
    const prev = hist[hist.length - 2] || eur;
    const diff = eur - prev;
    const pct = prev ? (diff / prev * 100) : 0;
    const dp = document.getElementById('dash-price');
    const dc = document.getElementById('dash-change');
    const db = document.getElementById('dash-bid');
    const da = document.getElementById('dash-ask');
    if (dp) dp.textContent = eur.toFixed(5);
    if (dc) {
      dc.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(5) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)';
      dc.className = 'price-change ' + (diff >= 0 ? 'up' : 'down');
    }
    if (db) db.textContent = (eur - 0.00002).toFixed(5);
    if (da) da.textContent = (eur + 0.00002).toFixed(5);
  }
}

function buildSidePrices() {
  const el = document.getElementById('side-prices');
  if (!el) return;
  el.innerHTML = '<div class="section-title" style="margin:0 0 8px">Live Prices</div>' +
    Object.keys(state.prices).slice(0,7).map(p => `
      <div class="side-price-item" id="sp-${p.replace('/','_')}">
        <span class="sp-pair">${p}</span>
        <span class="sp-price">${fmtPrice(p, state.prices[p])}</span>
      </div>
    `).join('');
}

function updateSidePrices() {
  Object.entries(state.prices).forEach(([p, price]) => {
    const el = document.getElementById('sp-' + p.replace('/','_'));
    if (el) el.querySelector('.sp-price').textContent = fmtPrice(p, price);
  });
}

/* ── Charts ─────────────────────────────────────────────────── */
function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: { ticks: { color: '#4a6080', font: { size: 11 } }, grid: { color: '#1e2a45' } }
    }
  };
}

// Dashboard always renders the EUR/USD chart as candlesticks (lightweight-charts),
// matching the Forex terminal rather than a Chart.js line chart.
function initMainChart() {
  if (!window.LightweightCharts) return;
  const container = document.getElementById('main-chart');
  if (!container) return;

  if (!state.dash.chart) {
    const cs = getComputedStyle(document.body);
    const textMuted = cs.getPropertyValue('--text-muted').trim();
    const borderColor = cs.getPropertyValue('--border').trim();
    state.dash.chart = LightweightCharts.createChart(container, {
      layout: { background: { color: 'transparent' }, textColor: textMuted },
      grid: { vertLines: { color: borderColor }, horzLines: { color: borderColor } },
      timeScale: { timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });
    state.dash.series = state.dash.chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444'
    });
    new ResizeObserver(() => {
      if (!state.dash.chart) return;
      state.dash.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    }).observe(container);
  }
  if (!state.dash.initialized) {
    state.dash.initialized = true;
    synthesizeDashCandles();
  }
}

function synthesizeDashCandles() {
  const pair = 'EUR/USD';
  const price = state.prices[pair];
  if (!price || !state.dash.series) return;

  const timeframe = state.dash.timeframe;
  const bucketMs = state.dash.bucketMs[timeframe];
  const tickStep = 0.0003; // matches server's per-tick volatility fraction
  const ticksPerBar = Math.max(1, bucketMs / 1500);
  const barVol = Math.max(price * 0.00001, price * tickStep * Math.sqrt(ticksPerBar));
  const bars = 150;
  const barStart = Math.floor(Date.now() / bucketMs) * bucketMs;

  const closes = new Array(bars);
  closes[bars - 1] = price;
  for (let i = bars - 2; i >= 0; i--) {
    closes[i] = closes[i + 1] - (Math.random() - 0.5) * barVol;
  }

  const out = [];
  for (let i = 0; i < bars; i++) {
    const time = Math.floor((barStart - (bars - 1 - i) * bucketMs) / 1000);
    const open = i === 0 ? closes[0] - (Math.random() - 0.5) * barVol * 0.5 : closes[i - 1];
    const close = closes[i];
    const hi = Math.max(open, close) + Math.random() * barVol * 0.4;
    const lo = Math.min(open, close) - Math.random() * barVol * 0.4;
    out.push({ time, open: mtRound(pair, open), high: mtRound(pair, hi), low: mtRound(pair, lo), close: mtRound(pair, close) });
  }

  state.dash.candles[timeframe] = out;
  state.dash.series.setData(out);
}

function updateDashLiveCandle() {
  if (!state.dash.series) return;
  const pair = 'EUR/USD';
  const timeframe = state.dash.timeframe;
  const price = state.prices[pair];
  if (!price) return;
  const bars = state.dash.candles[timeframe];
  if (!bars || !bars.length) return;

  const bucketMs = state.dash.bucketMs[timeframe];
  const barTime = Math.floor(Date.now() / bucketMs) * bucketMs / 1000;
  const last = bars[bars.length - 1];

  if (barTime === last.time) {
    last.close = mtRound(pair, price);
    last.high = Math.max(last.high, last.close);
    last.low = Math.min(last.low, last.close);
    state.dash.series.update(last);
  } else if (barTime > last.time) {
    const bar = { time: barTime, open: last.close, high: mtRound(pair, price), low: mtRound(pair, price), close: mtRound(pair, price) };
    bars.push(bar);
    if (bars.length > 300) bars.shift();
    state.dash.series.update(bar);
  }
}

// ── Deriv-style tick chart plugin ───────────────────────────────────
// Draws the floating current-price tag and the dashed entry/barrier line
// straight onto the canvas — the two details that make a chart read as
// Deriv's own trade-ticket chart rather than a generic line chart.
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const derivTickPlugin = {
  id: 'derivTick',
  afterDraw(chart) {
    const opts = (chart.config.options.plugins && chart.config.options.plugins.derivTick) || {};
    const data = chart.data.datasets[0].data;
    if (!data.length) return;
    const { ctx, chartArea, scales } = chart;
    const last = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : last;
    const up = last >= prev;
    const color = up ? '#22c55e' : '#ef4444';
    const y = Math.min(Math.max(scales.y.getPixelForValue(last), chartArea.top), chartArea.bottom);
    const fmt = opts.formatPrice || (p => p.toFixed(2));

    if (opts.entryPrice != null) {
      const ey = scales.y.getPixelForValue(opts.entryPrice);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, ey);
      ctx.lineTo(chartArea.right, ey);
      ctx.stroke();
      ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('Entry ' + fmt(opts.entryPrice), chartArea.left + 4, ey - 4);
      ctx.restore();
    }

    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = fmt(last);
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    const textW = ctx.measureText(label).width;
    const padX = 6, tagH = 18, tagW = textW + padX * 2;
    const tagX = chartArea.right + 4;
    const tagY = y - tagH / 2;
    ctx.fillStyle = color;
    roundRectPath(ctx, tagX, tagY, tagW, tagH, 4);
    ctx.fill();
    ctx.fillStyle = '#0b0f16';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tagX + padX, y + 0.5);
    ctx.restore();
  }
};

function initBinaryChartView() {
  const ctx = document.getElementById('binary-chart');
  if (!ctx || state.binaryChart) return;
  const pair = currentBinaryPair();
  const hist = state.priceHistory[pair] || [];
  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, 'rgba(20,184,166,0.22)');
  gradient.addColorStop(1, 'rgba(20,184,166,0)');
  state.binaryChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hist.map((_, i) => i),
      datasets: [{
        data: hist,
        borderColor: '#14b8a6',
        borderWidth: 1.5,
        pointRadius: hist.map((_, i) => i === hist.length - 1 ? 3 : 0),
        pointBackgroundColor: '#14b8a6',
        pointBorderColor: '#0b0f16',
        pointBorderWidth: 1.5,
        pointHoverRadius: 0,
        fill: true,
        backgroundColor: gradient,
        tension: 0,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      layout: { padding: { right: 64, top: 8, bottom: 4 } },
      plugins: {
        legend: { display: false },
        derivTick: { entryPrice: null, formatPrice: p => fmtPrice(pair, p) }
      },
      scales: {
        x: { display: false },
        y: {
          position: 'right',
          grid: { color: 'rgba(255,255,255,0.05)', drawTicks: false },
          border: { display: false },
          ticks: { color: '#4a6080', font: { size: 10 }, maxTicksLimit: 4, padding: 6 }
        }
      }
    },
    plugins: [derivTickPlugin]
  });
  updateBinaryChartHeader();
}

function updateBinaryChartHeader() {
  const pair = currentBinaryPair();
  const pairEl = document.getElementById('bcp-pair');
  const priceEl = document.getElementById('bcp-price');
  if (pairEl) pairEl.textContent = pair;
  if (!priceEl) return;
  const hist = state.priceHistory[pair] || [];
  const last = hist[hist.length - 1];
  if (last === undefined) return;
  const prev = hist[hist.length - 2];
  priceEl.textContent = fmtPrice(pair, last);
  priceEl.classList.toggle('up', prev !== undefined && last >= prev);
  priceEl.classList.toggle('down', prev !== undefined && last < prev);
}

function initPortfolioChart() {
  const ctx = document.getElementById('portfolio-chart');
  if (!ctx || state.portfolioChart) return;
  const data = state.balanceHistory.length > 1 ? state.balanceHistory : [10000, state.balance];
  state.portfolioChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map((_,i) => i),
      datasets: [{
        data,
        borderColor: '#22c55e',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        backgroundColor: 'rgba(34,197,94,0.07)',
        tension: 0.4
      }]
    },
    options: chartDefaults()
  });
}

function updateCharts() {
  if (state.dash.series) updateDashLiveCandle();
  if (state.binaryChart) {
    const pair = currentBinaryPair();
    const binHist = state.priceHistory[pair] || [];
    const ds = state.binaryChart.data.datasets[0];
    state.binaryChart.data.labels = binHist.map((_, i) => i);
    ds.data = [...binHist];
    ds.pointRadius = binHist.map((_, i) => i === binHist.length - 1 ? 3 : 0);
    ds.pointBackgroundColor = binHist.map((v, i) => {
      if (i !== binHist.length - 1) return '#14b8a6';
      const prev = binHist[i - 1];
      return prev !== undefined && v < prev ? '#ef4444' : '#22c55e';
    });
    const openOpt = state.trades.binary.find(t => t.status === 'open' && t.pair === pair);
    state.binaryChart.options.plugins.derivTick.entryPrice = openOpt ? openOpt.entryPrice : null;
    state.binaryChart.options.plugins.derivTick.formatPrice = p => fmtPrice(pair, p);
    state.binaryChart.update('none');
    updateBinaryChartHeader();
  }
  if (state.portfolioChart) {
    const bal = state.balanceHistory;
    state.portfolioChart.data.labels = bal.map((_,i) => i);
    state.portfolioChart.data.datasets[0].data = [...bal];
    state.portfolioChart.update('none');
  }
}

/* ── Positions ──────────────────────────────────────────────── */
function renderOpenPositions() {
  const el = document.getElementById('open-positions-list');
  if (!el) return;
  const open = state.trades.forex.filter(t => t.status === 'open');
  if (!open.length && !state.trades.binary.filter(t=>t.status==='open').length) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-chart-candle"></i><p>No open positions yet. Place a trade to get started.</p></div>';
    return;
  }
  el.innerHTML = open.map(t => {
    const pnl = t.pnl || 0;
    const badgeLabel = t.kind === 'multiplier' ? `MULTIPLIER x${t.leverage} ${t.direction === 'buy' ? 'UP' : 'DOWN'}`
      : t.kind === 'accumulator' ? `ACCUMULATOR ${t.growthRate}%`
      : t.direction.toUpperCase();
    const sizeLabel = (t.kind === 'multiplier' || t.kind === 'accumulator')
      ? `Stake: $${t.amount} at risk`
      : `Size: $${t.amount} · ${t.leverage}x`;
    return `
      <div class="position-card">
        <div>
          <div class="pos-pair">${t.pair} <span class="badge badge-${t.direction}">${badgeLabel}</span></div>
          <div class="pos-detail">Entry: ${fmtPrice(t.pair, t.entryPrice)} · ${sizeLabel}</div>
        </div>
        <div style="text-align:right">
          <div class="pos-pnl ${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : ''}$${fmt(Math.abs(pnl))}</div>
          <div class="pos-actions" style="margin-top:6px">
            <button class="btn-close-pos" onclick="closeTrade('${t.id}')">Close</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function updateOpenPositions() {
  state.trades.forex.filter(t => t.status === 'open').forEach(t => {
    const cur = state.prices[t.pair];
    if (!cur) return;
    const diff = t.direction === 'buy' ? cur - t.entryPrice : t.entryPrice - cur;
    let pnl = parseFloat((diff * t.amount * t.leverage).toFixed(2));
    if (t.kind === 'multiplier' || t.kind === 'accumulator') pnl = Math.max(pnl, -t.amount);
    t.pnl = pnl;
    t.currentPrice = cur;
  });
  renderOpenPositions();
  renderMtPositions();
  updateMtAccountFooter();
}

function renderBinaryPositions() {
  const el = document.getElementById('binary-positions');
  if (!el) return;
  const open = state.trades.binary.filter(t => t.status === 'open');
  if (!open.length) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-clock"></i><p>No active binary options.</p></div>';
    const bsWon = document.getElementById('bs-won');
    const bsLost = document.getElementById('bs-lost');
    if (bsWon) bsWon.textContent = state.trades.binary.filter(t=>t.status==='won').length;
    if (bsLost) bsLost.textContent = state.trades.binary.filter(t=>t.status==='lost').length;
    return;
  }
  el.innerHTML = open.map(o => {
    const left = Math.max(0, o.expiresAt - Date.now());
    const mins = Math.floor(left / 60000);
    const secs = Math.floor((left % 60000) / 1000);
    const timer = String(mins).padStart(2,'0') + ':' + String(secs).padStart(2,'0');
    return `
      <div class="bin-card" id="bincard-${o.id}">
        <div>
          <div class="pos-pair">${o.pair} <span class="badge badge-${o.direction}">${binaryLabel(o)}</span></div>
          <div class="pos-detail">Stake: $${fmt(o.stake)} · Win: $${fmt(o.payout)}</div>
        </div>
        <div style="text-align:right">
          <div class="bin-timer" id="btimer-${o.id}">${timer}</div>
          <div class="pos-detail" style="margin-top:3px">Entry: ${fmtPrice(o.pair, o.entryPrice)}</div>
        </div>
      </div>
    `;
  }).join('');

  if (document.getElementById('bs-won')) document.getElementById('bs-won').textContent = state.trades.binary.filter(t=>t.status==='won').length;
  if (document.getElementById('bs-lost')) document.getElementById('bs-lost').textContent = state.trades.binary.filter(t=>t.status==='lost').length;
}

function updateBinaryTimers() {
  state.trades.binary.filter(t => t.status === 'open').forEach(o => {
    const el = document.getElementById('btimer-' + o.id);
    if (!el) return;
    const left = Math.max(0, o.expiresAt - Date.now());
    const mins = Math.floor(left / 60000);
    const secs = Math.floor((left % 60000) / 1000);
    el.textContent = String(mins).padStart(2,'0') + ':' + String(secs).padStart(2,'0');
  });
}

function renderPortfolioTrades() {
  const el = document.getElementById('portfolio-trades');
  if (!el) return;
  const all = [...state.trades.forex, ...state.trades.binary];
  if (!all.length) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-briefcase"></i><p>No trades yet.</p></div>';
    return;
  }
  el.innerHTML = all.map(t => {
    const isBinary = t.type === 'binary';
    const pnl = isBinary
      ? (t.status === 'won' ? t.payout - t.stake : t.status === 'lost' ? -t.stake : 0)
      : (t.pnl || 0);
    const badgeClass = `badge-${t.direction}`;
    const statusClass = t.status === 'open' ? 'badge-open' : t.status === 'won' ? 'badge-won' : t.status === 'lost' ? 'badge-lost' : 'badge-closed';
    return `
      <div class="position-card">
        <div>
          <div class="pos-pair">${t.pair} <span class="badge ${badgeClass}">${isBinary ? binaryLabel(t) : (t.direction||'').toUpperCase()}</span></div>
          <div class="pos-detail">${isBinary ? 'Binary · Stake: $'+fmt(t.stake) : 'Forex · $'+t.amount+' · '+t.leverage+'x'} · <span class="badge ${statusClass}">${t.status}</span></div>
        </div>
        <div style="text-align:right">
          <div class="pos-pnl ${pnl >= 0 ? 'up' : 'down'}">${pnl !== 0 ? (pnl >= 0 ? '+' : '') + '$' + fmt(Math.abs(pnl)) : '—'}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Forex Terminal (MT5-style) ────────────────────────────────
   Server only exposes a single live tick price per pair (no OHLC
   history anywhere). Candle history below is synthesized client-side
   as a random walk ending at the current live price, then the newest
   bar is kept in sync with real polled ticks. Left tool-rail / most
   toolbar icons are decorative (visual only, no behavior). ──────── */

function mtDecimals(pair) {
  if (pair.includes('BTC') || pair.includes('ETH')) return 2;
  if (pair.includes('XAU') || pair.includes('XAG')) return 2;
  if (pair.includes('JPY')) return 3;
  return 5;
}

function mtRound(pair, v) {
  return parseFloat(v.toFixed(mtDecimals(pair)));
}

function mtSpread(pair, price) {
  if (!price) return [0, 0];
  let s;
  if (pair.includes('BTC')) s = price * 0.0004;
  else if (pair.includes('ETH')) s = price * 0.0006;
  else if (pair.includes('XAU') || pair.includes('XAG')) s = price * 0.00015;
  else if (pair.includes('JPY')) s = 0.02;
  else s = 0.00004;
  return [mtRound(pair, price - s / 2), mtRound(pair, price + s / 2)];
}

function initForexTerminal() {
  if (!window.LightweightCharts) return;
  const container = document.getElementById('mt-chart-container');
  if (!container) return;

  if (!state.mt.chart) {
    const cs = getComputedStyle(document.body);
    const textMuted = cs.getPropertyValue('--text-muted').trim();
    const borderColor = cs.getPropertyValue('--border').trim();
    state.mt.chart = LightweightCharts.createChart(container, {
      layout: { background: { color: 'transparent' }, textColor: textMuted },
      grid: {
        vertLines: { color: borderColor },
        horzLines: { color: borderColor }
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });
    state.mt.series = state.mt.chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceLineColor: '#ef4444', priceLineWidth: 1
    });
    new ResizeObserver(() => {
      if (!state.mt.chart) return;
      state.mt.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      resizeMtDrawCanvas();
      redrawMtDrawings();
    }).observe(container);
    initMtDrawing();
  }

  if (!state.mt.initialized) {
    state.mt.initialized = true;
    renderMtWatchlistRows();
    synthesizeCandles(state.mt.pair, state.mt.timeframe);
    updateMtChartHeader();
  }
  updateMtAccountFooter();
  renderMtPositions();
}

function updateMtChartHeader() {
  const sym = document.getElementById('mt-chart-symbol');
  const tf = document.getElementById('mt-chart-tf');
  const desc = document.getElementById('mt-chart-desc');
  if (sym) sym.textContent = state.mt.pair;
  if (tf) tf.textContent = state.mt.timeframe;
  if (desc) desc.textContent = MT_PAIR_NAMES[state.mt.pair] || '';
}

function synthesizeCandles(pair, timeframe) {
  const price = state.prices[pair];
  if (!price || !state.mt.series) return;

  const bucketMs = state.mt.bucketMs[timeframe];
  const tickStep = price > 1000 ? 0.003 : 0.0003; // matches server's per-tick volatility fraction
  const ticksPerBar = Math.max(1, bucketMs / 1500);
  const barVol = Math.max(price * 0.00001, price * tickStep * Math.sqrt(ticksPerBar));
  const bars = 150;
  const barStart = Math.floor(Date.now() / bucketMs) * bucketMs;

  const closes = new Array(bars);
  closes[bars - 1] = price;
  for (let i = bars - 2; i >= 0; i--) {
    closes[i] = closes[i + 1] - (Math.random() - 0.5) * barVol;
  }

  const out = [];
  for (let i = 0; i < bars; i++) {
    const time = Math.floor((barStart - (bars - 1 - i) * bucketMs) / 1000);
    const open = i === 0 ? closes[0] - (Math.random() - 0.5) * barVol * 0.5 : closes[i - 1];
    const close = closes[i];
    const hi = Math.max(open, close) + Math.random() * barVol * 0.4;
    const lo = Math.min(open, close) - Math.random() * barVol * 0.4;
    out.push({ time, open: mtRound(pair, open), high: mtRound(pair, hi), low: mtRound(pair, lo), close: mtRound(pair, close) });
  }

  state.mt.candles[pair + '_' + timeframe] = out;
  state.mt.series.setData(out);
  syncMtPriceLines(mtKey());
  redrawMtDrawings();
  updateMtIndicators();
}

function updateMtLiveCandle() {
  if (!state.mt.series) return;
  const pair = state.mt.pair;
  const timeframe = state.mt.timeframe;
  const price = state.prices[pair];
  if (!price) return;
  const key = pair + '_' + timeframe;
  const bars = state.mt.candles[key];
  if (!bars || !bars.length) return;

  const bucketMs = state.mt.bucketMs[timeframe];
  const barTime = Math.floor(Date.now() / bucketMs) * bucketMs / 1000;
  const last = bars[bars.length - 1];

  if (barTime === last.time) {
    last.close = mtRound(pair, price);
    last.high = Math.max(last.high, last.close);
    last.low = Math.min(last.low, last.close);
    state.mt.series.update(last);
  } else if (barTime > last.time) {
    const bar = { time: barTime, open: last.close, high: mtRound(pair, price), low: mtRound(pair, price), close: mtRound(pair, price) };
    bars.push(bar);
    if (bars.length > 300) bars.shift();
    state.mt.series.update(bar);
  }
  redrawMtDrawings();
  updateMtIndicators();
}

function renderMtWatchlistRows() {
  const el = document.getElementById('mt-watchlist-rows');
  if (!el) return;
  const filter = state.mt.watchlistFilter;
  const pairs = Object.keys(state.prices).filter(p => !filter || p.toLowerCase().includes(filter));

  el.innerHTML = pairs.map(p => {
    const price = state.prices[p];
    const [bid, ask] = mtSpread(p, price);
    const hist = state.priceHistory[p] || [price];
    const prev = hist[hist.length - 2] || price;
    const chg = prev ? ((price - prev) / prev * 100) : 0;
    const up = chg >= 0;
    return `
      <div class="mt-watchlist-row ${p === state.mt.pair ? 'active' : ''}" onclick="selectMtPair('${p}')">
        <span class="mt-wl-sym"><i class="ti ti-caret-${up ? 'up' : 'down'}-filled ${up ? 'up' : 'down'}"></i>${p}</span>
        <span class="mt-wl-bid">${mtRound(p, bid)}</span>
        <span class="mt-wl-ask">${mtRound(p, ask)}</span>
        <span class="mt-wl-chg ${up ? 'up' : 'down'}">${up ? '+' : ''}${chg.toFixed(2)}%</span>
      </div>
    `;
  }).join('');
}

function filterMtWatchlist(query) {
  state.mt.watchlistFilter = query.trim().toLowerCase();
  renderMtWatchlistRows();
}

function selectMtPair(pair) {
  if (pair === state.mt.pair) return;
  state.mt.pair = pair;
  document.getElementById('f-pair').value = pair;
  updateMtChartHeader();
  synthesizeCandles(pair, state.mt.timeframe);
  renderMtWatchlistRows();
  mtExecUpdateDisplays();
}

function setMtTimeframe(tf, el) {
  state.mt.timeframe = tf;
  document.querySelectorAll('#mt-tf-group .mt-tf').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  updateMtChartHeader();
  synthesizeCandles(state.mt.pair, tf);
}

function setMtChartType(type) {
  if (!state.mt.chart || type === state.mt.chartType) return;
  state.mt.chartType = type;
  document.getElementById('mt-ct-candle').classList.toggle('active', type === 'candlestick');
  document.getElementById('mt-ct-line').classList.toggle('active', type === 'line');

  const key = state.mt.pair + '_' + state.mt.timeframe;
  const bars = state.mt.candles[key] || [];
  state.mt.chart.removeSeries(state.mt.series);
  state.mt.activePriceLines = []; // the removed series destroyed these; drop stale handles
  if (type === 'line') {
    state.mt.series = state.mt.chart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5 });
    state.mt.series.setData(bars.map(b => ({ time: b.time, value: b.close })));
  } else {
    state.mt.series = state.mt.chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceLineColor: '#ef4444', priceLineWidth: 1
    });
    state.mt.series.setData(bars);
  }
  syncMtPriceLines(key);
  redrawMtDrawings();
}

function toggleMtTool(el) {
  document.querySelectorAll('#mt-tools-rail .mt-tool').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function toggleMtFullscreen() {
  const el = document.querySelector('.mt-terminal');
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}

/* ── Drawing tools (trend line / horizontal line / Fibonacci) ─────
   Horizontal line and Fibonacci use lightweight-charts' native
   price lines (auto-positioned, survive pan/zoom for free). Trend
   line has no native primitive for an arbitrary two-point diagonal,
   so it's drawn on a canvas overlay, redrawn from stored {time,price}
   points via timeToCoordinate/priceToCoordinate whenever the visible
   range changes. Only the cursor tool can delete (click-to-hit-test);
   there's no drag-to-move — out of scope for this pass. ──────────── */

function mtKey() {
  return state.mt.pair + '_' + state.mt.timeframe;
}

function initMtDrawing() {
  const canvas = document.getElementById('mt-draw-canvas');
  if (!canvas || state.mt.drawCanvas) return;
  state.mt.drawCanvas = canvas;
  resizeMtDrawCanvas();
  state.mt.chart.subscribeClick(onMtChartClick);
  state.mt.chart.subscribeCrosshairMove(onMtChartCrosshair);
  state.mt.chart.timeScale().subscribeVisibleTimeRangeChange(redrawMtDrawings);
}

function resizeMtDrawCanvas() {
  const canvas = state.mt.drawCanvas;
  const container = document.getElementById('mt-chart-container');
  if (!canvas || !container) return;
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth, h = container.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.mt.drawCtx = ctx;
}

function setMtTool(tool, el) {
  state.mt.tool = tool;
  state.mt.pendingPoint = null;
  state.mt.previewPoint = null;
  document.querySelectorAll('#mt-tools-rail .mt-tool').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  redrawMtDrawings();
}

function onMtChartClick(param) {
  if (!state.mt.series || !param.point || param.time === undefined) return;
  const priceVal = state.mt.series.coordinateToPrice(param.point.y);
  if (priceVal == null) return;
  const point = { time: param.time, price: mtRound(state.mt.pair, priceVal) };
  const key = mtKey();

  if (state.mt.tool === 'cursor') {
    hitTestAndDeleteMtDrawing(param.point);
    return;
  }

  if (state.mt.tool === 'hline') {
    if (!state.mt.drawings[key]) state.mt.drawings[key] = [];
    state.mt.drawings[key].push({ type: 'hline', price: point.price });
    syncMtPriceLines(key);
    toast('Horizontal line added');
    return;
  }

  if (state.mt.tool === 'trendline' || state.mt.tool === 'fib') {
    if (!state.mt.pendingPoint) {
      state.mt.pendingPoint = point;
      return;
    }
    if (!state.mt.drawings[key]) state.mt.drawings[key] = [];
    state.mt.drawings[key].push({ type: state.mt.tool, p1: state.mt.pendingPoint, p2: point });
    state.mt.pendingPoint = null;
    state.mt.previewPoint = null;
    if (state.mt.tool === 'fib') syncMtPriceLines(key);
    redrawMtDrawings();
    toast((state.mt.tool === 'fib' ? 'Fibonacci' : 'Trend line') + ' added');
  }
}

function onMtChartCrosshair(param) {
  if (!state.mt.pendingPoint || (state.mt.tool !== 'trendline' && state.mt.tool !== 'fib')) return;
  if (!param.point) return;
  state.mt.previewPoint = { x: param.point.x, y: param.point.y };
  redrawMtDrawings();
}

function redrawMtDrawings() {
  const canvas = state.mt.drawCanvas, ctx = state.mt.drawCtx;
  if (!canvas || !ctx || !state.mt.chart || !state.mt.series) return;
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const timeScale = state.mt.chart.timeScale();
  (state.mt.drawings[mtKey()] || []).filter(d => d.type === 'trendline').forEach(d => {
    const x1 = timeScale.timeToCoordinate(d.p1.time);
    const y1 = state.mt.series.priceToCoordinate(d.p1.price);
    const x2 = timeScale.timeToCoordinate(d.p2.time);
    const y2 = state.mt.series.priceToCoordinate(d.p2.price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  if (state.mt.pendingPoint && state.mt.previewPoint) {
    const x1 = timeScale.timeToCoordinate(state.mt.pendingPoint.time);
    const y1 = state.mt.series.priceToCoordinate(state.mt.pendingPoint.price);
    if (x1 != null && y1 != null) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(state.mt.previewPoint.x, state.mt.previewPoint.y);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pxToPriceDelta(px) {
  const p0 = state.mt.series.coordinateToPrice(0);
  const p1 = state.mt.series.coordinateToPrice(px);
  if (p0 == null || p1 == null) return Infinity;
  return Math.abs(p1 - p0);
}

function hitTestAndDeleteMtDrawing(point) {
  const key = mtKey();
  const drawings = state.mt.drawings[key] || [];
  const clickPrice = state.mt.series.coordinateToPrice(point.y);
  const priceTolerance = pxToPriceDelta(6);
  const timeScale = state.mt.chart.timeScale();

  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    let hit = false;

    if (d.type === 'trendline') {
      const x1 = timeScale.timeToCoordinate(d.p1.time);
      const y1 = state.mt.series.priceToCoordinate(d.p1.price);
      const x2 = timeScale.timeToCoordinate(d.p2.time);
      const y2 = state.mt.series.priceToCoordinate(d.p2.price);
      if (x1 != null && y1 != null && x2 != null && y2 != null) {
        hit = distToSegment(point.x, point.y, x1, y1, x2, y2) <= 6;
      }
    } else if (d.type === 'hline' && clickPrice != null) {
      hit = Math.abs(clickPrice - d.price) <= priceTolerance;
    } else if (d.type === 'fib' && clickPrice != null) {
      const high = Math.max(d.p1.price, d.p2.price);
      const low = Math.min(d.p1.price, d.p2.price);
      const diff = high - low;
      hit = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].some(level => Math.abs(clickPrice - (high - diff * level)) <= priceTolerance);
    }

    if (hit) {
      drawings.splice(i, 1);
      if (d.type === 'hline' || d.type === 'fib') syncMtPriceLines(key);
      redrawMtDrawings();
      toast('Drawing removed');
      return;
    }
  }
}

function syncMtPriceLines(key) {
  if (!state.mt.series) return;
  state.mt.activePriceLines.forEach(line => {
    try { state.mt.series.removePriceLine(line); } catch (e) { /* series was swapped, handle already gone */ }
  });
  state.mt.activePriceLines = [];

  (state.mt.drawings[key] || []).forEach(d => {
    if (d.type === 'hline') {
      state.mt.activePriceLines.push(state.mt.series.createPriceLine({
        price: d.price, color: '#38bdf8', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: ''
      }));
    } else if (d.type === 'fib') {
      const high = Math.max(d.p1.price, d.p2.price);
      const low = Math.min(d.p1.price, d.p2.price);
      const diff = high - low;
      [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach(level => {
        state.mt.activePriceLines.push(state.mt.series.createPriceLine({
          price: mtRound(state.mt.pair, high - diff * level), color: '#f59e0b', lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: (level * 100).toFixed(1) + '%'
        }));
      });
    }
  });
}

/* ── Indicators (SMA / EMA) ─────────────────────────────────────── */
function computeSMA(bars, period) {
  const out = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

function computeEMA(bars, period) {
  if (!bars.length) return [];
  const k = 2 / (period + 1);
  let prev = bars[0].close;
  const out = [{ time: bars[0].time, value: prev }];
  for (let i = 1; i < bars.length; i++) {
    prev = bars[i].close * k + prev * (1 - k);
    out.push({ time: bars[i].time, value: prev });
  }
  return out;
}

function updateMtIndicators() {
  if (!state.mt.chart) return;
  const bars = state.mt.candles[mtKey()] || [];
  Object.values(state.mt.indicators).forEach(ind => {
    if (!ind.active) return;
    if (!ind.series) ind.series = state.mt.chart.addLineSeries({ color: ind.color, lineWidth: 1 });
    ind.series.setData(ind.type === 'sma' ? computeSMA(bars, ind.period) : computeEMA(bars, ind.period));
  });
}

function openMtIndicatorModal() {
  const el = document.getElementById('mt-indicator-list');
  el.innerHTML = Object.entries(state.mt.indicators).map(([key, ind]) => `
    <div class="settings-row">
      <span>${MT_INDICATOR_LABELS[key]}</span>
      <button class="btn-outline" onclick="toggleMtIndicator('${key}')">${ind.active ? 'Remove' : 'Add'}</button>
    </div>
  `).join('');
  openModal('mt-indicator-modal');
}

function toggleMtIndicator(key) {
  const ind = state.mt.indicators[key];
  if (!ind) return;
  if (ind.active) {
    if (ind.series) { state.mt.chart.removeSeries(ind.series); ind.series = null; }
    ind.active = false;
  } else {
    ind.active = true;
    updateMtIndicators();
  }
  openMtIndicatorModal();
}

/* ── Price alerts ───────────────────────────────────────────────── */
function openMtAlertModal() {
  const sel = document.getElementById('mt-alert-pair');
  sel.innerHTML = Object.keys(state.prices).map(p => `<option ${p === state.mt.pair ? 'selected' : ''}>${p}</option>`).join('');
  document.getElementById('mt-alert-price').value = '';
  renderMtAlertsList();
  openModal('mt-alert-modal');
}

function createMtAlert() {
  const pair = document.getElementById('mt-alert-pair').value;
  const condition = document.getElementById('mt-alert-condition').value;
  const price = parseFloat(document.getElementById('mt-alert-price').value);
  if (!price || price <= 0) { toast('Enter a valid target price', true); return; }
  state.mt.alerts.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 7), pair, condition, price });
  document.getElementById('mt-alert-price').value = '';
  renderMtAlertsList();
  toast(`Alert set: ${pair} ${condition === 'above' ? '>' : '<'} ${fmtPrice(pair, price)}`);
}

function deleteMtAlert(id) {
  state.mt.alerts = state.mt.alerts.filter(a => a.id !== id);
  renderMtAlertsList();
}

function renderMtAlertsList() {
  const el = document.getElementById('mt-alert-list');
  if (!el) return;
  if (!state.mt.alerts.length) {
    el.innerHTML = '<div class="empty-state" style="padding:16px 0"><p>No active alerts.</p></div>';
    return;
  }
  el.innerHTML = state.mt.alerts.map(a => `
    <div class="settings-row">
      <span>${a.pair} ${a.condition === 'above' ? '&gt;' : '&lt;'} ${fmtPrice(a.pair, a.price)}</span>
      <button class="btn-close-pos" onclick="deleteMtAlert('${a.id}')"><i class="ti ti-x"></i></button>
    </div>
  `).join('');
}

function checkMtAlerts() {
  if (!state.mt.alerts.length) return;
  const triggeredIds = [];
  state.mt.alerts.forEach(a => {
    const cur = state.prices[a.pair];
    if (!cur) return;
    if ((a.condition === 'above' && cur >= a.price) || (a.condition === 'below' && cur <= a.price)) {
      triggeredIds.push(a.id);
      toast(`🔔 ${a.pair} ${a.condition === 'above' ? 'reached above' : 'reached below'} ${fmtPrice(a.pair, a.price)}`);
    }
  });
  if (triggeredIds.length) {
    state.mt.alerts = state.mt.alerts.filter(a => !triggeredIds.includes(a.id));
    renderMtAlertsList();
  }
}

function renderMtPositions() {
  const rowsEl = document.getElementById('mt-positions-rows');
  const emptyEl = document.getElementById('mt-positions-empty');
  if (!rowsEl || !emptyEl) return;

  // Multipliers/Accumulators are opened from Binary Options, not this Forex
  // terminal — keep them out of its positions table and account footer.
  const open = (state.trades.forex || []).filter(t => t.status === 'open' && !t.kind);
  if (!open.length) {
    rowsEl.innerHTML = '';
    emptyEl.classList.add('show');
    return;
  }
  emptyEl.classList.remove('show');

  rowsEl.innerHTML = open.map(t => {
    const pnl = t.pnl || 0;
    const time = new Date(t.openedAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="mt-position-row">
        <span class="mt-pos-sym">${t.pair}</span>
        <span>#${t.id.slice(0, 8)}</span>
        <span>${time}</span>
        <span class="${t.direction === 'buy' ? 'up' : 'down'}">${t.direction === 'buy' ? 'Buy' : 'Sell'}</span>
        <span>$${fmt(t.amount)}</span>
        <span>${fmtPrice(t.pair, t.entryPrice)}</span>
        <span>${t.stopLoss ? fmtPrice(t.pair, t.stopLoss) : '—'}</span>
        <span>${t.takeProfit ? fmtPrice(t.pair, t.takeProfit) : '—'}</span>
        <span>${fmtPrice(t.pair, t.currentPrice)}</span>
        <span>0.00</span>
        <span class="${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : ''}$${fmt(Math.abs(pnl))}</span>
        <button class="mt-pos-close" onclick="closeTrade('${t.id}')" title="Close position"><i class="ti ti-x"></i></button>
      </div>
    `;
  }).join('');
}

function updateMtAccountFooter() {
  const balEl = document.getElementById('mt-af-balance');
  if (!balEl) return;

  const balance = state.balance || 0;
  const open = (state.trades.forex || []).filter(t => t.status === 'open' && !t.kind);
  const floatingPnl = open.reduce((s, t) => s + (t.pnl || 0), 0);
  const margin = open.reduce((s, t) => s + (t.margin || 0), 0);
  const equity = balance + floatingPnl;
  const freeMargin = equity - margin;
  const level = margin > 0 ? ((equity / margin) * 100).toFixed(2) + '%' : '0.00%';

  document.getElementById('mt-af-balance').textContent = fmt(balance);
  document.getElementById('mt-af-equity').textContent = fmt(equity);
  document.getElementById('mt-af-margin').textContent = fmt(margin);
  document.getElementById('mt-af-free').textContent = fmt(freeMargin);
  document.getElementById('mt-af-level').textContent = level;
}

/* ── New Order Modal (Forex terminal) ──────────────────────────── */
function openMtOrderModal() {
  const sel = document.getElementById('mt-order-pair');
  sel.innerHTML = Object.keys(state.prices).map(p => `<option ${p === state.mt.pair ? 'selected' : ''}>${p}</option>`).join('');
  setMtOrderDir('buy');
  document.getElementById('mt-order-amount').value = 100;
  document.getElementById('mt-order-sl').value = '';
  document.getElementById('mt-order-tp').value = '';
  updateMtOrderCalc();
  openModal('mt-order-modal');
}

function setMtOrderDir(d) {
  setDir(d); // keeps state.fxDir and the hidden trade-form's buy/sell buttons in sync
  document.getElementById('mt-order-buy').className = 'dir-btn btn-buy' + (d === 'buy' ? ' active' : '');
  document.getElementById('mt-order-sell').className = 'dir-btn btn-sell' + (d === 'sell' ? ' active' : '');
}

function updateMtOrderCalc() {
  const amount = parseFloat(document.getElementById('mt-order-amount')?.value) || 100;
  const lev = parseInt(document.getElementById('mt-order-leverage')?.value) || 50;
  const margin = (amount / lev).toFixed(2);
  const potPnl = (amount * lev * 0.005).toFixed(2);
  document.getElementById('mt-order-margin').textContent = '$' + fmt(parseFloat(margin));
  document.getElementById('mt-order-pnl').textContent = '$' + fmt(parseFloat(potPnl));
}

async function submitMtOrder() {
  // Bridge into the existing (hidden) trade-form fields and reuse placeFxTrade()
  // rather than duplicating request-building/validation logic.
  document.getElementById('f-pair').value = document.getElementById('mt-order-pair').value;
  document.getElementById('f-amount').value = document.getElementById('mt-order-amount').value;
  document.getElementById('f-leverage').value = document.getElementById('mt-order-leverage').value;
  document.getElementById('f-sl').value = document.getElementById('mt-order-sl').value;
  document.getElementById('f-tp').value = document.getElementById('mt-order-tp').value;

  const btn = document.getElementById('mt-order-submit');
  btn.disabled = true; btn.textContent = 'Placing...';
  await placeFxTrade();
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-chart-candle"></i> Place Order';
  closeModal('mt-order-modal');
}

/* ── Market Execution panel (Forex terminal) ───────────────────────
   A second, always-visible order entry point (unlike the empty-state-
   only "Create New Order" modal above): a compact ticket docked over
   the left side of the chart with volume/SL/TP steppers and immediate
   Sell/Buy-by-Market buttons. Bridges into the same hidden trade-form
   fields and placeFxTrade() as the other order flows. ────────────── */
function openMtMarketExec() {
  document.getElementById('mt-exec-amount').value = 100;
  document.getElementById('mt-exec-sl').value = '';
  document.getElementById('mt-exec-tp').value = '';
  document.getElementById('mt-exec-comment').value = '';
  document.getElementById('mt-exec-vol-error').classList.remove('show');
  document.getElementById('mt-exec-volume-stepper').classList.remove('error');
  document.getElementById('mt-exec-panel').classList.add('show');
  mtExecUpdateDisplays();
}

function closeMtMarketExec() {
  document.getElementById('mt-exec-panel').classList.remove('show');
}

function mtExecStep(field, delta) {
  const id = field === 'amount' ? 'mt-exec-amount' : field === 'sl' ? 'mt-exec-sl' : 'mt-exec-tp';
  const el = document.getElementById(id);
  const cur = parseFloat(el.value) || 0;
  const next = Math.max(0, cur + delta);
  el.value = field === 'amount' ? next.toFixed(2) : mtRound(state.mt.pair, next);
  mtExecUpdateDisplays();
}

function mtExecUpdateDisplays() {
  const panel = document.getElementById('mt-exec-panel');
  if (!panel || !panel.classList.contains('show')) return;
  document.getElementById('mt-exec-symbol').textContent = state.mt.pair;
  const amount = parseFloat(document.getElementById('mt-exec-amount').value) || 0;
  document.getElementById('mt-exec-volume-display').textContent = fmt(amount) + ' USD';
  const price = state.prices[state.mt.pair];
  const [bid, ask] = mtSpread(state.mt.pair, price);
  document.getElementById('mt-exec-bid').textContent = mtRound(state.mt.pair, bid);
  document.getElementById('mt-exec-ask').textContent = mtRound(state.mt.pair, ask);
}

async function submitMtExec(direction) {
  const amount = parseFloat(document.getElementById('mt-exec-amount').value) || 0;
  const errEl = document.getElementById('mt-exec-vol-error');
  const stepperEl = document.getElementById('mt-exec-volume-stepper');
  if (amount < 10) {
    errEl.classList.add('show');
    stepperEl.classList.add('error');
    return;
  }
  errEl.classList.remove('show');
  stepperEl.classList.remove('error');

  document.getElementById('f-pair').value = state.mt.pair;
  document.getElementById('f-amount').value = amount;
  document.getElementById('f-sl').value = document.getElementById('mt-exec-sl').value;
  document.getElementById('f-tp').value = document.getElementById('mt-exec-tp').value;
  setDir(direction);

  await placeFxTrade();
  closeMtMarketExec();
}

/* ── Trade Actions ──────────────────────────────────────────── */
async function placeFxTrade() {
  const btn = document.getElementById('forex-submit');
  btn.disabled = true; btn.textContent = 'Placing...';

  const body = {
    userId: USER_ID,
    pair: document.getElementById('f-pair').value,
    direction: state.fxDir,
    amount: parseFloat(document.getElementById('f-amount').value),
    leverage: parseInt(document.getElementById('f-leverage').value),
    stopLoss: document.getElementById('f-sl').value,
    takeProfit: document.getElementById('f-tp').value
  };

  const res = await api('/trade/forex', 'POST', body);
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-chart-candle"></i> Place Trade';

  if (!res || res.error) { toast(res?.error || 'Failed to place trade', true); return; }
  toast(`✓ ${body.direction.toUpperCase()} ${body.pair} · $${fmt(body.amount)} opened`);
  await fetchTrades(); await fetchStats();
}

async function placeBinaryTrade() {
  if (state.contractType === 'multipliers') return placeMultiplierTrade();
  if (state.contractType === 'accumulators') return placeAccumulatorTrade();

  const btn = document.getElementById('binary-submit');
  const durSecs = btDurationToSeconds();
  if (!durSecs || durSecs < 1) { toast('Set a valid duration first', true); return; }

  const buyLabel = document.getElementById('bt-buy-label');
  btn.disabled = true; if (buyLabel) buyLabel.textContent = 'Placing…';

  const allowEqEl = document.getElementById('bt-allow-equals');
  const body = {
    userId: USER_ID,
    pair: document.getElementById('b-pair').value,
    contractType: state.contractType,
    direction: state.binDir,
    stake: parseFloat(document.getElementById('b-stake').value),
    expirySeconds: durSecs,
    payoutPercent: parseInt(document.getElementById('b-payout').value),
    allowEquals: !!(allowEqEl && allowEqEl.checked && state.contractType === 'rise_fall')
  };
  if (state.contractType === 'over_under' || state.contractType === 'matches_differs') {
    body.prediction = state.binDigit;
  }
  if (BARRIER_MARKET_TYPES.includes(state.contractType)) {
    body.barrierOffset = computeBarrierOffset();
  }

  const res = await api('/trade/binary', 'POST', body);
  btn.disabled = false; if (buyLabel) buyLabel.textContent = 'Buy';

  if (!res || res.error) { toast(res?.error || 'Failed to place option', true); return; }
  const label = (BIN_DIR_LABELS[state.contractType] && BIN_DIR_LABELS[state.contractType][body.direction]) || body.direction.toUpperCase();
  const digitPart = body.prediction !== undefined ? ` ${body.prediction}` : '';
  toast(`✓ ${label}${digitPart} on ${body.pair} · Expires in ${btFormatDuration(durSecs)}`);
  await fetchTrades(); await fetchStats();
  updateBtAccountInfo();
}

async function placeMultiplierTrade() {
  const btn = document.getElementById('binary-submit');
  const buyLabel = document.getElementById('bt-buy-label');
  btn.disabled = true; if (buyLabel) buyLabel.textContent = 'Placing…';

  const body = {
    userId: USER_ID,
    pair: document.getElementById('b-pair').value,
    direction: state.binDir,
    stake: parseFloat(document.getElementById('b-stake').value),
    multiplier: parseInt(document.getElementById('bt-multiplier-select').value, 10)
  };

  const res = await api('/trade/multiplier', 'POST', body);
  btn.disabled = false; if (buyLabel) buyLabel.textContent = 'Open Position';

  if (!res || res.error) { toast(res?.error || 'Failed to open position', true); return; }
  toast(`✓ Multipliers x${body.multiplier} ${body.direction === 'up' ? 'Up' : 'Down'} opened on ${body.pair}`);
  await fetchTrades(); await fetchStats();
  updateBtAccountInfo();
}

async function placeAccumulatorTrade() {
  const btn = document.getElementById('binary-submit');
  const buyLabel = document.getElementById('bt-buy-label');
  btn.disabled = true; if (buyLabel) buyLabel.textContent = 'Placing…';

  const body = {
    userId: USER_ID,
    pair: document.getElementById('b-pair').value,
    stake: parseFloat(document.getElementById('b-stake').value),
    growthRate: parseInt(document.getElementById('bt-growth-select').value, 10)
  };

  const res = await api('/trade/accumulator', 'POST', body);
  btn.disabled = false; if (buyLabel) buyLabel.textContent = 'Open Position';

  if (!res || res.error) { toast(res?.error || 'Failed to open position', true); return; }
  toast(`✓ Accumulator ${body.growthRate}% opened on ${body.pair}`);
  await fetchTrades(); await fetchStats();
  updateBtAccountInfo();
}

async function closeTrade(id) {
  const res = await api(`/trade/close/${id}`, 'POST');
  if (!res || res.error) { toast(res?.error || 'Failed to close', true); return; }
  const pnl = res.pnl;
  toast(`Position closed · P&L: ${pnl >= 0 ? '+' : ''}$${fmt(Math.abs(pnl))}`);
  await fetchTrades(); await fetchStats();
}

/* ── SmartTrader (AI investment) ───────────────────────────────
   Fixed-term stake: user picks an amount (min $40) and a duration,
   server locks the stake and compounds it once every 24hr period by
   a fresh random 30%–35% rate (so 72hrs compounds 3x, 1 week 7x)
   until maturesAt. A flat 5% one-time insurance deduction is taken
   from the stake up front and only the net amount compounds.
   Countdown/estimates here are purely client-side display, driven
   off server-issued state. ────────────────────────────────────── */
const SMART_DURATION_DAYS = { '24h': 1, '72h': 3, '1w': 7 };
const SMART_INSURANCE_RATES = { '24h': 5, '72h': 5, '1w': 5 };

function smartReturnRange(stake, duration) {
  const periods = SMART_DURATION_DAYS[duration] || 1;
  const insuranceRate = SMART_INSURANCE_RATES[duration] || 0;
  const net = stake * (1 - insuranceRate / 100);
  return [net * Math.pow(1.30, periods), net * Math.pow(1.35, periods)];
}

// Purely cosmetic — random-walks each active investment's displayed value
// up/down within the low/high bounds of its estimated return, bouncing off
// either edge, so it visibly jitters every tick instead of sitting on the
// server's once-per-day currentValue.
const smartLiveState = {};
function smartLiveValue(inv) {
  const [low, high] = smartReturnRange(inv.stake, inv.duration);
  const range = high - low;
  let cur = smartLiveState[inv.id];
  if (cur === undefined) cur = low + Math.random() * range;
  const step = range * (0.08 + Math.random() * 0.22);
  cur += (Math.random() < 0.5 ? -1 : 1) * step;
  if (cur > high) cur = high - (cur - high);
  if (cur < low) cur = low + (low - cur);
  cur = Math.min(high, Math.max(low, cur));
  smartLiveState[inv.id] = cur;
  return cur;
}

function setSmartDuration(dur, el) {
  state.smartDuration = dur;
  document.querySelectorAll('#st-duration-tabs .contract-tab').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  updateSmartCalc();
}

function updateSmartCalc() {
  const stakeInput = document.getElementById('st-stake');
  const rawStake = parseFloat(stakeInput?.value);
  const stake = rawStake || 40;
  const isBelowMin = !!stakeInput && rawStake < 40;
  if (stakeInput) stakeInput.classList.toggle('invalid', isBelowMin);
  const sd = document.getElementById('st-stake-display');
  if (sd) sd.textContent = '$' + fmt(stake);
  const [low, high] = smartReturnRange(stake, state.smartDuration);
  const rd = document.getElementById('st-return-display');
  if (rd) {
    rd.textContent = '$' + fmt(low) + ' – $' + fmt(high);
    rd.classList.toggle('down', isBelowMin);
    rd.classList.toggle('up', !isBelowMin);
  }

  const rate = SMART_INSURANCE_RATES[state.smartDuration] || 0;
  const fee = stake * rate / 100;
  const it = document.getElementById('st-insurance-text');
  if (it) it.textContent = `A ${rate}% insurance deduction ($${fmt(fee)}) applies to ${SMART_DURATION_LABELS[state.smartDuration] || state.smartDuration} investments.`;
}

async function placeSmartInvestment() {
  const btn = document.getElementById('smart-submit');
  const stake = parseFloat(document.getElementById('st-stake').value);
  if (!stake || stake < 40) { toast('Minimum investment is $40', true); return; }

  btn.disabled = true; btn.textContent = 'Processing...';
  const res = await api('/trade/smart', 'POST', { userId: USER_ID, stake, duration: state.smartDuration });
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-robot"></i> Start Investment';

  if (!res || res.error) { toast(res?.error || 'Failed to start investment', true); return; }
  toast(`✓ $${fmt(stake)} invested for ${SMART_DURATION_LABELS[state.smartDuration] || state.smartDuration}`);
  await fetchSmartInvestments(); await fetchStats();
}

function formatTimeLeft(ms) {
  ms = Math.max(0, ms);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const hh = String(hours).padStart(2, '0'), mm = String(mins).padStart(2, '0'), ss = String(secs).padStart(2, '0');
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function renderSmartInvestments() {
  const el = document.getElementById('smart-investments-list');
  if (!el) return;
  const list = state.smartInvestments || [];
  const active = list.filter(i => i.status === 'active');

  const stActive = document.getElementById('st-active');
  if (stActive) stActive.textContent = active.length;
  const stInvested = document.getElementById('st-invested');
  if (stInvested) stInvested.textContent = '$' + fmt(active.reduce((s, i) => s + i.stake, 0));
  const stReturns = document.getElementById('st-returns');
  if (stReturns) stReturns.textContent = '$' + fmt(list.filter(i => i.status === 'completed').reduce((s, i) => s + (i.payout - i.stake), 0));

  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><i class="ti ti-robot"></i><p>No investments yet. Stake an amount above to get started.</p></div>';
    return;
  }
  el.innerHTML = list.map(i => {
    const liveValue = i.status === 'active' ? smartLiveValue(i) : i.payout;
    const profit = liveValue - i.stake;
    return `
      <div class="position-card" id="stcard-${i.id}">
        <div>
          <div class="pos-pair">SmartTrader <span class="badge ${i.status === 'active' ? 'badge-open' : 'badge-won'}">${i.status.toUpperCase()}</span></div>
          <div class="pos-detail">Stake: $${fmt(i.stake)} · Insurance: ${i.insuranceRate}% (-$${fmt(i.insuranceFee)}) · ${SMART_DURATION_LABELS[i.duration] || i.duration} · Day ${i.periodsCompleted}/${i.periods}</div>
        </div>
        <div style="text-align:right">
          <div class="pos-pnl up" id="stvalue-${i.id}">${i.status === 'active' ? 'Value: $' + fmt(liveValue) : '+$' + fmt(profit)}</div>
          <div class="bin-timer" id="sttimer-${i.id}" style="margin-top:3px">${i.status === 'active' ? formatTimeLeft(i.maturesAt - Date.now()) : 'Completed'}</div>
        </div>
      </div>
    `;
  }).join('');
}

function updateSmartTimers() {
  (state.smartInvestments || []).filter(i => i.status === 'active').forEach(i => {
    const el = document.getElementById('sttimer-' + i.id);
    if (!el) return;
    el.textContent = formatTimeLeft(i.maturesAt - Date.now());
  });
}

function updateSmartLiveValues() {
  (state.smartInvestments || []).filter(i => i.status === 'active').forEach(i => {
    const el = document.getElementById('stvalue-' + i.id);
    if (!el) return;
    el.textContent = 'Value: $' + fmt(smartLiveValue(i));
  });
}

/* ── Deposit / Withdraw ─────────────────────────────────────── */
async function fetchConfig() {
  const res = await api('/config');
  state.config = res && !res.error ? res : { mpesaEnabled: false, usdKesRate: 129, paystackEnabled: false, priceUpdateSpeedMs: 500, cardMinKes: 1290, cardMaxKes: 1290000 };
  applyPriceUpdateSpeed();
  // M-Pesa/Card stay visible even before Paystack keys are configured — the
  // deposit endpoints themselves return a clear "not configured yet" error
  // if someone tries to use them first.
  updateMpesaEstimate();
}

// Applies the admin-set platform-wide tick rate, restarting the poll
// interval only when the value actually changed (called on every
// fetchConfig(), including the 30s background refresh).
function applyPriceUpdateSpeed() {
  const ms = (state.config && state.config.priceUpdateSpeedMs) || 500;
  if (state.activeTickMs === ms) return;
  state.activeTickMs = ms;
  clearInterval(state.tickInterval);
  state.tickInterval = setInterval(async () => {
    await fetchPrices();
    refreshLiveUI();
  }, ms);
}

async function fetchCryptoWallets() {
  const res = await api('/wallets/active');
  state.cryptoWallets = Array.isArray(res) ? res : [];
}

function renderCryptoWalletInfo() {
  const el = document.getElementById('crypto-wallet-info');
  if (!el) return;
  const wallet = (state.cryptoWallets || [])[0];
  if (!wallet) {
    el.innerHTML = '<div class="info-box">Crypto deposits are temporarily unavailable — no receiving address is configured yet.</div>';
    state.selectedWalletId = null;
    return;
  }
  state.selectedWalletId = wallet.id;
  el.innerHTML = `
    <div style="text-align:center;margin-bottom:14px">
      <canvas id="crypto-qr" style="background:#fff;padding:10px;border-radius:var(--radius-lg);border:1px solid var(--accent);box-shadow:0 0 0 4px var(--accent-bg)"></canvas>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:12px;color:var(--text-dim)">Network</span>
      <strong style="font-size:13px">${wallet.currency} (${wallet.network})</strong>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0">
      <span style="font-size:12px;color:var(--text-dim);white-space:nowrap">Wallet Address</span>
      <span style="display:flex;align-items:center;gap:6px">
        <code style="font-size:12px;color:#a0c0e0;word-break:break-all;text-align:right">${wallet.address}</code>
        <button type="button" class="act-btn" onclick="copyCryptoAddress('${wallet.address}')" title="Copy address"><i class="ti ti-copy"></i></button>
      </span>
    </div>
    <div class="info-box" style="margin-top:10px">
      Send only <strong>${wallet.currency} (${wallet.network})</strong> to this address. Sending any other asset or network may result in permanent loss of funds.
    </div>
  `;
  if (typeof QRCode !== 'undefined') {
    QRCode.toCanvas(document.getElementById('crypto-qr'), wallet.address, {
      width: 180,
      margin: 1,
      color: { dark: '#0d1224', light: '#ffffff' }
    }, () => {});
  }
}

function copyCryptoAddress(addr) {
  navigator.clipboard.writeText(addr)
    .then(() => toast('✓ Address copied to clipboard'))
    .catch(() => toast('Copy failed — select the address manually', true));
}

// New cards are charged through Paystack's Inline/Popup widget
// (js.paystack.co/v1/inline.js, loaded in index.html) — card number, expiry,
// CVV and any bank OTP/3DS challenge are entered directly inside Paystack's
// hosted overlay and never pass through this page's JS or our server at
// all. Saved cards (charged by authorization_code via chargeSavedCard())
// still go through our own server-side /charge call, which is why the
// PIN/OTP/phone/birthday step UI below is still needed for that path.
const CARD_VERIFY_LABELS = {
  pin: 'Enter your card PIN',
  otp: 'Enter the OTP sent to your phone/email',
  phone: 'Enter your phone number',
  birthday: 'Enter your date of birth (YYYY-MM-DD)'
};

let cardVerifyState = null; // { txRef, saveCard }
let cardPollTimer = null;

function stopCardPolling() {
  if (cardPollTimer) { clearInterval(cardPollTimer); cardPollTimer = null; }
}

function resetCardForm() {
  cardVerifyState = null;
  document.getElementById('card-entry-form').style.display = '';
  document.getElementById('card-verify-step').style.display = 'none';
  document.getElementById('card-save-checkbox').checked = false;
  document.getElementById('card-status').textContent = '';
}

async function loadSavedCards() {
  const listEl = document.getElementById('card-saved-list');
  const res = await api(`/deposit/card/saved?userId=${encodeURIComponent(USER_ID)}`);
  const cards = (res && res.cards) || [];
  if (!cards.length) { listEl.style.display = 'none'; listEl.innerHTML = ''; return; }

  listEl.innerHTML = cards.map(c => `
    <div class="deposit-method-row" style="cursor:default">
      <div class="dmr-icon dmr-purple"><i class="ti ti-credit-card"></i></div>
      <div class="dmr-text">
        <div class="dmr-title">${c.cardType ? c.cardType.toUpperCase() : 'Card'} ····${c.last4}</div>
        <div class="dmr-sub">Expires ${c.expMonth}/${c.expYear}</div>
      </div>
      <button type="button" class="btn-submit" style="width:auto;padding:8px 14px;margin:0" onclick="chargeSavedCard('${c.authorizationCode}')">Pay</button>
      <button type="button" class="modal-close" style="position:static" title="Remove card" onclick="removeSavedCard('${c.authorizationCode}')"><i class="ti ti-x"></i></button>
    </div>
  `).join('');
  listEl.style.display = '';
}

async function removeSavedCard(authorizationCode) {
  await api(`/deposit/card/saved/${encodeURIComponent(authorizationCode)}`, 'DELETE', { userId: USER_ID });
  loadSavedCards();
}

async function chargeSavedCard(authorizationCode) {
  const amountKES = parseFloat(document.getElementById('card-amount').value);
  const statusEl = document.getElementById('card-status');
  const cfg = state.config || {};
  const minKes = cfg.cardMinKes || 1290;
  const maxKes = cfg.cardMaxKes || 1290000;
  if (!amountKES || amountKES < minKes || amountKES > maxKes) {
    toast(`Enter an amount between KES ${minKes} and KES ${maxKes}.`, true);
    return;
  }

  statusEl.textContent = 'Charging saved card…';
  const res = await api('/deposit/card/charge-saved', 'POST', { userId: USER_ID, authorizationCode, amount: amountKES });
  await handleCardChargeResult(res, { saveCard: false, btn: null, statusEl });
}

// Opens Paystack's hosted Inline/Popup widget for a new card. The widget
// collects the card details and drives any bank OTP/3DS challenge itself;
// this page only finds out the outcome via the callback below, and even
// then treats it as a hint — verifyCardDeposit() below is what actually
// asks Paystack server-to-server whether the charge succeeded before
// crediting anything.
async function confirmCardDeposit() {
  const amountKES = parseFloat(document.getElementById('card-amount').value);
  const saveCard = document.getElementById('card-save-checkbox').checked;
  const statusEl = document.getElementById('card-status');
  const btn = document.getElementById('card-pay-btn');

  const cfg = state.config || {};
  const minKes = cfg.cardMinKes || 1290;
  const maxKes = cfg.cardMaxKes || 1290000;
  if (!amountKES || amountKES < minKes || amountKES > maxKes) {
    toast(`Enter an amount between KES ${minKes} and KES ${maxKes}.`, true);
    return;
  }
  if (typeof PaystackPop === 'undefined') {
    toast('Payment widget failed to load — check your connection and try again.', true);
    return;
  }

  btn.disabled = true;
  statusEl.textContent = 'Preparing secure checkout…';

  const init = await api('/deposit/card/init', 'POST', { userId: USER_ID, amount: amountKES });
  if (!init || init.error) {
    btn.disabled = false;
    statusEl.textContent = (init && init.error) || 'Could not start checkout.';
    toast(statusEl.textContent, true);
    return;
  }

  statusEl.textContent = 'Complete your payment in the window that just opened…';
  const handler = PaystackPop.setup({
    key: init.publicKey,
    email: init.email,
    amount: Math.round(init.amountKES * 100), // Paystack amounts are in subunits (cents)
    currency: 'KES',
    ref: init.txRef,
    onClose: () => {
      btn.disabled = false;
      statusEl.textContent = '';
    },
    callback: (response) => {
      statusEl.textContent = 'Confirming payment…';
      verifyCardDeposit(response.reference || init.txRef, { saveCard, btn, statusEl });
    }
  });
  handler.openIframe();
}

// Independently confirms the widget's reported outcome with Paystack (via
// our server, using the secret key) before treating the deposit as paid.
async function verifyCardDeposit(txRef, { saveCard, btn, statusEl }) {
  const res = await api('/deposit/card/verify', 'POST', { userId: USER_ID, txRef, saveCard });
  if (btn) btn.disabled = false;
  if (res && res.success) {
    statusEl.textContent = '';
    closeModal('deposit-modal');
    toast(`✓ Card deposit received — $${fmt(res.amountUSD)} added to balance`);
    await fetchStats();
    loadSavedCards();
  } else {
    statusEl.textContent = 'Payment was not completed. Please try again.';
  }
}

async function handleCardChargeResult(res, { saveCard, btn, statusEl }) {
  if (btn) btn.disabled = false;

  if (!res || res.error) {
    statusEl.textContent = (res && res.error) || 'Card payment failed.';
    toast(statusEl.textContent, true);
    return;
  }

  if (res.status === 'success') {
    stopCardPolling();
    cardVerifyState = null;
    statusEl.textContent = '';
    closeModal('deposit-modal');
    toast(`✓ Card deposit received — $${fmt(res.amountUSD)} added to balance`);
    await fetchStats();
    return;
  }

  if (['pin', 'otp', 'phone', 'birthday'].includes(res.status)) {
    cardVerifyState = { txRef: res.reference, step: res.status, saveCard };
    document.getElementById('card-entry-form').style.display = 'none';
    const verifyStep = document.getElementById('card-verify-step');
    verifyStep.style.display = '';
    document.getElementById('card-verify-label').textContent = CARD_VERIFY_LABELS[res.status] || 'Enter verification code';
    document.getElementById('card-verify-input').value = '';
    statusEl.textContent = res.message || '';
    return;
  }

  if (res.status === 'open_url' && res.url) {
    cardVerifyState = { txRef: res.reference, saveCard };
    statusEl.textContent = 'Complete verification in the window that just opened…';
    window.open(res.url, '_blank', 'width=480,height=640');
    pollCardVerify(res.reference, statusEl);
    return;
  }

  statusEl.textContent = 'Card payment failed.';
}

async function submitCardVerification() {
  if (!cardVerifyState) return;
  const value = document.getElementById('card-verify-input').value.trim();
  const statusEl = document.getElementById('card-status');
  const btn = document.getElementById('card-verify-btn');
  if (!value) { toast('Enter the requested details', true); return; }

  btn.disabled = true;
  statusEl.textContent = 'Verifying…';
  const res = await api('/deposit/card/submit', 'POST', {
    userId: USER_ID, txRef: cardVerifyState.txRef, step: cardVerifyState.step, value, saveCard: cardVerifyState.saveCard
  });
  btn.disabled = false;
  await handleCardChargeResult(res, { saveCard: cardVerifyState ? cardVerifyState.saveCard : false, btn: null, statusEl });
}

function cancelCardVerification() {
  stopCardPolling();
  cardVerifyState = null;
  document.getElementById('card-verify-step').style.display = 'none';
  document.getElementById('card-entry-form').style.display = '';
  document.getElementById('card-status').textContent = '';
}

function pollCardVerify(txRef, statusEl) {
  stopCardPolling();
  const start = Date.now();
  cardPollTimer = setInterval(async () => {
    const res = await api('/deposit/card/verify', 'POST', { userId: USER_ID, txRef });
    if (res && res.status && res.status !== 'pending') {
      stopCardPolling();
      cardVerifyState = null;
      if (res.success) {
        statusEl.textContent = '';
        closeModal('deposit-modal');
        toast(`✓ Card deposit received — $${fmt(res.amountUSD)} added to balance`);
        await fetchStats();
      } else {
        statusEl.textContent = 'Payment was not completed. Please try again.';
      }
      return;
    }
    if (Date.now() - start > 3 * 60 * 1000) {
      stopCardPolling();
      statusEl.textContent = 'Still waiting on confirmation — check your transaction history shortly.';
    }
  }, 3000);
}

function updateMpesaEstimate() {
  const amountEl = document.getElementById('mpesa-amount');
  const estEl = document.getElementById('mpesa-usd-estimate');
  if (!amountEl || !estEl) return;
  const rate = (state.config && state.config.usdKesRate) || 129;
  const kes = parseFloat(amountEl.value) || 0;
  estEl.textContent = fmt(kes / rate);
}

let mpesaPollTimer = null;

function stopMpesaPolling() {
  if (mpesaPollTimer) { clearInterval(mpesaPollTimer); mpesaPollTimer = null; }
}

async function confirmMpesaDeposit() {
  const phone = document.getElementById('mpesa-phone').value.trim();
  const amountKES = parseFloat(document.getElementById('mpesa-amount').value);
  const statusEl = document.getElementById('mpesa-status');
  const btn = document.getElementById('mpesa-stk-btn');

  if (!phone) { toast('Enter your M-Pesa phone number', true); return; }
  if (!amountKES || amountKES < 10) { toast('Enter a valid amount', true); return; }

  btn.disabled = true;
  statusEl.textContent = 'Sending STK push…';

  const res = await api('/deposit/mpesa/initiate', 'POST', { userId: USER_ID, phone, amountKES });
  if (!res || res.error) {
    toast((res && res.error) || 'Could not start M-Pesa deposit', true);
    statusEl.textContent = '';
    btn.disabled = false;
    return;
  }

  statusEl.textContent = res.message || 'Check your phone and enter your M-Pesa PIN…';
  pollMpesaStatus(res.checkoutRequestId, btn, statusEl);
}

function pollMpesaStatus(checkoutRequestId, btn, statusEl) {
  stopMpesaPolling();
  const start = Date.now();
  mpesaPollTimer = setInterval(async () => {
    const res = await api(`/deposit/mpesa/status/${checkoutRequestId}?userId=${encodeURIComponent(USER_ID)}`);
    if (res && res.status && res.status !== 'pending') {
      stopMpesaPolling();
      btn.disabled = false;
      if (res.status === 'completed') {
        statusEl.textContent = '';
        closeModal('deposit-modal');
        toast(`✓ M-Pesa deposit received — $${fmt(res.amountUSD)} added to balance`);
        await fetchStats();
      } else if (res.status === 'expired') {
        statusEl.textContent = 'Request expired without a response. Please try again.';
      } else {
        statusEl.textContent = 'Payment was not completed. Please try again.';
      }
      return;
    }
    if (Date.now() - start > 3 * 60 * 1000) {
      stopMpesaPolling();
      btn.disabled = false;
      statusEl.textContent = 'Still waiting on M-Pesa — check your transaction history shortly.';
    }
  }, 3000);
}

const WALLET_ADDRESS_PATTERNS = {
  'USDT-TRC20': { re: /^T[a-zA-Z0-9]{33}$/, hint: 'Starts with T, 34 characters (TRON)' },
  'USDT-BEP20': { re: /^0x[a-fA-F0-9]{40}$/, hint: 'Starts with 0x, 42 characters (BSC)' },
  'USDT-ERC20': { re: /^0x[a-fA-F0-9]{40}$/, hint: 'Starts with 0x, 42 characters (Ethereum)' },
  'BTC':        { re: /^(bc1[a-z0-9]{25,39}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, hint: 'Starts with bc1, 1, or 3' },
  'ETH':        { re: /^0x[a-fA-F0-9]{40}$/, hint: 'Starts with 0x, 42 characters' },
};

function selWithdrawExchange(el) {
  document.querySelectorAll('#withdraw-exchange-grid .method-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function validateWithdrawAddress() {
  const netSel = document.getElementById('withdraw-network');
  const opt = netSel.selectedOptions[0];
  const min = opt.dataset.min, fee = opt.dataset.fee;
  document.getElementById('withdraw-network-info').textContent =
    `Minimum withdrawal: $${min} · Network fee: ${fee} ${opt.value.startsWith('USDT') ? 'USDT' : opt.value}`;

  const pattern = WALLET_ADDRESS_PATTERNS[opt.value];
  const addrInput = document.getElementById('withdraw-address');
  const hint = document.getElementById('withdraw-address-hint');
  const address = addrInput.value.trim();
  const btn = document.getElementById('withdraw-submit-btn');

  if (!address) {
    hint.textContent = pattern.hint;
    hint.style.color = 'var(--text-muted)';
    addrInput.style.borderColor = '';
    btn.disabled = false;
    return false;
  }
  const valid = pattern.re.test(address);
  hint.textContent = valid ? '✓ Address format looks valid' : `Invalid format — ${pattern.hint}`;
  hint.style.color = valid ? 'var(--green)' : 'var(--red)';
  addrInput.style.borderColor = valid ? 'var(--green)' : 'var(--red)';
  return valid;
}

async function confirmWithdraw() {
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const exchange = document.querySelector('#withdraw-exchange-grid .method-btn.active')?.dataset.exchange || 'Binance';
  const network = document.getElementById('withdraw-network').value;
  const min = parseFloat(document.getElementById('withdraw-network').selectedOptions[0].dataset.min);
  const address = document.getElementById('withdraw-address').value.trim();

  if (!address) { toast('Please enter a wallet address', true); return; }
  if (!validateWithdrawAddress()) { toast('That wallet address doesn\'t look valid for the selected network', true); return; }
  if (!amount || amount < min) { toast(`Minimum withdrawal for ${network} is $${min}`, true); return; }

  const destination = `${exchange} - ${network} — ${address}`;
  const btn = document.getElementById('withdraw-submit-btn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  const res = await api('/withdraw', 'POST', { userId: USER_ID, amount, destination, exchange, network, address });
  btn.disabled = false; btn.textContent = 'Request Withdrawal';
  if (!res || res.error) { toast(res?.error || 'Withdrawal failed', true); return; }
  closeModal('withdraw-modal');
  toast(`✓ Withdrawal of $${fmt(amount)} requested`);
  await fetchStats();
}

function updateWithdrawMpesaEstimate() {
  const amountEl = document.getElementById('withdraw-mpesa-amount');
  const estEl = document.getElementById('withdraw-mpesa-kes-estimate');
  if (!amountEl || !estEl) return;
  const rate = (state.config && state.config.usdKesRate) || 129;
  const usd = parseFloat(amountEl.value) || 0;
  estEl.textContent = fmt(usd * rate);
}

async function confirmWithdrawMpesa() {
  const phone = document.getElementById('withdraw-mpesa-phone').value.trim();
  const amount = parseFloat(document.getElementById('withdraw-mpesa-amount').value);
  const statusEl = document.getElementById('withdraw-mpesa-status');
  const btn = document.getElementById('withdraw-mpesa-btn');

  if (!phone) { toast('Enter your M-Pesa phone number', true); return; }
  if (!amount || amount < 10) { toast('Enter a valid amount', true); return; }

  btn.disabled = true; btn.textContent = 'Submitting…';
  statusEl.textContent = '';
  const res = await api('/withdraw/mpesa', 'POST', { userId: USER_ID, phone, amount });
  btn.disabled = false; btn.textContent = 'Request Withdrawal';
  if (!res || res.error) { toast((res && res.error) || 'Withdrawal failed', true); return; }
  closeModal('withdraw-modal');
  toast(`✓ Withdrawal of $${fmt(amount)} requested`);
  await fetchStats();
}

/* ── Calc helpers ───────────────────────────────────────────── */
function updateForexCalc() {
  const amount = parseFloat(document.getElementById('f-amount')?.value) || 100;
  const lev = parseInt(document.getElementById('f-leverage')?.value) || 50;
  const margin = (amount / lev).toFixed(2);
  const potPnl = (amount * lev * 0.005).toFixed(2);
  const mel = document.getElementById('f-margin'); if (mel) mel.textContent = '$' + fmt(parseFloat(margin));
  const pel = document.getElementById('f-pnl'); if (pel) pel.textContent = '$' + fmt(parseFloat(potPnl));
}

function updateBtCalc() {
  const type = state.contractType;
  const isOpenEnded = OPEN_ENDED_MARKET_TYPES.includes(type);
  const isScaledPayout = type === 'vanillas' || type === 'turbos';
  const stakeInput = document.getElementById('b-stake');
  let stake = parseFloat(stakeInput?.value) || 0;

  const sd = document.getElementById('b-stake-display'); if (sd) sd.textContent = '$' + fmt(stake);
  const pd = document.getElementById('b-payout-display');
  const bp = document.getElementById('bt-buy-payout');

  if (isOpenEnded) {
    const leverage = type === 'multipliers'
      ? (parseInt(document.getElementById('bt-multiplier-select')?.value, 10) || 1)
      : (ACCUMULATOR_LEVERAGES[parseInt(document.getElementById('bt-growth-select')?.value, 10)] || 1);
    if (pd) pd.textContent = '$' + fmt(stake * leverage);
    if (bp) bp.textContent = `Max loss $${fmt(stake)}`;
  } else if (isScaledPayout) {
    const maxPayout = stake * SCALED_PAYOUT_CAP;
    if (pd) pd.textContent = 'Up to $' + fmt(maxPayout);
    if (bp) bp.textContent = `Payout up to ${fmt(maxPayout)} USD`;
  } else {
    const pct = parseInt(document.getElementById('b-payout')?.value) || 85;
    const allowEqEl = document.getElementById('bt-allow-equals');
    const allowEq = !!(allowEqEl && allowEqEl.checked && type === 'rise_fall');
    const effPct = allowEq ? Math.max(1, pct - 5) : pct;
    const payout = stake * (1 + effPct / 100);
    if (pd) pd.textContent = '$' + fmt(payout);
    if (bp) bp.textContent = `Payout ${fmt(payout)} USD`;
  }

  if (BARRIER_MARKET_TYPES.includes(type)) updateBarrierPreview();

  updateBtDurationHint();
  const durSecs = btDurationToSeconds();
  const btn = document.getElementById('binary-submit');
  if (btn) {
    btn.disabled = isOpenEnded
      ? stake < 10
      : (!durSecs || durSecs < 1 || stake < 10 || stake > (stakeInput?.max ? parseFloat(stakeInput.max) : Infinity));
  }
}

// Kept as an alias — a couple of call sites elsewhere in the file predate
// the rename and are cheaper to bridge here than to hunt down individually.
function updateBinaryCalc() { updateBtCalc(); }

/* ── UI Actions ─────────────────────────────────────────────── */
function switchView(v, el) {
  document.querySelectorAll('.view').forEach(d => d.classList.remove('active'));
  const target = document.getElementById('view-' + v);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');

  state.currentView = v;

  document.body.classList.toggle('binary-fullwidth', v === 'binary');

  if (v === 'binary') {
    setTimeout(initBinaryChartView, 100);
    renderDigitPad();
    updateDigitStrip();
  }
  if (v === 'dashboard') setTimeout(initMainChart, 50);
  if (v === 'portfolio') setTimeout(initPortfolioChart, 100);
  if (v === 'smarttrader') { updateSmartCalc(); renderSmartInvestments(); }
  if (v === 'history') loadHistory();
  if (v === 'forex') {
    document.body.classList.add('forex-terminal');
    setTimeout(initForexTerminal, 50);
  } else {
    document.body.classList.remove('forex-terminal');
  }

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

function setDir(d) {
  state.fxDir = d;
  document.getElementById('f-buy').className = 'dir-btn btn-buy' + (d === 'buy' ? ' active' : '');
  document.getElementById('f-sell').className = 'dir-btn btn-sell' + (d === 'sell' ? ' active' : '');
}

/* ── Binary contract types (Deriv-style Digits/Rise-Fall/Barrier/Multiplier) ──
   Every market card on the grid is genuinely tradable now. Four categories:
     - digit:    over_under, matches_differs (+ even_odd, no digit pad)      — fixed expiry, digit pad
     - updown:   rise_fall, even_odd                                        — fixed expiry, simple direction
     - barrier:  higher_lower, touch_no_touch, vanillas, turbos             — fixed expiry, barrier/strike
     - open-ended: multipliers, accumulators                                — no expiry, closed manually
   Direction values are namespaced per contract type (not a flat map) since
   several categories reuse the same server-side values ('call'/'put' for
   both Rise/Fall and Vanillas, 'higher'/'lower' for both Higher/Lower and
   Turbos) against different DOM button groups. ── */
const BIN_DIR_GROUPS = {
  rise_fall: ['call', 'put'],
  over_under: ['over', 'under'],
  matches_differs: ['matches', 'differs'],
  even_odd: ['even', 'odd'],
  higher_lower: ['higher', 'lower'],
  touch_no_touch: ['touch', 'no_touch'],
  vanillas: ['call', 'put'],
  turbos: ['higher', 'lower'],
  multipliers: ['up', 'down']
};
const BIN_DIR_IDS = {
  rise_fall: { call: 'b-call', put: 'b-put' },
  over_under: { over: 'b-over', under: 'b-under' },
  matches_differs: { matches: 'b-matches', differs: 'b-differs' },
  even_odd: { even: 'b-even', odd: 'b-odd' },
  higher_lower: { higher: 'b-higher', lower: 'b-lower' },
  touch_no_touch: { touch: 'b-touch', no_touch: 'b-no_touch' },
  vanillas: { call: 'b-vcall', put: 'b-vput' },
  turbos: { higher: 'b-tlong', lower: 'b-tshort' },
  multipliers: { up: 'b-mup', down: 'b-mdown' }
};
const BIN_GROUP_ELS = {
  rise_fall: 'rise-fall-dirs',
  over_under: 'over-under-dirs',
  matches_differs: 'matches-differs-dirs',
  even_odd: 'even-odd-dirs',
  higher_lower: 'higher-lower-dirs',
  touch_no_touch: 'touch-no-touch-dirs',
  vanillas: 'vanillas-dirs',
  turbos: 'turbos-dirs',
  multipliers: 'multiplier-dirs'
};
const BIN_DEFAULT_DIR = {
  rise_fall: 'call', over_under: 'over', matches_differs: 'matches', even_odd: 'even',
  higher_lower: 'higher', touch_no_touch: 'touch', vanillas: 'call', turbos: 'higher', multipliers: 'up'
};
const BIN_DIR_LABELS = {
  rise_fall: { call: 'Rise', put: 'Fall' },
  over_under: { over: 'Over', under: 'Under' },
  matches_differs: { matches: 'Matches', differs: 'Differs' },
  even_odd: { even: 'Even', odd: 'Odd' },
  higher_lower: { higher: 'Higher', lower: 'Lower' },
  touch_no_touch: { touch: 'Touch', no_touch: 'No Touch' },
  vanillas: { call: 'Call', put: 'Put' },
  turbos: { higher: 'Long', lower: 'Short' },
  multipliers: { up: 'Up', down: 'Down' }
};
const DIGIT_PAD_MARKET_TYPES = ['over_under', 'matches_differs'];
const DIGIT_STREAM_MARKET_TYPES = ['over_under', 'matches_differs', 'even_odd'];
const BARRIER_MARKET_TYPES = ['higher_lower', 'touch_no_touch', 'vanillas', 'turbos'];
const OPEN_ENDED_MARKET_TYPES = ['multipliers', 'accumulators'];
const SCALED_PAYOUT_CAP = 5; // mirrors server's Vanillas/Turbos payout cap
const ACCUMULATOR_LEVERAGES = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 }; // mirrors server

function setBinDir(d) {
  state.binDir = d;
  const ids = BIN_DIR_IDS[state.contractType];
  (BIN_DIR_GROUPS[state.contractType] || []).forEach(opt => {
    const el = ids && document.getElementById(ids[opt]);
    if (el) el.classList.toggle('active', opt === d);
  });
  if (state.contractType === 'over_under') {
    if (d === 'over' && state.binDigit === 9) state.binDigit = 8;
    if (d === 'under' && state.binDigit === 0) state.binDigit = 1;
    renderDigitPad();
  }
  updateDigitStrip();
  updateBinaryCalc();
}

function priceDecimalsFor(pair) {
  if (!pair) return 5;
  if (pair.includes('BTC') || pair.includes('ETH')) return 0;
  if (pair.includes('XAU') || pair.includes('XAG')) return 2;
  if (pair.includes('JPY')) return 3;
  if (pair.includes('Volatility')) return 2;
  return 5;
}

// Sets a sensible default barrier/strike distance (~0.1% of spot) whenever a
// barrier contract type is selected or the underlying asset changes.
function resetBarrierDefault() {
  const input = document.getElementById('bt-barrier-distance');
  if (!input) return;
  const pair = document.getElementById('b-pair')?.value || currentBinaryPair();
  const spot = state.prices[pair] || 1;
  const decimals = priceDecimalsFor(pair);
  const step = 1 / Math.pow(10, decimals);
  const distance = Math.max(step, parseFloat((spot * 0.001).toFixed(decimals)));
  input.step = step.toFixed(decimals);
  input.value = distance;
}

function btStepBarrier(delta) {
  const input = document.getElementById('bt-barrier-distance');
  if (!input) return;
  const decimals = priceDecimalsFor(document.getElementById('b-pair')?.value);
  const step = 1 / Math.pow(10, decimals);
  let v = (parseFloat(input.value) || 0) + delta * step * 10;
  v = Math.max(step, v);
  input.value = parseFloat(v.toFixed(decimals));
  updateBtCalc();
}

function setBtBarrierSide(side) {
  state.barrierSide = side;
  document.getElementById('bt-side-above')?.classList.toggle('active', side === 'above');
  document.getElementById('bt-side-below')?.classList.toggle('active', side === 'below');
  updateBtCalc();
}

// Signed offset (server adds this to its own entry price to derive the
// barrier) — the user only ever enters a positive distance; which side of
// spot it lands on follows from the contract type + chosen direction.
function computeBarrierOffset() {
  const distance = Math.abs(parseFloat(document.getElementById('bt-barrier-distance')?.value)) || 0;
  const type = state.contractType, dir = state.binDir;
  if (type === 'higher_lower') return dir === 'higher' ? distance : -distance;
  if (type === 'vanillas') return dir === 'call' ? distance : -distance;
  if (type === 'turbos') return dir === 'higher' ? -distance : distance;
  if (type === 'touch_no_touch') return state.barrierSide === 'below' ? -distance : distance;
  return 0;
}

function updateBarrierPreview() {
  const preview = document.getElementById('bt-barrier-preview');
  if (!preview) return;
  const pair = document.getElementById('b-pair')?.value || currentBinaryPair();
  const spot = state.prices[pair];
  if (!spot) { preview.textContent = ''; return; }
  const barrier = spot + computeBarrierOffset();
  preview.textContent = `Barrier: ${fmtPrice(pair, barrier)} · Spot: ${fmtPrice(pair, spot)}`;
}

function setContractType(type) {
  state.contractType = type;
  state.binDir = BIN_DEFAULT_DIR[type] || null;
  if (type === 'over_under' && (state.binDigit === 9 || state.binDigit === undefined)) state.binDigit = 4;
  if (type === 'matches_differs' && state.binDigit === undefined) state.binDigit = 5;
  if (type === 'touch_no_touch' && !state.barrierSide) state.barrierSide = 'above';

  Object.values(BIN_GROUP_ELS).forEach(id => { document.getElementById(id).style.display = 'none'; });
  if (BIN_GROUP_ELS[type]) {
    document.getElementById(BIN_GROUP_ELS[type]).style.display = 'grid';
    const ids = BIN_DIR_IDS[type];
    (BIN_DIR_GROUPS[type] || []).forEach(opt => {
      const dEl = ids && document.getElementById(ids[opt]);
      if (dEl) dEl.classList.toggle('active', opt === state.binDir);
    });
  }

  const needsDigitPad = DIGIT_PAD_MARKET_TYPES.includes(type);
  document.getElementById('digit-pad-group').style.display = needsDigitPad ? 'flex' : 'none';
  if (needsDigitPad) document.getElementById('digit-pad-label').textContent = type === 'over_under' ? 'Barrier Digit' : 'Prediction Digit';
  document.getElementById('digit-strip-wrap').style.display = DIGIT_STREAM_MARKET_TYPES.includes(type) ? 'flex' : 'none';

  const eqRow = document.getElementById('bt-allow-equals-row');
  if (eqRow) eqRow.style.display = type === 'rise_fall' ? 'flex' : 'none';
  if (type !== 'rise_fall') {
    const eqBox = document.getElementById('bt-allow-equals');
    if (eqBox) eqBox.checked = false;
  }

  const isBarrier = BARRIER_MARKET_TYPES.includes(type);
  const barrierGroup = document.getElementById('bt-barrier-group');
  if (barrierGroup) barrierGroup.style.display = isBarrier ? 'block' : 'none';
  const touchSideRow = document.getElementById('bt-touch-side-row');
  if (touchSideRow) touchSideRow.style.display = type === 'touch_no_touch' ? 'grid' : 'none';
  if (isBarrier) {
    const labelEl = document.getElementById('bt-barrier-label');
    if (labelEl) labelEl.textContent = type === 'vanillas' ? 'Strike distance from spot' : 'Barrier distance from spot';
    resetBarrierDefault();
  }

  const isMultiplier = type === 'multipliers';
  const isAccumulator = type === 'accumulators';
  const isOpenEnded = isMultiplier || isAccumulator;
  const multGroup = document.getElementById('bt-multiplier-group'); if (multGroup) multGroup.style.display = isMultiplier ? 'block' : 'none';
  const growthGroup = document.getElementById('bt-growth-group'); if (growthGroup) growthGroup.style.display = isAccumulator ? 'block' : 'none';
  const durGroup = document.getElementById('bt-duration-group'); if (durGroup) durGroup.style.display = isOpenEnded ? 'none' : 'block';
  const advToggle = document.getElementById('bt-payout-adv-toggle');
  if (advToggle) advToggle.style.display = isOpenEnded ? 'none' : 'flex';
  if (isOpenEnded) {
    const adv = document.getElementById('bt-advanced'); if (adv) adv.style.display = 'none';
    advToggle?.classList.remove('active');
  }

  const stakeLabel = document.getElementById('b-stake-label');
  if (stakeLabel) stakeLabel.textContent = isOpenEnded ? 'Stake at risk' : 'Stake';
  const payoutLabel = document.getElementById('b-payout-label');
  if (payoutLabel) payoutLabel.textContent = isOpenEnded ? 'Exposure' : ((type === 'vanillas' || type === 'turbos') ? 'Max payout' : 'If correct');
  const buyLabel = document.getElementById('bt-buy-label');
  if (buyLabel) buyLabel.textContent = isOpenEnded ? 'Open Position' : 'Buy';

  if (needsDigitPad) renderDigitPad();
  updateDigitStrip();
  updateBtCalc();
}

/* ── Market types grid (Deriv-style, right-hand panel) ────────── */
const MARKET_LABELS = {
  rise_fall: 'Rise/Fall', higher_lower: 'Higher/Lower', matches_differs: 'Matches/Differs',
  even_odd: 'Even/Odd', accumulators: 'Accumulators', over_under: 'Over/Under',
  multipliers: 'Multipliers', touch_no_touch: 'Touch/No Touch', vanillas: 'Vanillas', turbos: 'Turbos'
};

/* ── Binary Trader — full-screen Deriv-style terminal ─────────────
   Opened whenever a market card (or a "Select for Trading" pick from
   the live Deriv catalog) is clicked. Reuses the same asset/direction/
   digit-pad/stake/payout elements the old embedded ticket used (they've
   simply moved into #bt-overlay), so setBinDir/setContractType/
   placeBinaryTrade/renderDigitPad etc. all keep working unchanged. ── */
function openBinaryTerminal(type, el) {
  state.selectedMarketType = type;
  document.querySelectorAll('.market-card').forEach(c => c.classList.remove('active'));
  (el || document.querySelector(`.market-card[data-market="${type}"]`))?.classList.add('active');

  const label = MARKET_LABELS[type] || type;
  const subEl = document.getElementById('bt-symbol-sub');
  if (subEl) subEl.textContent = label;
  const howtoEl = document.getElementById('bt-howto-label');
  if (howtoEl) howtoEl.textContent = label;
  const howtoModalEl = document.getElementById('bt-howto-modal-label');
  if (howtoModalEl) howtoModalEl.textContent = label;

  setContractType(type);

  document.getElementById('bt-overlay').classList.add('open');
  document.body.classList.add('bt-open');
  state.bt.open = true;
  updateBtSymbolHeader();
  updateBtAccountInfo();
  onBtDurationUnitChange();
  updateBtCalc();
  setTimeout(initBtChart, 30);
}

function closeBinaryTerminal() {
  document.getElementById('bt-overlay').classList.remove('open');
  document.body.classList.remove('bt-open');
  state.bt.open = false;
  closeBtAccountMenu();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.bt.open) closeBinaryTerminal();
});

function updateBtSymbolHeader() {
  const pair = currentBinaryPair();
  const nameEl = document.getElementById('bt-symbol-name');
  if (nameEl) nameEl.textContent = pair;
}

function updateBtAccountInfo() {
  const bal = '$' + fmt(state.balance || 0);
  const balEl = document.getElementById('bt-balance');
  if (balEl) balEl.textContent = bal + ' USD';
  const menuBalEl = document.getElementById('bt-account-menu-balance');
  if (menuBalEl) menuBalEl.textContent = bal;
}

function updateBtFooterClock() {
  if (!state.bt.open) return;
  const el = document.getElementById('bt-footer-datetime');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + now.toLocaleTimeString(undefined, { hour12: false });
}

function toggleBtAccountMenu(e) {
  e.stopPropagation();
  document.getElementById('bt-account-toggle')?.classList.toggle('open');
}
function closeBtAccountMenu() {
  document.getElementById('bt-account-toggle')?.classList.remove('open');
}
document.addEventListener('click', e => {
  const acct = document.getElementById('bt-account-toggle');
  if (acct && !acct.contains(e.target)) acct.classList.remove('open');
});

function toggleBtAvatarMenu(e) {
  e.stopPropagation();
  document.getElementById('bt-avatar-dropdown')?.classList.toggle('open');
}
function closeBtAvatarMenu() {
  document.getElementById('bt-avatar-dropdown')?.classList.remove('open');
}
function goToAccountSettingsFromBt() {
  closeBtAvatarMenu();
  closeBinaryTerminal();
  switchView('settings', document.querySelector('.nav-item[data-view="settings"]'));
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('bt-avatar-menu');
  if (wrap && !wrap.contains(e.target)) closeBtAvatarMenu();
});

function openBtHowTo() {
  const body = document.getElementById('bt-howto-modal-body');
  if (body) body.textContent = BT_HOWTO_TEXT[state.selectedMarketType] || 'Pick a direction, a duration and a stake, then press Buy.';
  openModal('bt-howto-modal');
}

function toggleBtAdvanced() {
  const el = document.getElementById('bt-advanced');
  const btn = document.querySelector('.bt-ticket-settings');
  if (!el) return;
  const show = el.style.display === 'none';
  el.style.display = show ? 'flex' : 'none';
  btn?.classList.toggle('active', show);
}

/* ── Binary Trader — candlestick chart engine ──────────────────────
   Same lightweight-charts library the Forex terminal uses. Candle
   history is synthesized client-side as a random walk ending at the
   live price (there's no historical tick store on the server), then
   kept in sync with real polled/streamed ticks tick-by-tick — same
   approach as the Forex terminal's synthesizeCandles(). Bar size
   scales with the selected contract duration so a 5-tick contract
   shows ~1s bars while a 1-day contract shows hourly bars. ────────── */
function btRound(pair, v) {
  return parseFloat(v.toFixed(digitDecimals(pair)));
}

function btTfLabel(ms) {
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  if (ms < 86400000) return Math.round(ms / 3600000) + 'h';
  return Math.round(ms / 86400000) + 'd';
}

function btBarMsForDuration(durSecs) {
  if (!durSecs) return 60000;
  if (durSecs <= 60) return 1000;
  if (durSecs <= 3600) return 60000;
  if (durSecs <= 86400) return 900000;
  return 3600000;
}

function initBtChart() {
  if (!window.LightweightCharts) return;
  const container = document.getElementById('bt-chart-container');
  if (!container) return;

  if (!state.bt.chart) {
    const cs = getComputedStyle(document.body);
    const textMuted = cs.getPropertyValue('--text-muted').trim();
    state.bt.chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { color: 'transparent' }, textColor: textMuted },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' }
      },
      timeScale: { timeVisible: true, secondsVisible: true },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false }
    });
    state.bt.series = state.bt.chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444'
    });
    new ResizeObserver(() => {
      if (!state.bt.chart) return;
      state.bt.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      resizeBtDrawCanvas();
      redrawBtDrawings();
    }).observe(container);
    initBtDrawing();
  }
  synthesizeBtCandles();
}

function synthesizeBtCandles() {
  if (!state.bt.series) return;
  const pair = currentBinaryPair();
  const price = state.prices[pair];
  if (!price) return;

  const durSecs = btDurationToSeconds();
  const barMs = btBarMsForDuration(durSecs);
  state.bt.barMs = barMs;
  const tfBadge = document.getElementById('bt-tf-badge');
  if (tfBadge) tfBadge.textContent = btTfLabel(barMs);

  const tickStep = price > 1000 ? 0.003 : 0.0003;
  const ticksPerBar = Math.max(1, barMs / 1500);
  const barVol = Math.max(price * 0.00001, price * tickStep * Math.sqrt(ticksPerBar));
  const bars = 150;
  const barStart = Math.floor(Date.now() / barMs) * barMs;

  const closes = new Array(bars);
  closes[bars - 1] = price;
  for (let i = bars - 2; i >= 0; i--) closes[i] = closes[i + 1] - (Math.random() - 0.5) * barVol;

  const out = [];
  for (let i = 0; i < bars; i++) {
    const time = Math.floor((barStart - (bars - 1 - i) * barMs) / 1000);
    const open = i === 0 ? closes[0] - (Math.random() - 0.5) * barVol * 0.5 : closes[i - 1];
    const close = closes[i];
    const hi = Math.max(open, close) + Math.random() * barVol * 0.4;
    const lo = Math.min(open, close) - Math.random() * barVol * 0.4;
    out.push({ time, open: btRound(pair, open), high: btRound(pair, hi), low: btRound(pair, lo), close: btRound(pair, close) });
  }

  state.bt.candles[pair] = out;
  state.bt.series.setData(state.bt.chartType === 'line' ? out.map(b => ({ time: b.time, value: b.close })) : out);
  syncBtPriceLines(pair);
  redrawBtDrawings();
  updateBtIndicators();
  updateBtOhlcBox(out[out.length - 1], true);
}

function updateBtLiveCandle() {
  if (!state.bt.series) return;
  const pair = currentBinaryPair();
  const price = state.prices[pair];
  if (!price) return;
  const bars = state.bt.candles[pair];
  if (!bars || !bars.length) return;

  const barMs = state.bt.barMs;
  const barTime = Math.floor(Date.now() / barMs) * barMs / 1000;
  const last = bars[bars.length - 1];
  const rounded = btRound(pair, price);
  let updated;

  if (barTime === last.time) {
    last.close = rounded;
    last.high = Math.max(last.high, rounded);
    last.low = Math.min(last.low, rounded);
    updated = last;
  } else if (barTime > last.time) {
    updated = { time: barTime, open: last.close, high: rounded, low: rounded, close: rounded };
    bars.push(updated);
    if (bars.length > 300) bars.shift();
  } else {
    return;
  }

  state.bt.series.update(state.bt.chartType === 'line' ? { time: updated.time, value: updated.close } : updated);
  redrawBtDrawings();
  updateBtIndicators();
  updateBtOhlcBox(updated, true);
}

function setBtChartType(type) {
  if (!state.bt.chart || type === state.bt.chartType) return;
  state.bt.chartType = type;
  document.getElementById('bt-ct-candle').classList.toggle('active', type === 'candlestick');
  document.getElementById('bt-ct-line').classList.toggle('active', type === 'line');
  document.getElementById('bt-ct-bar').classList.toggle('active', type === 'bar');

  const pair = currentBinaryPair();
  const bars = state.bt.candles[pair] || [];
  state.bt.chart.removeSeries(state.bt.series);
  state.bt.activePriceLines = [];
  if (type === 'line') {
    state.bt.series = state.bt.chart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5 });
    state.bt.series.setData(bars.map(b => ({ time: b.time, value: b.close })));
  } else if (type === 'bar') {
    state.bt.series = state.bt.chart.addBarSeries({ upColor: '#22c55e', downColor: '#ef4444' });
    state.bt.series.setData(bars);
  } else {
    state.bt.series = state.bt.chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444'
    });
    state.bt.series.setData(bars);
  }
  syncBtPriceLines(pair);
  redrawBtDrawings();
  updateBtIndicators();
}

function btZoom(dir) {
  if (!state.bt.chart) return;
  const ts = state.bt.chart.timeScale();
  const spacing = ts.options().barSpacing || 6;
  ts.applyOptions({ barSpacing: Math.max(2, Math.min(60, spacing + dir * 2)) });
}
function btZoomReset() {
  state.bt.chart?.timeScale().fitContent();
}

function downloadBtChart() {
  if (!state.bt.chart) { toast('Chart not ready yet', true); return; }
  const canvas = state.bt.chart.takeScreenshot();
  const link = document.createElement('a');
  link.download = `${currentBinaryPair().replace('/', '')}_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function toggleBtFullscreen() {
  const el = document.querySelector('.bt-terminal');
  if (!document.fullscreenElement) el?.requestFullscreen?.();
  else document.exitFullscreen?.();
}

/* ── OHLC readout — top-left box, driven by crosshair hover ───────── */
function updateBtOhlcBox(bar, isLive) {
  const box = document.getElementById('bt-ohlc-box');
  if (!box || !bar) return;
  const pair = currentBinaryPair();
  const up = bar.close >= bar.open;
  const timeStr = isLive ? 'Live' : new Date(bar.time * 1000).toLocaleString();
  box.style.display = 'block';
  box.innerHTML = `<span class="bt-ohlc-time">${escapeHtml(pair)} &middot; ${timeStr}</span>` +
    `O <b>${fmtPrice(pair, bar.open)}</b>&nbsp;&nbsp;H <b class="up">${fmtPrice(pair, bar.high)}</b>&nbsp;&nbsp;` +
    `L <b class="down">${fmtPrice(pair, bar.low)}</b>&nbsp;&nbsp;C <b class="${up ? 'up' : 'down'}">${fmtPrice(pair, bar.close)}</b>`;
}

/* ── Drawing tools (trend line / horizontal line / Fibonacci) ─────
   Mirrors the Forex terminal's drawing engine (see initMtDrawing and
   neighbors) against state.bt instead of state.mt, keyed by pair
   instead of pair+timeframe since the binary chart has one timeframe
   per pair at a time. ──────────────────────────────────────────── */
function btKey() { return currentBinaryPair(); }

function initBtDrawing() {
  const canvas = document.getElementById('bt-draw-canvas');
  if (!canvas || state.bt.drawCanvas) return;
  state.bt.drawCanvas = canvas;
  resizeBtDrawCanvas();
  state.bt.chart.subscribeClick(onBtChartClick);
  state.bt.chart.subscribeCrosshairMove(onBtChartCrosshair);
  state.bt.chart.timeScale().subscribeVisibleTimeRangeChange(redrawBtDrawings);
}

function resizeBtDrawCanvas() {
  const canvas = state.bt.drawCanvas;
  const container = document.getElementById('bt-chart-container');
  if (!canvas || !container) return;
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth, h = container.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.bt.drawCtx = ctx;
}

function setBtTool(tool, el) {
  state.bt.tool = tool;
  state.bt.pendingPoint = null;
  state.bt.previewPoint = null;
  document.querySelectorAll('#bt-tools-rail .bt-drawtool').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  redrawBtDrawings();
}

function onBtChartClick(param) {
  if (!state.bt.series || !param.point || param.time === undefined) return;
  const priceVal = state.bt.series.coordinateToPrice(param.point.y);
  if (priceVal == null) return;
  const pair = currentBinaryPair();
  const point = { time: param.time, price: btRound(pair, priceVal) };
  const key = btKey();

  if (state.bt.tool === 'cursor') {
    hitTestAndDeleteBtDrawing(param.point);
    return;
  }
  if (state.bt.tool === 'hline') {
    if (!state.bt.drawings[key]) state.bt.drawings[key] = [];
    state.bt.drawings[key].push({ type: 'hline', price: point.price });
    syncBtPriceLines(key);
    toast('Horizontal line added');
    return;
  }
  if (state.bt.tool === 'trendline' || state.bt.tool === 'fib') {
    if (!state.bt.pendingPoint) { state.bt.pendingPoint = point; return; }
    if (!state.bt.drawings[key]) state.bt.drawings[key] = [];
    state.bt.drawings[key].push({ type: state.bt.tool, p1: state.bt.pendingPoint, p2: point });
    state.bt.pendingPoint = null;
    state.bt.previewPoint = null;
    if (state.bt.tool === 'fib') syncBtPriceLines(key);
    redrawBtDrawings();
    toast((state.bt.tool === 'fib' ? 'Fibonacci' : 'Trend line') + ' added');
  }
}

function onBtChartCrosshair(param) {
  if (state.bt.pendingPoint && (state.bt.tool === 'trendline' || state.bt.tool === 'fib') && param.point) {
    state.bt.previewPoint = { x: param.point.x, y: param.point.y };
    redrawBtDrawings();
  }

  const pair = currentBinaryPair();
  if (!param.point || param.time === undefined || !param.seriesData || !state.bt.series) {
    const bars = state.bt.candles[pair];
    if (bars && bars.length) updateBtOhlcBox(bars[bars.length - 1], true);
    return;
  }
  const d = param.seriesData.get(state.bt.series);
  if (!d) return;
  const val = d.value !== undefined ? d.value : d.close;
  updateBtOhlcBox({
    time: param.time,
    open: d.open !== undefined ? d.open : val,
    high: d.high !== undefined ? d.high : val,
    low: d.low !== undefined ? d.low : val,
    close: val
  }, false);
}

function redrawBtDrawings() {
  const canvas = state.bt.drawCanvas, ctx = state.bt.drawCtx;
  if (!canvas || !ctx || !state.bt.chart || !state.bt.series) return;
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const timeScale = state.bt.chart.timeScale();
  (state.bt.drawings[btKey()] || []).filter(d => d.type === 'trendline').forEach(d => {
    const x1 = timeScale.timeToCoordinate(d.p1.time);
    const y1 = state.bt.series.priceToCoordinate(d.p1.price);
    const x2 = timeScale.timeToCoordinate(d.p2.time);
    const y2 = state.bt.series.priceToCoordinate(d.p2.price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  if (state.bt.pendingPoint && state.bt.previewPoint) {
    const x1 = timeScale.timeToCoordinate(state.bt.pendingPoint.time);
    const y1 = state.bt.series.priceToCoordinate(state.bt.pendingPoint.price);
    if (x1 != null && y1 != null) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(state.bt.previewPoint.x, state.bt.previewPoint.y);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function btPxToPriceDelta(px) {
  const p0 = state.bt.series.coordinateToPrice(0);
  const p1 = state.bt.series.coordinateToPrice(px);
  if (p0 == null || p1 == null) return Infinity;
  return Math.abs(p1 - p0);
}

function hitTestAndDeleteBtDrawing(point) {
  const key = btKey();
  const drawings = state.bt.drawings[key] || [];
  const clickPrice = state.bt.series.coordinateToPrice(point.y);
  const priceTolerance = btPxToPriceDelta(6);
  const timeScale = state.bt.chart.timeScale();

  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    let hit = false;

    if (d.type === 'trendline') {
      const x1 = timeScale.timeToCoordinate(d.p1.time);
      const y1 = state.bt.series.priceToCoordinate(d.p1.price);
      const x2 = timeScale.timeToCoordinate(d.p2.time);
      const y2 = state.bt.series.priceToCoordinate(d.p2.price);
      if (x1 != null && y1 != null && x2 != null && y2 != null) {
        hit = distToSegment(point.x, point.y, x1, y1, x2, y2) <= 6;
      }
    } else if (d.type === 'hline' && clickPrice != null) {
      hit = Math.abs(clickPrice - d.price) <= priceTolerance;
    } else if (d.type === 'fib' && clickPrice != null) {
      const high = Math.max(d.p1.price, d.p2.price);
      const low = Math.min(d.p1.price, d.p2.price);
      const diff = high - low;
      hit = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].some(level => Math.abs(clickPrice - (high - diff * level)) <= priceTolerance);
    }

    if (hit) {
      drawings.splice(i, 1);
      if (d.type === 'hline' || d.type === 'fib') syncBtPriceLines(key);
      redrawBtDrawings();
      toast('Drawing removed');
      return;
    }
  }
}

function syncBtPriceLines(key) {
  if (!state.bt.series) return;
  state.bt.activePriceLines.forEach(line => {
    try { state.bt.series.removePriceLine(line); } catch (e) { /* series was swapped, handle already gone */ }
  });
  state.bt.activePriceLines = [];

  (state.bt.drawings[key] || []).forEach(d => {
    if (d.type === 'hline') {
      state.bt.activePriceLines.push(state.bt.series.createPriceLine({
        price: d.price, color: '#38bdf8', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: ''
      }));
    } else if (d.type === 'fib') {
      const high = Math.max(d.p1.price, d.p2.price);
      const low = Math.min(d.p1.price, d.p2.price);
      const diff = high - low;
      [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach(level => {
        state.bt.activePriceLines.push(state.bt.series.createPriceLine({
          price: btRound(currentBinaryPair(), high - diff * level), color: '#f59e0b', lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: (level * 100).toFixed(1) + '%'
        }));
      });
    }
  });
}

/* ── Indicators (SMA / EMA) — reuses computeSMA/computeEMA from the
   Forex terminal (pure functions, no state.mt coupling). ─────────── */
function updateBtIndicators() {
  if (!state.bt.chart) return;
  const bars = state.bt.candles[btKey()] || [];
  Object.values(state.bt.indicators).forEach(ind => {
    if (!ind.active) return;
    if (!ind.series) ind.series = state.bt.chart.addLineSeries({ color: ind.color, lineWidth: 1 });
    ind.series.setData(ind.type === 'sma' ? computeSMA(bars, ind.period) : computeEMA(bars, ind.period));
  });
}

function openBtIndicatorModal() {
  const el = document.getElementById('bt-indicator-list');
  el.innerHTML = Object.entries(state.bt.indicators).map(([key, ind]) => `
    <div class="settings-row">
      <span>${BT_INDICATOR_LABELS[key]}</span>
      <button class="btn-outline" onclick="toggleBtIndicator('${key}')">${ind.active ? 'Remove' : 'Add'}</button>
    </div>
  `).join('');
  openModal('bt-indicator-modal');
}

function toggleBtIndicator(key) {
  const ind = state.bt.indicators[key];
  if (!ind) return;
  if (ind.active) {
    if (ind.series) { state.bt.chart.removeSeries(ind.series); ind.series = null; }
    ind.active = false;
  } else {
    ind.active = true;
    updateBtIndicators();
  }
  openBtIndicatorModal();
}

/* ── Duration unit control (Ticks/Seconds/Minutes/Hours/Days/End Time)
   Ticks convert to seconds using the platform's configured tick speed
   (admin-managed, see fetchConfig) so "5 ticks" always reflects how
   often prices actually move on this server. ─────────────────────── */
function btDurationToSeconds() {
  const unit = document.getElementById('bt-duration-unit')?.value || 'm';
  if (unit === 'endtime') {
    const val = document.getElementById('bt-duration-endtime')?.value;
    if (!val) return 0;
    const ms = new Date(val).getTime() - Date.now();
    return ms > 0 ? Math.round(ms / 1000) : 0;
  }
  const n = parseFloat(document.getElementById('bt-duration-value')?.value) || 0;
  const tickMs = (state.config && state.config.priceUpdateSpeedMs) || 500;
  switch (unit) {
    case 't': return Math.round(n * tickMs / 10) / 100;
    case 's': return n;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    case 'm':
    default: return n * 60;
  }
}

function btFormatDuration(secs) {
  if (secs < 60) return (secs < 10 ? secs.toFixed(1) : Math.round(secs)) + 's';
  if (secs < 3600) return Math.round(secs / 60) + 'm';
  if (secs < 86400) return (secs / 3600).toFixed(1) + 'h';
  return (secs / 86400).toFixed(1) + 'd';
}

function updateBtDurationHint() {
  const hint = document.getElementById('bt-duration-hint');
  if (!hint) return;
  const unit = document.getElementById('bt-duration-unit')?.value || 'm';
  const secs = btDurationToSeconds();
  if (unit === 'endtime') {
    hint.textContent = secs > 0 ? `Expires in ${btFormatDuration(secs)}` : 'Pick a time in the future';
    hint.style.color = secs > 0 ? '' : 'var(--red)';
  } else if (unit === 't') {
    hint.textContent = `≈ ${btFormatDuration(secs)} at the current tick speed`;
    hint.style.color = '';
  } else {
    hint.textContent = '';
  }
}

function onBtDurationUnitChange() {
  const unit = document.getElementById('bt-duration-unit')?.value || 'm';
  const valWrap = document.getElementById('bt-duration-value-wrap');
  const endInput = document.getElementById('bt-duration-endtime');
  const valInput = document.getElementById('bt-duration-value');
  if (!valWrap || !endInput || !valInput) return;

  if (unit === 'endtime') {
    valWrap.style.display = 'none';
    endInput.style.display = 'block';
    if (!endInput.value) {
      const d = new Date(Date.now() + 15 * 60000);
      d.setSeconds(0, 0);
      endInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
  } else {
    valWrap.style.display = 'flex';
    endInput.style.display = 'none';
    const [min, max] = BT_DURATION_BOUNDS[unit] || [1, 1440];
    valInput.min = min; valInput.max = max;
    let v = parseInt(valInput.value, 10) || min;
    v = Math.min(max, Math.max(min, v));
    valInput.value = v;
  }
  updateBtDurationHint();
  updateBtCalc();
  if (state.bt.open) synthesizeBtCandles();
}

function btStepDuration(delta) {
  const unit = document.getElementById('bt-duration-unit')?.value || 'm';
  if (unit === 'endtime') return;
  const input = document.getElementById('bt-duration-value');
  const [min, max] = BT_DURATION_BOUNDS[unit] || [1, 1440];
  let v = (parseInt(input.value, 10) || min) + delta;
  v = Math.min(max, Math.max(min, v));
  input.value = v;
  updateBtCalc();
  if (state.bt.open) synthesizeBtCandles();
}

function btStepStake(delta) {
  const input = document.getElementById('b-stake');
  const max = parseFloat(input.max) || 5000;
  const min = parseFloat(input.min) || 10;
  let v = (parseFloat(input.value) || 0) + delta;
  v = Math.min(max, Math.max(min, v));
  input.value = v;
  updateBtCalc();
}

/* ── Asset dropdown, driven by the server's live-priced Deriv set ──── */
function buildBinaryAssetSelect() {
  const sel = document.getElementById('b-pair');
  if (!sel) return;
  const prevValue = sel.value;
  const fx = [], synth = [];
  Object.keys(state.prices).forEach(p => (p.startsWith('Volatility') ? synth : fx).push(p));
  const opts = (arr) => arr.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  sel.innerHTML =
    (fx.length ? `<optgroup label="Forex &amp; Crypto">${opts(fx)}</optgroup>` : '') +
    (synth.length ? `<optgroup label="Synthetic Indices">${opts(synth)}</optgroup>` : '');
  if (fx.includes(prevValue) || synth.includes(prevValue)) sel.value = prevValue;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Live Deriv Markets browser ──────────────────────────────────────
   Pulls Deriv's full public instrument catalog (active_symbols, cached
   server-side and refreshed every 30s — no login/OAuth/token) and renders
   it grouped and labelled exactly as Deriv does: market_display_name,
   submarket_display_name and display_name verbatim from the API. ──── */
function pipDecimals(pip) {
  if (!pip || pip <= 0) return 2;
  return Math.max(0, Math.round(-Math.log10(pip)));
}

async function loadDerivMarketCatalog() {
  const badge = document.getElementById('dm-live-badge');
  try {
    const res = await fetch(API + '/deriv/symbols');
    const data = await res.json();
    state.derivCatalog = data.symbols || [];
    if (badge) badge.classList.remove('mib-offline');
    buildDerivMarketFilters();
    renderDerivMarkets();
  } catch (e) {
    state.derivCatalog = [];
    if (badge) { badge.classList.add('mib-offline'); badge.textContent = 'Offline'; }
    const list = document.getElementById('dm-list');
    if (list) list.innerHTML = '<div class="empty-state"><i class="ti ti-cloud-off"></i><p>Could not reach Deriv\'s live market feed right now.</p></div>';
  }
}

function buildDerivMarketFilters() {
  const wrap = document.getElementById('dm-filters');
  if (!wrap) return;
  const markets = [...new Set(state.derivCatalog.map(s => s.marketDisplay).filter(Boolean))];
  state.derivFilter = state.derivFilter || 'all';
  wrap.innerHTML = ['<button class="dm-chip' + (state.derivFilter === 'all' ? ' active' : '') + '" onclick="selectDerivFilter(\'all\',this)">All Markets</button>']
    .concat(markets.map(m => `<button class="dm-chip${state.derivFilter === m ? ' active' : ''}" onclick="selectDerivFilter('${m.replace(/'/g, "\\'")}',this)">${escapeHtml(m)}</button>`))
    .join('');
}

function selectDerivFilter(market, el) {
  state.derivFilter = market;
  document.querySelectorAll('#dm-filters .dm-chip').forEach(c => c.classList.remove('active'));
  el?.classList.add('active');
  renderDerivMarkets();
}

function renderDerivMarkets() {
  const list = document.getElementById('dm-list');
  if (!list) return;
  const term = (document.getElementById('dm-search')?.value || '').toLowerCase().trim();
  const filter = state.derivFilter || 'all';

  const rows = state.derivCatalog.filter(s => {
    if (filter !== 'all' && s.marketDisplay !== filter) return false;
    if (term && !s.pair.toLowerCase().includes(term)) return false;
    return true;
  });

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state"><i class="ti ti-search-off"></i><p>No markets match your search.</p></div>';
    return;
  }

  // Group by Deriv's own submarket_display_name, in catalog order.
  const groups = [];
  const groupIndex = new Map();
  rows.forEach(s => {
    const key = s.submarketDisplay || s.marketDisplay || 'Other';
    if (!groupIndex.has(key)) { groupIndex.set(key, groups.length); groups.push({ title: key, rows: [] }); }
    groups[groupIndex.get(key)].rows.push(s);
  });

  list.innerHTML = groups.map(g => `
    <div class="dm-group-title">${escapeHtml(g.title)}</div>
    ${g.rows.map(s => {
      const tradable = state.prices[s.pair] !== undefined;
      const decimals = pipDecimals(s.pip);
      const price = tradable ? state.prices[s.pair] : s.spot;
      const priceStr = Number.isFinite(price) ? price.toFixed(decimals) : '&mdash;';
      return `
        <div class="dm-row${state.derivFocusSymbol === s.symbol ? ' active' : ''}" onclick="focusDerivSymbol('${s.symbol}')">
          <span class="dm-dot${s.exchangeOpen ? ' open' : ''}" title="${s.exchangeOpen ? 'Market open' : 'Market closed'}"></span>
          <div class="dm-row-name">
            <div class="dm-row-pair">${escapeHtml(s.pair)}${tradable ? ' <span class="dm-tradable">Tradable</span>' : ''}</div>
            <div class="dm-row-sub">${escapeHtml(s.marketDisplay || '')}</div>
          </div>
          <div class="dm-row-price" data-symbol="${s.symbol}">${priceStr}</div>
        </div>`;
    }).join('')}
  `).join('');
}

// Lightweight per-tick refresh — updates price text in place instead of
// rebuilding the whole list, so scrolling/search state isn't disturbed.
function updateDerivMarketPrices() {
  if (!state.derivCatalog) return;
  document.querySelectorAll('#dm-list .dm-row-price').forEach(el => {
    const entry = state.derivCatalog.find(s => s.symbol === el.dataset.symbol);
    if (!entry) return;
    const tradable = state.prices[entry.pair] !== undefined;
    const price = tradable ? state.prices[entry.pair] : entry.spot;
    const decimals = pipDecimals(entry.pip);
    el.textContent = Number.isFinite(price) ? price.toFixed(decimals) : '—';
  });
}

async function focusDerivSymbol(symbol) {
  state.derivFocusSymbol = symbol;
  renderDerivMarkets();
  const entry = state.derivCatalog.find(s => s.symbol === symbol);
  const detail = document.getElementById('dm-detail');
  if (!entry || !detail) return;

  detail.style.display = 'block';
  detail.innerHTML = `<span class="mib-live">Live &middot; Deriv API</span><br>Fetching contract types for <b>${escapeHtml(entry.pair)}</b>&hellip;`;

  const tradable = state.prices[entry.pair] !== undefined;
  const tradeBtn = tradable
    ? `<br><button class="btn-submit btn-binary" onclick="selectDerivForTrading('${entry.pair.replace(/'/g, "\\'")}')"><i class="ti ti-bolt"></i> Select for Trading</button>`
    : `<br><span style="color:var(--text-dim)">Demo execution for ${escapeHtml(entry.pair)} isn't available yet on AlphaFX &mdash; browsing only.</span>`;

  try {
    const data = await window.DerivAPI.contractsFor(symbol);
    const rows = data.available || [];
    if (!rows.length) {
      detail.innerHTML = `<span class="mib-live">Live &middot; Deriv API</span><br>
        No contract types are currently offered on <b>${escapeHtml(entry.pair)}</b>.${tradeBtn}`;
      return;
    }
    const byCategory = new Map();
    rows.forEach(r => {
      const cat = r.contract_category_display || r.contract_category;
      if (!byCategory.has(cat)) byCategory.set(cat, new Set());
      byCategory.get(cat).add(r.contract_display || r.contract_type);
    });
    const lines = [...byCategory.entries()].map(([cat, types]) => `<b>${escapeHtml(cat)}</b>: ${[...types].map(escapeHtml).join(', ')}`).join('<br>');
    detail.innerHTML = `<span class="mib-live">Live &middot; Deriv API</span><br>
      Contract types Deriv offers on <b>${escapeHtml(entry.pair)}</b> right now:<br>${lines}${tradeBtn}`;
  } catch (e) {
    detail.innerHTML = e.isApiError
      ? `<span class="mib-live">Live &middot; Deriv API</span><br>
        No contract types are currently offered on <b>${escapeHtml(entry.pair)}</b>.${tradeBtn}`
      : `<span class="mib-live mib-offline">Offline</span><br>
        Couldn't reach Deriv's live feed for <b>${escapeHtml(entry.pair)}</b> right now.${tradeBtn}`;
  }
}

function selectDerivForTrading(pair) {
  const sel = document.getElementById('b-pair');
  if (!sel) return;
  sel.value = pair;
  onBinaryPairChange();
  openBinaryTerminal(state.selectedMarketType);
}

function binaryLabel(o) {
  const label = (BIN_DIR_LABELS[o.direction] || o.direction || '').toUpperCase();
  return o.prediction !== undefined && o.prediction !== null ? `${label} ${o.prediction}` : label;
}

function currentBinaryPair() {
  return document.getElementById('b-pair')?.value || 'EUR/USD';
}

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

function digitFrequencies(pair) {
  const hist = (state.priceHistory[pair] || []).slice(-20);
  const counts = new Array(10).fill(0);
  hist.forEach(p => counts[lastDigitOf(pair, p)]++);
  const total = hist.length || 1;
  return counts.map(c => Math.round((c / total) * 100));
}

function selectDigit(d) {
  if (state.contractType === 'over_under') {
    if (state.binDir === 'over' && d === 9) return;
    if (state.binDir === 'under' && d === 0) return;
  }
  state.binDigit = d;
  renderDigitPad();
  updateDigitStrip();
}

function renderDigitPad() {
  const pad = document.getElementById('digit-pad');
  if (!pad || pad.offsetParent === null) return;
  const pair = currentBinaryPair();
  const pcts = digitFrequencies(pair);
  const maxPct = Math.max(...pcts, 1);
  pad.innerHTML = pcts.map((pct, d) => {
    const disabled = state.contractType === 'over_under' &&
      ((state.binDir === 'over' && d === 9) || (state.binDir === 'under' && d === 0));
    const isSel = d === state.binDigit;
    const barH = Math.max(3, Math.round((pct / maxPct) * 26));
    return `
      <button class="digit-btn${isSel ? ' active' : ''}" ${disabled ? 'disabled' : ''} onclick="selectDigit(${d})">
        <span class="digit-pct">${pct}%</span>
        <span class="digit-bar" style="height:${barH}px"></span>
        <span class="digit-num">${d}</span>
      </button>`;
  }).join('');
}

function updateDigitStrip() {
  const wrap = document.getElementById('digit-strip');
  if (!wrap || wrap.offsetParent === null) return;
  const pair = currentBinaryPair();
  const hist = (state.priceHistory[pair] || []).slice(-18);
  wrap.innerHTML = hist.map((p, i) => {
    const d = lastDigitOf(pair, p);
    let cls = '';
    if (state.contractType === 'over_under') cls = d > state.binDigit ? 'win' : (d < state.binDigit ? 'lose' : '');
    else if (state.contractType === 'matches_differs') cls = d === state.binDigit ? 'win' : '';
    else if (state.contractType === 'even_odd') cls = d % 2 === 0 ? 'even' : 'odd';
    const latest = i === hist.length - 1 ? ' latest' : '';
    return `<span class="digit-chip ${cls}${latest}">${d}</span>`;
  }).join('');
}

function onBinaryPairChange() {
  renderDigitPad();
  updateDigitStrip();
  updateCharts();
  if (BARRIER_MARKET_TYPES.includes(state.contractType)) resetBarrierDefault();
  updateBtCalc();
  if (state.bt.open) {
    updateBtSymbolHeader();
    synthesizeBtCandles();
  }
}

function setTF(el) {
  document.querySelectorAll('.tf').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'withdraw-modal') showWithdrawMethodSelect();
  if (id === 'deposit-modal') showMethodSelect();
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'deposit-modal') { stopMpesaPolling(); stopCardPolling(); }
}

function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const wasOpen = item.classList.contains('open');
  item.parentElement.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}

const DEPOSIT_METHOD_TITLES = { mpesa: 'M-Pesa', card: 'Credit / Debit Card', crypto: 'USDT (TRC20)' };

function selMethod(kind) {
  state.depositMethod = kind;
  const isMpesa = kind === 'mpesa';
  const isCard = kind === 'card';
  const isCrypto = kind === 'crypto';
  const card = document.getElementById('deposit-card-fields');
  const mp = document.getElementById('deposit-mpesa-fields');
  const cr = document.getElementById('deposit-crypto-fields');
  if (card) card.style.display = isCard ? '' : 'none';
  if (mp) mp.style.display = isMpesa ? '' : 'none';
  if (cr) cr.style.display = isCrypto ? '' : 'none';
  if (isMpesa) updateMpesaEstimate();
  if (isCrypto) renderCryptoWalletInfo();
  if (isCard) { resetCardForm(); loadSavedCards(); }

  document.getElementById('deposit-method-select').style.display = 'none';
  document.getElementById('deposit-fields-screen').style.display = '';
  document.getElementById('deposit-modal-title').textContent = DEPOSIT_METHOD_TITLES[kind] || 'Deposit';
  document.getElementById('deposit-modal-subtitle').textContent = 'Choose an amount below';
}

function showMethodSelect() {
  stopMpesaPolling();
  stopCardPolling();
  document.getElementById('deposit-method-select').style.display = '';
  document.getElementById('deposit-fields-screen').style.display = 'none';
  document.getElementById('deposit-modal-title').textContent = 'Deposit';
  document.getElementById('deposit-modal-subtitle').textContent = 'Fund your account';
}

const WITHDRAW_METHOD_TITLES = { mpesa: 'M-Pesa', crypto: 'Crypto' };

function selWithdrawMethod(kind) {
  const isMpesa = kind === 'mpesa';
  const isCrypto = kind === 'crypto';
  const mp = document.getElementById('withdraw-mpesa-fields');
  const cr = document.getElementById('withdraw-crypto-fields');
  if (mp) mp.style.display = isMpesa ? '' : 'none';
  if (cr) cr.style.display = isCrypto ? '' : 'none';
  if (isMpesa) updateWithdrawMpesaEstimate();
  if (isCrypto) validateWithdrawAddress();

  document.getElementById('withdraw-method-select').style.display = 'none';
  document.getElementById('withdraw-fields-screen').style.display = '';
  document.getElementById('withdraw-modal-title').textContent = WITHDRAW_METHOD_TITLES[kind] || 'Withdraw';
  document.getElementById('withdraw-modal-subtitle').textContent = 'Choose an amount below';
}

function showWithdrawMethodSelect() {
  document.getElementById('withdraw-method-select').style.display = '';
  document.getElementById('withdraw-fields-screen').style.display = 'none';
  document.getElementById('withdraw-modal-title').textContent = 'Withdraw';
  document.getElementById('withdraw-modal-subtitle').textContent = 'Choose a payout method';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleTheme() {
  document.body.classList.toggle('light');
}

async function loadHistory() {
  const el = document.getElementById('history-list');
  if (!el) return;
  const data = await api(`/transactions/${USER_ID}`);
  if (!data || !data.length) { el.innerHTML = '<div class="empty-state"><i class="ti ti-history"></i><p>No transactions yet.</p></div>'; return; }
  el.innerHTML = data.map(tx => `
    <div class="history-item">
      <div>
        <div style="font-size:13px;font-weight:500;color:var(--text)">${tx.type === 'deposit' ? '⬇ Deposit' : '⬆ Withdrawal'} via ${tx.method || tx.destination || 'Demo'}</div>
        <div style="font-size:11px;color:var(--text-muted)">${new Date(tx.date).toLocaleString()} · <span class="badge badge-${tx.status === 'completed' ? 'open' : 'pending'}">${tx.status}</span></div>
      </div>
      <div style="font-size:15px;font-weight:600" class="${tx.type === 'deposit' ? 'up' : 'down'}">${tx.type === 'deposit' ? '+' : '-'}$${fmt(tx.amount)}</div>
    </div>
  `).join('');
}

/* ── Utilities ──────────────────────────────────────────────── */
function fmt(n) {
  return parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPrice(pair, price) {
  if (!price) return '—';
  if (pair.includes('BTC') || pair.includes('ETH')) return '$' + parseFloat(price).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (pair.includes('XAU') || pair.includes('XAG')) return parseFloat(price).toFixed(2);
  if (pair.includes('JPY')) return parseFloat(price).toFixed(3);
  if (pair.includes('Volatility')) return parseFloat(price).toFixed(2);
  return parseFloat(price).toFixed(5);
}

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// Close modals on backdrop click
document.querySelectorAll('.modal-bg').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

/* ── Avatar dropdown ────────────────────────────────────────── */
function toggleAvatarMenu(e) {
  e.stopPropagation();
  document.getElementById('avatar-dropdown')?.classList.toggle('open');
}
function closeAvatarMenu() {
  document.getElementById('avatar-dropdown')?.classList.remove('open');
}
function goToAccountSettings() {
  closeAvatarMenu();
  switchView('settings', document.querySelector('.nav-item[data-view="settings"]'));
}
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('avatar-menu');
  if (wrap && !wrap.contains(e.target)) closeAvatarMenu();
});

/* ── Session & Auth ─────────────────────────────────────────── */
function doLogout() {
  localStorage.removeItem('alphafx_session');
  window.location.href = '/login';
}

function getSession() {
  try { return JSON.parse(localStorage.getItem('alphafx_session') || 'null'); }
  catch(e) { return null; }
}

function applySessionToUI(session) {
  const name = (session && session.name) || 'John Doe';
  const mode = (!session || session.userId === 'demo-user-1') ? 'Demo Account' : 'Live Account';
  const initials = name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'JD';

  const topAvatar = document.getElementById('user-avatar');
  if (topAvatar) topAvatar.textContent = initials;

  const btAvatar = document.getElementById('bt-avatar');
  if (btAvatar) btAvatar.textContent = initials;

  const sideAvatar = document.getElementById('sidebar-avatar');
  if (sideAvatar) sideAvatar.textContent = initials;
  const sideName = document.getElementById('sidebar-username');
  if (sideName) sideName.textContent = name;
  const sideMode = document.getElementById('sidebar-usermode');
  if (sideMode) sideMode.textContent = mode;

  const stAvatar = document.getElementById('st-avatar');
  if (stAvatar) stAvatar.textContent = initials;
  const stName = document.getElementById('st-username');
  if (stName) stName.textContent = name;

  const settingsUserId = document.getElementById('settings-user-id');
  if (settingsUserId) settingsUserId.textContent = (session && session.userId) || USER_ID;
  const settingsEmail = document.getElementById('settings-email');
  if (settingsEmail) settingsEmail.textContent = (session && session.email) || 'john@example.com';
  const settingsMode = document.getElementById('settings-mode');
  if (settingsMode) settingsMode.textContent = mode === 'Demo Account' ? 'Demo' : 'Live';
}

// A logged-in user's account now lives on the server (see /api/register and
// /api/login), so every trade, deposit and balance call below is wired to
// whoever is actually signed in instead of always defaulting to the shared
// demo-user-1 account.
const _session = getSession();
if (_session && _session.userId) {
  USER_ID = _session.userId;
}
applySessionToUI(_session);
