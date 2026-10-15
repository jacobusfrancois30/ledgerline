// src/tax.js - SARS personal income tax estimate (South Africa)
// Figures from sars.gov.za (rates of tax for individuals, medical tax credits,
// interest exemption) and the Budget 2026 tax guide. Add a year here each budget.
'use strict';

export const TAX_TABLES = {
  // Year of assessment 2027: 1 March 2026 - 28 February 2027
  2027: {
    brackets: [
      [245100, 0, 0.18], [383100, 44118, 0.26], [530200, 79998, 0.31], [695800, 125599, 0.36],
      [887000, 185215, 0.39], [1878600, 259783, 0.41], [Infinity, 666339, 0.45],
    ],
    rebates: { primary: 17820, secondary: 9765, tertiary: 3249 },
    thresholds: { under65: 99000, '65to74': 153250, '75plus': 171300 },
    mtc: { main: 376, first: 376, extra: 254 },
    interestExempt: { under65: 23800, older: 34500 },
    retirementCap: 430000,
  },
  // Year of assessment 2026: 1 March 2025 - 28 February 2026
  2026: {
    brackets: [
      [237100, 0, 0.18], [370500, 42678, 0.26], [512800, 77362, 0.31], [673000, 121475, 0.36],
      [857900, 179147, 0.39], [1817000, 251258, 0.41], [Infinity, 644489, 0.45],
    ],
    rebates: { primary: 17235, secondary: 9444, tertiary: 3145 },
    thresholds: { under65: 95750, '65to74': 148217, '75plus': 165689 },
    mtc: { main: 364, first: 364, extra: 246 },
    interestExempt: { under65: 23800, older: 34500 },
    retirementCap: 350000,
  },
};

export const INCOME_TYPES = [
  ['employment', 'Salary / wages (PAYE)'],
  ['business', 'Freelance / business'],
  ['interest', 'Interest'],
  ['rental', 'Rental income'],
  ['exempt', 'Not taxable'],
];
export const DEDUCTION_TYPES = [
  ['', 'Not a tax item'],
  ['retirement', 'Retirement annuity / pension'],
  ['medicalaid', 'Medical aid contributions'],
  ['medical', 'Medical costs (out of pocket)'],
  ['donation', 'Donations (s18A receipt)'],
  ['business', 'Business expense'],
];

// SARS names a tax year by the year it ends: 2027 = 1 Mar 2026 - 28 Feb 2027
export function taxYearFor(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return m >= 3 ? y + 1 : y;
}
export function taxYearRange(year) {
  const febEnd = new Date(year, 2, 0).getDate();
  return { start: `${year - 1}-03-01`, end: `${year}-02-${String(febEnd).padStart(2, '0')}` };
}
export function tableFor(year) {
  if (TAX_TABLES[year]) return { table: TAX_TABLES[year], year, exact: true };
  const known = Object.keys(TAX_TABLES).map(Number).sort((a, b) => a - b);
  const use = year > known[known.length - 1] ? known[known.length - 1] : known[0];
  return { table: TAX_TABLES[use], year: use, exact: false };
}

export function defaultTaxSettings() {
  return {
    age: 'under65',
    onMedicalAid: false,
    medDependants: 0,
    medMonths: 12,
    project: true,
    incomeTypes: { salary: 'employment', side: 'business', otherinc: 'interest' },
    deductionTypes: {},
    years: {}, // per tax year: { paye, provisionalPaid, retirementExtra, medicalAidExtra, donationsExtra }
  };
}

export function normalTax(taxable, table) {
  if (taxable <= 0) return 0;
  let lower = 0;
  for (const [upper, base, rate] of table.brackets) {
    if (taxable <= upper) return base + (taxable - lower) * rate;
    lower = upper;
  }
  return 0;
}
export function marginalRate(taxable, table) {
  for (const [upper, , rate] of table.brackets) if (taxable <= upper) return rate;
  return table.brackets[table.brackets.length - 1][2];
}

/**
 * Estimate tax for one SARS year from the ledger.
 * Returns every intermediate figure so the view can show its working.
 */
