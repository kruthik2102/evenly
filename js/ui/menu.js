// Pull-down menu that grows out of the button that opened it (transform-origin
// at the trigger), and shrinks back into it.

import { el, html } from './dom.js';
import { haptic } from './motion.js';

let current = null;

export function closeMenu() {
  if (!current) return;
  const { node, scrim } = current;
  current = null;
  node.classList.remove('open');
  scrim.remove();
  setTimeout(() => node.remove(), 220);
}

/** items: [{ id, label, checked?, destructive?, icon? }] → resolves with the chosen id (or null). */
export function showMenu(anchor, items, { title } = {}) {
  closeMenu();
  return new Promise((resolve) => {
    const r = anchor.getBoundingClientRect();
    const node = el(String(html`<div class="menu" role="menu">
      ${title ? html`<div class="menu-title">${title}</div>` : ''}
      ${items.map((it) => html`<button role="menuitemradio" aria-checked="${String(!!it.checked)}" class="menu-item ${it.destructive ? 'destructive' : ''}" data-id="${it.id}">
        <span class="menu-check">${it.checked ? '✓' : ''}</span><span>${it.label}</span></button>`)}
    </div>`));
    const scrim = el('<div class="menu-scrim"></div>');
    document.body.append(scrim, node);
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const right = r.right > window.innerWidth / 2;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, right ? r.right - w : r.left));
    const below = r.bottom + 6 + h < window.innerHeight - 8;
    const top = below ? r.bottom + 6 : Math.max(8, r.top - h - 6);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.transformOrigin = `${r.left + r.width / 2 - left}px ${below ? 0 : h}px`;
    requestAnimationFrame(() => node.classList.add('open'));
    current = { node, scrim };
    const done = (id) => { closeMenu(); resolve(id); };
    scrim.addEventListener('pointerdown', () => done(null));
    node.addEventListener('click', (e) => {
      const b = e.target.closest('.menu-item');
      if (b) { haptic(); done(b.dataset.id); }
    });
    node.querySelector('.menu-item')?.focus({ preventScroll: true });
    node.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
  });
}

/** Native-feeling confirmation as an action sheet anchored at the bottom. */
export function confirmAction({ title, message, confirm = 'Delete', destructive = true, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    const node = el(String(html`<div class="action-sheet-layer">
      <div class="scrim"></div>
      <div class="action-sheet" role="alertdialog" aria-label="${title}">
        <div class="as-group">
          <div class="as-head">${title ? html`<strong>${title}</strong>` : ''}${message ? html`<span>${message}</span>` : ''}</div>
          <button class="as-btn ${destructive ? 'destructive' : ''}" data-v="1">${confirm}</button>
        </div>
        <button class="as-btn as-cancel" data-v="0">${cancel}</button>
      </div></div>`));
    document.body.append(node);
    requestAnimationFrame(() => node.classList.add('open'));
    const done = (v) => {
      node.classList.remove('open');
      setTimeout(() => node.remove(), 260);
      resolve(v);
    };
    node.querySelector('.scrim').addEventListener('click', () => done(false));
    node.addEventListener('click', (e) => {
      const b = e.target.closest('.as-btn');
      if (b) done(b.dataset.v === '1');
    });
    node.querySelector('.as-cancel').focus({ preventScroll: true });
  });
}
