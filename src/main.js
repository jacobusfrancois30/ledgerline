// src/main.js - Application bootstrap, state management, routing, event delegation, and Gemini workflows
'use strict';

import {
  today,
  ym,
  addMonths,
  mLabel,
  dstr,
  sampleLedger,
  sampleTxns,
  emptyLedger,
  normalizeLedger,
  autoCategory,
  catName,
  round2,
  uid,
  esc,
  money
} from './model.js';
import {
  loadData,
  saveLedger,
  saveTransactions,
  deleteTransactions,
  clearAllData,
  exportBackup,
  restoreBackup,
  shouldShowBackupReminder,
  requestPersistentStorage,
  hashPin,
  verifyPin
} from './store.js';
import { toast } from './ui/toast.js';
import { openSheet, closeSheet, initSheetListeners, fld, catOptions, acctOptions } from './ui/sheet.js';
import { pickCSV, exportCSV } from './csv.js';
import {
  scanReceipt,
  parseBankAlerts,
  smartCategorize,
  askAboutMoney,
  generateMonthlyReview,
  testApiKey,
  downscaleImage,
  GeminiError,
  DEFAULT_MODEL
} from './gemini.js';

import { renderOverview } from './views/overview.js';
import { renderTransactions, openTransactionForm, getFilteredTransactions } from './views/transactions.js';
import { renderBudgets } from './views/budgets.js';
import { renderBills, openBillForm } from './views/bills.js';
import { renderGoals, openGoalForm } from './views/goals.js';
import { renderSetup, openAccountForm } from './views/setup.js';

// Application state
let L = null;               // Ledger: { settings, accounts, categories, bills, goals, rules }
let T = [];                 // Transactions list
let metadata = null;        // { lastBackup, pinHash, geminiKey, geminiModel, ... }
let sampleMode = false;
let month = ym(today());
let currentView = 'overview';
let isLocked = false;
let backupBannerDismissed = false;

const uiState = {
  q: '',
  cat: '',
  acct: '',
  allMonths: false
};

const VIEWS = {
  overview: { title: 'Overview', icon: '<path d="M3 13V8m5 5V4m5 9v-6" />' },
  transactions: { title: 'Transactions', icon: '<path d="M3 4h10M3 8h10M3 12h6" />' },
  budgets: { title: 'Budgets', icon: '<path d="M2.5 5.5h11v7h-11z M2.5 5.5l2-2.5h7l2 2.5" />' },
  bills: { title: 'Bills', icon: '<path d="M3.5 2.5h9v11l-2-1.3-2.5 1.3-2.5-1.3-2 1.3z M6 6h4M6 9h4" />' },
  goals: { title: 'Goals', icon: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.2"/>' },
  setup: { title: 'Setup', icon: '<path d="M2.5 4.5h11M2.5 11.5h11"/><circle cx="5.5" cy="4.5" r="1.6"/><circle cx="10.5" cy="11.5" r="1.6"/>' },
};

// Auto-save debounce
let saveTimeout = null;
function commitState({ ledgerDirty = false, updatedTxns = [], deletedTxIds = [] } = {}) {
  if (sampleMode) {
    sampleMode = false;
    ledgerDirty = true;
    updatedTxns = [...T];
  }

  setSaveStatus('saving');
  clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    try {
      if (ledgerDirty) {
        await saveLedger(L, {
          geminiKey: metadata?.geminiKey,
          geminiModel: metadata?.geminiModel,
          pinHash: metadata?.pinHash
        });
      }
      if (updatedTxns.length) {
        await saveTransactions(updatedTxns);
      }
      if (deletedTxIds.length) {
        await deleteTransactions(deletedTxIds);
      }
      setSaveStatus('saved');
    } catch (err) {
      console.error('Error saving to IndexedDB:', err);
      setSaveStatus('error', 'Couldn’t save to IndexedDB');
    }
  }, 350);

  render();
}

function setSaveStatus(status, customMsg = '') {
  const el = document.querySelector('#savepill');
  if (!el) return;
  el.dataset.s = status;
  const labels = {
    connecting: 'Connecting…',
    saving: 'Saving…',
    saved: 'Saved locally',
    sample: 'Sample data (not saved)',
    error: customMsg || 'Error saving'
  };
  el.lastElementChild.textContent = labels[status] || status;
}

// Ledger summary for Gemini context
function getLedgerSummary() {
  const ms = Array.from({ length: 4 }, (_, i) => addMonths(month, i - 3));
  return {
    today: today(),
    currency: L.settings.currency,
    viewingMonth: month,
    months: ms.map(m => {
      const tx = T.filter(t => t.date.startsWith(m));
      let inc = 0, exp = 0;
      const byCat = {};
      for (const t of tx) {
        if (t.categoryId === 'transfer') continue;
        if (t.amount > 0) inc += t.amount;
        else {
          exp -= t.amount;
          const cName = catName(L.categories, t.categoryId);
          byCat[cName] = (byCat[cName] || 0) - t.amount;
        }
      }
      return { month: m, income: round2(inc), spent: round2(exp), byCategory: byCat };
    }),
    budgets: L.categories.filter(c => c.kind === 'expense' && c.budget).map(c => ({
      category: c.name,
      monthly: c.budget,
      rollover: c.rollover
    })),
    bills: L.bills.map(b => ({
      name: b.name,
      amount: b.amount,
      day: b.day
    })),
    goals: L.goals.map(g => ({
      name: g.name,
      target: g.target,
      saved: g.saved,
      due: g.due
    })),
    accounts: L.accounts.map(a => ({
      name: a.name,
      type: a.type,
      balance: round2(a.opening + T.filter(t => t.accountId === a.id).reduce((acc, t) => acc + t.amount, 0))
    })),
    recentTransactions: [...T]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 80)
      .map(t => [t.date, t.payee, t.amount, catName(L.categories, t.categoryId)])
  };
}