export function estimateTax({ transactions, categories, tax, year, today }) {
  const { start, end } = taxYearRange(year);
  const { table, year: tableYear, exact } = tableFor(year);
  const yr = tax.years?.[year] || {};
  const inYear = transactions.filter(t => t.date >= start && t.date <= end);

  // Months of data so far, to project a year in progress
  const lastDay = today < end ? today : end;
  const monthsElapsed = today < start ? 0 : Math.min(12,
    (Number(lastDay.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(lastDay.slice(5, 7)) - 3 + 1);
  const inProgress = today >= start && today <= end;
  const factor = inProgress && tax.project && monthsElapsed > 0 ? 12 / monthsElapsed : 1;

  const catKind = id => (categories.find(c => c.id === id) || {}).kind;
  const totals = { employment: 0, business: 0, interest: 0, rental: 0, exempt: 0,
    retirement: 0, medicalaid: 0, medical: 0, donation: 0, businessExp: 0 };
  const byCategory = {};
  for (const t of inYear) {
    const kind = catKind(t.categoryId);
    if (kind === 'transfer') continue;
    if (t.amount > 0 && kind !== 'expense') {
      const type = tax.incomeTypes?.[t.categoryId] || (kind === 'income' ? 'exempt' : 'exempt');
      totals[type] += t.amount;
      (byCategory[t.categoryId] ||= { income: 0, spend: 0 }).income += t.amount;
    } else if (t.amount < 0) {
      const d = tax.deductionTypes?.[t.categoryId];
      if (d) totals[d === 'business' ? 'businessExp' : d] += -t.amount;
      (byCategory[t.categoryId] ||= { income: 0, spend: 0 }).spend += -t.amount;
    }
  }
  // Scale ledger-tracked amounts to a full year; manual extras are already annual
  const S = n => n * factor;
  const older = tax.age !== 'under65';
  const employment = S(totals.employment);
  const businessNet = S(totals.business - totals.businessExp);
  const rental = S(totals.rental);
  const interest = S(totals.interest);
  const interestExempt = Math.min(interest, older ? table.interestExempt.older : table.interestExempt.under65);
  const interestTaxable = interest - interestExempt;

  const incomeBeforeDeductions = employment + Math.max(0, businessNet) + rental + interestTaxable;

  const retirementPaid = S(totals.retirement) + (+yr.retirementExtra || 0);
  const retirementLimit = Math.min(table.retirementCap, 0.275 * incomeBeforeDeductions);
  const retirementDeduction = Math.min(retirementPaid, retirementLimit);

  const afterRetirement = Math.max(0, incomeBeforeDeductions - retirementDeduction);
  const donationsPaid = S(totals.donation) + (+yr.donationsExtra || 0);
  const donationDeduction = Math.min(donationsPaid, 0.10 * afterRetirement);

  const taxable = Math.max(0, afterRetirement - donationDeduction);
  const taxBeforeRebates = normalTax(taxable, table);

  const r = table.rebates;
  const rebates = r.primary + (older ? r.secondary : 0) + (tax.age === '75plus' ? r.tertiary : 0);
  const afterRebates = Math.max(0, taxBeforeRebates - rebates);

  // Medical scheme fees tax credit (s6A)
  const deps = Math.max(0, Math.round(+tax.medDependants || 0));
  const months = Math.max(0, Math.min(12, Math.round(+tax.medMonths || 0)));
  const mtcMonthly = tax.onMedicalAid ? table.mtc.main + (deps >= 1 ? table.mtc.first : 0) + Math.max(0, deps - 1) * table.mtc.extra : 0;
  const mtc = mtcMonthly * months;

  // Additional medical expenses tax credit (s6B), no disability in the household
  const medAidPaid = S(totals.medicalaid) + (+yr.medicalAidExtra || 0);
  const medOOP = S(totals.medical);
  const amtc = older
    ? Math.max(0, (1 / 3) * (Math.max(0, medAidPaid - 3 * mtc) + medOOP))
    : Math.max(0, 0.25 * (Math.max(0, medAidPaid - 4 * mtc) + medOOP - 0.075 * taxable));

  const liability = Math.max(0, afterRebates - mtc - amtc);
  const paye = +yr.paye || 0;
  const provisionalPaid = +yr.provisionalPaid || 0;
  const balance = liability - paye - provisionalPaid; // > 0 owe SARS, < 0 refund

  const nonEmployment = Math.max(0, businessNet) + rental + interestTaxable;
  const provisional = nonEmployment > 30000 && taxable > table.thresholds[tax.age || 'under65'];

  return {
    year, tableYear, exactTable: exact, start, end, inProgress, monthsElapsed, factor,
    totals, byCategory, employment, businessNet, rental, interest, interestExempt, interestTaxable,
    incomeBeforeDeductions, retirementPaid, retirementLimit, retirementDeduction,
    donationsPaid, donationDeduction, taxable, taxBeforeRebates, rebates, afterRebates,
    mtcMonthly, mtc, medAidPaid, medOOP, amtc, liability, paye, provisionalPaid, balance,
    marginal: marginalRate(taxable, table), effective: incomeBeforeDeductions ? liability / incomeBeforeDeductions : 0,
    threshold: table.thresholds[tax.age || 'under65'], provisional,
    // IRP6: about half the year's tax (after PAYE) by end August, the rest by end February
    irp6First: provisional ? Math.max(0, (liability - paye) / 2) : 0,
    irp6Second: provisional ? Math.max(0, liability - paye - Math.max(provisionalPaid, (liability - paye) / 2)) : 0,
    count: inYear.length,
  };
}
