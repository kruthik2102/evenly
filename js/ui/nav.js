// A UINavigationController for the web: push/pop with the iOS parallax slide,
// an interruptible edge-swipe back gesture that tracks the finger 1:1 and
// decides by projected momentum, and large titles that collapse into a
// translucent bar as you scroll.

import { html, raw, el } from './dom.js';
import { Spring, VelocityTracker, project, rubberband, reducedMotion, SPRING, haptic } from './motion.js';

const call = (v, s) => (typeof v === 'function' ? v.call(s) : v);

function pageMarkup(screen, backLabel) {
  const title = call(screen.title, screen) || '';
  return html`
    <section class="page ${screen.large ? 'has-large' : ''} ${screen.className || ''}">
      <header class="navbar">
        <div class="nav-leading">${backLabel != null
          ? html`<button class="nav-back" data-nav="back" aria-label="Back to ${backLabel}"><svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${backLabel}</span></button>`
          : raw(call(screen.leading, screen) || '')}</div>
        <h1 class="nav-title">${title}</h1>
        <div class="nav-trailing">${raw(call(screen.actions, screen) || '')}</div>
      </header>
      <div class="scroller">
        ${screen.large ? html`<h1 class="large-title">${title}</h1>` : ''}
        <div class="content">${raw(screen.body())}</div>
      </div>
      ${screen.accessory ? html`<div class="accessory">${raw(call(screen.accessory, screen) || '')}</div>` : ''}
      <div class="shade"></div>
    </section>`;
}

export class Nav {
  constructor(host, { context = {}, onTopChange } = {}) {
    this.host = host;
    this.stack = [];
    this.context = context; // passed to screens as this.ctx
    this.onTopChange = onTopChange;
    host.classList.add('nav');
    host.addEventListener('click', (e) => this.#onClick(e));
    host.addEventListener('input', (e) => this.#onField(e, 'input'));
    host.addEventListener('change', (e) => this.#onField(e, 'change'));
    this.#installEdgeSwipe();
  }

  get top() { return this.stack[this.stack.length - 1]; }
  get width() { return this.host.clientWidth || 360; }

  #mount(screen, index) {
    screen.nav = this;
    screen.ctx = this.context;
    const backLabel = index > 0 ? (call(this.stack[index - 1].backTitle, this.stack[index - 1]) || call(this.stack[index - 1].title, this.stack[index - 1]) || 'Back') : null;
    const page = el(pageMarkup(screen, backLabel && backLabel.length > 14 ? 'Back' : backLabel));
    screen.page = page;
    page.__screen = screen;
    const scroller = page.querySelector('.scroller');
    let ticking = false;
    scroller.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; this.#onScroll(page, scroller); });
    }, { passive: true });
    this.host.append(page);
    this.#onScroll(page, scroller);
    screen.mount?.(page);
    return page;
  }

