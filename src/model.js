// src/model.js - Financial models, business logic, calculations, sample data (ZAR default)
'use strict';

export const pad = n => String(n).padStart(2, '0');
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clone = o => JSON.parse(JSON.stringify(o));
export const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const today = () => dstr(new Date());
export const ym = s => s.slice(0, 7);
export const addMonths = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
};
export const dim = m => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
};
export const mLabel = (m, opt = { month: 'long', year: 'numeric' }) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, opt);
};
export const dLabel = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
export const norm = s => String(s || '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\b(pos|debit|purchase|card|ach|payment|online|fnb|nedbank|standard bank|absa|capitec)\b/g, '')
  .replace(/\s+/g, ' ')
  .trim();
export const round2 = n => Math.round(n * 100) / 100;
export const sum = (a, f = x => x) => a.reduce((t, x) => t + f(x), 0);

export const DEFAULT_CURRENCY = 'ZAR';
export const CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'INR', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'MXN', 'BRL', 'NGN', 'KES', 'AED'];

const fmtCache = {};
export function money(n, opts = {}, currency = DEFAULT_CURRENCY) {
  const cur = currency || DEFAULT_CURRENCY;
  const key = cur + JSON.stringify(opts);
  if (!fmtCache[key]) {
    try {
      fmtCache[key] = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, ...opts });
    } catch {
      fmtCache[key] = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', ...opts });
    }
  }
  return fmtCache[key].format(Math.abs(n) < 0.005 ? 0 : n);
}
export const money0 = (n, currency = DEFAULT_CURRENCY) => money(n, { maximumFractionDigits: 0, minimumFractionDigits: 0 }, currency);

export const DEFAULT_CATS = [
  ['salary', 'Salary', 'income'],
  ['side', 'Side income', 'income'],
  ['otherinc', 'Other income', 'income'],
  ['housing', 'Housing', 'expense'],
  ['utilities', 'Utilities', 'expense'],
  ['groceries', 'Groceries', 'expense'],
  ['dining', 'Dining out', 'expense'],
  ['transport', 'Transport', 'expense'],
  ['health', 'Health & Fitness', 'expense'],
  ['shopping', 'Shopping', 'expense'],
  ['subs', 'Subscriptions', 'expense'],
  ['fun', 'Entertainment', 'expense'],
  ['travel', 'Travel', 'expense'],
  ['personal', 'Personal care', 'expense'],
  ['gifts', 'Gifts & giving', 'expense'],
  ['fees', 'Fees & interest', 'expense'],
  ['transfer', 'Transfer', 'transfer'],
];

export function emptyLedger() {
  return {
    settings: { currency: DEFAULT_CURRENCY },
    accounts: [{ id: 'chk', name: 'Everyday Checking', type: 'checking', opening: 0 }],
    categories: DEFAULT_CATS.map(([id, name, kind]) => ({ id, name, kind, budget: 0, rollover: false })),
    bills: [],
    goals: [],
    rules: [],
  };
}

export function normalizeLedger(l) {
  const base = emptyLedger();
  return {
    ...base,
    ...l,
    settings: { ...base.settings, ...(l?.settings || {}) },
    accounts: (l?.accounts && l.accounts.length) ? l.accounts : base.accounts,
    categories: (l?.categories && l.categories.length) ? l.categories : base.categories,
    bills: l?.bills || [],
    goals: l?.goals || [],
    rules: l?.rules || []
  };
}

