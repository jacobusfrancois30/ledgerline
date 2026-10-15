// src/csv.js - CSV parsing, column mapping, duplicate detection, import and export
'use strict';

import { uid, round2, pad, dstr, norm, esc, money, catName, autoCategory, ym } from './model.js';
import { openSheet, closeSheet, fld, acctOptions } from './ui/sheet.js';
import { toast } from './ui/toast.js';

// Pick the delimiter that appears most consistently across the first lines.
// Bank exports often start with a few preamble lines, so look past line 1.
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 40);
  let best = ',', bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map(l => l.split(d).length - 1).filter(n => n > 0);
    if (!counts.length) continue;
    // Most common non-zero count, weighted by how many lines share it
    const freq = {};
    counts.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
    const [n, lines_] = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = lines_ * Math.min(+n, 8);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const delim = detectDelimiter(text);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field.trim());
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field.trim());
        field = '';
        if (row.some(x => x)) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  row.push(field.trim());
  if (row.some(x => x)) rows.push(row);
  return rows;
}

export function parseAmount(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/−/g, '-');
  if (!s || !/\d/.test(s)) return NaN;
  const isNeg = /^\(.*\)$/.test(s) || /-/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (/,\d{1,2}$/.test(s) && !/\.\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : (isNeg ? -n : n);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const validYMD = (y, mo, d) => {
  y = +y; mo = +mo; d = +d;
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + pad(mo) + '-' + pad(d);
};

export function parseDate(s, order = 'dmy') {
  s = String(s || '').trim();
  if (!s) return '';
  // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (optionally followed by a time)
  let m = s.match(/^(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})(?!\d)/);
  if (m) return validYMD(m[1], m[2], m[3]);

  // YYYYMMDD (Standard Bank and others)
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return validYMD(m[1], m[2], m[3]);

  // DD/MM/YYYY or MM/DD/YYYY (2- or 4-digit year)
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})(?!\d)/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    let [mo, d] = order === 'mdy' ? [a, b] : [b, a];
    if (+mo > 12 && +d <= 12) [mo, d] = [d, mo];
    return validYMD(y, mo, d);
  }

  // 15 Oct 2026, 15-Oct-26, 15 October 2026
  const monthNum = w => MONTHS[w.toLowerCase()] || MONTHS[w.slice(0, 3).toLowerCase()];
  m = s.match(/^(\d{1,2})[-/.\s]+([a-z]{3,9})\.?[-/.\s,]+(\d{2,4})(?!\d)/i);
  if (m && monthNum(m[2])) return validYMD(m[3].length === 2 ? '20' + m[3] : m[3], monthNum(m[2]), m[1]);

  // Oct 15, 2026
  m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && monthNum(m[1])) return validYMD(m[3], monthNum(m[1]), m[2]);

  return '';
}

// Strip card numbers, trailing reference numbers and repeated spaces from bank
// descriptions so the same merchant always gets the same payee name.
// e.g. "Takealot            457896*9610  09 OCT" -> "Takealot"
export function cleanPayee(s) {
  let p = String(s || '').replace(/\s+/g, ' ').trim();
  p = p.replace(/\s+\d{4,6}\*+\d{4}\b.*$/, '');          // masked card number and anything after it
  p = p.replace(/\s+\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i, ''); // trailing "09 OCT"
  p = p.replace(/\s+\d{8,}$/, '');                        // trailing account / reference number
  return p.trim() || String(s || '').trim();
}

const isDateLike = v => !!parseDate(v, 'dmy');
const isNumberLike = v => /^[\s(+\-−]*[A-Z$€£R]{0,3}\s*[\d\s.,]+\)?\s*(CR|DR)?$/i.test(v) && /\d/.test(v) && !isDateLike(v);

// Find the real header row: bank exports often put account details above it.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const lc = rows[i].map(h => h.toLowerCase());
    const hasDate = lc.some(h => /date|posted/.test(h) && h.length < 30);
    const hasMoney = lc.some(h => /amount|debit|credit|value|withdraw|deposit|money|paid/.test(h) && h.length < 30);
    if (hasDate && hasMoney && rows[i].length >= 2) return i;
  }
  return -1;
}

