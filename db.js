/* ══════════════════════════════════════════
   db.js  –  IndexedDB wrapper for PesoFlow
   ══════════════════════════════════════════ */

const DB_NAME    = 'PesoFlowDB';
const DB_VERSION = 1;
let db = null;

/** Open (or create) the database */
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const d = e.target.result;

      /* key-value store for scalars (balance, pocket total, bills) */
      if (!d.objectStoreNames.contains('state')) {
        d.createObjectStore('state', { keyPath: 'key' });
      }

      /* transactions log */
      if (!d.objectStoreNames.contains('transactions')) {
        const txStore = d.createObjectStore('transactions', {
          keyPath: 'id', autoIncrement: true
        });
        txStore.createIndex('by_date', 'date');
        txStore.createIndex('by_type', 'type');
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

/* ── Generic state helpers ── */

function setState(key, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('state', 'readwrite');
    const req = tx.objectStore('state').put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror   = e  => reject(e.target.error);
  });
}

function getState(key, defaultValue = 0) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('state', 'readonly');
    const req = tx.objectStore('state').get(key);
    req.onsuccess = e => resolve(e.target.result ? e.target.result.value : defaultValue);
    req.onerror   = e => reject(e.target.error);
  });
}

/* ── Transaction log helpers ── */

function addTransaction(type, amount, note = '') {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('transactions', 'readwrite');
    const req = tx.objectStore('transactions').add({
      type,
      amount,
      note,
      date: new Date().toISOString()
    });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function getAllTransactions() {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('transactions', 'readonly');
    const req = tx.objectStore('transactions').getAll();
    req.onsuccess = e => resolve(e.target.result.reverse()); // newest first
    req.onerror   = e => reject(e.target.error);
  });
}

function clearAllTransactions() {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('transactions', 'readwrite');
    const req = tx.objectStore('transactions').clear();
    req.onsuccess = () => resolve();
    req.onerror   = e  => reject(e.target.error);
  });
}

/** Returns last N 'spend' transactions for the chart */
function getSpendHistory(limit = 14) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('transactions', 'readonly');
    const req = tx.objectStore('transactions').getAll();
    req.onsuccess = e => {
      const spends = e.target.result
        .filter(t => t.type === 'spend')
        .slice(-limit);
      resolve(spends);
    };
    req.onerror = e => reject(e.target.error);
  });
}