// src/pdf.js - Import bank statement PDFs (FNB first, other banks via Gemini)
'use strict';

import { uid, round2, pad, esc, money, catName, autoCategory } from './model.js';
import { openSheet, closeSheet, acctOptions } from './ui/sheet.js';
import { toast } from './ui/toast.js';
import { cleanPayee, dupKey } from './csv.js';
import { parseStatementPdf } from './gemini.js';

/* ---------- PDF text extraction (pdf.js, vendored in lib/pdfjs) ---------- */

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const base = new URL('../lib/pdfjs/', import.meta.url);
    pdfjsPromise = import(new URL('pdf.min.mjs', base).href).then(mod => {
      mod.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
      return mod;
    });
  }
  return pdfjsPromise;
}

// Group positioned text items into visual lines, each a list of cells left to right.
export function groupIntoLines(items, page = 1) {
  const rows = [];
  for (const it of items) {
    const str = String(it.str || '').trim();
    if (!str) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find(r => Math.abs(r.y - y) <= 2.5);
    if (!row) { row = { y, page, cells: [] }; rows.push(row); }
    row.cells.push({ x, w: it.width || 0, str });
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach(r => {
    r.cells.sort((a, b) => a.x - b.x);
    // Merge items pdf.js split mid-word (e.g. "1,234.5" + "6Cr") into one cell
    const merged = [];
    for (const c of r.cells) {
      const prev = merged[merged.length - 1];
      if (prev && c.x - (prev.x + prev.w) < 1.5) { prev.str += c.str; prev.w = c.x + c.w - prev.x; }
      else merged.push({ ...c });
    }
    r.cells = merged;
    r.text = merged.map(c => c.str).join(' ');
  });
  return rows;
}

async function readPdf(buf, password) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: buf, password, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...groupIntoLines(tc.items, p));
  }
  await doc.destroy();
  return lines;
}

/* ---------- Statement parsing ---------- */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const monthNum = w => MONTHS[String(w).slice(0, 3).toLowerCase()] || 0;
const AMOUNT_RE = /^\(?[-−]?\s?(?:R\s?)?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2}\)?\s?(?:Cr|Dr|CR|DR|-)?$/;
const SKIP_RE = /opening balance|closing balance|balance brought forward|balance carried forward|brought forward|carried forward|^total|turnover|interest rate|page \d+ of/i;

function amountValue(s) {
  const neg = /^\(|-|−|\bDr\b/i.test(s);
  const cr = /Cr$/i.test(s.trim());
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return { n: isNaN(n) ? NaN : n, neg, cr };
}

// The year a "dd Mon" date belongs to, from the statement period.
// A December line on a statement ending in January belongs to the year before.
function makeYearFor(lines) {
  let endY = 0, endM = 0;
  for (const l of lines) {
    const m = l.text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s*(?:to|-|–|until)\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
    if (m && monthNum(m[5])) { endY = +m[6]; endM = monthNum(m[5]); break; }
  }
  if (!endY) {
    // No period line: use the latest full date printed anywhere on the statement
    for (const l of lines) {
      for (const m of l.text.matchAll(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/g)) {
        const mo = monthNum(m[2]);
        if (mo && (+m[3] * 12 + mo) > (endY * 12 + endM)) { endY = +m[3]; endM = mo; }
      }
    }
  }
  if (!endY) { const d = new Date(); endY = d.getFullYear(); endM = d.getMonth() + 1; }
  return mo => (mo > endM ? endY - 1 : endY);
}

function leadingDate(text, yearFor) {
  let m = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, len: m[0].length };
  m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (m) return { date: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, len: m[0].length };
  m = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\b(?:\s+(20\d{2}))?/);
  if (m && monthNum(m[2]) && +m[1] >= 1 && +m[1] <= 31) {
    const mo = monthNum(m[2]);
    const y = m[3] ? +m[3] : yearFor(mo);
    return { date: `${y}-${pad(mo)}-${pad(m[1])}`, len: m[0].length };
  }
  return null;
}

