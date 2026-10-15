// src/views/transactions.js - Transactions view, day-grouped list, filters, add/edit form, and AI receipt & bank alert triggers
'use strict';

import {
  norm,
  kindOf,
  dLabel,
  esc,
  money,
  sum,
  uid,
  today,
  ym,
  catName,
  autoCategory,
  round2
} from '../model.js';
import { openSheet, closeSheet, confirmBtn, fld, catOptions, acctOptions } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

export function getFilteredTransactions({ transactions, month, uiState, categories }) {
  const q = norm(uiState.q);
  return transactions
    .filter(t => {
      const matchMonth = uiState.allMonths || t.date.startsWith(month);
      const matchCat = !uiState.cat || (uiState.cat === '_none' ? !t.categoryId : t.categoryId === uiState.cat);
      const matchAcct = !uiState.acct || t.accountId === uiState.acct;
      const matchQuery = !q ||
        norm(t.payee + ' ' + (t.note || '') + ' ' + catName(categories, t.categoryId)).includes(q) ||
        String(Math.abs(t.amount)).includes(uiState.q.trim());
      return matchMonth && matchCat && matchAcct && matchQuery;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.payee.localeCompare(b.payee));
}

export function renderTransactions({ ledger, transactions, month, uiState }) {
  const currency = ledger.settings.currency;
  const list = getFilteredTransactions({ transactions, month, uiState, categories: ledger.categories });
  const inc = sum(list.filter(t => kindOf(t, ledger.categories) === 'income'), t => t.amount);
  const out = -sum(list.filter(t => kindOf(t, ledger.categories) === 'expense'), t => t.amount);

  let lastDay = '';
  let rows = '';

  for (const t of list.slice(0, 600)) {
    if (t.date !== lastDay) {
      lastDay = t.date;
      rows += `<tr class="daygroup"><td colspan="4">${esc(dLabel(t.date))}</td></tr>`;
    }
    const k = kindOf(t, ledger.categories);
    const acct = ledger.accounts.find(a => a.id === t.accountId);
    rows += `
      <tr data-tx="${esc(t.id)}">
        <td class="payee">
          ${esc(t.payee || '(no description)')}
          ${t.note ? `<div class="muted" style="font-size:0.8rem;font-weight:400">${esc(t.note)}</div>` : ''}
        </td>
        <td>
          ${t.categoryId ? `<span class="chip${k === 'income' ? ' ok' : ''}">${esc(catName(ledger.categories, t.categoryId))}</span>` : '<span class="chip warn">Uncategorized</span>'}
        </td>
        <td class="muted">${esc(acct ? acct.name : '')}</td>
        <td class="amt r ${t.amount > 0 && k !== 'transfer' ? 'pos' : ''}">
          ${t.amount > 0 ? '+' : ''}${money(t.amount, {}, currency)}
        </td>
      </tr>`;
  }

  return `
    <div class="panel">
      <div class="filters">
        <input type="search" id="f-q" placeholder="Search payee, note, category or amount" value="${esc(uiState.q)}" autocomplete="off">
        <select id="f-cat">
          <option value="">All categories</option>
          <option value="_none"${uiState.cat === '_none' ? ' selected' : ''}>Uncategorized</option>
          ${catOptions(ledger.categories, uiState.cat, { blank: null })}
        </select>
        <select id="f-acct">
          <option value="">All accounts</option>
          ${acctOptions(ledger.accounts, uiState.acct)}
        </select>
        <label class="chk">
          <input type="checkbox" id="f-all"${uiState.allMonths ? ' checked' : ''}> All months
        </label>
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small" id="b-scan-receipt" title="Scan receipt with Gemini">
            📷 Scan receipt
          </button>
          <button class="btn small" id="b-paste-sms" title="Paste bank notification SMS or email">
            💬 Bank SMS
          </button>
          <button class="btn small" id="b-import">Import CSV</button>
          <button class="btn small" id="b-import-pdf" title="Import FNB or other bank statement PDFs">Import PDF</button>
          <button class="btn small" id="b-export">Export</button>
        </span>
      </div>

      <div class="muted" style="font-size:0.85rem">
        ${list.length} transactions · <span class="pos">${money(inc, {}, currency)} in</span> · ${money(out, {}, currency)} out
      </div>

      ${list.length ? `
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Payee</th>
                <th>Category</th>
                <th>Account</th>
                <th class="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        ${list.length > 600 ? '<div class="muted">Showing the 600 most recent. Narrow the search to see more.</div>' : ''}
      ` : `
        <div class="empty">
          No transactions match.
          <button class="link" id="b-add2">Add one</button>,
          <button class="link" id="b-scan2">scan a receipt</button>, or
          <button class="link" id="b-import2">import a bank CSV</button> or
          <button class="link" id="b-import-pdf2">PDF statements</button>.
        </div>
      `}
    </div>
  `;
}

/**
 * Transaction Form Sheet (Add / Edit / Transfer)
 */
export function openTransactionForm(t, { ledger, transactions, month, onSave, onDelete }) {
  const isNew = !t;
  const initialDate = today().startsWith(month) ? today() : month + '-01';
  t = t || {
    id: uid(),
    date: initialDate,
    payee: '',
    amount: 0,
    categoryId: '',
    accountId: (ledger.accounts[0] || {}).id,
    note: ''
  };

  let type = kindOf(t, ledger.categories) === 'transfer'
    ? 'transfer'
    : (t.amount > 0 ? 'income' : 'expense');

  const payees = [...new Set(transactions.map(x => x.payee))].slice(0, 400);

  openSheet(`
    <h2>${isNew ? 'New transaction' : 'Edit transaction'}</h2>
    <div class="seg" role="group" aria-label="Type">
      <button type="button" data-ty="expense">Expense</button>
      <button type="button" data-ty="income">Income</button>
      <button type="button" data-ty="transfer">Transfer</button>
    </div>
    <form id="tf" class="fields">
      ${fld('Payee or description', `<input type="text" id="t-payee" list="t-payees" required value="${esc(t.payee)}" autocomplete="off">`, true)}
      <datalist id="t-payees">${payees.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      ${fld('Amount', `<input type="number" id="t-amount" step="0.01" min="0" required value="${t.amount ? Math.abs(t.amount) : ''}" inputmode="decimal">`)}
      ${fld('Date', `<input type="date" id="t-date" required value="${esc(t.date)}">`)}
      <span class="field" id="t-catwrap">
        ${fld('Category', `<select id="t-cat">${catOptions(ledger.categories, t.categoryId)}</select>`)}
      </span>
      ${fld('<span id="t-acctlabel">Account</span>', `<select id="t-acct">${acctOptions(ledger.accounts, t.accountId)}</select>`)}
      <span class="field" id="t-towrap" hidden>
        ${fld('To account', `<select id="t-to">${acctOptions(ledger.accounts, (ledger.accounts.find(a => a.id !== t.accountId) || {}).id)}</select>`)}
      </span>
      ${fld('Note', `<input type="text" id="t-note" value="${esc(t.note || '')}" placeholder="Optional note or reference">`, true)}
    </form>
    <div class="sheet-acts">
      ${isNew ? '' : '<button class="btn danger left" id="t-del" type="button">Delete</button>'}
      <button class="btn" type="button" id="t-cancel">Cancel</button>
      <button class="btn primary" type="submit" form="tf">${isNew ? 'Add' : 'Save'}</button>
    </div>`, sh => {
    const setType = ty => {
      type = ty;
      sh.querySelectorAll('[data-ty]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ty === ty)));
      const isTransfer = ty === 'transfer' && isNew;
      sh.querySelector('#t-towrap').hidden = !isTransfer;
      sh.querySelector('#t-catwrap').hidden = ty === 'transfer';
      sh.querySelector('#t-acctlabel').textContent = isTransfer ? 'From account' : 'Account';
    };

    sh.querySelectorAll('[data-ty]').forEach(b => b.addEventListener('click', () => setType(b.dataset.ty)));
    setType(type);

    const payeeInput = sh.querySelector('#t-payee');
    const catSel = sh.querySelector('#t-cat');

    payeeInput.addEventListener('change', () => {
      if (!catSel.value) {
        const c = autoCategory(payeeInput.value, ledger.rules, ledger.categories, transactions);
        if (c) {
          catSel.value = c;
          const matchedCat = ledger.categories.find(x => x.id === c);
          if (matchedCat && matchedCat.kind === 'income') {
            setType('income');
          }
        }
      }
    });

    sh.querySelector('#t-cancel').addEventListener('click', closeSheet);

    const delBtn = sh.querySelector('#t-del');
    if (delBtn) {
      confirmBtn(delBtn, 'Tap again to delete', () => {
        onDelete(t);
        closeSheet();
        toast('Transaction deleted');
      });
    }

    sh.querySelector('#tf').addEventListener('submit', e => {
      e.preventDefault();
      const amt = Math.abs(parseFloat(sh.querySelector('#t-amount').value) || 0);
      const date = sh.querySelector('#t-date').value || today();
      const p = payeeInput.value.trim();
      const note = sh.querySelector('#t-note').value.trim();
      const from = sh.querySelector('#t-acct').value;

      if (type === 'transfer' && isNew) {
        const to = sh.querySelector('#t-to').value;
        if (to === from) {
          toast('Please select two different accounts');
          return;
        }
        const fromAcctObj = ledger.accounts.find(a => a.id === from);
        const toAcctObj = ledger.accounts.find(a => a.id === to);
        const leg1 = {
          id: uid(),
          date,
          payee: p || `Transfer to ${toAcctObj?.name || 'Account'}`,
          amount: -amt,
          categoryId: 'transfer',
          accountId: from,
          note
        };
        const leg2 = {
          id: uid(),
          date,
          payee: p || `Transfer from ${fromAcctObj?.name || 'Account'}`,
          amount: amt,
          categoryId: 'transfer',
          accountId: to,
          note
        };
        onSave([leg1, leg2]);
      } else {
        const catId = type === 'transfer'
          ? (ledger.categories.find(x => x.kind === 'transfer') || {}).id
          : (catSel.value || autoCategory(p, ledger.rules, ledger.categories, transactions));

        const updatedTx = {
          ...t,
          date,
          payee: p,
          amount: type === 'income' || (type === 'transfer' && t.amount > 0) ? amt : -amt,
          categoryId: catId || '',
          accountId: from,
          note
        };
        onSave([updatedTx]);
      }

      closeSheet();
      toast(isNew ? 'Transaction added' : 'Saved');
    });
  });
}
