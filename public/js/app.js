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
  binDigit: 5,
  mainChart: null,
  binaryChart: null,
  portfolioChart: null,
  priceHistory: {},
  tickInterval: null,
  tradeInterval: null,
  balanceHistory: [],
  currentView: 'dashboard',
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
  }
};

const MT_INDICATOR_LABELS = { sma20: 'SMA 20', sma50: 'SMA 50', ema20: 'EMA 20', ema50: 'EMA 50' };

const MT_PAIR_NAMES = {
  'EUR/USD': 'Euro vs US Dollar',
  'GBP/USD': 'British Pound vs US Dollar',
  'USD/JPY': 'US Dollar vs Japanese Yen',
  'USD/CHF': 'US Dollar vs Swiss Franc',
  'AUD/USD': 'Australian Dollar vs US Dollar',
  'USD/CAD': 'US Dollar vs Canadian Dollar',
  'XAU/USD': 'Gold vs US Dollar',
  'BTC/USD': 'Bitcoin vs US Dollar',
  'ETH/USD': 'Ethereum vs US Dollar'
};

/* ── Init ───────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  await fetchPrices();
  await fetchStats();
  await fetchTrades();
  buildTicker();
  buildSidePrices();
  initMainChart();
  updateForexCalc();
  updateBinaryCalc();

  state.tickInterval = setInterval(async () => {
    await fetchPrices();
    updateTicker();
    updateSidePrices();
    updateCharts();
    updateOpenPositions();
    updateBinaryTimers();
    checkMtAlerts();
    if (state.currentView === 'forex') {
      renderMtWatchlistRows();
      updateMtLiveCandle();
      mtExecUpdateDisplays();
    }
    if (state.currentView === 'binary') {
      updateDigitStrip();
      renderDigitPad();
    }
  }, 1500);

  state.tradeInterval = setInterval(async () => {
    await fetchTrades();
    await fetchStats();
  }, 5000);
});

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
  state.prices = data.prices;
  Object.entries(data.prices).forEach(([pair, price]) => {
    if (!state.priceHistory[pair]) state.priceHistory[pair] = [];
    state.priceHistory[pair].push(price);
    if (state.priceHistory[pair].length > 80) state.priceHistory[pair].shift();
  });
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

function initMainChart() {
  const ctx = document.getElementById('main-chart');
  if (!ctx) return;
  const hist = state.priceHistory['EUR/USD'] || [];
  state.mainChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hist.map((_,i) => i),
      datasets: [{
        data: hist,
        borderColor: '#38bdf8',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        backgroundColor: 'rgba(56,189,248,0.06)',
        tension: 0.3
      }]
    },
    options: chartDefaults()
  });
}

function initBinaryChartView() {
  const ctx = document.getElementById('binary-chart');
  if (!ctx || state.binaryChart) return;
  const hist = state.priceHistory[currentBinaryPair()] || [];
  state.binaryChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hist.map((_,i) => i),
      datasets: [{
        data: hist,
        borderColor: '#f59e0b',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.4
      }]
    },
    options: chartDefaults()
  });
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
  const hist = state.priceHistory['EUR/USD'] || [];
  if (state.mainChart) {
    state.mainChart.data.labels = hist.map((_,i) => i);
    state.mainChart.data.datasets[0].data = [...hist];
    state.mainChart.update('none');
  }
  if (state.binaryChart) {
    const binHist = state.priceHistory[currentBinaryPair()] || [];
    state.binaryChart.data.labels = binHist.map((_,i) => i);
    state.binaryChart.data.datasets[0].data = [...binHist];
    state.binaryChart.update('none');
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
    return `
      <div class="position-card">
        <div>
          <div class="pos-pair">${t.pair} <span class="badge badge-${t.direction}">${t.direction.toUpperCase()}</span></div>
          <div class="pos-detail">Entry: ${fmtPrice(t.pair, t.entryPrice)} · Size: $${t.amount} · ${t.leverage}x</div>
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
    t.pnl = parseFloat((diff * t.amount * t.leverage).toFixed(2));
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

  const open = (state.trades.forex || []).filter(t => t.status === 'open');
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
  const open = (state.trades.forex || []).filter(t => t.status === 'open');
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
  const btn = document.getElementById('binary-submit');
  btn.disabled = true; btn.textContent = 'Placing...';

  const body = {
    userId: USER_ID,
    pair: document.getElementById('b-pair').value,
    contractType: state.contractType,
    direction: state.binDir,
    stake: parseFloat(document.getElementById('b-stake').value),
    expiryMinutes: parseInt(document.getElementById('b-expiry').value),
    payoutPercent: parseInt(document.getElementById('b-payout').value)
  };
  if (state.contractType === 'over_under' || state.contractType === 'matches_differs') {
    body.prediction = state.binDigit;
  }

  const res = await api('/trade/binary', 'POST', body);
  btn.disabled = false; btn.innerHTML = '<i class="ti ti-bolt"></i> Buy Option';

  if (!res || res.error) { toast(res?.error || 'Failed to place option', true); return; }
  const label = BIN_DIR_LABELS[body.direction] || body.direction.toUpperCase();
  const digitPart = body.prediction !== undefined ? ` ${body.prediction}` : '';
  toast(`✓ ${label}${digitPart} on ${body.pair} · Expiry: ${body.expiryMinutes}m`);
  await fetchTrades(); await fetchStats();
}

async function closeTrade(id) {
  const res = await api(`/trade/close/${id}`, 'POST');
  if (!res || res.error) { toast(res?.error || 'Failed to close', true); return; }
  const pnl = res.pnl;
  toast(`Position closed · P&L: ${pnl >= 0 ? '+' : ''}$${fmt(Math.abs(pnl))}`);
  await fetchTrades(); await fetchStats();
}

/* ── Deposit / Withdraw ─────────────────────────────────────── */
async function confirmDeposit() {
  const amount = parseFloat(document.getElementById('deposit-amount').value);
  const method = document.querySelector('.method-btn.active span')?.textContent || 'Card';
  const res = await api('/deposit', 'POST', { userId: USER_ID, amount, method });
  if (!res || res.error) { toast(res?.error || 'Deposit failed', true); return; }
  closeModal('deposit-modal');
  toast(`✓ $${fmt(amount)} added to balance`);
  await fetchStats();
}

