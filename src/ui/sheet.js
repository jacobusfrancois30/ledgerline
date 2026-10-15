// src/ui/sheet.js - Modal dialogs, sheets, and form helpers
'use strict';

import { esc } from '../model.js';

let lastActiveElement = null;

export function openSheet(html, mount, options = {}) {
  lastActiveElement = document.activeElement;
  const overlay = document.querySelector('#overlay');
  if (!overlay) return;

  const wideClass = options.wide ? ' wide' : '';
  overlay.innerHTML = `<div class="sheet${wideClass}" role="dialog" aria-modal="true">${html}</div>`;
  overlay.hidden = false;

  const sheet = overlay.firstElementChild;
  if (mount && typeof mount === 'function') {
    mount(sheet);
  }

  // Auto-focus first input/button
  const firstFocusable = sheet.querySelector('input:not([type="hidden"]), select, textarea, button');
  if (firstFocusable) {
    firstFocusable.focus();
  }
}

export function closeSheet() {
  const overlay = document.querySelector('#overlay');
  if (overlay) {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }
  if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
    try {
      lastActiveElement.focus();
    } catch {}
  }
}

export function initSheetListeners() {
  const overlay = document.querySelector('#overlay');
  if (overlay) {
    overlay.addEventListener('mousedown', e => {
      if (e.target.id === 'overlay') {
        closeSheet();
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const overlay = document.querySelector('#overlay');
      if (overlay && !overlay.hidden) {
        closeSheet();
      }
    }
  });
}

export function confirmBtn(btn, armedLabel, onConfirm) {
  let timer;
  btn.addEventListener('click', (e) => {
    if (btn.dataset.armed) {
      clearTimeout(timer);
      delete btn.dataset.armed;
      onConfirm(e);
      return;
    }
    btn.dataset.armed = '1';
    const originalText = btn.textContent;
    btn.textContent = armedLabel;
    timer = setTimeout(() => {
      if (btn.isConnected) {
        delete btn.dataset.armed;
        btn.textContent = originalText;
      }
    }, 3500);
  });
}

export const fld = (label, inner, full = false) => `<label class="field${full ? ' full' : ''}"><span>${label}</span>${inner}</label>`;

export const catOptions = (categories, sel, { blank = 'Uncategorized', kinds } = {}) => {
  const groups = [
    ['expense', 'Spending'],
    ['income', 'Income'],
    ['transfer', 'Moving money']
  ];
  return (blank !== null ? `<option value="">${esc(blank)}</option>` : '') +
    groups.filter(([k]) => !kinds || kinds.includes(k)).map(([k, label]) =>
      `<optgroup label="${label}">` +
      categories.filter(c => c.kind === k).map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('') +
      '</optgroup>'
    ).join('');
};

export const acctOptions = (accounts, sel) =>
  accounts.map(a => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
