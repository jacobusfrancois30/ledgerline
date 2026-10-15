// src/ui/toast.js - Accessible toast notifications with action buttons
'use strict';

let toastTimeout = null;

export function toast(msg, action = null, duration = 2800) {
  const el = document.querySelector('#toast');
  if (!el) return;

  clearTimeout(toastTimeout);
  el.innerHTML = '';

  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);

  if (action && action.label && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      hideToast();
      action.onClick();
    });
    el.appendChild(btn);
  }

  el.hidden = false;

  if (duration > 0) {
    toastTimeout = setTimeout(() => {
      hideToast();
    }, duration);
  }
}

export function hideToast() {
  const el = document.querySelector('#toast');
  if (el) {
    el.hidden = true;
    el.innerHTML = '';
  }
  clearTimeout(toastTimeout);
}