// Routing
function navigateTo(v) {
  if (VIEWS[v]) {
    currentView = v;
    try {
      history.replaceState(null, '', '#' + v);
    } catch {}
    render();
    window.scrollTo(0, 0);
  }
}

function renderTabs() {
  const tabsContainer = document.querySelector('#tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = Object.entries(VIEWS).map(([k, v]) => `
    <button class="tab" data-view="${k}"${k === currentView ? ' aria-current="page"' : ''}>
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${v.icon}
      </svg>
      <span>${v.title}</span>
    </button>
  `).join('');
}

function render() {
  if (isLocked) {
    renderLockScreen();
    return;
  }
  const lockEl = document.querySelector('#lock-screen');
  if (lockEl) lockEl.remove();

  if (!L) return;

  const activeId = document.activeElement && document.activeElement.id;
  const selStart = activeId && document.activeElement.selectionStart;

  renderTabs();

  // Top header updates
  const vTitle = document.querySelector('#vtitle');
  if (vTitle) vTitle.textContent = VIEWS[currentView].title;

  const mLabelEl = document.querySelector('#mlabel');
  if (mLabelEl) mLabelEl.textContent = mLabel(month, { month: 'short', year: 'numeric' });

  const monthNav = document.querySelector('#monthnav');
  if (monthNav) monthNav.hidden = currentView === 'setup' || currentView === 'goals';

  // Banner area (sample data, backup reminders, offline status)
  const bannerContainer = document.querySelector('#banner');
  if (bannerContainer) {
    let bannerHtml = '';

    if (!navigator.onLine) {
      bannerHtml += `
        <div class="banner offline-banner">
          <p><b>Offline mode.</b> You can view and edit transactions locally. Gemini features require an internet connection.</p>
        </div>
      `;
    }

    if (sampleMode) {
      bannerHtml += `
        <div class="banner">
          <p><b>You’re looking at sample data.</b> Explore freely. Start your own ledger when you’re ready, or keep these numbers as a template.</p>
          <div class="acts">
            <button class="btn primary" id="b-fresh">Start my own ledger</button>
            <button class="btn" id="b-keep">Keep sample</button>
          </div>
        </div>
      `;
    } else if (!backupBannerDismissed && shouldShowBackupReminder(metadata?.lastBackup, metadata?.backupReminderDismissedMonth, ym(today()))) {
      bannerHtml += `
        <div class="banner backup-banner">
          <p><b>Backup reminder:</b> It’s been over 30 days since your last backup. Keep your data safe by exporting a copy.</p>
          <div class="acts">
            <button class="btn small primary" id="b-backup-banner-export">Export backup</button>
            <button class="btn small" id="b-backup-banner-dismiss">Dismiss</button>
          </div>
        </div>
      `;
    }

    bannerContainer.innerHTML = bannerHtml;
  }

  // Render view body
  const viewContainer = document.querySelector('#view');
  if (viewContainer) {
    let html = '';
    const ctx = {
      ledger: L,
      transactions: T,
      metadata,
      month,
      uiState,
      geminiKey: metadata?.geminiKey,
      geminiModel: metadata?.geminiModel || DEFAULT_MODEL,
      hasPin: Boolean(metadata?.pinHash)
    };

    switch (currentView) {
      case 'overview':
        html = renderOverview(ctx);
        break;
      case 'transactions':
        html = renderTransactions(ctx);
        break;
      case 'budgets':
        html = renderBudgets(ctx);
        break;
      case 'bills':
        html = renderBills(ctx);
        break;
      case 'goals':
        html = renderGoals(ctx);
        break;
      case 'setup':
        html = renderSetup(ctx);
        break;
    }
    viewContainer.innerHTML = html;
  }

  // Restore focus if appropriate
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el && el !== document.body) {
      el.focus();
      try {
        if (selStart != null) el.setSelectionRange(selStart, selStart);
      } catch {}
    }
  }

  if (sampleMode) {
    setSaveStatus('sample');
  }
}

// PIN Lock Screen
function renderLockScreen() {
  let lockEl = document.querySelector('#lock-screen');
  if (!lockEl) {
    lockEl = document.createElement('div');
    lockEl.id = 'lock-screen';
    lockEl.className = 'lock-screen';
    document.body.appendChild(lockEl);
  }

  let enteredPin = '';

  const updateDots = () => {
    lockEl.innerHTML = `
      <div style="text-align:center">
        <div class="brand-mark" style="width:48px;height:48px;margin:0 auto 12px;border-radius:12px">
          <svg width="24" height="24" viewBox="0 0 16 16"><path d="M3 2v12h10" fill="none" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 10.5l2.5-3 2 2 2.5-4" fill="none" stroke="var(--accent-ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h1 style="font-size:1.5rem">Ledgerline Locked</h1>
        <p class="muted" style="margin:4px 0 16px">Enter your passcode to unlock your ledger</p>
      </div>

      <div class="lock-pin-dots">
        ${[0, 1, 2, 3].map(i => `<div class="lock-pin-dot ${i < enteredPin.length ? 'filled' : ''}"></div>`).join('')}
      </div>

      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-key="${n}">${n}</button>`).join('')}
        <button type="button" data-key="clear" style="font-size:0.9rem">Clear</button>
        <button type="button" data-key="0">0</button>
        <button type="button" data-key="del">⌫</button>
      </div>
    `;

    lockEl.querySelectorAll('.keypad button').forEach(b => {
      b.addEventListener('click', async () => {
        const k = b.dataset.key;
        if (k === 'clear') {
          enteredPin = '';
          updateDots();
        } else if (k === 'del') {
          enteredPin = enteredPin.slice(0, -1);
          updateDots();
        } else if (enteredPin.length < 4) {
          enteredPin += k;
          updateDots();
          if (enteredPin.length === 4) {
            const valid = await verifyPin(enteredPin, metadata.pinHash);
            if (valid) {
              isLocked = false;
              render();
            } else {
              toast('Incorrect PIN. Try again.');
              setTimeout(() => {
                enteredPin = '';
                updateDots();
              }, 400);
            }
          }
        }
      });
    });
  };

  updateDots();
}

// Receipt Scanning Flow (Gemini)
function triggerReceiptScan() {
  if (!metadata?.geminiKey) {
    toast('Please add your Gemini API key in Setup first');
    navigateTo('setup');
    return;
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.capture = 'environment';

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    openSheet(`
      <h2>Scanning receipt…</h2>
      <div class="scanner-box">
        <div class="spinner"></div>
        <p>Analyzing receipt details with Gemini Flash…</p>
        <span class="muted" style="font-size:0.8rem">Downscaling photo to protect your privacy and speed up processing.</span>
      </div>
    `);

    try {
      const { base64 } = await downscaleImage(file);
      const result = await scanReceipt({
        apiKey: metadata.geminiKey,
        model: metadata.geminiModel || DEFAULT_MODEL,
        imageBase64: base64,
        categories: L.categories,
        currentCurrency: L.settings.currency
      });

      closeSheet();

      // Prefill transaction form with editable confirm sheet
      const noteParts = [];
      if (result.line_items && result.line_items.length) {
        noteParts.push(result.line_items.map(li => `${li.name}: ${li.amount}`).join('; '));
      }

      openTransactionForm({
        id: uid(),
        date: result.date || today(),
        payee: result.merchant || 'Receipt Expense',
        amount: -(result.total || 0),
        categoryId: result.category_guess || autoCategory(result.merchant, L.rules, L.categories, T) || 'groceries',
        accountId: (L.accounts[0] || {}).id,
        note: noteParts.join(' | ')
      }, {
        ledger: L,
        transactions: T,
        month,
        onSave: (savedList) => {
          T.push(...savedList);
          commitState({ updatedTxns: savedList });
        },
        onDelete: () => {}
      });

      toast('Receipt scanned! Review and tap Save.');
    } catch (err) {
      closeSheet();
      console.error('Receipt scanning error:', err);
      toast(err.message || 'Failed to scan receipt. Please try again.');
    }
  });

  fileInput.click();
}

