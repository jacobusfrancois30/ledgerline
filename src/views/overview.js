// src/views/overview.js - Dashboard view: safe-to-spend, cash flow, budget pulse, bills, insights, and Gemini features
'use strict';

import {
  monthStats,
  addMonths,
  dim,
  today,
  ym,
  billsState,
  netWorth,
  sum,
  detectSubscriptions,
  kindOf,
  mLabel,
  dLabel,
  money,
  money0,
  esc,
  round2,
  catName,
  balance
} from '../model.js';
import { cashflowChart, spark } from '../ui/charts.js';

export function renderOverview({ ledger, transactions, month, geminiKey, geminiModel }) {
  const currency = ledger.settings.currency;
  const st = monthStats(transactions, month, ledger.categories);
  const prevMonth = addMonths(month, -1);
  const prev = monthStats(transactions, prevMonth, ledger.categories);
  const isCur = month === ym(today());
  const daysLeft = isCur ? dim(month) - Number(today().slice(8)) + 1 : 0;

  const bs = billsState(ledger.bills, month, transactions);
  const dueBills = bs.filter(x => !x.paid);
  const dueAmt = sum(dueBills, x => x.b.amount);
  const safe = st.income - st.spent - dueAmt;

  const nw = netWorth(ledger.accounts, transactions);
  const nwSeries = Array.from({ length: 6 }, (_, i) => {
    const end = addMonths(month, i - 5) + '-31';
    return sum(ledger.accounts, a => a.opening) + sum(transactions.filter(t => t.date <= end), t => t.amount);
  });

  const rate = st.income > 0 ? (st.income - st.spent) / st.income : null;

  // Budget pulse: 6 expense categories closest to/over limit
  const cats = ledger.categories
    .filter(c => c.kind === 'expense' && (c.budget > 0 || st.byCat[c.id]))
    .map(c => {
      const spent = st.byCat[c.id] || 0;
      const avail = c.budget; // simplified pulse view
      return { c, spent, avail };
    })
    .sort((a, b) => {
      const pa = a.avail ? a.spent / a.avail : (a.spent ? 9 : 0);
      const pb = b.avail ? b.spent / b.avail : (b.spent ? 9 : 0);
      return pb - pa;
    })
    .slice(0, 6);

  // Insights
  const insights = [];
  const subs = detectSubscriptions(transactions, ledger.categories, ledger.bills);
  subs.slice(0, 2).forEach(s => {
    insights.push({
      tag: '<span class="chip warn">Recurring</span>',
      text: `<b>${esc(s.payee)}</b> charged ~${money(s.amount, {}, currency)} in ${s.months} of the last 4 months and isn’t tracked as a bill.`,
      act: `<button class="link" data-addsub="${esc(s.payee)}">Track as bill</button>`
    });
  });

  const deltas = ledger.categories
    .filter(c => c.kind === 'expense')
    .map(c => ({
      c,
      d: (st.byCat[c.id] || 0) - (prev.byCat[c.id] || 0),
      now: st.byCat[c.id] || 0
    }))
    .filter(x => Math.abs(x.d) > 150)
    .sort((a, b) => b.d - a.d);

  if (deltas[0] && deltas[0].d > 0) {
    insights.push({
      tag: '<span class="chip bad">Up</span>',
      text: `<b>${esc(deltas[0].c.name)}</b> is ${money0(deltas[0].d, currency)} higher than ${esc(mLabel(prevMonth, { month: 'long' }))}.`
    });
  }

  const down = deltas[deltas.length - 1];
  if (!isCur && down && down.d < 0) {
    insights.push({
      tag: '<span class="chip ok">Down</span>',
      text: `<b>${esc(down.c.name)}</b> is ${money0(-down.d, currency)} lower than last month.`
    });
  }

  const uncats = transactions.filter(t => t.date.startsWith(month) && !t.categoryId).length;
  if (uncats) {
    insights.push({
      tag: '<span class="chip">Tidy</span>',
      text: `${uncats} transaction${uncats > 1 ? 's' : ''} this month ${uncats > 1 ? 'have' : 'has'} no category.`,
      act: `<button class="link" data-go="transactions" data-uncat="1">Review</button>`
    });
  }

  const big = transactions
    .filter(t => t.date.startsWith(month) && kindOf(t, ledger.categories) === 'expense')
    .sort((a, b) => a.amount - b.amount)[0];
  if (big) {
    insights.push({
      tag: '<span class="chip">Largest</span>',
      text: `Biggest expense: <b>${esc(big.payee)}</b>, ${money(-big.amount, {}, currency)} on ${esc(dLabel(big.date))}.`
    });
  }

  // Suggestion chips in user's currency
  const currSym = currency === 'ZAR' ? 'R' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
  const chip1 = `Where can I cut ${currSym}2,000 a month?`;
  const chip2 = `Am I on track for my goals?`;
  const chip3 = `What changed since last month?`;

  return `
    <div class="stats">
      <div class="stat hero">
        <span class="eyebrow">${isCur ? 'Safe to spend' : 'Left over'}</span>
        <span class="v">${money(safe, {}, currency)}</span>
        <span class="s">
          ${isCur && daysLeft ? money(Math.max(0, safe) / daysLeft, {}, currency) + ' a day for ' + daysLeft + ' days' : 'Income minus spending'}
          ${dueAmt && isCur ? ' · after ' + money0(dueAmt, currency) + ' in bills' : ''}
        </span>
      </div>

      <div class="stat">
        <span class="eyebrow">Income</span>
        <span class="v">${money(st.income, {}, currency)}</span>
        <span class="s">
          ${prev.income ? (st.income >= prev.income ? '▲ ' : '▼ ') + money0(Math.abs(st.income - prev.income), currency) + ' vs last month' : '&nbsp;'}
        </span>
      </div>

      <div class="stat">
        <span class="eyebrow">Spent</span>
        <span class="v">${money(st.spent, {}, currency)}</span>
        <span class="s">
          ${rate !== null ? 'Saving ' + Math.round(rate * 100) + '% of income' : '&nbsp;'}
        </span>
      </div>

      <div class="stat">
        <span class="eyebrow">Net worth</span>
        <span class="v">${money(nw, {}, currency)}</span>
        <span class="s" style="display:flex;justify-content:space-between;align-items:end;gap:8px">
          ${ledger.accounts.length} account${ledger.accounts.length === 1 ? '' : 's'}
          ${spark(nwSeries, 96, 26)}
        </span>
      </div>
    </div>

    <div class="cols">
      <!-- Cash Flow Chart -->
      <div class="panel">
        <div class="panel-h">
          <h2>Cash flow</h2>
          <div class="legend">
            <span><i style="background:var(--accent)"></i>Income</span>
            <span><i style="background:var(--spend)"></i>Spending</span>
          </div>
        </div>
        <div class="chart">
          ${cashflowChart(month, 6, transactions, ledger.categories, currency)}
        </div>
      </div>

      <!-- Budget Pulse -->
      <div class="panel">
        <div class="panel-h">
          <h2>Budget pulse</h2>
          <button class="link" data-go="budgets">All budgets</button>
        </div>
        ${cats.length ? `
          <div class="rows">
            ${cats.map(({ c, spent, avail }) => {
              const p = avail > 0 ? spent / avail : (spent ? 1.2 : 0);
              return `
                <div class="row" style="flex-direction:column;align-items:stretch;gap:5px">
                  <div style="display:flex;justify-content:space-between;gap:8px">
                    <span>${esc(c.name)}</span>
                    <span class="num muted">${money0(spent, currency)} / ${money0(avail, currency)}</span>
                  </div>
                  <div class="bar ${p > 1 ? 'over' : p > 0.85 ? 'near' : ''}">
                    <i style="width:${Math.min(100, p * 100)}%"></i>
                  </div>
                </div>`;
            }).join('')}
          </div>
        ` : '<div class="empty">Set category budgets to see how your spending is tracking.</div>'}
      </div>

      <!-- Bills Due -->
      <div class="panel">
        <div class="panel-h">
          <h2>Bills ${isCur ? 'still due' : 'this month'}</h2>
          <button class="link" data-go="bills">Manage</button>
        </div>
        ${bs.length ? `
          <div class="rows">
            ${bs.slice(0, 7).map(({ b, paid, date }) => `
              <div class="row">
                <span class="num muted" style="width:46px">${esc(mLabel(month, { month: 'short' }))} ${b.day}</span>
                <span class="grow"><div>${esc(b.name)}</div></span>
                <span class="amt">${money(b.amount, {}, currency)}</span>
                ${paid ? '<span class="chip ok">Paid</span>' : (isCur && date < today() ? '<span class="chip bad">Late</span>' : '<span class="chip">Due</span>')}
              </div>
            `).join('')}
          </div>
        ` : '<div class="empty">Add rent, electricity, phone, and subscriptions to see what’s coming.</div>'}
      </div>

      <!-- Insights -->
      <div class="panel">
        <div class="panel-h">
          <h2>Insights</h2>
        </div>
        ${insights.length ? `
          <div class="rows">
            ${insights.map(i => `
              <div class="row" style="align-items:flex-start">
                ${i.tag}
                <span class="grow" style="white-space:normal">${i.text} ${i.act || ''}</span>
              </div>
            `).join('')}
          </div>
        ` : '<div class="empty">Insights appear once you have a month or two of transactions.</div>'}
      </div>

      <!-- Account Balances -->
      <div class="panel">
        <div class="panel-h">
          <h2>Accounts</h2>
          <button class="link" data-go="setup">Edit</button>
        </div>
        <div class="rows">
          ${ledger.accounts.map(a => {
            const b = balance(a, transactions);
            return `
              <div class="row">
                <span class="grow">
                  <div>${esc(a.name)}</div>
                  <div class="muted" style="font-size:0.8rem;text-transform:capitalize">${esc(a.type)}</div>
                </span>
                <span class="amt ${b < 0 ? 'neg-bad' : ''}">${money(b, {}, currency)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Gemini AI Card -->
      <div class="panel ask-card">
        <div class="panel-h">
          <h2>Ask about your money</h2>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="chip ai">Gemini</span>
            <button class="btn small" id="b-monthly-review" title="Generate Monthly Review for ${esc(mLabel(month, { month: 'short' }))}">
              Monthly review
            </button>
          </div>
        </div>
        <div class="suggest">
          <button class="btn small" data-ask="${esc(chip1)}">${esc(chip1)}</button>
          <button class="btn small" data-ask="${esc(chip2)}">${esc(chip2)}</button>
          <button class="btn small" data-ask="${esc(chip3)}">${esc(chip3)}</button>
        </div>
        <form id="askf" style="display:flex;gap:8px">
          <input type="text" id="ask-q" placeholder="Ask anything about your spending, trends, or budget" style="flex:1" autocomplete="off">
          <button class="btn primary" type="submit" id="ask-submit">Ask</button>
        </form>
        <div class="ask-out" id="ask-out" hidden></div>
        <span class="muted" style="font-size:0.78rem">
          Gemini sees a privacy-safe summary of your ledger (totals, budgets, recent merchants). Not financial advice.
          ${!geminiKey ? '<b style="color:var(--warn)">API key missing: <a href="#setup" style="color:inherit">Add in Setup</a></b>' : ''}
        </span>
      </div>
    </div>
  `;
}
