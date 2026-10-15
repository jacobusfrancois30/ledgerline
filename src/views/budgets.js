// src/views/budgets.js - Budgets view, rollover logic, 3-month average suggestion
'use strict';

import {
  monthStats,
  addMonths,
  mLabel,
  money,
  money0,
  sum,
  rolloverFor,
  esc
} from '../model.js';

export function renderBudgets({ ledger, transactions, month }) {
  const currency = ledger.settings.currency;
  const st = monthStats(transactions, month, ledger.categories);
  const expCategories = ledger.categories.filter(c => c.kind === 'expense');

  const totalBudget = sum(expCategories, c => c.budget || 0);
  const totalSpent = sum(expCategories, c => st.byCat[c.id] || 0) + (st.byCat._none || 0);
  const unbudgetedIncome = st.income - totalBudget;

  const avg3 = c => sum([1, 2, 3], k => monthStats(transactions, addMonths(month, -k), ledger.categories).byCat[c.id] || 0) / 3;

  return `
    <div class="stats">
      <div class="stat">
        <span class="eyebrow">Budgeted</span>
        <span class="v">${money0(totalBudget, currency)}</span>
        <span class="s">per month</span>
      </div>

      <div class="stat">
        <span class="eyebrow">Spent</span>
        <span class="v">${money0(totalSpent, currency)}</span>
        <span class="s">${totalBudget ? Math.round(totalSpent / totalBudget * 100) + '% of budget' : '&nbsp;'}</span>
      </div>

      <div class="stat">
        <span class="eyebrow">Unbudgeted income</span>
        <span class="v ${unbudgetedIncome < 0 ? 'neg-bad' : ''}">${money0(unbudgetedIncome, currency)}</span>
        <span class="s">
          ${unbudgetedIncome < 0 ? 'Budgets exceed this month’s income' : 'Give it a job: a goal or savings'}
        </span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>${esc(mLabel(month))}</h2>
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small" id="b-suggest">Suggest from 3-month average</button>
        </span>
      </div>

      <div>
        ${expCategories.map(c => {
          const spent = st.byCat[c.id] || 0;
          const roll = rolloverFor(c, month, transactions, ledger.categories);
          const avail = (c.budget || 0) + roll;
          const left = avail - spent;
          const p = avail > 0 ? spent / avail : (spent ? 1.2 : 0);

          return `
            <div class="budget-row">
              <div>
                <div style="font-weight:600">${esc(c.name)}</div>
                <div class="muted" style="font-size:0.78rem">3-mo avg ${money0(avg3(c), currency)}</div>
              </div>

              <input
                type="number"
                min="0"
                step="50"
                id="bud-${esc(c.id)}"
                data-bud="${esc(c.id)}"
                value="${c.budget || ''}"
                placeholder="0"
                aria-label="${esc(c.name)} monthly budget"
              >

              <div class="bcol">
                <div class="bar ${p > 1 ? 'over' : p > 0.85 ? 'near' : ''}">
                  <i style="width:${Math.min(100, p * 100)}%"></i>
                </div>
                <div class="meta">
                  <span class="num">
                    ${money0(spent, currency)} spent
                    ${c.rollover && roll ? ` · ${roll >= 0 ? '+' : ''}${money0(roll, currency)} rolled over` : ''}
                  </span>
                  <span class="num ${left < 0 ? 'neg-bad' : ''}">
                    ${left < 0 ? money0(-left, currency) + ' over' : money0(left, currency) + ' left'}
                  </span>
                </div>
              </div>

              <label class="chk tcol" title="Carry unspent money (or overspending) into next month">
                <input type="checkbox" data-roll="${esc(c.id)}"${c.rollover ? ' checked' : ''}> Roll over
              </label>
            </div>
          `;
        }).join('')}
      </div>

      ${st.byCat._none ? `
        <div class="muted" style="margin-top:10px">
          ${money(st.byCat._none, {}, currency)} of spending is uncategorized.
          <button class="link" data-go="transactions" data-uncat="1">Categorize it</button>
        </div>
      ` : ''}
    </div>
  `;
}