// Bank Notification Alert Flow (Gemini)
function openBankAlertSheet() {
  if (!metadata?.geminiKey) {
    toast('Please add your Gemini API key in Setup first');
    navigateTo('setup');
    return;
  }

  openSheet(`
    <h2>Paste Bank Alerts (SMS or Email)</h2>
    <p class="muted" style="margin:0">
      Paste one or multiple transaction SMS alerts from your bank (e.g. FNB, Capitec, Nedbank, Standard Bank, Absa).
      Gemini parses the dates, merchants, and amounts into clean transactions for your review.
    </p>

    <div class="fields" style="margin-top:8px">
      <label class="field full">
        <span>Alert messages</span>
        <textarea id="ba-text" rows="6" placeholder="FNB :-) R245.00 paid from Cheq a/c..8123 @ Checkers Hyper. 14Oct 13:02&#10;Capitec: Transfer of R1,200.00 from Sav to Cheq&#10;Standard Bank: Alert! R350.00 debited at SHELL FORECOURT"></textarea>
      </label>
    </div>

    <div id="ba-preview" style="margin-top:6px"></div>

    <div class="sheet-acts">
      <button class="btn" id="ba-cancel" type="button">Cancel</button>
      <button class="btn primary" id="ba-parse" type="button">Parse with Gemini</button>
      <button class="btn primary" id="ba-import" type="button" hidden>Import transactions</button>
    </div>`, sh => {
    let parsedAlerts = [];

    sh.querySelector('#ba-cancel').addEventListener('click', closeSheet);

    const parseBtn = sh.querySelector('#ba-parse');
    const importBtn = sh.querySelector('#ba-import');
    const previewEl = sh.querySelector('#ba-preview');

    parseBtn.addEventListener('click', async () => {
      const text = sh.querySelector('#ba-text').value.trim();
      if (!text) {
        toast('Please paste at least one bank notification message');
        return;
      }

      parseBtn.disabled = true;
      parseBtn.textContent = 'Parsing…';

      try {
        const rawResults = await parseBankAlerts({
          apiKey: metadata.geminiKey,
          model: metadata.geminiModel || DEFAULT_MODEL,
          alertText: text,
          accounts: L.accounts,
          categories: L.categories,
          currentCurrency: L.settings.currency
        });

        const seen = new Set(T.map(t => t.date + '|' + t.amount.toFixed(2) + '|' + norm(t.payee)));
        parsedAlerts = [];
        let dups = 0;

        for (const item of rawResults) {
          const amt = item.direction === 'credit' ? Math.abs(item.amount) : -Math.abs(item.amount);
          const key = item.date + '|' + amt.toFixed(2) + '|' + norm(item.payee);
          if (seen.has(key)) {
            dups++;
            continue;
          }
          seen.add(key);

          // Find hinted account or default
          let acctId = (L.accounts[0] || {}).id;
          if (item.account_hint) {
            const matchedAcct = L.accounts.find(a => norm(a.name).includes(norm(item.account_hint)));
            if (matchedAcct) acctId = matchedAcct.id;
          }

          const catId = item.category_guess || autoCategory(item.payee, L.rules, L.categories, T);

          parsedAlerts.push({
            id: uid(),
            date: item.date || today(),
            payee: item.payee,
            amount: round2(amt),
            categoryId: catId || '',
            accountId: acctId,
            note: 'Imported from bank alert'
          });
        }

        previewEl.innerHTML = `
          <p class="muted" style="margin:8px 0 6px">
            ${parsedAlerts.length} transactions found · ${dups} duplicates skipped
          </p>
          <div class="tablewrap" style="max-height:200px;overflow-y:auto">
            <table>
              <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th class="r">Amount</th></tr></thead>
              <tbody>
                ${parsedAlerts.map(t => `
                  <tr>
                    <td class="num">${esc(t.date)}</td>
                    <td class="payee">${esc(t.payee)}</td>
                    <td><span class="chip">${esc(catName(L.categories, t.categoryId))}</span></td>
                    <td class="amt r ${t.amount > 0 ? 'pos' : ''}">${money(t.amount, {}, L.settings.currency)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;

        parseBtn.hidden = true;
        importBtn.hidden = false;
        importBtn.textContent = `Import ${parsedAlerts.length} transactions`;
        importBtn.disabled = !parsedAlerts.length;
      } catch (err) {
        console.error('Error parsing bank alerts:', err);
        parseBtn.disabled = false;
        parseBtn.textContent = 'Parse with Gemini';
        toast(err.message || 'Failed to parse bank alerts.');
      }
    });

    importBtn.addEventListener('click', () => {
      if (parsedAlerts.length) {
        T.push(...parsedAlerts);
        commitState({ updatedTxns: parsedAlerts });
        closeSheet();
        toast(`${parsedAlerts.length} transactions imported from alerts`);
      }
    });
  });
}

// Smart Categorize Uncategorized (Gemini)
async function triggerSmartCategorize() {
  if (!metadata?.geminiKey) {
    toast('Please add your Gemini API key in Setup first');
    navigateTo('setup');
    return;
  }

  const uncatTxns = T.filter(t => !t.categoryId && t.payee && t.payee.trim());
  if (!uncatTxns.length) {
    toast('No uncategorized transactions found!');
    return;
  }

  const uniquePayees = [...new Set(uncatTxns.map(t => t.payee.trim()))];

  openSheet(`
    <h2>Categorizing with Gemini…</h2>
    <div class="scanner-box">
      <div class="spinner"></div>
      <p>Analyzing ${uniquePayees.length} unique merchants against your category rules…</p>
      <span class="muted" style="font-size:0.8rem">Only merchant names are sent (amounts and dates are never transmitted).</span>
    </div>
  `);

  try {
    const results = await smartCategorize({
      apiKey: metadata.geminiKey,
      model: metadata.geminiModel || DEFAULT_MODEL,
      uniquePayees,
      categories: L.categories
    });

    closeSheet();

    // Show editable review sheet
    openSheet(`
      <h2>Review Smart Categorization</h2>
      <p class="muted" style="margin:0">
        Review Gemini's suggested categories for your merchants before applying. You can also save rules for future imports.
      </p>

      <div class="tablewrap" style="max-height:360px;overflow-y:auto;margin-top:12px">
        <table>
          <thead>
            <tr>
              <th style="width:32px"><input type="checkbox" id="sc-check-all" checked></th>
              <th>Merchant</th>
              <th>Suggested Category</th>
              <th>Create Rule</th>
            </tr>
          </thead>
          <tbody>
            ${results.map((r, i) => `
              <tr data-sc-row="${i}">
                <td><input type="checkbox" class="sc-chk" checked data-idx="${i}"></td>
                <td style="font-weight:600">${esc(r.payee)}</td>
                <td>
                  <select class="sc-cat" data-idx="${i}">
                    ${catOptions(L.categories, r.categoryId, { kinds: ['expense', 'income'] })}
                  </select>
                </td>
                <td>
                  <label class="chk" style="font-size:0.8rem">
                    <input type="checkbox" class="sc-rule" data-idx="${i}"> Always
                  </label>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="sheet-acts">
        <button class="btn" id="sc-cancel" type="button">Cancel</button>
        <button class="btn primary" id="sc-apply" type="button">Apply Categories</button>
      </div>`, sh => {
      sh.querySelector('#sc-cancel').addEventListener('click', closeSheet);

      const checkAll = sh.querySelector('#sc-check-all');
      checkAll.addEventListener('change', () => {
        sh.querySelectorAll('.sc-chk').forEach(c => c.checked = checkAll.checked);
      });

      sh.querySelector('#sc-apply').addEventListener('click', () => {
        const rows = sh.querySelectorAll('tbody tr');
        let updatedCount = 0;
        let rulesAdded = 0;
        const touchedTxns = [];

        rows.forEach(tr => {
          const idx = tr.dataset.scRow;
          const isChecked = tr.querySelector('.sc-chk').checked;
          if (!isChecked) return;

          const payee = results[idx].payee;
          const chosenCatId = tr.querySelector('.sc-cat').value;
          const makeRule = tr.querySelector('.sc-rule').checked;

          if (makeRule) {
            L.rules.push({
              id: uid(),
              match: norm(payee),
              categoryId: chosenCatId
            });
            rulesAdded++;
          }

          // Apply to matching uncategorized transactions
          T.forEach(t => {
            if (!t.categoryId && norm(t.payee) === norm(payee)) {
              t.categoryId = chosenCatId;
              touchedTxns.push(t);
              updatedCount++;
            }
          });
        });

        commitState({ ledgerDirty: Boolean(rulesAdded), updatedTxns: touchedTxns });
        closeSheet();
        toast(`${updatedCount} transactions categorized${rulesAdded ? ` · ${rulesAdded} rules saved` : ''}`);
      });
    }, { wide: true });
  } catch (err) {
    closeSheet();
    console.error('Smart categorize error:', err);
    toast(err.message || 'Failed to categorize merchants.');
  }
}

// Ask About My Money (Gemini)
async function handleAskMoney(query) {
  if (!query || !query.trim()) return;

  const outEl = document.querySelector('#ask-out');
  const submitBtn = document.querySelector('#ask-submit');
  if (!outEl) return;

  if (!metadata?.geminiKey) {
    toast('Please add your Gemini API key in Setup first');
    navigateTo('setup');
    return;
  }

  outEl.hidden = false;
  outEl.className = 'ask-out loading';
  outEl.innerHTML = '<span class="spinner"></span> <span>Consulting your ledger with Gemini…</span>';
  if (submitBtn) submitBtn.disabled = true;

  try {
    const summaryData = getLedgerSummary();
    let accumulated = '';

    await askAboutMoney({
      apiKey: metadata.geminiKey,
      model: metadata.geminiModel || DEFAULT_MODEL,
      query,
      summaryData,
      onChunk: (chunk, fullText) => {
        accumulated = fullText;
        outEl.className = 'ask-out';
        outEl.textContent = accumulated;
      }
    });

    outEl.className = 'ask-out';
  } catch (err) {
    console.error('Ask Money error:', err);
    outEl.className = 'ask-out';
    outEl.textContent = err.message || 'Couldn’t get an answer right now. Check your internet or API key.';
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Monthly Review (Gemini)
async function triggerMonthlyReview() {
  if (!metadata?.geminiKey) {
    toast('Please add your Gemini API key in Setup first');
    navigateTo('setup');
    return;
  }

  const monthTitle = mLabel(month);

  openSheet(`
    <h2>Generating Monthly Review…</h2>
    <div class="scanner-box">
      <div class="spinner"></div>
      <p>Analyzing financial performance for ${esc(monthTitle)} with Gemini…</p>
    </div>
  `);

  try {
    const summaryData = getLedgerSummary();
    const review = await generateMonthlyReview({
      apiKey: metadata.geminiKey,
      model: metadata.geminiModel || DEFAULT_MODEL,
      summaryData,
      monthName: monthTitle
    });

    closeSheet();

    openSheet(`
      <h2>Monthly Review: ${esc(monthTitle)}</h2>
      <p style="font-size:1.05rem;font-weight:500;margin:4px 0 12px;color:var(--ink)">
        ${esc(review.summaryText)}
      </p>

      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:var(--good-soft);padding:12px 14px;border-radius:8px;border:1px solid var(--good)">
          <b style="color:var(--good)">🏆 Financial Wins</b>
          <ul style="margin:6px 0 0;padding-left:20px">
            ${(review.wins || []).map(w => `<li>${esc(w)}</li>`).join('')}
          </ul>
        </div>

        ${review.overspends && review.overspends.length ? `
          <div style="background:var(--warn-soft);padding:12px 14px;border-radius:8px;border:1px solid var(--warn)">
            <b style="color:var(--warn)">⚠️ Watch Areas & Overspends</b>
            <ul style="margin:6px 0 0;padding-left:20px">
              ${review.overspends.map(o => `<li>${esc(o)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <div style="background:var(--accent-soft);padding:12px 14px;border-radius:8px;border:1px solid var(--accent)">
          <b style="color:var(--accent)">🎯 Concrete Action for Next Month</b>
          <p style="margin:4px 0 0">${esc(review.action)}</p>
        </div>
      </div>

      <div class="sheet-acts" style="margin-top:14px">
        <button class="btn primary" id="mr-close" type="button">Done</button>
      </div>`, sh => {
      sh.querySelector('#mr-close').addEventListener('click', closeSheet);
    });
  } catch (err) {
    closeSheet();
    console.error('Monthly review error:', err);
    toast(err.message || 'Failed to generate monthly review.');
  }
}

// Global Event Listeners
function initEventListeners() {
  initSheetListeners();

  // Navigation click delegation
  document.addEventListener('click', e => {
    const t = e.target.closest('button, tr[data-tx], a[href^="#"]');
    if (!t) return;

    const d = t.dataset;

    if (d.view) {
      return navigateTo(d.view);
    }

    if (t.tagName === 'A' && t.getAttribute('href').startsWith('#')) {
      const targetHash = t.getAttribute('href').slice(1);
      if (VIEWS[targetHash]) {
        e.preventDefault();
        return navigateTo(targetHash);
      }
    }

    if (d.go) {
      if (d.uncat) {
        uiState.cat = '_none';
        uiState.allMonths = false;
      }
      return navigateTo(d.go);
    }

    if (d.tx) {
      const txn = T.find(x => x.id === d.tx);
      if (txn) {
        return openTransactionForm(txn, {
          ledger: L,
          transactions: T,
          month,
          onSave: (savedList) => {
            savedList.forEach(s => {
              const idx = T.findIndex(x => x.id === s.id);
              if (idx >= 0) T[idx] = s;
              else T.push(s);
            });
            commitState({ updatedTxns: savedList });
          },
          onDelete: (deletedTx) => {
            T = T.filter(x => x.id !== deletedTx.id);
            commitState({ deletedTxIds: [deletedTx.id] });
          }
        });
      }
    }

    if (d.ask) {
      const askInput = document.querySelector('#ask-q');
      if (askInput) askInput.value = d.ask;
      return handleAskMoney(d.ask);
    }

    if (d.addsub) {
      return openBillForm(null, { name: d.addsub }, {
        ledger: L,
        onSave: (newBill) => {
          L.bills.push(newBill);
          commitState({ ledgerDirty: true });
        },
        onDelete: () => {}
      });
    }

    if (d.editbill) {
      const bill = L.bills.find(b => b.id === d.editbill);
      if (bill) {
        return openBillForm(bill, null, {
          ledger: L,
          onSave: (updatedBill) => {
            const idx = L.bills.findIndex(b => b.id === updatedBill.id);
            if (idx >= 0) L.bills[idx] = updatedBill;
            else L.bills.push(updatedBill);
            commitState({ ledgerDirty: true });
          },
          onDelete: (delBill) => {
            L.bills = L.bills.filter(b => b.id !== delBill.id);
            commitState({ ledgerDirty: true });
          }
        });
      }
    }

    if (d.pay) {
      const b = L.bills.find(x => x.id === d.pay);
      if (!b) return;
      const date = month === ym(today()) ? today() : month + '-01';
      const newTx = {
        id: uid(),
        date,
        payee: b.name,
        amount: -b.amount,
        categoryId: b.categoryId,
        accountId: b.accountId,
        note: 'Recurring bill payment'
      };
      T.push(newTx);
      commitState({ updatedTxns: [newTx] });
      return toast(`${b.name} marked paid`);
    }

    if (d.editgoal) {
      const g = L.goals.find(x => x.id === d.editgoal);
      if (g) {
        return openGoalForm(g, {
          onSave: (updatedGoal) => {
            const idx = L.goals.findIndex(x => x.id === updatedGoal.id);
            if (idx >= 0) L.goals[idx] = updatedGoal;
            else L.goals.push(updatedGoal);
            commitState({ ledgerDirty: true });
          },
          onDelete: (delGoal) => {
            L.goals = L.goals.filter(x => x.id !== delGoal.id);
            commitState({ ledgerDirty: true });
          }
        });
      }
    }

    if (d.editacct) {
      const a = L.accounts.find(x => x.id === d.editacct);
      if (a) {
        return openAccountForm(a, {
          ledger: L,
          transactions: T,
          onSave: (updatedAcct) => {
            const idx = L.accounts.findIndex(x => x.id === updatedAcct.id);
            if (idx >= 0) L.accounts[idx] = updatedAcct;
            else L.accounts.push(updatedAcct);
            commitState({ ledgerDirty: true });
          },
          onDelete: (delAcct) => {
            L.accounts = L.accounts.filter(x => x.id !== delAcct.id);
            commitState({ ledgerDirty: true });
          }
        });
      }
    }

    if (d.delrule) {
      L.rules = L.rules.filter(r => r.id !== d.delrule);
      commitState({ ledgerDirty: true });
      return toast('Rule removed');
    }

    if (d.editcat) {
      const cat = L.categories.find(c => c.id === d.editcat);
      if (!cat) return;
      const isUsed = T.some(x => x.categoryId === cat.id) || L.bills.some(b => b.categoryId === cat.id);

      return openSheet(`
        <h2>Edit Category</h2>
        <form id="cf" class="fields">
          ${fld('Category Name', `<input type="text" id="ce-name" required value="${esc(cat.name)}">`, true)}
        </form>
        <div class="sheet-acts">
          ${isUsed || cat.kind === 'transfer' ? '' : '<button class="btn danger left" id="ce-del" type="button">Delete</button>'}
          <button class="btn" type="button" id="ce-cancel">Cancel</button>
          <button class="btn primary" form="cf" type="submit">Save</button>
        </div>`, sh => {
        sh.querySelector('#ce-cancel').addEventListener('click', closeSheet);
        const delBtn = sh.querySelector('#ce-del');
        if (delBtn) {
          confirmBtn(delBtn, 'Tap again to delete', () => {
            L.categories = L.categories.filter(x => x.id !== cat.id);
            closeSheet();
            commitState({ ledgerDirty: true });
            toast('Category deleted');
          });
        }
        sh.querySelector('#cf').addEventListener('submit', ev => {
          ev.preventDefault();
          cat.name = sh.querySelector('#ce-name').value.trim() || cat.name;
          closeSheet();
          commitState({ ledgerDirty: true });
        });
      });
    }

    // Specific button IDs
    switch (t.id) {
      case 'b-scan-receipt':
      case 'b-scan2':
        return triggerReceiptScan();

      case 'b-paste-sms':
        return openBankAlertSheet();

      case 'b-smart-categorize':
        return triggerSmartCategorize();

      case 'b-monthly-review':
        return triggerMonthlyReview();

      case 'b-import':
      case 'b-import2':
        return pickCSV({
          ledger: L,
          transactions: T,
          onImport: (newTxns) => {
            T.push(...newTxns);
            commitState({ updatedTxns: newTxns });
          }
        });

      case 'b-export':
        return exportCSV(
          getFilteredTransactions({ transactions: T, month, uiState, categories: L.categories }),
          L.categories,
          L.accounts,
          `ledgerline-${uiState.allMonths ? 'all' : month}.csv`
        );

      case 'b-exportall':
        return exportCSV(T, L.categories, L.accounts, 'ledgerline-all-transactions.csv');

      case 'b-addbill':
        return openBillForm(null, null, {
          ledger: L,
          onSave: (newBill) => {
            L.bills.push(newBill);
            commitState({ ledgerDirty: true });
          },
          onDelete: () => {}
        });

      case 'b-addgoal':
        return openGoalForm(null, {
          onSave: (newGoal) => {
            L.goals.push(newGoal);
            commitState({ ledgerDirty: true });
          },
          onDelete: () => {}
        });

      case 'b-addacct':
        return openAccountForm(null, {
          ledger: L,
          transactions: T,
          onSave: (newAcct) => {
            L.accounts.push(newAcct);
            commitState({ ledgerDirty: true });
          },
          onDelete: () => {}
        });

      case 'b-suggest': {
        L.categories.filter(c => c.kind === 'expense').forEach(c => {
          const a = [1, 2, 3].reduce((acc, k) => {
            const m = addMonths(month, -k);
            const spent = T.filter(t => t.date.startsWith(m) && t.categoryId === c.id).reduce((s, t) => s - t.amount, 0);
            return acc + spent;
          }, 0) / 3;
          if (a > 0) c.budget = Math.ceil(a / 50) * 50;
        });
        commitState({ ledgerDirty: true });
        return toast('Budgets updated from your 3-month average');
      }

      case 'b-applyrules': {
        const touched = [];
        T.forEach(x => {
          if (!x.categoryId) {
            const c = autoCategory(x.payee, L.rules, L.categories, T);
            if (c) {
              x.categoryId = c;
              touched.push(x);
            }
          }
        });
        if (touched.length) commitState({ updatedTxns: touched });
        return toast(touched.length ? `${touched.length} transactions categorized` : 'Nothing to categorize');
      }

      case 'b-fresh': {
        L = emptyLedger();
        T = [];
        sampleMode = false;
        commitState({ ledgerDirty: true, updatedTxns: [] });
        return toast('Started a fresh, empty ledger');
      }

      case 'b-keep': {
        sampleMode = false;
        commitState({ ledgerDirty: true, updatedTxns: [...T] });
        return toast('Sample data kept. Edit anything to make it yours.');
      }

      case 'b-export-backup': {
        exportBackup(L, T, metadata);
        return toast('Backup exported');
      }

      case 'b-restore-backup': {
        const fileInput = document.querySelector('#f-restore-input');
        if (fileInput) fileInput.click();
        return;
      }

      case 'b-backup-banner-export': {
        exportBackup(L, T, metadata);
        backupBannerDismissed = true;
        render();
        return toast('Backup exported');
      }

      case 'b-backup-banner-dismiss': {
        backupBannerDismissed = true;
        render();
        return;
      }

      case 'b-test-gemini': {
        const statusEl = document.querySelector('#gemini-test-status');
        if (statusEl) statusEl.innerHTML = '<span class="spinner" style="vertical-align:middle"></span> Testing…';
        testApiKey(metadata?.geminiKey, metadata?.geminiModel || DEFAULT_MODEL)
          .then(() => {
            if (statusEl) statusEl.innerHTML = '<span class="chip ok">Connected ✓</span>';
            toast('Gemini connected successfully!');
          })
          .catch(err => {
            if (statusEl) statusEl.innerHTML = '<span class="chip bad">Error</span>';
            toast(err.message || 'Connection failed.');
          });
        return;
      }

      case 'b-change-gemini': {
        openSheet(`
          <h2>Update Gemini API Key</h2>
          <form id="key-update-form" class="fields">
            ${fld('Gemini API Key', `<input type="password" id="gemini-new-key" required placeholder="Paste your API key" autocomplete="off">`, true)}
          </form>
          <div class="sheet-acts">
            <button class="btn" id="key-up-cancel" type="button">Cancel</button>
            <button class="btn primary" form="key-update-form" type="submit">Save</button>
          </div>`, sh => {
          sh.querySelector('#key-up-cancel').addEventListener('click', closeSheet);
          sh.querySelector('#key-update-form').addEventListener('submit', e => {
            e.preventDefault();
            const val = sh.querySelector('#gemini-new-key').value.trim();
            if (val) {
              metadata = metadata || {};
              metadata.geminiKey = val;
              commitState({ ledgerDirty: true });
              closeSheet();
              toast('Gemini API key updated');
            }
          });
        });
        return;
      }

      case 'b-remove-gemini': {
        if (t.dataset.armed) {
          delete t.dataset.armed;
          t.textContent = 'Remove key';
          if (metadata) metadata.geminiKey = null;
          commitState({ ledgerDirty: true });
          toast('Gemini API key removed');
        } else {
          t.dataset.armed = '1';
          const orig = t.textContent;
          t.textContent = 'Tap again to remove';
          setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = orig; } }, 3500);
        }
        return;
      }

      case 'b-setup-pin':
      case 'b-change-pin': {
        openSheet(`
          <h2>${t.id === 'b-change-pin' ? 'Change PIN' : 'Set up Passcode PIN'}</h2>
          <form id="pin-setup-form" class="fields">
            ${fld('4-digit PIN', `<input type="password" id="pin-input-1" maxlength="6" pattern="[0-9]*" inputmode="numeric" required placeholder="••••">`, true)}
            ${fld('Confirm PIN', `<input type="password" id="pin-input-2" maxlength="6" pattern="[0-9]*" inputmode="numeric" required placeholder="••••">`, true)}
          </form>
          <div class="sheet-acts">
            <button class="btn" id="pin-cancel" type="button">Cancel</button>
            <button class="btn primary" form="pin-setup-form" type="submit">Save PIN</button>
          </div>`, sh => {
          sh.querySelector('#pin-cancel').addEventListener('click', closeSheet);
          sh.querySelector('#pin-setup-form').addEventListener('submit', async e => {
            e.preventDefault();
            const p1 = sh.querySelector('#pin-input-1').value.trim();
            const p2 = sh.querySelector('#pin-input-2').value.trim();
            if (p1.length < 4) {
              toast('PIN must be at least 4 digits');
              return;
            }
            if (p1 !== p2) {
              toast('PINs do not match');
              return;
            }
            const hash = await hashPin(p1);
            metadata = metadata || {};
            metadata.pinHash = hash;
            commitState({ ledgerDirty: true });
            closeSheet();
            toast('Passcode PIN enabled');
          });
        });
        return;
      }

      case 'b-remove-pin': {
        if (t.dataset.armed) {
          delete t.dataset.armed;
          t.textContent = 'Remove PIN';
          if (metadata) metadata.pinHash = null;
          commitState({ ledgerDirty: true });
          toast('PIN lock disabled');
        } else {
          t.dataset.armed = '1';
          const orig = t.textContent;
          t.textContent = 'Tap again to remove';
          setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = orig; } }, 3500);
        }
        return;
      }

      case 'b-reset': {
        if (t.dataset.armed) {
          delete t.dataset.armed;
          t.textContent = 'Erase everything';
          clearAllData().then(() => {
            L = sampleLedger();
            T = sampleTxns();
            sampleMode = true;
            metadata = {};
            currentView = 'overview';
            setSaveStatus('sample');
            toast('All data erased. Start fresh or explore sample data.');
            render();
          });
        } else {
          t.dataset.armed = '1';
          t.textContent = 'Tap again to erase ALL data';
          setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = 'Erase everything'; } }, 3500);
        }
        return;
      }
    }
  });

  // Top header button listeners
  const mPrev = document.querySelector('#mprev');
  if (mPrev) {
    mPrev.addEventListener('click', () => {
      month = addMonths(month, -1);
      render();
    });
  }

  const mNext = document.querySelector('#mnext');
  if (mNext) {
    mNext.addEventListener('click', () => {
      month = addMonths(month, 1);
      render();
    });
  }

  const addTxnBtn = document.querySelector('#addtxn');
  if (addTxnBtn) {
    addTxnBtn.addEventListener('click', () => {
      openTransactionForm(null, {
        ledger: L,
        transactions: T,
        month,
        onSave: (savedList) => {
          T.push(...savedList);
          commitState({ updatedTxns: savedList });
        },
        onDelete: () => {}
      });
    });
  }

  // Restore file input change
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'f-restore-input') {
      const file = el.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const restored = await restoreBackup(String(reader.result));
          L = normalizeLedger(restored.ledger);
          T = restored.transactions || [];
          sampleMode = false;
          toast('Backup restored successfully');
          render();
        } catch (err) {
          toast(err.message || 'Failed to restore backup');
        }
      };
      reader.readAsText(file);
    }
  });

  // Forms submit delegation
  document.addEventListener('submit', e => {
    const f = e.target;

    if (f.id === 'askf') {
      e.preventDefault();
      const val = document.querySelector('#ask-q')?.value;
      if (val) handleAskMoney(val);
    }

    if (f.id === 'gemini-key-form') {
      e.preventDefault();
      const keyVal = document.querySelector('#gemini-key-input')?.value.trim();
      if (keyVal) {
        metadata = metadata || {};
        metadata.geminiKey = keyVal;
        commitState({ ledgerDirty: true });
        toast('Gemini API key saved');
      }
    }

    if (f.id === 'rulef') {
      e.preventDefault();
      const matchText = document.querySelector('#r-match')?.value.trim();
      const catId = document.querySelector('#r-cat')?.value;
      if (matchText && catId) {
        L.rules.push({ id: uid(), match: matchText, categoryId: catId });
        commitState({ ledgerDirty: true });
        toast('Auto-categorize rule added');
      }
    }

    if (f.id === 'catf') {
      e.preventDefault();
      const catNameVal = document.querySelector('#c-name')?.value.trim();
      const catKindVal = document.querySelector('#c-kind')?.value;
      if (catNameVal) {
        L.categories.push({
          id: uid(),
          name: catNameVal,
          kind: catKindVal,
          budget: 0,
          rollover: false
        });
        commitState({ ledgerDirty: true });
        toast('Category added');
      }
    }

    if (f.dataset.contrib) {
      e.preventDefault();
      const goal = L.goals.find(g => g.id === f.dataset.contrib);
      const inputEl = f.querySelector('input');
      const amt = parseFloat(inputEl?.value) || 0;
      if (goal && amt > 0) {
        goal.saved = round2(goal.saved + amt);
        commitState({ ledgerDirty: true });
        toast(`${money(amt, {}, L.settings.currency)} added to ${goal.name}`);
      }
    }
  });

  // Input delegation for search query and filters
  let searchTimer;
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'f-q') {
      uiState.q = el.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 150);
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'f-cat') {
      uiState.cat = el.value;
      render();
    } else if (el.id === 'f-acct') {
      uiState.acct = el.value;
      render();
    } else if (el.id === 'f-all') {
      uiState.allMonths = el.checked;
      render();
    } else if (el.dataset.bud) {
      const c = L.categories.find(x => x.id === el.dataset.bud);
      if (c) {
        c.budget = Math.max(0, round2(+el.value || 0));
        commitState({ ledgerDirty: true });
      }
    } else if (el.dataset.roll) {
      const c = L.categories.find(x => x.id === el.dataset.roll);
      if (c) {
        c.rollover = el.checked;
        commitState({ ledgerDirty: true });
      }
    } else if (el.id === 's-cur') {
      L.settings.currency = el.value;
      commitState({ ledgerDirty: true });
    } else if (el.id === 's-gemini-model') {
      metadata = metadata || {};
      metadata.geminiModel = el.value;
      commitState({ ledgerDirty: true });
      toast('Model preference updated');
    }
  });

  // Hash routing
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (VIEWS[h] && h !== currentView) {
      currentView = h;
      render();
    }
  });
}

// Service Worker registration
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                toast('Update available for Ledgerline', {
                  label: 'Reload',
                  onClick: () => {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                    window.location.reload();
                  }
                }, 0);
              }
            });
          }
        });
      }).catch(err => {
        console.warn('ServiceWorker registration error:', err);
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    });
  }
}

// Main Boot
async function boot() {
  // Request persistent storage
  requestPersistentStorage();

  // Initialize service worker
  initServiceWorker();

  // Setup routing from hash
  try {
    const h = location.hash.slice(1);
    if (VIEWS[h]) currentView = h;
  } catch {}

  // Load from IndexedDB
  try {
    const data = await loadData();
    if (data && data.ledger) {
      L = normalizeLedger(data.ledger);
      T = data.txns || [];
      metadata = data.metadata || {};
      sampleMode = false;
      setSaveStatus('saved');
    } else {
      L = sampleLedger();
      T = sampleTxns();
      sampleMode = true;
      metadata = {};
      setSaveStatus('sample');
    }
  } catch (err) {
    console.error('Failed to load from IndexedDB, using sample data:', err);
    L = sampleLedger();
    T = sampleTxns();
    sampleMode = true;
    metadata = {};
    setSaveStatus('sample');
  }

  // Auto-migrate legacy or empty model setting to gemini-3.8-flash
  if (metadata) {
    if (!metadata.geminiModel || metadata.geminiModel === 'gemini-2.5-flash' || metadata.geminiModel === 'gemini-1.5-flash') {
      metadata.geminiModel = DEFAULT_MODEL;
      commitState({ ledgerDirty: true });
    }
  }

  // Check if PIN lock is active
  if (metadata?.pinHash) {
    isLocked = true;
  }

  initEventListeners();
  render();
}

boot();
