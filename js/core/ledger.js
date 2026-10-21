// The ledger is a state-based CRDT: an append-only set of operations, each of
// which writes some fields on one entity. A field keeps the write with the
// highest (clock, device). That rule is order-independent and idempotent, so
// every device that holds the same ops shows the same state, with no server
// deciding who wins.
//
// Op wire format (short keys keep share links small):
//   { i: "dev:seq", g: groupId, d: deviceId, s: seq, c: clock, t: type, e: entityId, v: { field: value } }

// Receipt photos are their own entity (keyed by expense id) so links can leave
// them out while live phone-to-phone sync still carries them.
export const ENTITY_TYPES = ['group', 'member', 'expense', 'payment', 'comment', 'conversion', 'receipt'];

export function newId(len = 12) {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  const abc = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (const b of bytes) s += abc[b % 36];
  return s;
}

/** Hybrid logical clock: tracks wall time but never runs backwards or repeats. */
export class Clock {
  constructor(last = 0, now = () => Date.now()) {
    this.last = last;
    this.now = now;
  }
  tick() {
    this.last = Math.max(this.now(), this.last + 1);
    return this.last;
  }
  observe(c) {
    if (c > this.last) this.last = c;
  }
}

/**
 * An op's write stamp. `w` lets machine-generated writes (recurring
 * occurrences) share one deterministic stamp, so the copies two phones make
 * of the same occurrence are indistinguishable and any human edit beats them.
 */
export const stampOf = (op) => [op.c, op.w ?? op.d];

/** Compare two write stamps [clock, device]. */
export function cmpStamp(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

function emptyGroupState(id) {
  return {
    id,
    group: { id, _ts: {}, _ops: [] },
    member: new Map(),
    expense: new Map(),
    payment: new Map(),
    comment: new Map(),
    conversion: new Map(),
    receipt: new Map(),
  };
}

/** One group's log and its materialized state. */
export class GroupLedger {
  constructor(groupId) {
    this.id = groupId;
    this.ops = new Map(); // op id → op
    this.order = []; // local arrival order, used for "what haven't I shared yet"
    this.state = emptyGroupState(groupId);
  }

  has(opId) {
    return this.ops.has(opId);
  }

  /** Adds ops; returns those that were new. Safe to call with duplicates. */
  add(ops) {
    const fresh = [];
    for (const op of ops) {
      if (!op || op.g !== this.id || this.ops.has(op.i)) continue;
      if (!ENTITY_TYPES.includes(op.t)) continue;
      this.ops.set(op.i, op);
      this.order.push(op.i);
      this.#apply(op);
      fresh.push(op);
    }
    return fresh;
  }

  #apply(op) {
    const st = this.state;
    let ent;
    if (op.t === 'group') ent = st.group;
    else {
      const map = st[op.t];
      ent = map.get(op.e);
      if (!ent) {
        ent = { id: op.e, _ts: {}, _ops: [] };
        map.set(op.e, ent);
      }
    }
    const stamp = stampOf(op);
    for (const [k, val] of Object.entries(op.v || {})) {
      const prev = ent._ts[k];
      if (!prev || cmpStamp(stamp, prev) > 0) {
        ent[k] = val;
        ent._ts[k] = stamp;
      }
    }
    // Keep the entity's op history sorted by stamp; the first op is its creation.
    const list = ent._ops;
    let idx = list.length;
    while (idx > 0 && cmpStamp(stampOf(list[idx - 1]), stamp) > 0) idx--;
    list.splice(idx, 0, op);
    ent._created = list[0].c;
    ent._by = list[0].d;
    ent._updated = list[list.length - 1].c;
  }

  /** Contiguous seq ranges we hold, per device: { dev: [[1,5],[7,7]] }. */
  summary() {
    const per = {};
    for (const op of this.ops.values()) (per[op.d] ||= []).push(op.s);
    const out = {};
    for (const [dev, seqs] of Object.entries(per)) {
      seqs.sort((a, b) => a - b);
      const ranges = [];
      for (const s of seqs) {
        const last = ranges[ranges.length - 1];
        if (last && s === last[1] + 1) last[1] = s;
        else ranges.push([s, s]);
      }
      out[dev] = ranges;
    }
    return out;
  }

  /** Ops we hold that a peer with `summary` doesn't. */
  missingFor(summary) {
    const out = [];
    for (const op of this.ops.values()) {
      const ranges = summary?.[op.d];
      if (!ranges || !ranges.some(([a, b]) => op.s >= a && op.s <= b)) out.push(op);
    }
    return out;
  }

  /** Ops that arrived after local position `mark` (see `order`). */
  since(mark = 0) {
    return this.order.slice(mark).map((id) => this.ops.get(id));
  }

  allOps() {
    return [...this.ops.values()];
  }

  maxSeq(dev) {
    let m = 0;
    for (const op of this.ops.values()) if (op.d === dev && op.s > m) m = op.s;
    return m;
  }
}

/** Live (non-deleted) entities of a type, as plain arrays. */
export function live(state, type) {
  return [...state[type].values()].filter((e) => !e.deleted);
}

/**
 * Describe what an op did, for the Activity feed and edit history.
 * Returns { verb: 'created'|'edited'|'deleted'|'restored', changed: [fields] }.
 */
export function opKind(ent, op) {
  const first = ent._ops[0] === op;
  const v = op.v || {};
  if (first) return { verb: 'created', changed: Object.keys(v) };
  if (v.deleted === true) return { verb: 'deleted', changed: [] };
  if (v.deleted === false && Object.keys(v).length === 1) return { verb: 'restored', changed: [] };
  return { verb: 'edited', changed: Object.keys(v).filter((k) => k !== 'deleted') };
}
