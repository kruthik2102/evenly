// Motion primitives from Apple's "Designing Fluid Interfaces", for the web.
// Springs are described the designer's way, by damping ratio and response
// (≈ seconds to settle), and are always interruptible: retargeting keeps the
// current on-screen value and velocity, so there's never a jump or a brick wall.

const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false, addEventListener() {} });
export const reducedMotion = mq('(prefers-reduced-motion: reduce)');

export const SPRING = {
  default: { damping: 1, response: 0.35 }, // critically damped, no overshoot
  flick: { damping: 0.8, response: 0.35 }, // only after a gesture carried momentum
  sheet: { damping: 0.86, response: 0.32 },
  snappy: { damping: 1, response: 0.25 },
};

export class Spring {
  constructor({ value = 0, onUpdate, onRest } = {}) {
    this.value = value;
    this.velocity = 0; // units per second
    this.target = value;
    this.onUpdate = onUpdate;
    this.onRest = onRest;
    this.raf = 0;
    this.k = 0;
    this.c = 0;
  }

  /** Retarget. Starts from wherever the value is right now (the presentation value). */
  to(target, { damping = 1, response = 0.35, velocity } = {}) {
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    // No animation frames arrive in a background tab; land immediately instead of stalling.
    if (reducedMotion.matches || (typeof document !== 'undefined' && document.hidden)) return this.set(target, true);
    // Apple's parameterisation → physics (mass = 1).
    this.k = (2 * Math.PI / response) ** 2;
    this.c = (4 * Math.PI * damping) / response;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.#step(t));
    }
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  /** Jump without animating (used while a finger is dragging: 1:1 tracking). */
  set(value, rest = false) {
    this.stop();
    this.value = value;
    this.velocity = 0;
    this.onUpdate?.(value);
    if (rest) { this.onRest?.(value); }
    return Promise.resolve();
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resolve?.();
    this.resolve = null;
  }

  #step(now) {
    let dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    // Fixed small substeps keep the integration stable on 60 and 120 Hz screens.
    const h = 1 / 480;
    while (dt > 0) {
      const s = Math.min(h, dt);
      const a = -this.k * (this.value - this.target) - this.c * this.velocity;
      this.velocity += a * s;
      this.value += this.velocity * s;
      dt -= s;
    }
    const settled = Math.abs(this.velocity) < 2 && Math.abs(this.value - this.target) < 0.25;
    if (settled) {
      this.value = this.target;
      this.velocity = 0;
      this.raf = 0;
      this.onUpdate?.(this.value);
      this.onRest?.(this.value);
      this.resolve?.();
      this.resolve = null;
      return;
    }
    this.onUpdate?.(this.value);
    this.raf = requestAnimationFrame((t) => this.#step(t));
  }
}

/** Keeps a short position history so we know the finger's velocity at release. */
export class VelocityTracker {
  constructor() { this.samples = []; }
  reset() { this.samples = []; }
  add(pos, t = performance.now()) {
    this.samples.push({ pos, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }
  /** px per second */
  velocity() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0];
    const b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.pos - a.pos) / dt : 0;
  }
}

/** Where a flick would come to rest (Apple's scroll-deceleration projection). */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary instead of a hard stop. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  const sign = Math.sign(overshoot);
  const x = Math.abs(overshoot);
  return sign * ((x * dimension * constant) / (dimension + constant * x));
}

/** A light tick on commit. Fired on the same frame as the visual change. */
export function haptic(kind = 'tick') {
  try { navigator.vibrate?.(kind === 'success' ? [8, 40, 12] : kind === 'warning' ? [14, 60, 14] : 8); } catch { /* unsupported */ }
}