  #onScroll(page, scroller) {
    const y = scroller.scrollTop;
    const large = page.querySelector('.large-title');
    const threshold = large ? large.offsetHeight + 4 : 0;
    page.classList.toggle('scrolled', y > 2);
    page.classList.toggle('title-collapsed', !large || y > threshold - 12);
  }

  /**
   * Re-render one screen's content in place, keeping scroll position.
   * Background refreshes (`auto`) skip a screen while someone is typing in it.
   */
  refresh(screen, { auto = false } = {}) {
    const page = screen.page;
    if (!page?.isConnected) return;
    const active = document.activeElement;
    if (auto && active && page.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
    const content = page.querySelector('.content');
    content.innerHTML = String(screen.body());
    const title = call(screen.title, screen) || '';
    page.querySelector('.nav-title').textContent = title;
    const lt = page.querySelector('.large-title');
    if (lt) lt.textContent = title;
    const tr = page.querySelector('.nav-trailing');
    if (screen.actions) tr.innerHTML = String(call(screen.actions, screen) || '');
    const acc = page.querySelector('.accessory');
    if (acc && screen.accessory) acc.innerHTML = String(call(screen.accessory, screen) || '');
    screen.afterRender?.(page);
  }

  refreshAll() {
    for (const s of this.stack) if (!s.noAutoRefresh) this.refresh(s, { auto: true });
  }

  reset(screen) {
    for (const s of this.stack) { s.unmount?.(); s.page?.remove(); }
    this.stack = [screen];
    const page = this.#mount(screen, 0);
    page.style.transform = '';
    screen.afterRender?.(page);
    this.onTopChange?.(screen);
  }

  push(screen, { animate = true } = {}) {
    const prev = this.top;
    this.stack.push(screen);
    const page = this.#mount(screen, this.stack.length - 1);
    screen.afterRender?.(page);
    this.onTopChange?.(screen);
    if (!prev) return;
    prev.page.classList.add('below');
    this.#hideDeeper();
    const w = this.width;
    const spring = this.#springFor(screen, prev);
    if (!animate || reducedMotion.matches) {
      page.classList.add('fade-in');
      spring.set(0);
      return;
    }
    spring.set(w);
    spring.to(0, SPRING.default);
  }

  pop({ velocity = 0 } = {}) {
    if (this.stack.length < 2) return;
    const top = this.top;
    const below = this.stack[this.stack.length - 2];
    below.page.style.display = '';
    const spring = top.spring || this.#springFor(top, below);
    const finish = () => {
      if (this.stack.includes(top)) return; // a push re-used it
      top.unmount?.();
      top.page.remove();
    };
    this.stack.pop();
    below.page.classList.remove('below');
    this.refresh(below);
    this.onTopChange?.(below);
    if (reducedMotion.matches) { spring.stop(); finish(); this.#apply(top, below, this.width); return; }
    spring.onRest = finish;
    spring.to(this.width, { ...(velocity > 300 ? SPRING.flick : SPRING.default), velocity });
  }

  popToRoot() {
    while (this.stack.length > 2) {
      const s = this.stack.splice(this.stack.length - 2, 1)[0];
      s.unmount?.();
      s.page.remove();
    }
    this.pop();
  }

  /** Remove a screen from the middle/top without animation (e.g. after deleting what it shows). */
  replaceTop(screen) {
    const old = this.stack.pop();
    old?.unmount?.();
    old?.page.remove();
    this.push(screen, { animate: false });
  }

  #hideDeeper() {
    this.stack.forEach((s, i) => { if (s.page) s.page.style.display = i < this.stack.length - 2 ? 'none' : ''; });
  }

  #springFor(top, below) {
    top.spring?.stop();
    top.spring = new Spring({ value: this.width, onUpdate: (x) => this.#apply(top, below, x) });
    return top.spring;
  }

  #apply(top, below, x) {
    const w = this.width;
    const p = Math.min(1, Math.max(0, x / w));
    top.page.style.transform = x ? `translate3d(${x}px,0,0)` : '';
    if (below?.page) {
      below.page.style.transform = p < 1 ? `translate3d(${-(1 - p) * w * 0.3}px,0,0)` : '';
      below.page.querySelector('.shade').style.opacity = String((1 - p) * 0.12);
    }
  }

  #installEdgeSwipe() {
    const vt = new VelocityTracker();
    let drag = null;
    this.host.addEventListener('pointerdown', (e) => {
      if (this.stack.length < 2 || e.button !== 0) return;
      const r = this.host.getBoundingClientRect();
      if (e.clientX - r.left > 28) return;
      const top = this.top;
      const below = this.stack[this.stack.length - 2];
      below.page.style.display = '';
      const spring = top.spring || this.#springFor(top, below);
      spring.stop(); // grab it mid-flight if it was animating
      drag = { id: e.pointerId, startX: e.clientX - spring.value, y0: e.clientY, top, below, spring, started: false };
      vt.reset();
      vt.add(e.clientX);
    });
    this.host.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      if (!drag.started) {
        if (dx < 10) return; // hysteresis before committing to a drag
        if (Math.abs(e.clientY - drag.y0) > dx) { // it's a scroll, not a swipe back
          if (drag.spring.value) drag.spring.to(0, SPRING.default);
          drag = null;
          return;
        }
        drag.started = true;
        this.host.setPointerCapture(e.pointerId);
        this.host.classList.add('dragging');
      }
      vt.add(e.clientX);
      drag.spring.set(dx < 0 ? rubberband(dx, this.width) : dx);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      this.host.classList.remove('dragging');
      if (!d.started) {
        if (d.spring.value) d.spring.to(0, SPRING.default); // we caught a push mid-flight; let it land
        return;
      }
      const v = vt.velocity();
      const projected = d.spring.value + project(v);
      if (projected > this.width / 2 && v > -200) {
        haptic();
        this.pop({ velocity: v });
      } else {
        d.spring.to(0, { ...SPRING.default, velocity: v });
      }
    };
    this.host.addEventListener('pointerup', end);
    this.host.addEventListener('pointercancel', end);
  }

  #screenFor(target) {
    return target.closest('.page')?.__screen;
  }

  #onClick(e) {
    const back = e.target.closest('[data-nav="back"]');
    if (back) {
      if (this.#screenFor(back) === this.top) this.pop();
      return;
    }
    const t = e.target.closest('[data-act]');
    if (!t || !this.host.contains(t)) return;
    const screen = this.#screenFor(t);
    const fn = screen?.on?.[t.dataset.act];
    if (fn) {
      e.preventDefault();
      fn.call(screen, t, e);
    }
  }

  #onField(e, kind) {
    const t = e.target.closest('[data-field]');
    if (!t) return;
    const screen = this.#screenFor(t);
    const fn = screen?.[kind === 'input' ? 'onInput' : 'onChange'];
    fn?.call(screen, t.dataset.field, t, e);
  }
}
