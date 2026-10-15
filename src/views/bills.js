// src/views/bills.js - Recurring bills, paid detection, and subscription finder
'use strict';

import {
  billsState,
  ym,
  today,
  detectSubscriptions,
  sum,
  mLabel,
  money,
  esc,
  uid,
  round2,
  catName
} from '../model.js';
import { openSheet, closeSheet, confirmBtn, fld, catOptions, acctOptions } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

export function renderBills({ ledger, transactions, month }) {
  const currency = ledger.settings.currency;
  const bs = billsState(ledger.bills, month, transactions);
  const isCur = month === ym(today());
  const subs = detectSubscriptions(transactions, ledger.categories, ledger.bills);

  const total = sum(ledger.bills, b => b.amount);
  const paid = sum(bs.filter(x => x.paid), x => x.b.amount);
  const stillDue = Math.max(0, total - paid);

  return `
    <div class="stats">
      <div class="stat">
        <span class="eyebrow">Monthly bills</span>
        <span class="v">${money(total, {}, currency)}</span>
        <span class="s">${ledger.bills.length} recurring</span>
      </div>

      <div class="stat">
        <span class="eyebrow">Paid ${isCur ? 'so far' : ''}</span>
        <span class="v">${money(paid, {}, currency)}</span>
        <span class="s">${bs.filter(x => x.paid).length} of ${bs.length}</span>
      </div>

      <div class="stat">
        <span class="eyebrow">Still due</span>
        <span class="v">${money(stillDue, {}, currency)}</span>
        <span class="s">${esc(mLabel(month))}</span>
      </div>
    </div>

    <div class="cols">
      <div class="panel wide">
        <div class="panel-h">
          <h2>Recurring bills</h2>
          <button class="btn small" id="b-addbill">+ Add bill</button>
        </div>

        ${bs.length ? `
          <div class="rows">
            ${bs.map(({ b, paid, date }) => {
              const acct = ledger.accounts.find(a => a.id === b.accountId);
              return `
                <div class="row">
                  <span class="num muted" style="width:52px">${esc(mLabel(month, { month: 'short' }))} ${b.day}</span>
                  <span class="grow">
                    <div style="font-weight:600">${esc(b.name)}</div>
                    <div class="muted" style="font-size:0.8rem">
                      ${esc(catName(ledger.categories, b.categoryId))} · ${esc(acct ? acct.name : '')}
                    </div>
                  </span>
                  <span class="amt">${money(b.amount, {}, currency)}</span>
                  ${paid ? '<span class="chip ok">Paid</span>' : `
                    ${isCur && date < today() ? '<span class="chip bad">Late</span>' : '<span class="chip">Due</span>'}
                    <button class="btn small" data-pay="${esc(b.id)}">Mark paid</button>
                  `}
                  <button class="btn small" data-editbill="${esc(b.id)}" aria-label="Edit ${esc(b.name)}">Edit</button>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="empty">
            No bills yet. Add rent, electricity, insurance, mobile, and internet bills.
            Ledgerline automatically marks each bill paid when a matching statement transaction appears.
          </div>
        `}
      </div>

      ${subs.length ? `
        <div class="panel wide">
          <div class="panel-h">
            <h2>Found in your transactions</h2>
            <span class="muted" style="font-size:0.85rem">Charges that repeat monthly around the same amount</span>
          </div>
          <div class="rows">
            ${subs.map(s => `
              <div class="row">
                <span class="grow">
                  <div style="font-weight:600">${esc(s.payee)}</div>
                  <div class="muted" style="font-size:0.8rem">
                    Around day ${s.day} · seen in ${s.months} months · ${money(s.amount * 12, {}, currency)} / year
                  </div>
                </span>
                <span class="amt">${money(s.amount, {}, currency)}</span>
                <button class="btn small" data-addsub="${esc(s.payee)}">Track as bill</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

export function openBillForm(b, preset, { ledger, onSave, onDelete }) {
  const isNew = !b;
  b = b || {
    id: uid(),
    name: '',
    amount: '',
    day: 1,
    categoryId: 'utilities',
    accountId: (ledger.accounts[0] || {}).id,
    ...(preset || {})
  };

  openSheet(`
    <h2>${isNew ? 'New recurring bill' : 'Edit bill'}</h2>
    <form id="bf" class="fields">
      ${fld('Name (as it appears on statements)', `<input type="text" id="bl-name" required value="${esc(b.name)}" placeholder="e.g. City Electricity">`, true)}
      ${fld('Amount', `<input type="number" id="bl-amt" step="0.01" min="0" required value="${esc(b.amount)}">`)}
      ${fld('Day of month (1-31)', `<input type="number" id="bl-day" min="1" max="31" required value="${esc(b.day)}">`)}
      ${fld('Category', `<select id="bl-cat">${catOptions(ledger.categories, b.categoryId, { kinds: ['expense'] })}</select>`)}
      ${fld('Paid from', `<select id="bl-acct">${acctOptions(ledger.accounts, b.accountId)}</select>`)}
    </form>
    <div class="sheet-acts">
      ${isNew ? '' : '<button class="btn danger left" type="button" id="bl-del">Delete</button>'}
      <button class="btn" type="button" id="bl-cancel">Cancel</button>
      <button class="btn primary" type="submit" form="bf">${isNew ? 'Add bill' : 'Save'}</button>
    </div>`, sh => {
    sh.querySelector('#bl-cancel').addEventListener('click', closeSheet);

    const delBtn = sh.querySelector('#bl-del');
    if (delBtn) {
      confirmBtn(delBtn, 'Tap again to delete', () => {
        onDelete(b);
        closeSheet();
        toast('Bill removed');
      });
    }

    sh.querySelector('#bf').addEventListener('submit', e => {
      e.preventDefault();
      const updatedBill = {
        ...b,
        name: sh.querySelector('#bl-name').value.trim(),
        amount: round2(+sh.querySelector('#bl-amt').value || 0),
        day: Math.min(31, Math.max(1, +sh.querySelector('#bl-day').value || 1)),
        categoryId: sh.querySelector('#bl-cat').value,
        accountId: sh.querySelector('#bl-acct').value
      };
      onSave(updatedBill);
      closeSheet();
      toast(isNew ? 'Bill added' : 'Saved');
    });
  });
}
