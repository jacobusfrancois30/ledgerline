// src/views/setup.js - Setup view: accounts, categories, rules, Gemini API key, smart categorize, backup/restore, PIN lock
'use strict';

import {
  CURRENCIES,
  catName,
  money,
  balance,
  esc,
  uid,
  round2
} from '../model.js';
import { AVAILABLE_MODELS } from '../gemini.js';
import { openSheet, closeSheet, confirmBtn, fld } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

export function renderSetup({ ledger, transactions, metadata, geminiKey, geminiModel, hasPin }) {
  const currency = ledger.settings.currency;
  const kindLabel = { expense: 'Spending', income: 'Income', transfer: 'Transfer' };

  // Masked API Key
  const maskedKey = geminiKey
    ? (geminiKey.length > 8 ? `${geminiKey.slice(0, 4)}••••••••${geminiKey.slice(-4)}` : '••••••••')
    : null;

  const lastBackupStr = metadata?.lastBackup
    ? new Date(metadata.lastBackup).toLocaleDateString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

  return `
    <div class="cols">
      <!-- Gemini AI Configuration -->
      <div class="panel wide">
        <div class="panel-h">
          <h2>Gemini API Configuration</h2>
          <span class="chip ai">Smart features</span>
        </div>
        <p class="muted" style="margin:0">
          Powers receipt scanning, parsing bank notification SMS/emails, auto-categorizing payees, and financial advice.
          Your key is saved <b>only on this device in IndexedDB</b> and is never sent to any server other than Google's API.
        </p>

        <div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">
          ${maskedKey ? `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <span class="num" style="font-weight:600;padding:6px 12px;background:var(--bg);border-radius:6px;border:1px solid var(--line)">
                🔑 ${esc(maskedKey)}
              </span>
              <button class="btn small" id="b-test-gemini">Test connection</button>
              <button class="btn small" id="b-change-gemini">Replace key</button>
              <button class="btn small danger" id="b-remove-gemini">Remove key</button>
              <span id="gemini-test-status"></span>
            </div>
          ` : `
            <form id="gemini-key-form" style="display:flex;gap:8px;flex-wrap:wrap">
              <input
                type="password"
                id="gemini-key-input"
                placeholder="Enter your Gemini API key"
                required
                style="flex:1 1 260px"
                autocomplete="off"
              >
              <button class="btn primary" type="submit">Save API Key</button>
            </form>
            <div class="muted" style="font-size:0.82rem">
              Get a free API key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" style="color:var(--accent)">Google AI Studio</a>.
              Recommended security: restrict the key to the Generative Language API.
            </div>
          `}

          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:6px">
            <label style="font-size:0.88rem;font-weight:600;color:var(--muted)">Model:</label>
            <select id="s-gemini-model" style="max-width:340px">
              ${AVAILABLE_MODELS.map(m => `
                <option value="${esc(m.id)}"${m.id === (geminiModel || 'gemini-2.5-flash') ? ' selected' : ''}>
                  ${esc(m.name)}
                </option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Smart Categorize Panel -->
      <div class="panel">
        <div class="panel-h">
          <h2>Smart Categorize</h2>
          <span class="chip ai">Gemini</span>
        </div>
        <p class="muted" style="margin:0">
          Scans all uncategorized transactions, sends only the unique merchant names (never amounts or dates) to Gemini, and lets you review suggestions before applying.
        </p>
        <button class="btn primary" id="b-smart-categorize" style="align-self:flex-start;margin-top:6px">
          Categorize uncategorized with Gemini
        </button>
      </div>

      <!-- Auto-categorize rules -->
      <div class="panel">
        <div class="panel-h">
          <h2>Auto-categorize rules</h2>
        </div>
        <span class="muted" style="font-size:0.85rem">
          When a payee matches, the category is assigned automatically on import and entry.
          Otherwise, Ledgerline reuses your last chosen category for that payee.
        </span>

        <div class="rows">
          ${ledger.rules.map(r => `
            <div class="row">
              <span class="grow">
                <div>“${esc(r.match)}” → <b>${esc(catName(ledger.categories, r.categoryId))}</b></div>
              </span>
              <button class="btn small danger" data-delrule="${esc(r.id)}">Remove</button>
            </div>
          `).join('') || '<div class="empty">No auto-categorize rules yet.</div>'}
        </div>

        <form id="rulef" style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" id="r-match" placeholder="Payee contains…" required style="flex:1 1 140px">
          <select id="r-cat" style="flex:1 1 140px">
            ${ledger.categories.filter(c => c.kind !== 'transfer').map(c => `
              <option value="${esc(c.id)}">${esc(c.name)}</option>
            `).join('')}
          </select>
          <button class="btn" type="submit">Add rule</button>
        </form>
        <button class="btn small" id="b-applyrules" style="align-self:flex-start">
          Apply rules to uncategorized
        </button>
      </div>

      <!-- Accounts -->
      <div class="panel">
        <div class="panel-h">
          <h2>Accounts</h2>
          <button class="btn small" id="b-addacct">+ Account</button>
        </div>
        <div class="rows">
          ${ledger.accounts.map(a => `
            <div class="row">
              <span class="grow">
                <div style="font-weight:600">${esc(a.name)}</div>
                <div class="muted" style="font-size:0.8rem">
                  ${esc(a.type)} · opening ${money(a.opening, {}, currency)}
                </div>
              </span>
              <span class="amt">${money(balance(a, transactions), {}, currency)}</span>
              <button class="btn small" data-editacct="${esc(a.id)}">Edit</button>
            </div>
          `).join('')}
        </div>
        <span class="muted" style="font-size:0.8rem">
          Set opening balances so totals match your bank statement. Credit card balances are typically negative.
        </span>
      </div>

      <!-- Categories -->
      <div class="panel">
        <div class="panel-h">
          <h2>Categories</h2>
        </div>
        <div class="rows">
          ${ledger.categories.map(c => `
            <div class="row">
              <span class="grow">
                <div>${esc(c.name)}</div>
              </span>
              <span class="chip">${kindLabel[c.kind]}</span>
              <button class="btn small" data-editcat="${esc(c.id)}">Rename</button>
            </div>
          `).join('')}
        </div>
        <form id="catf" style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" id="c-name" placeholder="New category name" required style="flex:1 1 140px">
          <select id="c-kind">
            <option value="expense">Spending</option>
            <option value="income">Income</option>
          </select>
          <button class="btn" type="submit">Add category</button>
        </form>
      </div>

      <!-- Preferences & Security -->
      <div class="panel">
        <div class="panel-h">
          <h2>Preferences & Security</h2>
        </div>

        ${fld('Default Currency', `
          <select id="s-cur">
            ${CURRENCIES.map(c => `
              <option value="${c}"${c === currency ? ' selected' : ''}>${c}</option>
            `).join('')}
          </select>
        `)}

        <!-- Passcode Lock -->
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
          <span style="font-size:0.88rem;font-weight:600">Passcode Lock (PIN)</span>
          <span class="muted" style="font-size:0.82rem">
            Protects your financial data with a numeric PIN hashed via WebCrypto SHA-256.
          </span>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
            ${hasPin ? `
              <span class="chip ok">PIN active</span>
              <button class="btn small" id="b-change-pin">Change PIN</button>
              <button class="btn small danger" id="b-remove-pin">Remove PIN</button>
            ` : `
              <button class="btn small" id="b-setup-pin">Set up PIN lock</button>
            `}
          </div>
        </div>

        <!-- Backup & Restore -->
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
          <span style="font-size:0.88rem;font-weight:600">Backup & Storage</span>
          <div class="muted" style="font-size:0.82rem">
            Last full backup: <b>${esc(lastBackupStr)}</b>.<br>
            All data lives in this browser’s IndexedDB. Export a backup regularly to keep your records safe across devices.
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
            <button class="btn" id="b-export-backup">Export backup (.json)</button>
            <button class="btn" id="b-restore-backup">Restore backup</button>
            <input type="file" id="f-restore-input" accept=".json,application/json" hidden>
            <button class="btn" id="b-exportall">Export all CSV</button>
          </div>
        </div>

        <!-- Danger Zone -->
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
          <button class="btn danger" id="b-reset">Erase everything</button>
        </div>
      </div>
    </div>
  `;
}

export function openAccountForm(a, { ledger, transactions, onSave, onDelete }) {
  const isNew = !a;
  a = a || { id: uid(), name: '', type: 'checking', opening: 0 };
  const isUsed = transactions.some(t => t.accountId === a.id);

  openSheet(`
    <h2>${isNew ? 'New account' : 'Edit account'}</h2>
    <form id="af" class="fields">
      ${fld('Account name', `<input type="text" id="a-name" required value="${esc(a.name)}" placeholder="e.g. FNB Cheque, Savings">`, true)}
      ${fld('Account type', `
        <select id="a-type">
          ${['checking', 'savings', 'credit', 'cash', 'investment', 'loan'].map(t => `
            <option value="${t}"${t === a.type ? ' selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>
          `).join('')}
        </select>
      `)}
      ${fld('Opening balance', `<input type="number" id="a-open" step="0.01" value="${esc(a.opening)}">`)}
    </form>
    <div class="sheet-acts">
      ${isNew || isUsed || ledger.accounts.length < 2 ? '' : '<button class="btn danger left" type="button" id="a-del">Delete</button>'}
      <button class="btn" type="button" id="a-cancel">Cancel</button>
      <button class="btn primary" type="submit" form="af">${isNew ? 'Add account' : 'Save'}</button>
    </div>`, sh => {
    sh.querySelector('#a-cancel').addEventListener('click', closeSheet);

    const delBtn = sh.querySelector('#a-del');
    if (delBtn) {
      confirmBtn(delBtn, 'Tap again to delete', () => {
        onDelete(a);
        closeSheet();
        toast('Account removed');
      });
    }

    sh.querySelector('#af').addEventListener('submit', e => {
      e.preventDefault();
      const updatedAcct = {
        ...a,
        name: sh.querySelector('#a-name').value.trim(),
        type: sh.querySelector('#a-type').value,
        opening: round2(+sh.querySelector('#a-open').value || 0)
      };
      onSave(updatedAcct);
      closeSheet();
      toast(isNew ? 'Account created' : 'Saved');
    });
  });
}