// Parse transaction lines from a text statement. Works on FNB's layout
// (Date | Description | Amount | Balance | Accrued charges, credits marked "Cr")
// and on signed layouts where debits are negative.
export function parseStatementLines(lines) {
  const yearFor = makeYearFor(lines);
  // Locate the Amount column from the table header, if there is one
  let amountX = null;
  for (const l of lines) {
    const a = l.cells.find(c => /^amount$/i.test(c.str) || /^amount\s*\(r\)$/i.test(c.str));
    if (a && l.cells.some(c => /balance/i.test(c.str))) { amountX = a.x + a.w / 2; break; }
  }
  const usesCr = lines.some(l => l.cells.some(c => AMOUNT_RE.test(c.str) && /Cr$/i.test(c.str)));

  const out = [];
  let last = null;
  for (const l of lines) {
    const d = leadingDate(l.text, yearFor);
    const amountCells = l.cells.filter(c => AMOUNT_RE.test(c.str.replace(/\s+(Cr|Dr)$/i, '$1')));
    if (!d) {
      // A wrapped description line under the previous transaction
      if (last && !amountCells.length && l.page === last.page && last.y - l.y < 14 && l.text.length < 60 && !SKIP_RE.test(l.text)) {
        last.tx.payee = (last.tx.payee + ' ' + l.text).trim();
        last.y = l.y;
      }
      continue;
    }
    if (!amountCells.length) { last = null; continue; }

    let cell;
    if (amountX != null) {
      cell = amountCells.reduce((best, c) => Math.abs(c.x + c.w / 2 - amountX) < Math.abs(best.x + best.w / 2 - amountX) ? c : best);
      if (Math.abs(cell.x + cell.w / 2 - amountX) > 60) cell = amountCells[0];
    } else {
      cell = amountCells[0];
    }
    const firstAmtIdx = l.cells.indexOf(amountCells[0]);
    let desc = l.cells.slice(0, firstAmtIdx).map(c => c.str).join(' ');
    desc = desc.slice(Math.min(d.len, desc.length)).trim();
    // Layouts like "Date | Amount | Balance | Description" put the text after the numbers
    if (!desc) {
      const lastAmtIdx = l.cells.indexOf(amountCells[amountCells.length - 1]);
      desc = l.cells.slice(lastAmtIdx + 1).map(c => c.str).join(' ').trim();
    }
    if (SKIP_RE.test(desc) || !desc) { last = null; continue; }

    const v = amountValue(cell.str);
    if (isNaN(v.n) || v.n === 0) continue;
    const amount = v.cr ? v.n : (v.neg || usesCr ? -v.n : v.n);
    const tx = { date: d.date, payee: desc.replace(/\s+/g, ' '), amount: round2(amount) };
    out.push(tx);
    last = { tx, y: l.y, page: l.page };
  }
  return out;
}

/* ---------- Import UI ---------- */

function askPassword(fileName) {
  return new Promise(resolve => {
    openSheet(`
      <h2>${esc(fileName)} is password-protected</h2>
      <p class="muted" style="margin:0">Enter the statement password. It's used only to open the file on this device and isn't saved.</p>
      <form id="pw-form" class="fields"><input type="password" id="pw-input" class="full" required autocomplete="off" placeholder="Statement password"></form>
      <div class="sheet-acts"><button class="btn" type="button" id="pw-skip">Skip this file</button><button class="btn primary" type="submit" form="pw-form">Open</button></div>`, sh => {
      sh.querySelector('#pw-skip').addEventListener('click', () => { closeSheet(); resolve(null); });
      sh.querySelector('#pw-form').addEventListener('submit', e => { e.preventDefault(); const v = sh.querySelector('#pw-input').value; closeSheet(); resolve(v); });
    });
  });
}

const toBase64 = buf => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function readWithGemini(file, ctx) {
  const buf = await file.arrayBuffer();
  if (buf.byteLength > 18 * 1024 * 1024) throw new Error('File is over 18 MB, too big to send to Gemini.');
  const rows = await parseStatementPdf({
    apiKey: ctx.geminiKey, model: ctx.geminiModel, pdfBase64: toBase64(buf),
    currentCurrency: ctx.ledger.settings.currency,
  });
  return rows
    .filter(r => r && r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && +r.amount)
    .map(r => ({ date: r.date, payee: String(r.payee || '').trim(), amount: round2(r.direction === 'credit' ? Math.abs(r.amount) : -Math.abs(r.amount)) }));
}

export function pickPDFs(ctx) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.pdf,application/pdf';
  inp.multiple = true;
  inp.addEventListener('change', () => { const files = [...inp.files]; if (files.length) importPdfFiles(files, ctx); });
  inp.click();
}

export async function importPdfFiles(files, ctx) {
  toast(`Reading ${files.length} PDF${files.length > 1 ? 's' : ''}…`);
  const results = [];
  for (const file of files) {
    const r = { file, name: file.name, rows: [], method: 'Statement reader', error: '' };
    try {
      const buf = await file.arrayBuffer();
      let lines = null, password;
      for (let attempt = 0; attempt < 3 && !lines; attempt++) {
        try { lines = await readPdf(new Uint8Array(buf.slice(0)), password); }
        catch (err) {
          if (err && err.name === 'PasswordException') {
            password = await askPassword(file.name);
            if (password == null) { r.error = 'Skipped: password-protected'; break; }
          } else throw err;
        }
      }
      if (lines) {
        r.rows = parseStatementLines(lines);
        if (!r.rows.length) r.error = lines.length ? 'No transactions recognised' : 'No text in this PDF (it may be a scan)';
      } else if (!r.error) r.error = 'Wrong password';
    } catch (err) {
      console.error('PDF read failed', file.name, err);
      r.error = 'Couldn’t open this PDF';
    }
    results.push(r);
  }
  showPreview(results, ctx);
}

