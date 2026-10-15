// src/csv.js - CSV parsing, column mapping, duplicate detection, import and export
'use strict';

import { uid, round2, pad, dstr, norm, esc, money, catName, autoCategory, ym } from './model.js';
import { openSheet, closeSheet, fld, acctOptions } from './ui/sheet.js';
import { toast } from './ui/toast.js';

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const head = text.slice(0, 500);
  const delim = head.includes(';') && !head.includes(',') ? ';' : ',';

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
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.some(x => x.trim())) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  row.push(field);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

export function parseAmount(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (!s) return NaN;
  const isNeg = /^\(.*\)$/.test(s) || /-/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : (isNeg ? -n : n);
}

export function parseDate(s, order = 'ymd') {
  s = String(s || '').trim();
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);

  // DD-MM-YYYY or MM-DD-YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    const [mo, d] = order === 'dmy' ? [b, a] : [a, b];
    if (+mo > 12) return y + '-' + pad(d) + '-' + pad(mo);
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  const d = new Date(s);
  return isNaN(d) ? '' : dstr(d);
}

export function importFlow(text, fileName, { ledger, transactions, onImport }) {
  const rows = parseCSV(text);
  if (rows.length < 2) {
    toast('That file has no rows to import');
    return;
  }

  const head = rows[0].map(h => h.trim());
  const lc = head.map(h => h.toLowerCase());
  const find = re => lc.findIndex(h => re.test(h));

  const map = {
    date: find(/date|posted|trans.*date|transaction_date/),
    payee: find(/desc|payee|merchant|name|memo|details|narrative|beneficiary/),
    amount: find(/^amount|amount$|amount \(|value|net/),
    debit: find(/debit|withdraw|money out|paid out/),
    credit: find(/credit|deposit|money in|paid in/)
  };

  if (map.amount >= 0 && (map.amount === map.debit || map.amount === map.credit)) {
    map.debit = -1;
    map.credit = -1;
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
      ${fld('Date format', `<select id="i-order"><option value="dmy">Day/Month/Year (ZA / UK / EU)</option><option value="mdy">Month/Day/Year (US)</option><option value="ymd">Year/Month/Day (ISO)</option></select>`)}
      ${fld('Debit column (if separate)', colSel('i-debit', map.debit, true))}
      ${fld('Credit column (if separate)', colSel('i-credit', map.credit, true))}
      ${fld('Into account', `<select id="i-acct">${acctOptions(ledger.accounts, (ledger.accounts[0] || {}).id)}</select>`)}
      <label class="chk" style="align-self:end"><input type="checkbox" id="i-flip"> Positive numbers are spending</label>
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

      const seen = new Set(transactions.map(t => t.date + '|' + t.amount.toFixed(2) + '|' + norm(t.payee)));
      parsed = [];
      let dup = 0;
      let bad = 0;

      for (const r of rows.slice(1)) {
        const date = parseDate(r[c.d], order);
        let amount = c.a >= 0 ? parseAmount(r[c.a]) : (parseAmount(r[c.cr]) || 0) - Math.abs(parseAmount(r[c.de]) || 0);
        if (flip && c.a >= 0) amount = -amount;
        const payee = String(r[c.p] || '').trim().replace(/\s+/g, ' ');

        if (!date || isNaN(amount) || amount === 0) {
          bad++;
          continue;
        }

        amount = round2(amount);
        const key = date + '|' + amount.toFixed(2) + '|' + norm(payee);
        if (seen.has(key)) {
          dup++;
          continue;
        }
        seen.add(key);

        const categoryId = autoCategory(payee, ledger.rules, ledger.categories, transactions);
        parsed.push({
          id: uid(),
          date,
          payee,
          amount,
          categoryId,
          accountId: acc,
          note: ''
        });
      }

      const catd = parsed.filter(t => t.categoryId).length;
      sh.querySelector('#i-prev').innerHTML = `
        <p class="muted" style="margin:0 0 6px">
          ${parsed.length} new · ${catd} auto-categorized · ${dup} duplicates skipped${bad ? ' · ' + bad + ' unreadable' : ''}
        </p>
        <div class="tablewrap" style="max-height:220px;overflow-y:auto">
          <table>
            <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th class="r">Amount</th></tr></thead>
            <tbody>
              ${parsed.slice(0, 8).map(t => `
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