async function confirmWithdraw() {
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const destination = document.getElementById('withdraw-dest').value;
  const res = await api('/withdraw', 'POST', { userId: USER_ID, amount, destination });
  if (!res || res.error) { toast(res?.error || 'Withdrawal failed', true); return; }
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

function updateBinaryCalc() {
  const stake = parseFloat(document.getElementById('b-stake')?.value) || 100;
  const pct = parseInt(document.getElementById('b-payout')?.value) || 85;
  const payout = stake * (1 + pct / 100);
  const sd = document.getElementById('b-stake-display'); if (sd) sd.textContent = '$' + fmt(stake);
  const pd = document.getElementById('b-payout-display'); if (pd) pd.textContent = '$' + fmt(payout);
}

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
  if (v === 'portfolio') setTimeout(initPortfolioChart, 100);
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

/* ── Binary contract types (Deriv-style Digits/Rise-Fall) ────── */
const BIN_DIR_GROUPS = {
  rise_fall: ['call', 'put'],
  over_under: ['over', 'under'],
  matches_differs: ['matches', 'differs'],
  even_odd: ['even', 'odd']
};
const BIN_DIR_IDS = {
  call: 'b-call', put: 'b-put',
  over: 'b-over', under: 'b-under',
  matches: 'b-matches', differs: 'b-differs',
  even: 'b-even', odd: 'b-odd'
};
const BIN_GROUP_ELS = {
  rise_fall: 'rise-fall-dirs',
  over_under: 'over-under-dirs',
  matches_differs: 'matches-differs-dirs',
  even_odd: 'even-odd-dirs'
};
const BIN_DEFAULT_DIR = { rise_fall: 'call', over_under: 'over', matches_differs: 'matches', even_odd: 'even' };
const BIN_DIR_LABELS = { call: 'Rise', put: 'Fall', over: 'Over', under: 'Under', matches: 'Matches', differs: 'Differs', even: 'Even', odd: 'Odd' };

function setBinDir(d) {
  state.binDir = d;
  (BIN_DIR_GROUPS[state.contractType] || []).forEach(opt => {
    const el = document.getElementById(BIN_DIR_IDS[opt]);
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

function setContractType(type, el) {
  state.contractType = type;
  state.binDir = BIN_DEFAULT_DIR[type];
  if (type === 'over_under' && (state.binDigit === 9 || state.binDigit === undefined)) state.binDigit = 4;
  if (type === 'matches_differs' && state.binDigit === undefined) state.binDigit = 5;

  document.querySelectorAll('.contract-tab').forEach(t => t.classList.remove('active'));
  (el || document.querySelector(`.contract-tab[data-type="${type}"]`))?.classList.add('active');

  Object.values(BIN_GROUP_ELS).forEach(id => { document.getElementById(id).style.display = 'none'; });
  document.getElementById(BIN_GROUP_ELS[type]).style.display = 'grid';
  (BIN_DIR_GROUPS[type] || []).forEach(opt => {
    const dEl = document.getElementById(BIN_DIR_IDS[opt]);
    if (dEl) dEl.classList.toggle('active', opt === state.binDir);
  });

  const needsDigit = type === 'over_under' || type === 'matches_differs';
  document.getElementById('digit-pad-group').style.display = needsDigit ? 'flex' : 'none';
  document.getElementById('digit-pad-label').textContent = type === 'over_under' ? 'Barrier Digit' : 'Prediction Digit';

  document.getElementById('digit-strip-wrap').style.display = type === 'rise_fall' ? 'none' : 'flex';

  if (needsDigit) renderDigitPad();
  updateDigitStrip();
  updateBinaryCalc();
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
}

function setTF(el) {
  document.querySelectorAll('.tf').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const wasOpen = item.classList.contains('open');
  item.parentElement.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}

function selMethod(el) {
  document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleTheme() {
  document.body.classList.toggle('light');
}

function changeSpeed() {
  const ms = parseInt(document.getElementById('speed-select').value);
  clearInterval(state.tickInterval);
  state.tickInterval = setInterval(async () => {
    await fetchPrices();
    updateTicker();
    updateSidePrices();
    updateCharts();
    updateOpenPositions();
    updateBinaryTimers();
    checkMtAlerts();
    if (state.currentView === 'forex') {
      renderMtWatchlistRows();
      updateMtLiveCandle();
      mtExecUpdateDisplays();
    }
    if (state.currentView === 'binary') {
      updateDigitStrip();
      renderDigitPad();
    }
  }, ms);
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

/* ── Session & Auth ─────────────────────────────────────────── */
function doLogout() {
  localStorage.removeItem('alphafx_session');
  window.location.href = 'login.html';
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

  const sideAvatar = document.getElementById('sidebar-avatar');
  if (sideAvatar) sideAvatar.textContent = initials;
  const sideName = document.getElementById('sidebar-username');
  if (sideName) sideName.textContent = name;
  const sideMode = document.getElementById('sidebar-usermode');
  if (sideMode) sideMode.textContent = mode;

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
