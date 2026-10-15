// src/ui/charts.js - Inline SVG charts: cash flow bar chart, sparklines, goal progress rings
'use strict';

import { addMonths, monthStats, mLabel, money, esc } from '../model.js';

export function cashflowChart(endMonth, n = 6, txns = [], categories = [], currency = 'ZAR') {
  const ms = Array.from({ length: n }, (_, i) => addMonths(endMonth, i - n + 1));
  const data = ms.map(m => ({ m, ...monthStats(txns, m, categories) }));
  const max = Math.max(1, ...data.map(d => Math.max(d.income, d.spent)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = Math.ceil(max / step) * step;

  const W = 560;
  const H = 220;
  const l = 64;
  const r = 14;
  const t = 16;
  const b = 30;
  const iw = W - l - r;
  const ih = H - t - b;

  const y = v => t + ih - (v / nice) * ih;
  const gw = iw / n;
  const bw = Math.min(20, gw / 3.0);
  const ticks = [0, 0.5, 1].map(f => f * nice);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and spending by month">`;

  // Horizontal grid lines and values
  ticks.forEach(v => {
    const yPos = y(v);
    s += `<line x1="${l}" x2="${W - r}" y1="${yPos}" y2="${yPos}" stroke="var(--line)" stroke-width="1"/>`;
    s += `<text x="${l - 8}" y="${yPos + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${esc(money(v, { notation: 'compact', maximumFractionDigits: 1 }, currency))}</text>`;
  });

  // Bars and month labels
  data.forEach((d, i) => {
    const cx = l + gw * i + gw / 2;
    const cur = d.m === endMonth;
    const incomeHeight = Math.max(0, ih + t - y(d.income));
    const spentHeight = Math.max(0, ih + t - y(d.spent));

    s += `<rect x="${cx - bw - 1}" y="${y(d.income)}" width="${bw}" height="${incomeHeight}" rx="3" fill="var(--accent)" opacity="${cur ? 1 : 0.6}">
      <title>${esc(mLabel(d.m))} income: ${esc(money(d.income, {}, currency))}</title>
    </rect>`;

    s += `<rect x="${cx + 1}" y="${y(d.spent)}" width="${bw}" height="${spentHeight}" rx="3" fill="var(--spend)" opacity="${cur ? 1 : 0.6}">
      <title>${esc(mLabel(d.m))} spending: ${esc(money(d.spent, {}, currency))}</title>
    </rect>`;

    s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${cur ? 'var(--ink)' : 'var(--muted)'}" font-weight="${cur ? 700 : 500}">${esc(mLabel(d.m, { month: 'short' }))}</text>`;
  });

  s += '</svg>';
  return s;
}

export function spark(values, w = 120, h = 30) {
  if (!values || values.length < 2) return '';
  const mx = Math.max(...values);
  const mn = Math.min(...values);
  const rg = mx - mn || 1;

  const pts = values.map((v, i) => [
    i * (w - 6) / (values.length - 1) + 3,
    h - 4 - ((v - mn) / rg) * (h - 8)
  ]);

  const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d} L${last[0]} ${h} L3 ${h}Z" fill="var(--accent)" opacity="0.12"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="var(--accent)"/>
  </svg>`;
}

export function goalRing(p, r = 30, strokeWidth = 8) {
  const pClamped = Math.max(0, Math.min(1, p));
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pClamped);
  const size = (r + strokeWidth) * 2;
  const center = r + strokeWidth;

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${strokeWidth}"/>
    <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 ${center} ${center})"/>
    <text x="${center}" y="${center + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)" font-family="var(--f-num)">${Math.round(pClamped * 100)}%</text>
  </svg>`;
}
