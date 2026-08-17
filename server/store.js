'use strict';

// ─── Crash/restart-safe persistence ─────────────────────────────────────────
// Wraps a plain data object in a recursive Proxy so every mutation anywhere
// in its tree (db.users[id].balance = x, db.transactions.push(tx), ...) is
// caught automatically — every existing call site in index.js keeps working
// completely unchanged. On each mutation the whole tree is debounce-flushed
// to a local JSON file (write-to-temp-then-rename, so a crash mid-write can
// never corrupt the file); on boot, that file is loaded back if present.
//
// This is file-based, single-instance durability — appropriate for the
// current in-memory-object architecture without touching the ~40+ places
// that read/write it. A real relational database would be the next step if
// this ever needs to run across multiple server instances.
const fs = require('fs');
const path = require('path');

const SAVE_DEBOUNCE_MS = 1000;

function createPersistedStore(defaultData, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let data = defaultData;
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim()) {
        const loaded = JSON.parse(raw);
        // Shallow-merge at the top level so a field added to defaultData
        // after some data has already been persisted (e.g. a new settings
        // block) still shows up instead of being undefined.
        data = { ...defaultData, ...loaded };
      }
      console.log(`[store] Loaded persisted state from ${filePath}`);
    } catch (err) {
      console.error(`[store] Failed to read ${filePath}, starting from defaults:`, err.message);
    }
  }

  let saveTimer = null;
  let writing = false;
  let writeAgain = false;

  function writeNow() {
    if (writing) { writeAgain = true; return; }
    writing = true;
    const tmp = filePath + '.tmp';
    fs.writeFile(tmp, JSON.stringify(data), (err) => {
      if (err) { console.error('[store] write failed:', err.message); writing = false; return; }
      fs.rename(tmp, filePath, (err2) => {
        writing = false;
        if (err2) console.error('[store] rename failed:', err2.message);
        if (writeAgain) { writeAgain = false; writeNow(); }
      });
    });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, SAVE_DEBOUNCE_MS);
  }

  function flushSync() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error('[store] sync flush failed:', err.message);
    }
  }

  const proxyCache = new WeakMap();
  function wrap(target) {
    if (target === null || typeof target !== 'object') return target;
    if (proxyCache.has(target)) return proxyCache.get(target);
    const proxy = new Proxy(target, {
      get(obj, prop, receiver) {
        return wrap(Reflect.get(obj, prop, receiver));
      },
      set(obj, prop, value, receiver) {
        const ok = Reflect.set(obj, prop, value, receiver);
        scheduleSave();
        return ok;
      },
      deleteProperty(obj, prop) {
        const ok = Reflect.deleteProperty(obj, prop);
        scheduleSave();
        return ok;
      }
    });
    proxyCache.set(target, proxy);
    return proxy;
  }

  // Persist the initial (possibly freshly-seeded) state immediately so the
  // file exists from the first boot rather than only after the first write.
  flushSync();

  function shutdown() {
    flushSync();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return wrap(data);
}

module.exports = { createPersistedStore };
