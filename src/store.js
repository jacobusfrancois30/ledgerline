// src/store.js - IndexedDB storage, backup/restore, PIN encryption
'use strict';

const DB_NAME = 'ledgerline_db';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ledger')) {
        db.createObjectStore('ledger', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('by_date', 'date', { unique: false });
        txStore.createIndex('by_account', 'accountId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        await navigator.storage.persist();
      }
    }
  } catch (err) {
    console.warn('Storage persistence request failed', err);
  }
}

export async function loadData() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['ledger', 'transactions'], 'readonly');
    const ledgerStore = tx.objectStore('ledger');
    const txStore = tx.objectStore('transactions');

    let meta = null;
    let txns = [];

    const getMeta = ledgerStore.get('current');
    getMeta.onsuccess = () => {
      meta = getMeta.result || null;
    };

    const getAllTx = txStore.getAll();
    getAllTx.onsuccess = () => {
      txns = getAllTx.result || [];
    };

    tx.oncomplete = () => {
      resolve({
        ledger: meta ? meta.ledger : null,
        metadata: meta ? {
          lastBackup: meta.lastBackup,
          backupReminderDismissedMonth: meta.backupReminderDismissedMonth,
          pinHash: meta.pinHash,
          geminiKey: meta.geminiKey,
          geminiModel: meta.geminiModel,
          updated: meta.updated
        } : null,
        txns
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveLedger(ledger, extraMeta = {}) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['ledger'], 'readwrite');
    const store = tx.objectStore('ledger');

    const getReq = store.get('current');
    getReq.onsuccess = () => {
      const prev = getReq.result || { id: 'current' };
      const updatedRecord = {
        ...prev,
        id: 'current',
        ledger,
        updated: new Date().toISOString(),
        ...extraMeta
      };
      store.put(updatedRecord);
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveTransactions(txnsList) {
  if (!txnsList || !txnsList.length) return true;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['transactions'], 'readwrite');
    const store = tx.objectStore('transactions');
    for (const t of txnsList) {
      store.put(t);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteTransactions(txIds) {
  if (!txIds || !txIds.length) return true;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['transactions'], 'readwrite');
    const store = tx.objectStore('transactions');
    for (const id of txIds) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllData() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['ledger', 'transactions'], 'readwrite');
    tx.objectStore('ledger').clear();
    tx.objectStore('transactions').clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// Full backup export (JSON)
export async function exportBackup(ledger, txns, metadata) {
  const backup = {
    app: 'Ledgerline',
    version: 1,
    exportedAt: new Date().toISOString(),
    ledger,
    transactions: txns,
    metadata: {
      geminiModel: metadata?.geminiModel || 'gemini-2.5-flash',
      // We do not export the raw PIN hash or secrets for maximum portability and security
    }
  };

  // Record this as a fresh backup
  await saveLedger(ledger, { lastBackup: new Date().toISOString() });

  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `ledgerline-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);

  return true;
}

// Restore from backup JSON
export async function restoreBackup(jsonContent) {
  let parsed;
  try {
    parsed = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  } catch (err) {
    throw new Error('Invalid JSON backup file');
  }

  if (!parsed || !parsed.ledger || !Array.isArray(parsed.transactions)) {
    throw new Error('Backup format unrecognized: missing ledger or transactions array');
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['ledger', 'transactions'], 'readwrite');
    const ledgerStore = tx.objectStore('ledger');
    const txStore = tx.objectStore('transactions');

    ledgerStore.clear();
    txStore.clear();

    const record = {
      id: 'current',
      ledger: parsed.ledger,
      updated: new Date().toISOString(),
      lastBackup: new Date().toISOString(),
      geminiModel: parsed.metadata?.geminiModel || 'gemini-2.5-flash'
    };
    ledgerStore.put(record);

    for (const t of parsed.transactions) {
      if (t && t.id && t.date) {
        txStore.put(t);
      }
    }

    tx.oncomplete = () => resolve(parsed);
    tx.onerror = () => reject(tx.error);
  });
}

// 30-day Backup reminder
export function shouldShowBackupReminder(lastBackupDate, dismissedMonth, currentMonth) {
  if (dismissedMonth === currentMonth) return false;
  if (!lastBackupDate) return true;
  const daysSince = (Date.now() - new Date(lastBackupDate).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= 30;
}

// WebCrypto PIN Hashing
export async function hashPin(pin) {
  const enc = new TextEncoder();
  const data = enc.encode('ledgerline-salt-2025:' + String(pin));
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin, hash) {
  if (!hash) return true;
  const candidate = await hashPin(pin);
  return candidate === hash;
}
