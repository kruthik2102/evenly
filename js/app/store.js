// The app's single source of truth: one GroupLedger per group, persisted as raw
// ops in IndexedDB. Every user action becomes an op via #write(); everything
// the UI shows is derived from the ledgers.

import { GroupLedger, Clock, newId, live, opKind } from '../core/ledger.js';
import { groupBalances, personView, pairwise, edges } from '../core/balances.js';
import { expenseParts } from '../core/balances.js';
import { minorDigits, formatPlain } from '../core/money.js';
import { dueDates, COPIED_FIELDS, isoDate } from '../core/recurring.js';
import { newGroupKey } from '../sync/codec.js';
import { makeInvite, readLink } from '../sync/links.js';

/* ---------- persistence ---------- */

export function memoryPersistence() {
  const rows = [];
  const kv = new Map();
  return {
    async load() { return { rows: [...rows], kv: new Map(kv) }; },
    async putOps(list) { rows.push(...list); },
    async putKV(k, v) { kv.set(k, structuredClone(v)); },
    async delKV(k) { kv.delete(k); },
    async deleteGroup(g) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].g === g) rows.splice(i, 1); },
    async wipe() { rows.length = 0; kv.clear(); },
  };
}

export function idbPersistence(name = 'evenly') {
  const ready = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('ops', { keyPath: 'k' }).createIndex('g', 'g');
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (stores, mode, fn) => {
    const db = await ready;
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const out = fn(t);
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    async load() {
      const rows = await tx(['ops'], 'readonly', (t) => t.objectStore('ops').getAll());
      const kv = new Map();
      await tx(['kv'], 'readonly', (t) => {
        const s = t.objectStore('kv');
        const keys = s.getAllKeys();
        const vals = s.getAll();
        t.addEventListener('complete', () => keys.result.forEach((k, i) => kv.set(k, vals.result[i])));
      });
      return { rows, kv };
    },
    putOps: (list) => tx(['ops'], 'readwrite', (t) => { const s = t.objectStore('ops'); list.forEach((r) => s.put(r)); }),
    putKV: (k, v) => tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').put(v, k); }),
    delKV: (k) => tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').delete(k); }),
    deleteGroup: (g) => tx(['ops'], 'readwrite', (t) => {
      const s = t.objectStore('ops');
      const req = s.index('g').getAllKeys(g);
      req.onsuccess = () => req.result.forEach((k) => s.delete(k));
    }),
    wipe: () => tx(['ops', 'kv'], 'readwrite', (t) => { t.objectStore('ops').clear(); t.objectStore('kv').clear(); }),
  };
}

/* ---------- store ---------- */

export const DEFAULT_SETTINGS = { theme: 'system', lock: false, lockTimeout: 60, credentialId: null };

export class Store {
  constructor(persistence, { now = () => Date.now() } = {}) {
    this.p = persistence;
    this.now = now;
    this.device = null;
    this.groups = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.seen = 0; // activity read mark (clock)
    this.clock = new Clock(0, now);
    this.listeners = new Set();
    this.peers = new Set();
    this.pending = false;
  }

  /* ----- lifecycle ----- */

