/* ── Deriv public WebSocket client ─────────────────────────────
   Talks to wss://api.derivws.com for read-only, unauthenticated
   market metadata (contracts_for) used to enrich the binary
   options market-type grid with live info. No account/auth calls. */
(function () {
  const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
  const REQUEST_TIMEOUT = 8000;
  const CACHE_TTL = 60000;

  let socket = null;
  let reqSeq = 1;
  const pending = new Map();
  const cache = new Map();

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return socket;
    socket = new WebSocket(DERIV_WS_URL);
    socket.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      const waiter = pending.get(msg.req_id);
      if (!waiter) return;
      pending.delete(msg.req_id);
      if (msg.error) {
        // Deriv answered — this is a business-logic error (e.g. no contracts
        // for this symbol), not a dropped connection. Tag it so callers can
        // tell that apart from a real connectivity failure.
        const err = new Error(msg.error.message || 'Deriv API error');
        err.code = msg.error.code;
        err.isApiError = true;
        waiter.reject(err);
      } else {
        waiter.resolve(msg);
      }
    });
    socket.addEventListener('close', () => { socket = null; });
    socket.addEventListener('error', () => {});
    return socket;
  }

  function send(request) {
    return new Promise((resolve, reject) => {
      const ws = connect();
      const reqId = reqSeq++;
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error('Deriv API request timed out'));
      }, REQUEST_TIMEOUT);

      pending.set(reqId, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      const payload = JSON.stringify(Object.assign({}, request, { req_id: reqId }));
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      else ws.addEventListener('open', () => ws.send(payload), { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        pending.delete(reqId);
        reject(new Error('Deriv API connection failed'));
      }, { once: true });
    });
  }

  async function contractsFor(symbol) {
    const key = 'contracts_for:' + symbol;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
    const msg = await send({ contracts_for: symbol });
    const data = msg.contracts_for;
    cache.set(key, { data, ts: Date.now() });
    return data;
  }

  window.DerivAPI = { contractsFor };
})();