function rng(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function sampleLedger() {
  const l = emptyLedger();
  l.settings.currency = 'ZAR';
  l.accounts = [
    { id: 'chk', name: 'Cheque Account', type: 'checking', opening: 14200 },
    { id: 'sav', name: 'Notice Savings', type: 'savings', opening: 65000 },
    { id: 'cc', name: 'Credit Card', type: 'credit', opening: 0 },
  ];
  const budgets = {
    housing: 12500,
    utilities: 2200,
    groceries: 5500,
    dining: 2400,
    transport: 1800,
    subs: 450,
    shopping: 2000,
    fun: 1200,
    health: 850,
    personal: 600
  };
  l.categories.forEach(c => {
    c.budget = budgets[c.id] || 0;
    c.rollover = c.id === 'groceries';
  });
  l.bills = [
    { id: uid(), name: 'Northside Apartments', amount: 12500, day: 1, categoryId: 'housing', accountId: 'chk' },
    { id: uid(), name: 'Virgin Active Gym', amount: 850, day: 3, categoryId: 'health', accountId: 'cc' },
    { id: uid(), name: 'City of Cape Town Electricity', amount: 1650, day: 8, categoryId: 'utilities', accountId: 'chk' },
    { id: uid(), name: 'Fiberlink Internet', amount: 799, day: 12, categoryId: 'utilities', accountId: 'chk' },
    { id: uid(), name: 'Vodacom Mobile', amount: 499, day: 20, categoryId: 'utilities', accountId: 'cc' },
  ];
  const now = new Date();
  const due = n => dstr(new Date(now.getFullYear(), now.getMonth() + n, 1));
  l.goals = [
    { id: uid(), name: 'Emergency fund', target: 90000, saved: 52000, due: due(10) },
    { id: uid(), name: 'Garden Route Holiday', target: 28000, saved: 12000, due: due(6) },
  ];
  l.rules = [
    { id: uid(), match: 'woolworths', categoryId: 'groceries' },
    { id: uid(), match: 'checkers', categoryId: 'groceries' },
    { id: uid(), match: 'spar', categoryId: 'groceries' },
    { id: uid(), match: 'shell', categoryId: 'transport' },
    { id: uid(), match: 'engen', categoryId: 'transport' },
    { id: uid(), match: 'netflix', categoryId: 'subs' },
    { id: uid(), match: 'spotify', categoryId: 'subs' },
  ];
  return l;
}

export function sampleTxns() {
  const r = rng(42);
  const out = [];
  const t = today();
  const cur = ym(t);

  const add = (date, payee, amount, categoryId, accountId) => {
    if (date <= t) {
      out.push({
        id: uid(),
        date,
        payee,
        amount: round2(amount),
        categoryId,
        accountId,
        note: ''
      });
    }
  };

  for (let k = -3; k <= 0; k++) {
    const m = addMonths(cur, k);
    const D = d => m + '-' + pad(Math.min(d, dim(m)));

    // Income
    add(D(1), 'FinTech Payroll', 22500, 'salary', 'chk');
    add(D(15), 'FinTech Payroll', 22500, 'salary', 'chk');

    // Recurring Bills
    add(D(1), 'Northside Apartments', -12500, 'housing', 'chk');
    add(D(3), 'Virgin Active Gym', -850, 'health', 'cc');
    add(D(5), 'Netflix South Africa', -199, 'subs', 'cc');
    add(D(9), 'Spotify Premium', -69.99, 'subs', 'cc');
    add(D(8), 'City of Cape Town Electricity', -(1450 + r() * 400), 'utilities', 'chk');
    add(D(12), 'Fiberlink Internet', -799, 'utilities', 'chk');
    add(D(20), 'Vodacom Mobile', -499, 'utilities', 'cc');

    // Transfers
    add(D(16), 'Transfer to savings', -3500, 'transfer', 'chk');
    add(D(16), 'Transfer from cheque', 3500, 'transfer', 'sav');
    add(D(25), 'Credit card settlement', -4200, 'transfer', 'chk');
    add(D(25), 'Payment received', 4200, 'transfer', 'cc');

    // Groceries (Checkers & Woolworths)
    [2, 9, 16, 23, 29].forEach((d, i) => {
      add(D(d), i % 2 ? 'Woolworths Food' : 'Checkers Hyper', -(750 + r() * 600), 'groceries', 'cc');
    });

    // Dining
    const dine = ['Tashas Cafe', 'Kauai Healthy', 'Spur Steak Ranch', 'Nando’s Flame-Grilled', 'Vida e Caffè', 'Col’Cacchio Pizzeria'];
    for (let i = 0; i < 5 + Math.floor(r() * 4); i++) {
      add(D(1 + Math.floor(r() * 27)), dine[Math.floor(r() * dine.length)], -(140 + r() * 320), 'dining', 'cc');
    }

    // Transport & Fuel
    add(D(6), 'Shell Forecourt', -(650 + r() * 250), 'transport', 'cc');
    add(D(21), 'Engen QuickShop', -(600 + r() * 200), 'transport', 'cc');
    if (r() > 0.4) add(D(13), 'Uber Trip', -(95 + r() * 85), 'transport', 'cc');

    // Shopping & Fun
    add(D(10 + Math.floor(r() * 10)), 'Takealot.com', -(350 + r() * (k === -1 ? 1400 : 500)), 'shopping', 'cc');
    if (r() > 0.3) add(D(18), 'Ster-Kinekor Cinema', -(220 + r() * 140), 'fun', 'cc');
    if (k === -2) add(D(22), 'Web Consulting Project', 7500, 'side', 'chk');
    if (k === -1) add(D(14), 'Clicks Pharmacy', -245.50, 'health', 'cc');
    add(D(28), 'Interest earned', 380 + r() * 50, 'otherinc', 'sav');
  }

  return out;
}

export const catById = (categories, id) => categories.find(c => c.id === id);
export const acctById = (accounts, id) => accounts.find(a => a.id === id);
export const kindOf = (t, categories) => {
  const c = catById(categories, t.categoryId);
  return c ? c.kind : (t.amount >= 0 ? 'income' : 'expense');
};
export const catName = (categories, id) => (catById(categories, id) || { name: 'Uncategorized' }).name;

export const txIn = (txns, m) => txns.filter(t => t.date.startsWith(m));

export function monthStats(txns, m, categories) {
  const list = txIn(txns, m);
  let income = 0;
  let spent = 0;
  const byCat = {};
  for (const t of list) {
    const k = kindOf(t, categories);
    if (k === 'transfer') continue;
    if (k === 'income') {
      income += t.amount;
    } else {
      spent -= t.amount;
      const id = t.categoryId || '_none';
      byCat[id] = (byCat[id] || 0) - t.amount;
    }
  }
  return { income, spent, byCat, count: list.length };
}

export const balance = (account, txns) => account.opening + sum(txns.filter(t => t.accountId === account.id), t => t.amount);
export const netWorth = (accounts, txns) => sum(accounts, a => balance(a, txns));

export function firstMonth(txns, currentMonth) {
  let f = currentMonth;
  for (const t of txns) {
    if (ym(t.date) < f) f = ym(t.date);
  }
  return f;
}

export function rolloverFor(category, m, txns, categories) {
  if (!category.rollover) return 0;
  let carry = 0;
  let cur = firstMonth(txns, m);
  while (cur < m) {
    carry += category.budget - (monthStats(txns, cur, categories).byCat[category.id] || 0);
    cur = addMonths(cur, 1);
  }
  return carry;
}

export function billPaid(bill, m, txns) {
  const n = norm(bill.name);
  return txIn(txns, m).some(t => t.amount < 0 && (norm(t.payee).includes(n) || n.includes(norm(t.payee))) && norm(t.payee).length > 2);
}

export function billsState(bills, m, txns) {
  return bills.map(b => ({
    b,
    paid: billPaid(b, m, txns),
    date: m + '-' + pad(Math.min(b.day, dim(m)))
  })).sort((a, b) => a.b.day - b.b.day);
}

export function autoCategory(payee, rules, categories, allTxns) {
  const n = norm(payee);
  if (!n) return '';
  const rule = rules.find(r => r.match && n.includes(norm(r.match)));
  if (rule && catById(categories, rule.categoryId)) return rule.categoryId;
  const prev = [...allTxns].sort((a, b) => b.date.localeCompare(a.date)).find(t => t.categoryId && norm(t.payee) === n);
  return prev ? prev.categoryId : '';
}

export function detectSubscriptions(txns, categories, bills) {
  const cur = ym(today());
  const months = [addMonths(cur, -3), addMonths(cur, -2), addMonths(cur, -1), cur];
  const groups = {};

  for (const t of txns) {
    if (t.amount >= 0 || kindOf(t, categories) !== 'expense' || !months.includes(ym(t.date))) continue;
    const k = norm(t.payee);
    (groups[k] = groups[k] || []).push(t);
  }

  const out = [];
  for (const [k, list] of Object.entries(groups)) {
    const ms = new Set(list.map(t => ym(t.date)));
    if (ms.size < 2 || list.length > ms.size + 1) continue;
    const amts = list.map(t => -t.amount);
    const avg = sum(amts) / amts.length;
    if (amts.some(a => Math.abs(a - avg) / avg > (ms.size >= 3 ? 0.06 : 0.005))) continue;
    if (bills.some(b => norm(b.name) === k || k.includes(norm(b.name)))) continue;
    const last = list.sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push({
      payee: last.payee,
      amount: round2(avg),
      day: Number(last.date.slice(8)),
      categoryId: last.categoryId,
      accountId: last.accountId,
      months: ms.size
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
