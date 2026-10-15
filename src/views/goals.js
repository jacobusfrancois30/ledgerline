// src/views/goals.js - Financial savings goals, target dates, monthly contribution calculations, and progress rings
'use strict';

import {
  today,
  ym,
  addMonths,
  mLabel,
  money0,
  esc,
  uid,
  round2
} from '../model.js';
import { goalRing } from '../ui/charts.js';
import { openSheet, closeSheet, confirmBtn, fld } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

export function renderGoals({ ledger }) {
  const currency = ledger.settings.currency;
  const now = today();

  return `
    <div class="cols">
      ${ledger.goals.map(g => {
        const p = g.target ? Math.min(1, g.saved / g.target) : 0;
        const [y, m] = (g.due || now).split('-').map(Number);
        const [ny, nm] = now.split('-').map(Number);
        const monthsLeft = Math.max(1, (y - ny) * 12 + (m - nm));
        const neededMonthly = Math.max(0, g.target - g.saved) / monthsLeft;

        return `
          <div class="panel goal">
            <div class="panel-h">
              <h2>${esc(g.name)}</h2>
              <button class="link" data-editgoal="${esc(g.id)}">Edit</button>
            </div>

            <div class="ring-row">
              ${goalRing(p, 30, 8)}
              <div>
                <div class="big">${money0(g.saved, currency)}</div>
                <div class="muted">of ${money0(g.target, currency)}</div>
              </div>
            </div>

            <div class="muted" style="font-size:0.88rem">
              ${p >= 1 ? '🎯 Goal reached! Outstanding work.' : `
                Save <b class="num" style="color:var(--ink)">${money0(neededMonthly, currency)}</b> a month to hit it by ${esc(g.due ? mLabel(ym(g.due)) : 'your target date')} (${monthsLeft} month${monthsLeft > 1 ? 's' : ''}).
              `}
            </div>

            <form data-contrib="${esc(g.id)}" style="display:flex;gap:8px">
              <input
                type="number"
                step="50"
                min="0"
                id="gc-${esc(g.id)}"
                placeholder="Amount to contribute"
                style="flex:1"
                aria-label="Amount to add to ${esc(g.name)}"
                required
              >
              <button class="btn small primary" type="submit">Add money</button>
            </form>
          </div>
        `;
      }).join('')}

      <div class="panel" style="justify-content:center;align-items:center;min-height:200px;text-align:center">
        <div class="empty" style="padding:0 0 14px">
          ${ledger.goals.length ? 'Planning your next milestone?' : 'Goals turn “someday” into a manageable monthly number.'}
        </div>
        <button class="btn primary" id="b-addgoal">+ New goal</button>
      </div>
    </div>
  `;
}

export function openGoalForm(g, { onSave, onDelete }) {
  const isNew = !g;
  g = g || {
    id: uid(),
    name: '',
    target: '',
    saved: 0,
    due: addMonths(ym(today()), 12) + '-01'
  };

  openSheet(`
    <h2>${isNew ? 'New financial goal' : 'Edit goal'}</h2>
    <form id="gf" class="fields">
      ${fld('Goal title', `<input type="text" id="g-name" required value="${esc(g.name)}" placeholder="e.g. Emergency fund, Vacation…">`, true)}
      ${fld('Target amount', `<input type="number" id="g-target" min="1" step="50" required value="${esc(g.target)}">`)}
      ${fld('Saved so far', `<input type="number" id="g-saved" min="0" step="10" value="${esc(g.saved)}">`)}
      ${fld('Target date', `<input type="date" id="g-due" value="${esc(g.due || '')}">`, true)}
    </form>
    <div class="sheet-acts">
      ${isNew ? '' : '<button class="btn danger left" type="button" id="g-del">Delete</button>'}
      <button class="btn" type="button" id="g-cancel">Cancel</button>
      <button class="btn primary" type="submit" form="gf">${isNew ? 'Create goal' : 'Save'}</button>
    </div>`, sh => {
    sh.querySelector('#g-cancel').addEventListener('click', closeSheet);

    const delBtn = sh.querySelector('#g-del');
    if (delBtn) {
      confirmBtn(delBtn, 'Tap again to delete', () => {
        onDelete(g);
        closeSheet();
        toast('Goal removed');
      });
    }

    sh.querySelector('#gf').addEventListener('submit', e => {
      e.preventDefault();
      const updatedGoal = {
        ...g,
        name: sh.querySelector('#g-name').value.trim(),
        target: +sh.querySelector('#g-target').value || 0,
        saved: round2(+sh.querySelector('#g-saved').value || 0),
        due: sh.querySelector('#g-due').value
      };
      onSave(updatedGoal);
      closeSheet();
      toast(isNew ? 'Goal created' : 'Saved');
    });
  });
}
