// Tiny templating: html`` escapes every interpolated value unless it's raw().

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function piece(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(piece).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += piece(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

/** Instant press feedback on pointer-down (not on release), with cancel-by-moving-away. */
export function installPressFeedback(root) {
  let pressed = null;
  let start = null;
  const clear = () => { pressed?.classList.remove('is-pressed'); pressed = null; };
  root.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('[data-act], button, .cell.tappable, a.cell, label.cell');
    if (!t || t.disabled) return;
    pressed = t;
    start = { x: e.clientX, y: e.clientY };
    t.classList.add('is-pressed');
  }, { passive: true });
  root.addEventListener('pointermove', (e) => {
    if (pressed && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear();
  }, { passive: true });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => root.addEventListener(n, clear, { passive: true }));
  root.addEventListener('scroll', clear, { capture: true, passive: true });
}

let toastTimer = 0;
/** Small status banner. `action` = { label, run } for things like Undo. */
export function toast(message, { action, kind = 'info', ms = 3200 } = {}) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('<div id="toast" class="toast" role="status" aria-live="polite"></div>');
    document.body.append(t);
  }
  t.className = `toast toast-${kind}`;
  t.innerHTML = String(html`<span>${message}</span>${action ? html`<button class="toast-action">${action.label}</button>` : ''}`);
  if (action) t.querySelector('button').onclick = () => { action.run(); hide(); };
  void t.offsetWidth; // commit the hidden state first so the entrance transition runs
  t.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => t.classList.remove('show');
  toastTimer = setTimeout(hide, action ? ms + 2000 : ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('<textarea style="position:fixed;opacity:0"></textarea>');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** System share sheet when available; returns false if the user has to copy instead. */
export async function shareText({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return true;
    }
  }
  return false;
}

export function downloadFile(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = el('<a></a>');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function shareFile(name, content, type) {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return true;
    }
  }
  downloadFile(name, file, type);
  return true;
}

const scripts = new Map();
/** Lazy-load a pinned CDN script once (QR codes, OCR). */
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); reject(new Error('Couldn’t load a component. Check your connection.')); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export function relativeTime(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = new Date(ts);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 864e5);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
