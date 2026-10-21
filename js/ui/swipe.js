// Swipe-to-reveal row actions, iOS style. The row follows the finger 1:1 after
// a 10px direction lock; on release the momentum is projected to choose
// between closed, open (showing Delete) and a full swipe that deletes.

import { Spring, VelocityTracker, project, rubberband, SPRING, haptic } from './motion.js';

let openRow = null;

function springFor(row) {
  if (!row.__spring) {
    const content = row.querySelector('.swipe-content');
    const actions = row.querySelector('.swipe-actions');
    row.__spring = new Spring({
      value: 0,
      onUpdate: (x) => {
        content.style.transform = x ? `translate3d(${x}px,0,0)` : '';
        actions.style.setProperty('--reveal', String(Math.min(1, -x / actions.offsetWidth || 0)));
        row.classList.toggle('swiping', x !== 0);
      },
    });
  }
  return row.__spring;
}

export function closeOpenRow(except) {
  if (openRow && openRow !== except && openRow.isConnected) springFor(openRow).to(0, SPRING.default);
  if (openRow !== except) openRow = null;
}

/** onFullSwipe(row) is called when a row is swiped all the way across. */
export function installSwipeRows(host, onFullSwipe) {
  const vt = new VelocityTracker();
  let d = null;

  host.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.swipe-row');
    if (!row || e.target.closest('.swipe-actions')) { if (!e.target.closest('.swipe-actions')) closeOpenRow(); return; }
    closeOpenRow(row);
    const s = springFor(row);
    s.stop(); // catch it mid-flight
    d = { row, s, id: e.pointerId, x0: e.clientX - s.value, y0: e.clientY, lock: null };
    vt.reset();
    vt.add(e.clientX);
  });

  host.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.lock) {
      if (Math.hypot(e.clientX - (d.x0 + d.s.value), dy) < 10) return;
      d.lock = Math.abs(dx - d.s.value) > Math.abs(dy) ? 'x' : 'y';
      if (d.lock === 'x') { d.row.setPointerCapture(e.pointerId); d.row.classList.add('dragging'); }
    }
    if (d.lock !== 'x') return;
    vt.add(e.clientX);
    const w = d.row.offsetWidth;
    // Past zero (to the right) and past the full-swipe point, resist.
    const x = dx > 0 ? rubberband(dx, w) : dx < -w * 0.85 ? -w * 0.85 + rubberband(dx + w * 0.85, w) : dx;
    d.s.set(x);
  });

  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const { row, s, lock } = d;
    d = null;
    row.classList.remove('dragging');
    if (lock !== 'x') return;
    row.__justDragged = true;
    setTimeout(() => { row.__justDragged = false; }, 60);
    const v = vt.velocity();
    const w = row.offsetWidth;
    const reveal = row.querySelector('.swipe-actions').offsetWidth || 88;
    const landing = s.value + project(v);
    if (landing < -w * 0.6) {
      haptic('warning');
      s.to(-w, { ...SPRING.default, velocity: v }).then(() => onFullSwipe(row));
      openRow = null;
    } else if (landing < -reveal / 2) {
      s.to(-reveal, { ...(Math.abs(v) > 300 ? SPRING.flick : SPRING.default), velocity: v });
      openRow = row;
    } else {
      s.to(0, { ...SPRING.default, velocity: v });
      if (openRow === row) openRow = null;
    }
  };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);

  // A drag must never also count as a tap on the row.
  host.addEventListener('click', (e) => {
    const row = e.target.closest('.swipe-row');
    if (row?.__justDragged || (row && openRow === row && !e.target.closest('.swipe-actions'))) {
      e.stopPropagation();
      e.preventDefault();
      if (openRow === row) closeOpenRow();
    }
  }, true);
}