function showPreview(results, ctx) {
  const hasKey = !!ctx.geminiKey;
  openSheet(`
    <h2>Import ${results.length} statement${results.length > 1 ? 's' : ''}</h2>
    <div id="pdf-files" class="rows"></div>
    <label class="field"><span>Into account</span><select id="pdf-acct">${acctOptions(ctx.ledger.accounts, (ctx.ledger.accounts[0] || {}).id)}</select></label>
    <div id="pdf-prev"></div>
    <div class="sheet-acts">
      <button class="btn" type="button" id="pdf-cancel">Cancel</button>
      <button class="btn primary" type="button" id="pdf-go">Import</button>
    </div>`, sh => {
    let parsed = [];
    const build = () => {
      const acc = sh.querySelector('#pdf-acct').value;
      sh.querySelector('#pdf-files').innerHTML = results.map((r, i) => `
        <div class="row">
          <span class="grow"><div style="font-weight:600">${esc(r.name)}</div>
            <div class="muted" style="font-size:.8rem">${r.busy ? 'Reading with Gemini…' : r.error ? esc(r.error) : `${r.rows.length} transactions · ${esc(r.method)}`}</div></span>
          ${r.rows.length ? '<span class="chip ok">Read</span>' : '<span class="chip warn">Not read</span>'}
          ${hasKey && !r.busy ? `<button class="btn small" type="button" data-gem="${i}">${r.rows.length ? 'Re-read with Gemini' : 'Read with Gemini'}</button>` : ''}
        </div>`).join('') + (!hasKey && results.some(r => !r.rows.length) ? '<div class="muted" style="font-size:.85rem">Add a Gemini key in Setup to read statements from other banks or scanned PDFs.</div>' : '');

      const existing = new Map();
      for (const t of ctx.transactions) {
        if (t.accountId !== acc) continue;
        const k = dupKey(t.date, t.amount, t.payee); existing.set(k, (existing.get(k) || 0) + 1);
      }
      // Overlapping statements repeat the same transactions. A key that appears
      // twice in one statement is two real purchases; across statements it is
      // the same one. So keep, per key, the most copies any single file has,
      // minus what's already in the ledger.
      const want = new Map();
      for (const r of results) {
        const inFile = new Map();
        for (const row of r.rows) { const k = dupKey(row.date, row.amount, row.payee); inFile.set(k, (inFile.get(k) || 0) + 1); }
        for (const [k, n] of inFile) want.set(k, Math.max(want.get(k) || 0, n));
      }
      for (const [k, n] of want) want.set(k, n - (existing.get(k) || 0));
      parsed = []; let dup = 0;
      for (const r of results) {
        for (const row of r.rows) {
          const payee = cleanPayee(row.payee);
          const k = dupKey(row.date, row.amount, payee);
          if ((want.get(k) || 0) <= 0) { dup++; continue; }
          want.set(k, want.get(k) - 1);
          parsed.push({ id: uid(), date: row.date, payee, amount: row.amount,
            categoryId: autoCategory(payee, ctx.ledger.rules, ctx.ledger.categories, ctx.transactions),
            accountId: acc, note: payee !== row.payee ? row.payee : '' });
        }
      }
      parsed.sort((a, b) => b.date.localeCompare(a.date));
      const range = parsed.length ? `${parsed[parsed.length - 1].date} to ${parsed[0].date}` : '';
      sh.querySelector('#pdf-prev').innerHTML = `
        <p class="muted" style="margin:0 0 6px">${parsed.length} new${range ? ' · ' + range : ''} · ${dup} duplicates skipped</p>
        ${parsed.length ? `<div class="tablewrap" style="max-height:260px;overflow-y:auto"><table>
          <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th class="r">Amount</th></tr></thead>
          <tbody>${parsed.slice(0, 20).map(t => `<tr><td class="num">${esc(t.date)}</td><td class="payee">${esc(t.payee)}</td>
            <td><span class="chip">${esc(catName(ctx.ledger.categories, t.categoryId))}</span></td>
            <td class="amt r ${t.amount > 0 ? 'pos' : ''}">${money(t.amount, {}, ctx.ledger.settings.currency)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      const go = sh.querySelector('#pdf-go');
      go.textContent = 'Import ' + parsed.length;
      go.disabled = !parsed.length || results.some(r => r.busy);
    };

    sh.querySelector('#pdf-acct').addEventListener('change', build);
    sh.querySelector('#pdf-files').addEventListener('click', async e => {
      const b = e.target.closest('[data-gem]'); if (!b) return;
      const r = results[+b.dataset.gem];
      r.busy = true; build();
      try { r.rows = await readWithGemini(r.file, ctx); r.method = 'Gemini'; r.error = r.rows.length ? '' : 'Gemini found no transactions'; }
      catch (err) { r.error = err.message || 'Gemini couldn’t read this file'; }
      r.busy = false;
      if (sh.isConnected) build();
    });
    sh.querySelector('#pdf-cancel').addEventListener('click', closeSheet);
    sh.querySelector('#pdf-go').addEventListener('click', () => {
      if (!parsed.length) return;
      ctx.onImport(parsed);
      closeSheet();
      toast(`${parsed.length} transactions imported`);
    });
    build();
  });
}
