// Modal sheets. Each sheet hosts its own Nav, so a form can push detail pickers
// inside it, as on iOS. Dragging the grabber or bar tracks the finger 1:1,
// rubber-bands upwards, and on release projects the flick's momentum to decide
// between dismissing and settling. Grabbing a sheet mid-animation catches it.

import { el } from './dom.js';
import { Nav } from './nav.js';
import { Spring, VelocityTracker, project, rubberband, reducedMotion, SPRING } from './motion.js';

const open = [];

function updateBackdrop() {
  const app = document.getElementById('app');
  const n = open.length;
  app.inert = n > 0;
  document.body.classList.toggle('sheet-open', n > 0);
  open.forEach((s, i) => {
    s.layer.inert = i < n - 1;
    s.layer.classList.toggle('pushed-back', i < n - 1);
  });
}

/**
 * openSheet(screen, { onClose, size }) → { close, nav }
 * `screen` is a normal Nav screen; it can call this.sheet.close().
 */
export function openSheet(screen, { onClose, size = 'large', context = {} } = {}) {
  const layer = el(`
    <div class="sheet-layer size-${size}">
      <div class="scrim"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grabber" aria-hidden="true"></div>
        <div class="sheet-nav"></div>
      </div>
    </div>`);
  document.body.append(layer);
  const sheetEl = layer.querySelector('.sheet');
  const scrim = layer.querySelector('.scrim');
  const nav = new Nav(layer.querySelector('.sheet-nav'), { context });
  const api = { layer, nav, close: (o) => close(o), closed: false };
  screen.sheet = api;
  const origPush = nav.push.bind(nav);
  nav.push = (s, o) => { s.sheet = api; origPush(s, o); };

  const height = () => sheetEl.offsetHeight || window.innerHeight;
  const isPrimary = open.length === 0; // only the first sheet pushes the app back
  const spring = new Spring({
    value: 1,
    onUpdate: (y) => {
      sheetEl.style.transform = `translate3d(0,${y}px,0)`;
      const p = 1 - Math.min(1, Math.max(0, y / height()));
      scrim.style.opacity = String(p);
      if (isPrimary) document.documentElement.style.setProperty('--sheet-progress', String(p));
    },
  });

  open.push(api);
  updateBackdrop();
  nav.reset(screen);
  spring.set(height());
  if (reducedMotion.matches) {
    layer.classList.add('fade-in');
    spring.set(0);
  } else {
    requestAnimationFrame(() => spring.to(0, SPRING.sheet));
  }
  requestAnimationFrame(() => layer.querySelector('[autofocus]')?.focus({ preventScroll: true }));

  function close({ velocity = 0, silent = false } = {}) {
    if (api.closed) return;
    api.closed = true;
    const i = open.indexOf(api);
    if (i >= 0) open.splice(i, 1);
    updateBackdrop();
    if (!silent) onClose?.();
    for (const s of nav.stack) s.unmount?.();
    const done = () => {
      layer.remove();
      if (isPrimary) document.documentElement.style.setProperty('--sheet-progress', '0');
    };
    if (reducedMotion.matches) {
      layer.classList.add('fade-out');
      setTimeout(done, 200);
      return;
    }
    spring.onRest = done;
    spring.to(height() + 40, { ...(velocity > 400 ? SPRING.flick : SPRING.default), velocity });
  }

  scrim.addEventListener('click', () => { if (!screen.modalLock) close(); });
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open[open.length - 1] === api) close(); });

  // Drag to dismiss from the grabber and the navigation bar.
  const vt = new VelocityTracker();
  let drag = null;
  sheetEl.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.grabber, .navbar') || e.target.closest('button, input, a')) return;
    spring.stop();
    drag = { id: e.pointerId, start: e.clientY - spring.value, moved: false };
    vt.reset();
    vt.add(e.clientY);
  });
  sheetEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.start;
    if (!drag.moved && Math.abs(dy - spring.value) < 6) return;
    if (!drag.moved) { drag.moved = true; sheetEl.setPointerCapture(e.pointerId); }
    vt.add(e.clientY);
    spring.set(dy < 0 ? rubberband(dy, height()) : dy);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    const v = vt.velocity();
    const landing = spring.value + project(v);
    if (landing > height() * 0.45 && !screen.modalLock) close({ velocity: v });
    else spring.to(0, { ...(Math.abs(v) > 400 ? SPRING.flick : SPRING.default), velocity: v });
  };
  sheetEl.addEventListener('pointerup', end);
  sheetEl.addEventListener('pointercancel', end);

  return api;
}

export function sheetNavs() {
  return open.map((s) => s.nav);
}

export function topSheet() {
  return open[open.length - 1] || null;
}

export function closeAllSheets() {
  [...open].reverse().forEach((s) => s.close({ silent: true }));
}