// No header row at all: guess columns from what the data looks like.
function guessColumnsFromData(rows) {
  const width = Math.max(...rows.map(r => r.length));
  const sample = rows.filter(r => r.length >= Math.min(3, width)).slice(0, 40);
  const score = (i, fn) => sample.filter(r => r[i] && fn(r[i])).length / (sample.length || 1);
  const cols = Array.from({ length: width }, (_, i) => ({
    i, date: score(i, isDateLike), num: score(i, isNumberLike),
    text: sample.reduce((t, r) => t + (r[i] && !isNumberLike(r[i]) && !isDateLike(r[i]) ? r[i].length : 0), 0),
  }));
  const date = cols.filter(c => c.date > 0.6).sort((a, b) => b.date - a.date)[0];
  const nums = cols.filter(c => c.num > 0.6 && (!date || c.i !== date.i));
  const payee = cols.filter(c => (!date || c.i !== date.i) && !nums.includes(c)).sort((a, b) => b.text - a.text)[0];
  return { date: date ? date.i : -1, amount: nums.length ? nums[0].i : -1, payee: payee ? payee.i : -1, debit: -1, credit: -1 };
}

// Day/month vs month/day: any first part > 12 means DMY, any second part > 12 means MDY.
function detectDateOrder(rows, col) {
  let dmy = 0, mdy = 0, iso = 0;
  for (const r of rows) {
    const v = String(r[col] || '').trim();
    if (/^\d{4}[-/.\s]?\d{1,2}[-/.\s]?\d{1,2}/.test(v)) { iso++; continue; }
    const m = v.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  if (iso && !dmy && !mdy) return 'ymd';
  return mdy > dmy ? 'mdy' : 'dmy';
}

const dupKey = (date, amount, payee) => date + '|' + Number(amount).toFixed(2) + '|' + norm(cleanPayee(payee));

export function importFlow(text, fileName, { ledger, transactions, onImport }) {
  const rows = parseCSV(text);
  if (rows.length < 2) {
    toast('That file has no rows to import');
    return;
  }

  const headerIdx = findHeaderRow(rows);
  const width = Math.max(...rows.map(r => r.length));
  const head = headerIdx >= 0
    ? rows[headerIdx].map((h, i) => h || 'Column ' + (i + 1))
    : Array.from({ length: width }, (_, i) => 'Column ' + (i + 1));
  const dataRows = rows.slice(headerIdx + 1);
  const lc = headerIdx >= 0 ? head.map(h => h.toLowerCase()) : [];
  const find = re => lc.findIndex(h => re.test(h));

  const map = headerIdx < 0 ? guessColumnsFromData(dataRows) : {
    // Broader date patterns including SA bank headers
    date: find(/^(date|posted|trans.*date|transaction.?date|value.?date|entry.?date|posting.?date|txn.?date|booking.?date)$/),
    // Broader payee/description patterns
    payee: find(/^(description|desc|payee|merchant|name|memo|details|narrative|beneficiary|reference|remarks|particulars|transaction.?description|txn.?description|trx.?desc|counter.?party|party.?name)$/),
    // Amount: prefer columns literally named "amount"
    amount: find(/^(amount|transaction.?amount|txn.?amount|trx.?amount|value|net.?amount|running.?amount|debit\/credit|dr\/cr)$/),
    debit: find(/^(debit|debit.?amount|dr|withdrawals?|money.?out|paid.?out|charge|payment)$/),
    credit: find(/^(credit|credit.?amount|cr|deposits?|money.?in|paid.?in|receipts?)$/)
  };

  // Fallback: if strict match failed, try looser (never treat "Balance" as the amount)
  if (headerIdx >= 0) {
    if (map.date < 0) map.date = find(/date|posted/);
    if (map.payee < 0) map.payee = find(/desc|payee|merchant|name|memo|details|narrative|beneficiary|reference|remarks/);
    if (map.amount < 0) map.amount = lc.findIndex(h => /amount|value|net/.test(h) && !/balance/.test(h));
    if (map.debit < 0) map.debit = find(/debit|withdraw|money.?out|paid.?out/);
    if (map.credit < 0) map.credit = find(/credit|deposit|money.?in|paid.?in/);
    // Still no description column: use the longest text column
    if (map.payee < 0) map.payee = guessColumnsFromData(dataRows).payee;
  }

  // If amount col is same as debit or credit, clear debit/credit
  if (map.amount >= 0 && (map.amount === map.debit || map.amount === map.credit)) {
    map.debit = -1;
    map.credit = -1;
  }

  // If we have both debit and credit columns, clear the amount col
  if (map.debit >= 0 && map.credit >= 0) {
    map.amount = -1;
  }

  if (map.date < 0 || (map.amount < 0 && map.debit < 0 && map.credit < 0)) {
    toast('Couldn’t find date and amount columns. Pick them below.');
  }

  // Day/month order from all rows, not just the first one
  const detectedOrder = map.date >= 0 ? detectDateOrder(dataRows, map.date) : 'dmy';

  // Sign convention: a single amount column with no negatives anywhere is
  // most likely a card export where positive numbers are spending.
  let autoFlip = false;
  if (map.amount >= 0) {
    const vals = dataRows.map(r => parseAmount(r[map.amount])).filter(n => !isNaN(n) && n !== 0);
    autoFlip = vals.length >= 3 && vals.every(n => n > 0);
  }

  const colSel = (id, sel, none = false) =>
    `<select id="${id}">${none ? '<option value="-1">None</option>' : ''}${head.map((h, i) =>
      `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`
    ).join('')}</select>`;

  openSheet(`
    <h2>Import ${esc(fileName)}</h2>
    <p class="muted" style="margin:0">Match columns and check preview. Transactions already in your ledger (same date, amount, and payee) are skipped automatically.</p>
    <div class="fields">
      ${fld('Date column', colSel('i-date', map.date))}
      ${fld('Description column', colSel('i-payee', map.payee))}
      ${fld('Amount column', colSel('i-amount', map.amount, true))}
      ${fld('Date format', `<select id="i-order"><option value="dmy"${detectedOrder === 'dmy' ? ' selected' : ''}>Day/Month/Year (ZA / UK / EU)</option><option value="mdy"${detectedOrder === 'mdy' ? ' selected' : ''}>Month/Day/Year (US)</option><option value="ymd"${detectedOrder === 'ymd' ? ' selected' : ''}>Year/Month/Day (ISO)</option></select>`)}
      ${fld('Debit column (if separate)', colSel('i-debit', map.debit, true))}
      ${fld('Credit column (if separate)', colSel('i-credit', map.credit, true))}
      ${fld('Into account', `<select id="i-acct">${acctOptions(ledger.accounts, (ledger.accounts[0] || {}).id)}</select>`)}
      <label class="chk" style="align-self:end"><input type="checkbox" id="i-flip"${autoFlip ? ' checked' : ''}> Positive numbers are spending</label>
    </div>
    <div id="i-prev" style="margin-top:6px"></div>
    <div class="sheet-acts">
      <button class="btn" id="i-cancel" type="button">Cancel</button>
      <button class="btn primary" id="i-go" type="button">Import</button>
    </div>`, sh => {
    let parsed = [];
    const val = id => +sh.querySelector('#' + id).value;

    const build = () => {
      const c = { d: val('i-date'), p: val('i-payee'), a: val('i-amount'), de: val('i-debit'), cr: val('i-credit') };
      const order = sh.querySelector('#i-order').value;
      const flip = sh.querySelector('#i-flip').checked;
      const acc = sh.querySelector('#i-acct').value;

      // Count existing transactions per key, so two identical purchases on the
      // same day in the file are both kept, while re-imports are still skipped.
      const existing = new Map();
      for (const t of transactions) {
        if (t.accountId !== acc) continue;
        const k = dupKey(t.date, t.amount, t.payee);
        existing.set(k, (existing.get(k) || 0) + 1);
      }
      parsed = [];
      let dup = 0;
      let bad = 0;

      for (const r of dataRows) {
        if (r.length < Math.max(2, Math.ceil(head.length / 2))) continue; // footer / note lines
        const date = c.d >= 0 ? parseDate(r[c.d], order) : '';
        const single = c.a >= 0 ? parseAmount(r[c.a]) : NaN;
        let amount;
        if (!isNaN(single)) {
          amount = flip ? -single : single;
        } else {
          const cr = parseAmount(r[c.cr]), de = parseAmount(r[c.de]);
          amount = (isNaN(cr) ? 0 : Math.abs(cr)) - (isNaN(de) ? 0 : Math.abs(de));
        }
        const raw = String(r[c.p] || '').trim().replace(/\s+/g, ' ');
        const payee = cleanPayee(raw);

        if (!date || isNaN(amount) || amount === 0) {
          bad++;
          continue;
        }

        amount = round2(amount);
        const key = dupKey(date, amount, payee);
        const left = existing.get(key) || 0;
        if (left > 0) {
          existing.set(key, left - 1);
          dup++;
          continue;
        }

        const categoryId = autoCategory(payee, ledger.rules, ledger.categories, transactions);
        parsed.push({
          id: uid(),
          date,
          payee,
          amount,
          categoryId,
          accountId: acc,
          note: raw !== payee ? raw : ''
        });
      }

      const catd = parsed.filter(t => t.categoryId).length;
      sh.querySelector('#i-prev').innerHTML = `
        <p class="muted" style="margin:0 0 6px">
          ${parsed.length} new · ${catd} auto-categorized · ${dup} duplicates skipped${bad ? ' · ' + bad + ' unreadable' : ''}
        </p>
        <div class="tablewrap" style="max-height:260px;overflow-y:auto">
          <table>
            <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th class="r">Amount</th></tr></thead>
            <tbody>
              ${parsed.slice(0, 15).map(t => `
                <tr>
                  <td class="num">${esc(t.date)}</td>
                  <td class="payee">${esc(t.payee)}</td>
                  <td><span class="chip">${esc(catName(ledger.categories, t.categoryId))}</span></td>
                  <td class="amt r ${t.amount > 0 ? 'pos' : ''}">${money(t.amount, {}, ledger.settings.currency)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

      const goBtn = sh.querySelector('#i-go');
      goBtn.textContent = 'Import ' + parsed.length;
      goBtn.disabled = !parsed.length;
    };

    sh.querySelectorAll('select, input').forEach(el => el.addEventListener('change', build));
    build();

    sh.querySelector('#i-cancel').addEventListener('click', closeSheet);
    sh.querySelector('#i-go').addEventListener('click', () => {
      if (parsed.length) {
        onImport(parsed);
        closeSheet();
        toast(`${parsed.length} transactions imported`);
      }
    });
  });
}

export function pickCSV(context) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.csv,text/csv,text/plain';
  inp.addEventListener('change', () => {
    const f = inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importFlow(String(r.result), f.name, context);
    r.readAsText(f);
  });
  inp.click();
}

export function toCSV(list, categories, accounts) {
  const q = v => {
    v = String(v ?? '');
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return [
    'Date,Payee,Amount,Category,Account,Note',
    ...list.map(t => [
      t.date,
      t.payee,
      t.amount.toFixed(2),
      catName(categories, t.categoryId),
      (accounts.find(a => a.id === t.accountId) || {}).name || '',
      t.note || ''
    ].map(q).join(','))
  ].join('\n');
}

export function exportCSV(list, categories, accounts, filename = 'ledgerline-export.csv') {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const csv = toCSV(sorted, categories, accounts);

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
  toast(`Exported ${list.length} transactions`);
}