  async init() {
    const { rows, kv } = await this.p.load();
    this.device = kv.get('device') || null;
    this.settings = { ...DEFAULT_SETTINGS, ...(kv.get('settings') || {}) };
    this.seen = kv.get('seen') || 0;
    for (const [k, meta] of kv) {
      if (k.startsWith('group:')) this.groups.set(meta.g, { ...meta, ledger: new GroupLedger(meta.g) });
    }
    rows.sort((a, b) => a.n - b.n);
    for (const r of rows) {
      const grp = this.groups.get(r.g);
      if (!grp) continue;
      grp.ledger.add([r.op]);
      this.clock.observe(r.op.c);
    }
    if (this.device) await this.catchUpRecurring();
    return this;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #notify() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.listeners.forEach((fn) => fn());
    });
  }

  async setupDevice({ name, emoji = '🙂', currency = 'INR', upi = '' }) {
    this.device = { id: newId(10), name: name.trim(), emoji, currency, upi: upi.trim() };
    await this.p.putKV('device', this.device);
    this.#notify();
  }

  async updateDevice(fields) {
    Object.assign(this.device, fields);
    await this.p.putKV('device', this.device);
    // Keep my member record in every group in step with my profile.
    for (const grp of this.groups.values()) {
      const me = this.meIn(grp.g);
      if (!me) continue;
      const m = grp.ledger.state.member.get(me);
      const patch = {};
      for (const k of ['name', 'emoji', 'upi']) if (k in fields && m?.[k] !== fields[k]) patch[k] = fields[k];
      if (Object.keys(patch).length) await this.#write(grp.g, 'member', me, patch);
    }
    this.#notify();
  }

  async updateSettings(fields) {
    Object.assign(this.settings, fields);
    await this.p.putKV('settings', this.settings);
    this.#notify();
  }

  async markSeen() {
    this.seen = this.clock.last;
    await this.p.putKV('seen', this.seen);
    this.#notify();
  }

  /* ----- writing ----- */

  async #write(g, t, e, v, extra = {}) {
    const grp = this.groups.get(g);
    if (!grp) throw new Error('Unknown group');
    const s = grp.ledger.maxSeq(this.device.id) + 1;
    const op = { i: `${this.device.id}:${s}`, g, d: this.device.id, s, c: extra.c ?? this.clock.tick(), t, e, v, ...extra };
    if (extra.c != null) this.clock.observe(extra.c);
    await this.#ingest(grp, [op]);
    return op;
  }

  async #ingest(grp, ops) {
    const fresh = grp.ledger.add(ops);
    if (!fresh.length) return fresh;
    const base = grp.ledger.order.length - fresh.length;
    fresh.forEach((op) => this.clock.observe(op.c));
    await this.p.putOps(fresh.map((op, i) => ({ k: `${op.g}/${op.i}`, g: op.g, n: base + i, op })));
    for (const peer of this.peers) peer.push(grp.g, fresh.filter((op) => op.d === this.device.id));
    this.#notify();
    return fresh;
  }

  async #saveMeta(grp) {
    const { ledger, ...meta } = grp;
    await this.p.putKV('group:' + grp.g, meta);
  }

  /* ----- groups & members ----- */

  async createGroup({ name, type = 'other', emoji = '👥', color = 'indigo', currency, members = [], direct = false }) {
    const g = newId();
    const grp = { g, key: newGroupKey(), me: newId(), joinedAt: this.now(), shareMark: 0, ledger: new GroupLedger(g) };
    this.groups.set(g, grp);
    await this.#saveMeta(grp);
    await this.#write(g, 'group', g, {
      name: name.trim(), type, emoji, color, currency: currency || this.device.currency,
      simplify: true, whiteboard: '', direct, defaultSplit: null,
    });
    await this.#write(g, 'member', grp.me, {
      name: this.device.name, emoji: this.device.emoji, upi: this.device.upi || '',
      claimedBy: this.device.id, person: 'dev:' + this.device.id,
    });
    for (const m of members) await this.addMember(g, m);
    return g;
  }

  /** A 1:1 ledger with a friend, shown under "Non-group expenses". */
  async directWith(person) {
    for (const grp of this.groups.values()) {
      const st = grp.ledger.state;
      if (!st.group.direct || st.group.deleted) continue;
      const others = live(st, 'member').filter((m) => m.id !== this.meIn(grp.g));
      if (others.some((m) => this.personRoot(m) === person.key)) return grp.g;
    }
    return this.createGroup({ name: person.name, type: 'couple', emoji: person.emoji || '🙂', direct: true, members: [{ name: person.name, emoji: person.emoji, person: person.anyPersonId }] });
  }

  async addMember(g, { name, emoji = '🙂', person, upi = '' }) {
    const id = newId();
    await this.#write(g, 'member', id, { name: name.trim(), emoji, person: person || 'p:' + newId(8), upi, claimedBy: null, left: false });
    return id;
  }

  updateMember(g, id, fields) { return this.#write(g, 'member', id, fields); }
  setGroup(g, fields) { return this.#write(g, 'group', g, fields); }

  async removeMember(g, id) {
    const bal = groupBalances(this.state(g));
    const owes = Object.values(bal.net).some((n) => (n[id] || 0) !== 0);
    if (owes) throw new Error('Settle this person’s balance before removing them.');
    await this.#write(g, 'member', id, { left: true });
  }

  /** Leave: stop tracking the group on this phone. Others keep their copy. */
  async leaveGroup(g, { force = false } = {}) {
    const me = this.meIn(g);
    if (!force && me) {
      const bal = groupBalances(this.state(g));
      if (Object.values(bal.net).some((n) => (n[me] || 0) !== 0)) throw new Error('You can’t leave while you have an outstanding balance in this group.');
    }
    await this.p.deleteGroup(g);
    await this.p.delKV('group:' + g);
    this.groups.delete(g);
    this.#notify();
  }

  /** Delete for everyone: marks the group deleted; peers drop it on next sync. */
  async deleteGroup(g) {
    await this.#write(g, 'group', g, { deleted: true });
  }

  /* ----- expenses, payments, comments ----- */

  async saveExpense(g, id, { receipt, ...fields }) {
    const st = this.state(g);
    let repeatOn = false;
    if (!id) {
      id = newId();
      await this.#write(g, 'expense', id, { ...fields, createdBy: this.meIn(g), deleted: false });
      repeatOn = fields.repeat && fields.repeat !== 'off';
    } else {
      // Only write the fields that changed, so concurrent edits to other fields survive.
      const cur = st.expense.get(id) || {};
      const diff = {};
      for (const [k, v] of Object.entries(fields)) if (JSON.stringify(cur[k]) !== JSON.stringify(v)) diff[k] = v;
      if (Object.keys(diff).length) await this.#write(g, 'expense', id, diff);
      repeatOn = diff.repeat && diff.repeat !== 'off';
    }
    if (receipt !== undefined && (receipt || null) !== this.receiptOf(g, id)) await this.#write(g, 'receipt', id, { data: receipt || null });
    if (repeatOn) await this.catchUpRecurring();
    return id;
  }

  /** An expense's photo. Older expenses kept it inline; newer ones keep it in its own record. */
  receiptOf(g, id) {
    const st = this.state(g);
    const r = st?.receipt.get(id);
    return (r ? r.data : st?.expense.get(id)?.receipt) || null;
  }

  deleteEntity(g, type, id) { return this.#write(g, type, id, { deleted: true }); }
  restoreEntity(g, type, id) { return this.#write(g, type, id, { deleted: false }); }

  async recordPayment(g, { from, to, amount, currency, date, notes = '' }) {
    const id = newId();
    await this.#write(g, 'payment', id, { from, to, amount, currency, date: date || this.today(), notes, createdBy: this.meIn(g), deleted: false });
    return id;
  }

  async savePayment(g, id, fields) {
    await this.#write(g, 'payment', id, fields);
  }

  async addComment(g, expenseId, text) {
    const id = newId();
    await this.#write(g, 'comment', id, { on: expenseId, text: text.trim(), author: this.meIn(g), deleted: false });
    return id;
  }

  /**
   * Convert every debt in `from` to `to` at `rate` (1 from = rate to).
   * The rate and the converted amounts are stored, so every phone agrees.
   */
  async convertCurrency(g, from, to, rate) {
    const pw = pairwise(this.state(g));
    const scale = 10 ** (minorDigits(to) - minorDigits(from));
    const transfers = edges(pw[from]).map((e) => ({ debtor: e.debtor, creditor: e.creditor, fromAmount: e.amount, toAmount: Math.round(e.amount * rate * scale) }));
    if (!transfers.length) throw new Error(`Nothing is owed in ${from}.`);
    const id = newId();
    await this.#write(g, 'conversion', id, { from, to, rate, transfers, date: this.today(), createdBy: this.meIn(g), deleted: false });
    return id;
  }

  /** Create any recurring occurrences that have come due. */
  async catchUpRecurring() {
    const today = this.today();
    for (const grp of this.groups.values()) {
      const st = grp.ledger.state;
      for (const exp of live(st, 'expense')) {
        if (!exp.repeat || exp.repeat === 'off') continue;
        for (const date of dueDates(exp, today)) {
          const id = `${exp.id}@${date}`;
          if (st.expense.has(id)) continue;
          const v = { date, from: exp.id, createdBy: exp.createdBy, deleted: false };
          for (const k of COPIED_FIELDS) if (exp[k] !== undefined) v[k] = exp[k];
          // Deterministic stamp: earliest moment the date exists anywhere (UTC+14).
          const [y, m, d] = date.split('-').map(Number);
          await this.#write(grp.g, 'expense', id, v, { c: Date.UTC(y, m - 1, d) - 14 * 3600e3, w: '~recurring' });
        }
      }
    }
  }

  /* ----- reading ----- */

  state(g) { return this.groups.get(g)?.ledger.state; }

  today() {
    const d = new Date(this.now());
    return isoDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
  }

  /** My member id in a group (the member this phone claimed). */
  meIn(g) {
    const grp = this.groups.get(g);
    if (!grp) return null;
    if (grp.me && grp.ledger.state.member.get(grp.me)?.claimedBy === this.device?.id) return grp.me;
    for (const m of grp.ledger.state.member.values()) if (m.claimedBy === this.device?.id) return (grp.me = m.id);
    return grp.me || null;
  }

  liveGroups({ includeDirect = true } = {}) {
    return [...this.groups.values()]
      .filter((grp) => grp.ledger.state.group.name !== undefined && !grp.ledger.state.group.deleted)
      .filter((grp) => includeDirect || !grp.ledger.state.group.direct)
      .map((grp) => grp.g);
  }

  /** What to call a group on this phone. A one-to-one ledger is named after the other person. */
  groupName(g) {
    const st = this.state(g);
    if (!st) return 'Group';
    if (!st.group.direct) return st.group.name || 'Group';
    const me = this.meIn(g);
    const others = live(st, 'member').filter((m) => m.id !== me && !m.left);
    return others.map((m) => m.name).join(', ') || st.group.name || 'Friend';
  }

  members(g, { includeLeft = false } = {}) {
    const st = this.state(g);
    return live(st, 'member').filter((m) => includeLeft || !m.left).sort((a, b) => (a._created - b._created) || (a.id < b.id ? -1 : 1));
  }

  memberName(g, id, { you = true } = {}) {
    if (you && id === this.meIn(g)) return 'You';
    return this.state(g)?.member.get(id)?.name || 'Someone';
  }

  /* ----- people across groups (Friends) ----- */

  /** Union-find over person ids and device ids, so one friend is one row. */
  #people() {
    const parent = new Map();
    const find = (x) => {
      while (parent.get(x) && parent.get(x) !== x) x = parent.get(x);
      return x;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (!parent.has(ra)) parent.set(ra, ra);
      if (!parent.has(rb)) parent.set(rb, rb);
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    };
    for (const g of this.liveGroups()) {
      for (const m of live(this.state(g), 'member')) {
        const p = m.person || 'm:' + m.id;
        if (!parent.has(p)) parent.set(p, p);
        if (m.claimedBy) union(p, 'dev:' + m.claimedBy);
      }
    }
    return find;
  }

  personRoot(member) {
    const find = this.#people();
    return find(member.person || 'm:' + member.id);
  }

  /** Friends with their net balance and per-group breakdown. */
  friends() {
    const find = this.#people();
    const myRoot = find('dev:' + this.device.id);
    const map = new Map();
    for (const g of this.liveGroups()) {
      const st = this.state(g);
      const me = this.meIn(g);
      const view = personView(groupBalances(st), me);
      for (const m of live(st, 'member')) {
        const key = find(m.person || 'm:' + m.id);
        if (key === myRoot || m.id === me) continue;
        const f = map.get(key) || { key, name: m.name, emoji: m.emoji, upi: m.upi, anyPersonId: m.person, members: [], total: {}, breakdown: [] };
        f.members.push({ g, id: m.id });
        if (m.claimedBy) { f.name = m.name; f.emoji = m.emoji; f.upi = m.upi || f.upi; }
        for (const line of view.lines.filter((l) => l.other === m.id)) {
          f.total[line.currency] = (f.total[line.currency] || 0) + line.amount;
          f.breakdown.push({ g, ...line });
        }
        map.set(key, f);
      }
    }
    for (const f of map.values()) for (const k of Object.keys(f.total)) if (!f.total[k]) delete f.total[k];
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Overall net across everything, per currency. */
  overall() {
    const total = {};
    for (const g of this.liveGroups()) {
      const v = personView(groupBalances(this.state(g)), this.meIn(g));
      for (const [c, n] of Object.entries(v.total)) total[c] = (total[c] || 0) + n;
    }
    for (const k of Object.keys(total)) if (!total[k]) delete total[k];
    return total;
  }

  /** Everything that happened, newest first. */
  activity({ limit = 200, g: only } = {}) {
    const items = [];
    for (const g of only ? [only] : this.liveGroups()) {
      const st = this.state(g);
      for (const op of this.groups.get(g).ledger.allOps()) {
        if (op.w === '~recurring') continue;
        const ent = op.t === 'group' ? st.group : st[op.t].get(op.e);
        if (!ent) continue;
        items.push({ g, op, ent, kind: opKind(ent, op), mine: op.d === this.device.id, unread: op.d !== this.device.id && op.c > this.seen });
      }
    }
    return items.sort((a, b) => b.op.c - a.op.c).slice(0, limit);
  }

  unreadCount() {
    let n = 0;
    for (const g of this.liveGroups()) for (const op of this.groups.get(g).ledger.allOps()) if (op.d !== this.device.id && op.c > this.seen && op.w !== '~recurring') n++;
    return n;
  }

  search(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const out = [];
    for (const g of this.liveGroups()) {
      const st = this.state(g);
      for (const e of live(st, 'expense')) {
        const hay = [e.desc, e.notes, e.category, formatPlain(e.amount, e.currency), st.group.name, ...(e.split?.items || []).map((i) => i.name)].join(' ').toLowerCase();
        if (hay.includes(s)) out.push({ g, e });
      }
    }
    return out.sort((a, b) => (b.e.date || '').localeCompare(a.e.date || '') || b.e._created - a.e._created);
  }

  /* ----- sharing ----- */

  from() { return { device: this.device.id, name: this.device.name }; }

  /** What links carry: the whole history except receipt photos, which only travel phone to phone. */
  #linkOps(grp) {
    return grp.ledger.allOps().filter((op) => op.t !== 'receipt');
  }

  /**
   * The group link. There's one kind of link: whoever opens it joins the group
   * if they're new, or gets the latest changes if they're already in.
   * `claim` makes it a personal invite that sets the opener up as that member.
   */
  async shareLink(g, { claim = null } = {}) {
    const grp = this.groups.get(g);
    const count = this.unsharedCount(g);
    const link = await makeInvite({ groupId: g, key: grp.key, ops: this.#linkOps(grp), claim, from: this.from(), name: grp.ledger.state.group.name });
    grp.shareMark = grp.ledger.order.length;
    await this.#saveMeta(grp);
    return { link, count };
  }

  async inviteLink(g, claim) {
    return (await this.shareLink(g, { claim })).link;
  }

  /** Changes made here or received since this phone last shared the group link. */
  unsharedCount(g) {
    const grp = this.groups.get(g);
    return grp ? grp.ledger.since(grp.shareMark || 0).filter((op) => op.t !== 'receipt').length : 0;
  }

  /** Accepts an invite or update link (or any text containing one). */
  async importText(text) {
    const data = await readLink(text, (g) => this.groups.get(g)?.key);
    let grp = this.groups.get(data.groupId);
    const isNew = !grp;
    if (isNew) {
      grp = { g: data.groupId, key: data.key, me: null, joinedAt: this.now(), shareMark: 0, ledger: new GroupLedger(data.groupId) };
      this.groups.set(grp.g, grp);
      await this.#saveMeta(grp);
    }
    const added = await this.#ingest(grp, data.ops || []);
    // Ops we just received don't need to be shared back.
    if (isNew) { grp.shareMark = grp.ledger.order.length; await this.#saveMeta(grp); }
    if (data.kind === 'join' && !this.meIn(grp.g) && data.claim) {
      const m = grp.ledger.state.member.get(data.claim);
      if (m && !m.claimedBy) await this.claim(grp.g, data.claim);
    }
    await this.catchUpRecurring();
    return { kind: data.kind, g: grp.g, added: added.length, isNew, from: data.from, needsClaim: !this.meIn(grp.g) };
  }

  /** "That's me": link this phone to a placeholder member. */
  async claim(g, memberId) {
    const grp = this.groups.get(g);
    grp.me = memberId;
    await this.#saveMeta(grp);
    await this.#write(g, 'member', memberId, { claimedBy: this.device.id, emoji: this.device.emoji, upi: this.device.upi || '' });
  }

  /** Join as a new member rather than claiming a placeholder. */
  async joinAsNew(g) {
    const grp = this.groups.get(g);
    const id = newId();
    grp.me = id;
    await this.#saveMeta(grp);
    await this.#write(g, 'member', id, { name: this.device.name, emoji: this.device.emoji, upi: this.device.upi || '', claimedBy: this.device.id, person: 'dev:' + this.device.id, left: false });
  }

  /* ----- live peers ----- */

  peerHooks(onState) {
    return {
      summaries: () => this.liveGroups().map((g) => ({ g, key: this.groups.get(g).key, summary: this.groups.get(g).ledger.summary() })),
      missing: (g, summary) => this.groups.get(g)?.ledger.missingFor(summary) || [],
      receive: async (g, ops) => {
        const grp = this.groups.get(g);
        if (grp) await this.#ingest(grp, ops);
      },
      onState,
    };
  }

  addPeer(peer) { this.peers.add(peer); }
  removePeer(peer) { this.peers.delete(peer); }

  /* ----- export & backup ----- */

  exportCSV(g) {
    const st = this.state(g);
    const mem = this.members(g, { includeLeft: true });
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Description', 'Category', 'Cost', 'Currency', ...mem.map((m) => m.name)]];
    const lines = [];
    for (const e of live(st, 'expense')) {
      const parts = expenseParts(e);
      if (!parts) continue;
      lines.push({ date: e.date, cells: [e.date, e.desc, e.category || 'general', formatPlain(e.amount, e.currency), e.currency, ...mem.map((m) => formatPlain((parts.paid[m.id] || 0) - (parts.owed[m.id] || 0), e.currency))] });
    }
    for (const p of live(st, 'payment')) {
      lines.push({ date: p.date, cells: [p.date, `${st.member.get(p.from)?.name} paid ${st.member.get(p.to)?.name}`, 'Payment', formatPlain(p.amount, p.currency), p.currency, ...mem.map((m) => formatPlain(m.id === p.from ? p.amount : m.id === p.to ? -p.amount : 0, p.currency))] });
    }
    lines.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const bal = groupBalances(st);
    const out = [...rows, ...lines.map((l) => l.cells)];
    for (const [cur, net] of Object.entries(bal.net)) out.push(['', 'Total balance', '', '', cur, ...mem.map((m) => formatPlain(net[m.id] || 0, cur))]);
    return out.map((r) => r.map(q).join(',')).join('\r\n');
  }

  backup() {
    return {
      evenly: 1,
      exportedAt: new Date(this.now()).toISOString(),
      device: this.device,
      settings: { theme: this.settings.theme },
      groups: [...this.groups.values()].map(({ ledger, ...meta }) => ({ meta, ops: ledger.allOps() })),
    };
  }

  async restore(data) {
    if (data?.evenly !== 1) throw new Error('That isn’t an Evenly backup.');
    if (!this.device && data.device) { this.device = data.device; await this.p.putKV('device', this.device); }
    let added = 0;
    for (const { meta, ops } of data.groups || []) {
      let grp = this.groups.get(meta.g);
      if (!grp) {
        grp = { ...meta, ledger: new GroupLedger(meta.g) };
        this.groups.set(meta.g, grp);
        await this.#saveMeta(grp);
      }
      added += (await this.#ingest(grp, ops)).length;
    }
    this.#notify();
    return added;
  }

  async wipe() {
    await this.p.wipe();
    this.groups.clear();
    this.device = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.#notify();
  }
}
