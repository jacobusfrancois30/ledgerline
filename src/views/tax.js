// src/views/tax.js - SARS tax estimate view (South African personal income tax)
'use strict';

import { esc, money0, catName } from '../model.js';
import { estimateTax, taxYearFor, INCOME_TYPES, DEDUCTION_TYPES, TAX_TABLES } from '../tax.js';

const R = (n, cur) => money0(Math.round(n), cur);
const pct = n => (n * 100).toFixed(1).replace(/\.0$/, '') + '%';

export function renderTax({ ledger, transactions, taxYear, today }) {
  const cur = ledger.settings.currency;
  const tax = ledger.tax;
  const year = taxYear || taxYearFor(today);
  const e = estimateTax({ transactions, categories: ledger.categories, tax, year, today });
  const yr = tax.years?.[year] || {};
  const years = [...new Set([...Object.keys(TAX_TABLES).map(Number), taxYearFor(today), ...transactions.map(t => taxYearFor(t.date))])].sort((a, b) => b - a);
  // Without PAYE entered, a salaried person's "balance" is just their tax, not money owed
  const paidKnown = e.paye > 0 || e.provisionalPaid > 0 || e.employment === 0;
  const owe = paidKnown && e.balance > 0.5, refund = paidKnown && e.balance < -0.5;
  const notZar = cur !== 'ZAR';

  const line = (label, value, opts = {}) => `
    <div class="row"${opts.strong ? ' style="font-weight:700"' : ''}>
      <span class="grow"><div>${label}</div>${opts.note ? `<div class="muted" style="font-size:.8rem;white-space:normal">${opts.note}</div>` : ''}</span>
      <span class="amt">${opts.minus ? '− ' : ''}${R(value, cur)}</span>
    </div>`;

  const incomeCats = ledger.categories.filter(c => c.kind === 'income');
  const expenseCats = ledger.categories.filter(c => c.kind === 'expense');
  const catRow = (c, kind) => {
    const v = e.byCategory[c.id] || { income: 0, spend: 0 };
    const amt = kind === 'income' ? v.income : v.spend;
    const opts = kind === 'income' ? INCOME_TYPES : DEDUCTION_TYPES;
    const sel = kind === 'income' ? (tax.incomeTypes[c.id] || 'exempt') : (tax.deductionTypes[c.id] || '');
    if (kind === 'expense' && !amt && !sel) return '';
    return `<div class="row">
      <span class="grow"><div>${esc(c.name)}</div><div class="muted num" style="font-size:.8rem">${R(amt, cur)} in this tax year</div></span>
      <select data-taxcat="${esc(c.id)}" data-taxkind="${kind}" aria-label="Tax treatment of ${esc(c.name)}" style="max-width:220px">
        ${opts.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select></div>`;
  };

  return `
  ${notZar ? `<div class="banner"><p>The tax estimate uses SARS (South African) rules and assumes amounts are in rand. Your currency is set to ${esc(cur)}.</p></div>` : ''}
  <div class="panel-h" style="margin-bottom:12px">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <label class="eyebrow" for="tax-year">Tax year</label>
      <select id="tax-year">${years.map(y => `<option value="${y}"${y === year ? ' selected' : ''}>${y} (Mar ${y - 1} – Feb ${y})</option>`).join('')}</select>
      ${e.inProgress ? `<label class="chk"><input type="checkbox" id="tax-project"${tax.project ? ' checked' : ''}> Project ${e.monthsElapsed} month${e.monthsElapsed === 1 ? '' : 's'} to a full year</label>` : ''}
    </div>
    <button class="btn small" id="b-tax-export">Export tax transactions</button>
  </div>
  ${!e.exactTable ? `<div class="banner"><p>SARS tables for ${year} aren’t in the app yet, so this uses the ${e.tableYear} tables.</p></div>` : ''}

  <div class="stats">
    <div class="stat hero"><span class="eyebrow">${owe ? 'Estimated amount to pay SARS' : refund ? 'Estimated refund' : paidKnown ? 'Nothing to pay or refund' : 'Estimated tax for the year'}</span>
      <span class="v">${R(paidKnown ? Math.abs(e.balance) : e.liability, cur)}</span>
      <span class="s">${e.paye || e.provisionalPaid ? `Tax ${R(e.liability, cur)} minus ${R(e.paye + e.provisionalPaid, cur)} already paid` : 'Enter PAYE from your IRP5 below to see your refund or amount owed'}</span></div>
    <div class="stat"><span class="eyebrow">Tax for the year</span><span class="v">${R(e.liability, cur)}</span><span class="s">Effective rate ${pct(e.effective)}</span></div>
    <div class="stat"><span class="eyebrow">Taxable income</span><span class="v">${R(e.taxable, cur)}</span><span class="s">Marginal rate ${pct(e.marginal)}${e.taxable <= e.threshold ? ' · below tax threshold' : ''}</span></div>
    <div class="stat"><span class="eyebrow">Tax threshold</span><span class="v">${R(e.threshold, cur)}</span><span class="s">No tax below this for your age</span></div>
  </div>

  <div class="cols">
    <div class="panel">
      <div class="panel-h"><h2>How it’s worked out</h2>${e.factor !== 1 ? `<span class="chip warn">Projected ×${e.factor.toFixed(2)}</span>` : ''}</div>
      <div class="rows">
        ${line('Salary and wages', e.employment)}
        ${e.businessNet ? line('Freelance / business profit', Math.max(0, e.businessNet), { note: e.businessNet < 0 ? 'A loss can’t reduce other income here; ask a tax practitioner about ring-fencing.' : '' }) : ''}
        ${e.rental ? line('Rental income', e.rental, { note: 'Gross amount. Tag rental costs as business expenses to reduce it.' }) : ''}
        ${e.interest ? line('Interest', e.interestTaxable, { note: `${R(e.interest, cur)} earned, first ${R(e.interestExempt, cur)} is exempt` }) : ''}
        ${line('Income before deductions', e.incomeBeforeDeductions, { strong: true })}
        ${e.retirementPaid ? line('Retirement contributions', e.retirementDeduction, { minus: true, note: `Paid ${R(e.retirementPaid, cur)}; limit 27.5% of income, max ${R(TAX_TABLES[e.tableYear].retirementCap, cur)}${e.retirementPaid > e.retirementLimit ? '. The excess carries over to next year' : ''}` }) : ''}
        ${e.donationsPaid ? line('Donations (s18A)', e.donationDeduction, { minus: true, note: 'Up to 10% of taxable income' }) : ''}
        ${line('Taxable income', e.taxable, { strong: true })}
        ${line('Tax on taxable income', e.taxBeforeRebates)}
        ${line('Rebates for your age', Math.min(e.rebates, e.taxBeforeRebates), { minus: true })}
        ${e.mtc ? line('Medical scheme credits', Math.min(e.mtc, e.afterRebates), { minus: true, note: `${R(e.mtcMonthly, cur)} a month × ${tax.medMonths} months` }) : ''}
        ${e.amtc ? line('Additional medical credit', e.amtc, { minus: true }) : ''}
        ${line('Tax for the year', e.liability, { strong: true })}
        ${e.paye ? line('PAYE already deducted', e.paye, { minus: true }) : ''}
        ${e.provisionalPaid ? line('Provisional tax paid', e.provisionalPaid, { minus: true }) : ''}
        ${line(owe ? 'Estimated to pay' : 'Estimated refund', Math.abs(e.balance), { strong: true })}
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>About you</h2></div>
      <div class="fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px">
        <label class="field"><span>Age on 28 Feb ${year}</span>
          <select data-taxf="age"><option value="under65"${tax.age === 'under65' ? ' selected' : ''}>Under 65</option><option value="65to74"${tax.age === '65to74' ? ' selected' : ''}>65 to 74</option><option value="75plus"${tax.age === '75plus' ? ' selected' : ''}>75 or older</option></select></label>
        <label class="field"><span>PAYE on your IRP5(s)</span><input type="number" min="0" step="1" id="tax-paye" data-taxy="paye" value="${esc(yr.paye ?? '')}" placeholder="0"></label>
        <label class="field"><span>On a medical aid?</span>
          <select data-taxf="onMedicalAid"><option value="false"${!tax.onMedicalAid ? ' selected' : ''}>No</option><option value="true"${tax.onMedicalAid ? ' selected' : ''}>Yes</option></select></label>
        ${tax.onMedicalAid ? `
          <label class="field"><span>Dependants on it</span><input type="number" min="0" max="15" step="1" id="tax-deps" data-taxf="medDependants" value="${esc(tax.medDependants)}"></label>
          <label class="field"><span>Months on it this year</span><input type="number" min="0" max="12" step="1" id="tax-months" data-taxf="medMonths" value="${esc(tax.medMonths)}"></label>
          <label class="field"><span>Medical aid paid (not tracked)</span><input type="number" min="0" step="1" id="tax-medaid" data-taxy="medicalAidExtra" value="${esc(yr.medicalAidExtra ?? '')}" placeholder="0"></label>` : ''}
        <label class="field"><span>RA / pension paid (not tracked)</span><input type="number" min="0" step="1" id="tax-ra" data-taxy="retirementExtra" value="${esc(yr.retirementExtra ?? '')}" placeholder="0"></label>
        <label class="field"><span>Donations with s18A (not tracked)</span><input type="number" min="0" step="1" id="tax-don" data-taxy="donationsExtra" value="${esc(yr.donationsExtra ?? '')}" placeholder="0"></label>
        ${e.provisional || yr.provisionalPaid ? `<label class="field"><span>Provisional tax paid (IRP6)</span><input type="number" min="0" step="1" id="tax-prov" data-taxy="provisionalPaid" value="${esc(yr.provisionalPaid ?? '')}" placeholder="0"></label>` : ''}
      </div>
      <span class="muted" style="font-size:.8rem">“Not tracked” means amounts that aren’t already in your transactions (for example, your employer deducts them from your salary). Your IRP5 shows these.</span>
    </div>

    ${e.provisional ? `<div class="panel"><div class="panel-h"><h2>Provisional tax (IRP6)</h2><span class="chip warn">Likely needed</span></div>
      <p class="muted" style="margin:0">You earn over R30,000 a year outside your salary, so SARS expects you to register as a provisional taxpayer and pay in two parts.</p>
      <div class="rows">${line('1st payment, by 31 August', e.irp6First)}${line('2nd payment, by end of February', e.irp6Second)}</div>
      <span class="muted" style="font-size:.8rem">Underpaying can attract penalties and interest. A registered tax practitioner can confirm your amounts.</span></div>` : ''}

    <div class="panel">
      <div class="panel-h"><h2>Income: how SARS treats it</h2></div>
      <div class="rows">${incomeCats.map(c => catRow(c, 'income')).join('')}</div>
    </div>
    <div class="panel">
      <div class="panel-h"><h2>Deductions and credits</h2></div>
      <span class="muted" style="font-size:.85rem">Tag the spending categories that count for tax. Showing categories with spending this tax year.</span>
      <div class="rows">${expenseCats.map(c => catRow(c, 'expense')).join('') || '<div class="empty">No spending in this tax year yet.</div>'}</div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>For your eFiling return</h2></div>
      <div class="rows">
        ${[
          ['IRP5 / IT3(a)', 'From each employer. Shows salary and PAYE.'],
          ['IT3(b)', 'From your bank, for interest earned.'],
          ['Medical aid tax certificate', 'From your scheme, if you were a member.'],
          ['Retirement annuity certificate', 'From your RA provider.'],
          ['Section 18A receipts', 'For donations to approved organisations.'],
          ['Income and expense records', 'For freelance, business or rental income. Export them with the button above.'],
        ].map(([a, b]) => `<div class="row" style="align-items:flex-start"><span class="chip">Doc</span><span class="grow"><div style="font-weight:600">${a}</div><div class="muted" style="font-size:.85rem;white-space:normal">${b}</div></span></div>`).join('')}
      </div>
      <span class="muted" style="font-size:.8rem">Submit your return on <a href="https://www.sarsefiling.co.za" target="_blank" rel="noopener" style="color:var(--accent)">SARS eFiling</a> or the SARS MobiApp. Check SARS for this year’s filing season dates.</span>
    </div>
  </div>
  <p class="muted" style="font-size:.8rem;margin-top:16px">This is an estimate using SARS ${e.tableYear} tax tables. It isn't a tax return and isn't tax advice. It doesn't cover capital gains, travel allowances, fringe benefits, lump sums or disability-related medical costs. SARS’s assessment is final; for anything complex, use a registered tax practitioner.</p>`;
}
