// Expense detail, the add/edit form with all split modes, its pickers, and
// on-device receipt scanning.

import { html, raw, toast, fmtDate, relativeTime, loadScript } from '../ui/dom.js';
import { icon, groupTile, avatar, catIcon, category, CATEGORIES, guessCategory, segmented, nl2br } from '../ui/kit.js';
import { haptic } from '../ui/motion.js';
import { confirmAction } from '../ui/menu.js';
import { formatMoney, formatPlain, parseAmount, allCurrencies, currencyName, currencySymbol, COMMON_CURRENCIES } from '../core/money.js';
import { computeShares, checkPayers, SPLIT_MODES } from '../core/split.js';
import { REPEATS, nextDue } from '../core/recurring.js';
import { parseReceipt } from '../core/receipt.js';
import { live } from '../core/ledger.js';
import { app } from '../app/app.js';
import { historyLine, actorName } from './describe.js';
import { deleteWithUndo } from './group.js';

const fmt = formatMoney;

/* ---------------- Expense detail ---------------- */

export class ExpenseScreen {
  constructor(g, id) { this.g = g; this.id = id; this.comment = ''; }
  get e() { return app.store.state(this.g)?.expense.get(this.id); }
  title() { return this.e?.desc || 'Expense'; }
  actions() {
    if (!this.e || this.e.deleted) return '';
    return html`<button class="nav-btn" data-act="del" aria-label="Delete">${icon('trash')}</button>
      <button class="nav-btn text bold" data-act="edit">Edit</button>`;
  }
  accessory() {
    if (!this.e) return '';
    return html`<form class="composer glass"><input data-field="comment" placeholder="Add a comment" value="${this.comment}" enterkeyhint="send" aria-label="Add a comment">
      <button class="send" data-act="send" aria-label="Send">${icon('arrow')}</button></form>`;
  }
  afterRender(page) {
    const f = page.querySelector('.composer');
    if (f && !f.__wired) { f.__wired = true; f.addEventListener('submit', (ev) => { ev.preventDefault(); this.on.send.call(this); }); }
  }
  body() {
    const store = app.store;
    const e = this.e;
    if (!e) return html`<p class="empty-note">This expense isn’t on this phone.</p>`;
    const st = store.state(this.g);
    const me = store.meIn(this.g);
    const res = computeShares(e.amount, e.split);
    const owed = res.shares || {};
    const paid = e.paidBy || {};
    const people = [...new Set([...Object.keys(paid).filter((k) => paid[k]), ...Object.keys(owed)])];
    const comments = live(st, 'comment').filter((c) => c.on === this.id).sort((a, b) => a._created - b._created);
    const ops = e._ops;
    const next = e.repeat && e.repeat !== 'off' ? nextDue(e, store.today()) : null;
    const source = e.from ? st.expense.get(e.from) : null;
    return html`
      ${e.deleted ? html`<div class="banner tint-red"><span>This expense was deleted.</span><button class="btn btn-small" data-act="restore">Restore</button></div>` : ''}
      <div class="hero expense-hero">
        <button class="cat-btn" data-act="edit" aria-label="Category: ${category(e.category).label}">${catIcon(e.category, 'xl')}</button>
        <h2>${e.desc}</h2>
        <p class="hero-amount num">${fmt(e.amount, e.currency)}</p>
        <p class="hero-meta">${fmtDate(e.date)} · ${st.group.direct ? 'Non-group' : st.group.name}</p>
        <p class="hero-meta">Added by ${actorName(this.g, ops[0].w === '~recurring' ? '~recurring' : ops[0].d)} ${relativeTime(ops[0].c, store.now())}${ops.length > 1 ? html`<br>Last updated by ${actorName(this.g, ops[ops.length - 1].d)} ${relativeTime(ops[ops.length - 1].c, store.now())}` : ''}</p>
        ${next ? html`<p class="pill-note">${icon('repeat')} Repeats ${REPEATS.find((r) => r.id === e.repeat).label.toLowerCase()} · next on ${fmtDate(next)}</p>` : ''}
        ${source ? html`<button class="pill-note link" data-act="source">${icon('repeat')} From a repeating expense</button>` : ''}
      </div>
      ${e.receipt ? html`<button class="receipt-thumb" data-act="receipt" aria-label="View receipt"><img src="${e.receipt}" alt="Receipt photo"></button>` : ''}
      ${!res.ok ? html`<div class="banner tint-orange"><span>${res.error}. Edit the split so balances include this expense.</span></div>` : ''}
      <h3 class="section-header">Who paid and who owes</h3>
      <div class="list">
        ${people.map((id) => {
          const p = paid[id] || 0;
          const o = owed[id] || 0;
          const m = st.member.get(id);
          const name = id === me ? 'You' : m?.name || 'Someone';
          return html`<div class="cell"><span class="cell-leading">${avatar(m || { name, id })}</span>
            <span class="cell-main"><span class="cell-title">${name}</span>
              <span class="cell-sub">${p ? `paid ${fmt(p, e.currency)}` : ''}${p && o ? ' · ' : ''}${o ? `${id === me ? 'owe' : 'owes'} ${fmt(o, e.currency)}` : ''}</span></span>
            <span class="cell-trailing">${p - o ? html`<span class="num ${p - o > 0 ? 'pos' : 'neg'}">${p - o > 0 ? '+' : '−'}${fmt(Math.abs(p - o), e.currency)}</span>` : ''}</span></div>`;
        })}
      </div>
      <p class="section-footer">${splitSentence(e)}</p>
      ${e.split?.mode === 'items' ? html`<h3 class="section-header">Items</h3><div class="list">${(e.split.items || []).map((it) => html`<div class="cell"><span class="cell-main"><span class="cell-title">${it.name || 'Item'}</span><span class="cell-sub">${(it.people || []).map((id) => store.memberName(this.g, id)).join(', ')}</span></span><span class="cell-trailing num">${fmt(it.amount, e.currency)}</span></div>`)}
        ${res.extra ? html`<div class="cell"><span class="cell-main"><span class="cell-title">Tax, tip & service</span><span class="cell-sub">Shared in proportion to items</span></span><span class="cell-trailing num">${fmt(res.extra, e.currency)}</span></div>` : ''}</div>` : ''}
      ${e.notes ? html`<h3 class="section-header">Notes</h3><div class="card notes">${nl2br(e.notes)}</div>` : ''}
      <h3 class="section-header">Comments</h3>
      ${comments.length ? html`<div class="comments">${comments.map((c) => {
        const author = st.member.get(c.author);
        return html`<div class="comment ${c.author === me ? 'mine' : ''}">${avatar(author || { name: '?' }, 'sm')}
          <div class="bubble"><span class="c-name">${c.author === me ? 'You' : author?.name || 'Someone'} · ${relativeTime(c._created, store.now())}</span><p>${c.text}</p></div></div>`;
      })}</div>` : html`<p class="empty-note small">No comments yet.</p>`}
      <h3 class="section-header">History</h3>
      <div class="list history">${ops.map((op, i) => html`<div class="cell"><span class="cell-main"><span class="cell-text">${historyLine(this.g, e, op, i)}</span><span class="cell-meta">${new Date(op.c).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></span></div>`)}</div>
      <div class="bottom-space"></div>`;
  }
  onInput(f, el) { if (f === 'comment') this.comment = el.value; }
  on = {
    edit() { app.present(new ExpenseForm({ g: this.g, id: this.id })); },
    async del() {
      await deleteWithUndo(this.g, 'expense', this.id);
    },
    async restore() { await app.store.restoreEntity(this.g, 'expense', this.id); haptic('success'); },
    receipt() { app.present(new ReceiptViewer(this.e.receipt)); },
    source() { app.show(new ExpenseScreen(this.g, this.e.from), this); },
    async send() {
      const text = this.comment.trim();
      if (!text) return;
      this.comment = '';
      const input = this.page.querySelector('[data-field="comment"]');
      if (input) { input.value = ''; input.blur(); }
      await app.store.addComment(this.g, this.id, text);
      haptic();
    },
  };
}

function splitSentence(e) {
  const mode = e.split?.mode || 'equal';
  return {
    equal: 'Split equally.',
    exact: 'Split by exact amounts.',
    percent: 'Split by percentages.',
    shares: 'Split by shares.',
    adjust: 'Split equally after adjustments.',
    items: 'Split item by item; tax and tip shared in proportion.',
  }[mode];
}

class ReceiptViewer {
  constructor(src) { this.src = src; this.title = 'Receipt'; }
  leading() { return html`<button class="nav-btn text bold" data-act="close">Done</button>`; }
  body() { return html`<div class="receipt-full"><img src="${this.src}" alt="Receipt photo"></div>`; }
  on = { close() { this.sheet.close(); } };
}

/* ---------------- Add / edit form ---------------- */

function defaultsFor(g) {
  const store = app.store;
  const me = store.meIn(g);
  const members = store.members(g).map((m) => m.id);
  const ds = store.state(g).group.defaultSplit;
  const payer = ds && ds.payer && ds.payer !== 'adder' && members.includes(ds.payer) ? ds.payer : me || members[0];
  let split = { mode: 'equal', members: [...members], values: {}, items: [] };
  if (ds?.split?.mode === 'percent' || ds?.split?.mode === 'shares') {
    split = { mode: ds.split.mode, members: [...members], values: { ...ds.split.values }, items: [] };
  }
  return { payer, split };
}

export class ExpenseForm {
  constructor({ g = null, id = null, prefill = null } = {}) {
    const store = app.store;
    this.editing = id;
    this.title = id ? 'Edit expense' : 'Add expense';
    this.modalLock = false;
    if (id) {
      const e = store.state(g).expense.get(id);
      const payers = Object.keys(e.paidBy || {}).filter((k) => e.paidBy[k]);
      this.d = {
        g, desc: e.desc, amountText: formatPlain(e.amount, e.currency), currency: e.currency, category: e.category || 'general', catManual: true,
        date: e.date, repeat: e.repeat || 'off', notes: e.notes || '', receipt: e.receipt || null,
        payer: payers.length === 1 ? payers[0] : 'multi',
        multi: Object.fromEntries(payers.map((k) => [k, formatPlain(e.paidBy[k], e.currency)])),
        split: { mode: e.split?.mode || 'equal', members: [...(e.split?.members || Object.keys(e.split?.values || {}))], values: { ...(e.split?.values || {}) }, items: structuredClone(e.split?.items || []) },
        texts: {},
      };
      // Money values in the split are stored in minor units; show them as text.
      if (['exact', 'adjust'].includes(this.d.split.mode)) for (const [k, v] of Object.entries(this.d.split.values)) this.d.texts[k] = formatPlain(v, e.currency);
      for (const it of this.d.split.items) it.amountText = formatPlain(it.amount, e.currency);
      if (this.d.split.mode === 'items') this.d.split.extraText = formatPlain(e.amount - this.d.split.items.reduce((a, it) => a + it.amount, 0), e.currency);
    } else {
      this.d = { g: null, desc: '', amountText: '', currency: store.device.currency, category: 'general', catManual: false, date: store.today(), repeat: 'off', notes: '', receipt: null, payer: null, multi: {}, split: { mode: 'equal', members: [], values: {}, items: [] }, texts: {} };
      const first = g || (store.liveGroups().length === 1 ? store.liveGroups()[0] : null);
      if (first) this.setGroup(first);
      if (prefill) Object.assign(this.d, prefill, prefill.split ? { split: { ...this.d.split, ...prefill.split } } : {});
    }
  }

  setGroup(g) {
    const store = app.store;
    const st = store.state(g);
    this.d.g = g;
    if (!this.editing) this.d.currency = this.d.amountText ? this.d.currency : st.group.currency || store.device.currency;
    const { payer, split } = defaultsFor(g);
    this.d.payer = payer;
    this.d.multi = {};
    this.d.split = split;
    this.d.texts = {};
  }

  get amount() {
    const v = parseAmount(this.d.amountText, this.d.currency);
    return Number.isFinite(v) ? v : 0;
  }

  /** The split as stored: money in minor units. */
  builtSplit() {
    const d = this.d;
    const s = { mode: d.split.mode };
    if (s.mode === 'equal') s.members = [...d.split.members];
    else if (s.mode === 'exact' || s.mode === 'adjust') {
      s.values = {};
      for (const [k, t] of Object.entries(d.texts)) { const v = parseAmount(t, d.currency); if (Number.isFinite(v) && v) s.values[k] = v; }
      if (s.mode === 'adjust') s.members = [...d.split.members];
    } else if (s.mode === 'percent' || s.mode === 'shares') {
      s.values = {};
      for (const [k, v] of Object.entries(d.split.values)) if (Number(v) > 0) s.values[k] = Number(v);
    } else if (s.mode === 'items') {
      s.items = d.split.items.map((it) => ({ name: it.name || '', amount: Number.isFinite(parseAmount(it.amountText, d.currency)) ? parseAmount(it.amountText, d.currency) : 0, people: [...(it.people || [])] })).filter((it) => it.amount);
    }
    return s;
  }

  builtPaidBy() {
    const d = this.d;
    if (d.payer !== 'multi') return d.payer ? { [d.payer]: this.amount } : {};
    const out = {};
    for (const [k, t] of Object.entries(d.multi)) { const v = parseAmount(t, d.currency); if (Number.isFinite(v) && v) out[k] = v; }
    return out;
  }

  validate() {
    const d = this.d;
    if (!d.g) return { ok: false, msg: 'Choose a group or a friend' };
    if (!d.desc.trim()) return { ok: false, msg: 'Add a description' };
    if (this.amount <= 0) return { ok: false, msg: 'Enter an amount' };
    const pay = checkPayers(this.amount, this.builtPaidBy());
    if (!pay.ok) return { ok: false, msg: pay.remaining ? `Payments are ${pay.remaining > 0 ? 'short by' : 'over by'} ${fmt(Math.abs(pay.remaining), d.currency)}` : 'Choose who paid' };
    const res = computeShares(this.amount, this.builtSplit());
    if (!res.ok) return { ok: false, msg: res.error, res };
    return { ok: true, res };
  }

  leading() { return html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  actions() { return html`<button class="nav-btn text bold" data-act="save">Save</button>`; }

  body() {
    const store = app.store;
    const d = this.d;
    const st = d.g && store.state(d.g);
    const v = this.validate();
    const payerLabel = !d.g ? '—' : d.payer === 'multi' ? 'Multiple people' : store.memberName(d.g, d.payer);
    const splitLabel = !d.g ? '—' : splitSummary(this);
    return html`
      <button class="cell tappable with-row" data-act="pickGroup">
        <span class="cell-label">With</span>
        ${st ? html`<span class="cell-leading">${groupTile(st.group, 'sm')}</span><span class="cell-main"><span class="cell-title">${st.group.direct ? `${store.members(d.g).filter((m) => m.id !== store.meIn(d.g)).map((m) => m.name).join(', ')} (non-group)` : st.group.name}</span><span class="cell-sub">${store.members(d.g).length} people</span></span>`
          : html`<span class="cell-main"><span class="cell-title accent-text">Choose a group or friend</span></span>`}
      </button>

      <div class="card entry-card">
        <div class="entry-row">
          <button class="cat-btn" data-act="pickCategory" aria-label="Category: ${category(d.category).label}">${catIcon(d.category, 'lg')}</button>
          <input class="desc-input" data-field="desc" placeholder="Description" value="${d.desc}" ${this.editing ? '' : raw('autofocus')} autocomplete="off" enterkeyhint="next" aria-label="Description">
        </div>
        <div class="entry-row">
          <button class="cur-btn" data-act="pickCurrency" aria-label="Currency: ${d.currency}">${currencySymbol(d.currency)}</button>
          <input class="amount-input num" data-field="amount" placeholder="0.00" value="${d.amountText}" inputmode="decimal" autocomplete="off" aria-label="Amount" ${d.split.mode === 'items' ? raw('readonly') : ''}>
        </div>
        ${d.split.mode === 'items' ? html`<p class="entry-note">The total comes from the items. Edit them under Split.</p>` : ''}
      </div>

      <div class="list">
        <button class="cell tappable" data-act="pickPayer" ${d.g ? '' : raw('disabled')}><span class="cell-label">Paid by</span><span class="cell-main"><span class="cell-title">${payerLabel}</span></span></button>
        <button class="cell tappable" data-act="pickSplit" ${d.g ? '' : raw('disabled')}><span class="cell-label">Split</span><span class="cell-main"><span class="cell-title">${splitLabel}</span></span></button>
      </div>
      <p class="section-footer form-status ${v.ok ? '' : 'neg'}">${this.#status(v)}</p>

      <div class="list">
        <label class="cell"><span class="cell-label">Date</span><span class="cell-main"><input type="date" class="inline" data-field="date" value="${d.date}" max="9999-12-31"></span></label>
        <button class="cell tappable" data-act="pickRepeat"><span class="cell-label">Repeat</span><span class="cell-main"><span class="cell-title">${REPEATS.find((r) => r.id === d.repeat)?.label || 'Never'}</span></span></button>
        <label class="cell top"><span class="cell-label">Notes</span><span class="cell-main"><textarea class="inline" data-field="notes" rows="2" placeholder="Optional">${d.notes}</textarea></span></label>
      </div>

      <div class="list">
        ${d.receipt ? html`<div class="cell"><span class="cell-leading"><img class="mini-receipt" src="${d.receipt}" alt="Receipt"></span><span class="cell-main"><span class="cell-title">Receipt attached</span></span>
          <button class="nav-btn" data-act="removeReceipt" aria-label="Remove receipt">${icon('close')}</button></div>`
          : html`<label class="cell tappable"><span class="cell-leading"><span class="sq tint-gray">${icon('camera')}</span></span><span class="cell-main"><span class="cell-title accent-text">Attach a photo</span></span>
            <input type="file" accept="image/*" class="visually-hidden" data-field="photo"></label>`}
        <button class="cell tappable" data-act="scan" ${d.g ? '' : raw('disabled')}><span class="cell-leading"><span class="sq tint-purple">${icon('scan')}</span></span><span class="cell-main"><span class="cell-title accent-text">Scan a receipt to itemize</span><span class="cell-sub">Reads it on this phone. The photo isn’t uploaded.</span></span></button>
      </div>
      ${this.editing ? html`<div class="list"><button class="cell tappable destructive-cell" data-act="delete"><span class="cell-main"><span class="cell-title center">Delete expense</span></span></button></div>` : ''}
      <div class="bottom-space small"></div>`;
  }

  #status(v) {
    const d = this.d;
    if (!v.ok) return v.msg;
    const shares = Object.values(v.res.shares);
    const n = shares.length;
    if (d.split.mode === 'equal' && n) return `${fmt(Math.max(...shares), d.currency)} per person (${n} ${n === 1 ? 'person' : 'people'})`;
    return 'Everything adds up.';
  }

  #refreshStatus() {
    const el = this.page?.querySelector('.form-status');
    if (!el) return;
    const v = this.validate();
    el.textContent = this.#status(v);
    el.classList.toggle('neg', !v.ok);
  }

  onInput(f, el) {
    const d = this.d;
    if (f === 'desc') {
      d.desc = el.value;
      if (!d.catManual) {
        const guess = guessCategory(d.desc) || 'general';
        if (guess !== d.category) {
          d.category = guess;
          const b = this.page.querySelector('.cat-btn');
          if (b) b.innerHTML = String(catIcon(guess, 'lg'));
        }
      }
    }
    if (f === 'amount') d.amountText = el.value;
    if (f === 'notes') d.notes = el.value;
    if (f === 'date') d.date = el.value;
    this.#refreshStatus();
  }

  async onChange(f, el) {
    if (f === 'date') this.d.date = el.value || app.store.today();
    if (f === 'photo' && el.files?.[0]) {
      try {
        this.d.receipt = await compressImage(el.files[0], 900, 0.72);
        this.nav.refresh(this);
      } catch { toast('Couldn’t read that photo'); }
    }
  }

  on = {
    cancel() { this.sheet.close(); },
    pickGroup() { this.nav.push(new GroupPicker(this)); },
    pickCategory() { this.nav.push(new CategoryPicker(this)); },
    pickCurrency() { this.nav.push(new CurrencyPicker(this)); },
    pickPayer() { this.nav.push(new PaidByScreen(this)); },
    pickSplit() { this.nav.push(new SplitScreen(this)); },
    pickRepeat() { this.nav.push(new RepeatPicker(this)); },
    scan() { this.nav.push(new ScanScreen({ g: this.d.g, form: this })); },
    removeReceipt() { this.d.receipt = null; this.nav.refresh(this); },
    async delete() {
      const ok = await confirmAction({ title: 'Delete this expense?', message: 'You can restore it from the expense afterwards.', confirm: 'Delete expense' });
      if (!ok) return;
      await app.store.deleteEntity(this.d.g, 'expense', this.editing);
      this.sheet.close();
    },
    async save() {
      const v = this.validate();
      if (!v.ok) {
        haptic('warning');
        const st = this.page.querySelector('.form-status');
        st?.classList.remove('shake');
        void st?.offsetWidth;
        st?.classList.add('shake');
        return toast(v.msg);
      }
      const d = this.d;
      const fields = {
        desc: d.desc.trim(), amount: this.amount, currency: d.currency, category: d.category, date: d.date || app.store.today(),
        repeat: d.repeat, notes: d.notes.trim(), receipt: d.receipt || null, paidBy: this.builtPaidBy(), split: this.builtSplit(),
      };
      const id = await app.store.saveExpense(d.g, this.editing, fields);
      haptic('success');
      this.sheet.close();
      if (!this.editing) {
        toast('Expense added', { action: { label: 'Share', run: () => app.shareUpdates(d.g) } });
        app.afterAdd?.(d.g, id);
      }
    },
  };
}

function splitSummary(form) {
  const d = form.d;
  const n = d.split.mode === 'equal' ? d.split.members.length : 0;
  const all = app.store.members(d.g).length;
  switch (d.split.mode) {
    case 'equal': return n === all ? 'Equally between everyone' : `Equally between ${n}`;
    case 'exact': return 'By exact amounts';
    case 'percent': return 'By percentages';
    case 'shares': return 'By shares';
    case 'adjust': return 'Equally, with adjustments';
    case 'items': return `Itemized · ${d.split.items.length} item${d.split.items.length === 1 ? '' : 's'}`;
    default: return 'Equally';
  }
}

/* ---------------- Pickers ---------------- */

class GroupPicker {
  constructor(form) { this.form = form; this.title = 'With'; }
  body() {
    const store = app.store;
    const groups = store.liveGroups({ includeDirect: false });
    const friends = store.friends();
    return html`
      <h3 class="section-header">Groups</h3>
      <div class="list">${groups.length ? groups.map((g) => html`<button class="cell tappable" data-act="group" data-g="${g}"><span class="cell-leading">${groupTile(store.state(g).group)}</span><span class="cell-main"><span class="cell-title">${store.state(g).group.name}</span></span>${g === this.form.d.g ? html`<span class="cell-trailing tint-text">${icon('check')}</span>` : ''}</button>`) : html`<div class="cell"><span class="cell-main muted">No groups yet</span></div>`}</div>
      ${friends.length ? html`<h3 class="section-header">Just with a friend (non-group)</h3>
      <div class="list">${friends.map((f) => html`<button class="cell tappable" data-act="friend" data-key="${f.key}"><span class="cell-leading">${avatar({ ...f, id: f.key })}</span><span class="cell-main"><span class="cell-title">${f.name}</span></span></button>`)}</div>` : ''}`;
  }
  on = {
    group(el) { this.form.setGroup(el.dataset.g); this.nav.pop(); },
    async friend(el) {
      const f = app.store.friends().find((x) => x.key === el.dataset.key);
      const g = await app.store.directWith(f);
      this.form.setGroup(g);
      this.nav.pop();
    },
  };
}

class CategoryPicker {
  constructor(form) { this.form = form; this.title = 'Category'; this.q = ''; }
  body() {
    return html`<div class="searchbar"><span class="sb-icon">${icon('search')}</span><input type="search" data-field="q" placeholder="Search categories" value="${this.q}"></div>
      <div class="cat-results">${this.#list()}</div>`;
  }
  #list() {
    const q = this.q.trim().toLowerCase();
    return html`${CATEGORIES.map((g) => {
      const items = g.items.filter(([, label]) => !q || label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q));
      if (!items.length) return '';
      return html`<h3 class="section-header">${g.label}</h3><div class="list">${items.map(([id, label]) => {
        const full = g.id === 'general' ? 'general' : `${g.id}.${id}`;
        return html`<button class="cell tappable" data-act="pick" data-id="${full}"><span class="cell-leading">${catIcon(full)}</span><span class="cell-main"><span class="cell-title">${label}</span></span>${full === this.form.d.category ? html`<span class="cell-trailing tint-text">${icon('check')}</span>` : ''}</button>`;
      })}</div>`;
    })}`;
  }
  onInput(f, el) { this.q = el.value; this.page.querySelector('.cat-results').innerHTML = String(this.#list()); }
  on = { pick(el) { this.form.d.category = el.dataset.id; this.form.d.catManual = true; haptic(); this.nav.pop(); } };
}

class CurrencyPicker {
  constructor(form) { this.form = form; this.title = 'Currency'; this.q = ''; }
  body() {
    return html`<div class="searchbar"><span class="sb-icon">${icon('search')}</span><input type="search" data-field="q" placeholder="Search currencies" value="${this.q}"></div>
      <div class="cur-results">${this.#list()}</div>`;
  }
  #list() {
    const q = this.q.trim().toLowerCase();
    const all = allCurrencies().filter((c) => !q || c.toLowerCase().includes(q) || currencyName(c).toLowerCase().includes(q));
    const common = all.filter((c) => COMMON_CURRENCIES.slice(0, 10).includes(c));
    const rest = all.filter((c) => !common.includes(c));
    const row = (c) => html`<button class="cell tappable" data-act="pick" data-c="${c}"><span class="cell-leading"><span class="cur-badge">${currencySymbol(c)}</span></span><span class="cell-main"><span class="cell-title">${currencyName(c)}</span><span class="cell-sub">${c}</span></span>${c === this.form.d.currency ? html`<span class="cell-trailing tint-text">${icon('check')}</span>` : ''}</button>`;
    return html`${common.length ? html`<h3 class="section-header">Common</h3><div class="list">${common.map(row)}</div>` : ''}
      ${rest.length ? html`<h3 class="section-header">All currencies</h3><div class="list">${rest.map(row)}</div>` : ''}`;
  }
  onInput(f, el) { this.q = el.value; this.page.querySelector('.cur-results').innerHTML = String(this.#list()); }
  on = {
    pick(el) {
      this.form.d.currency = el.dataset.c; // typed amounts are text, so they carry over as typed
      haptic();
      this.nav.pop();
    },
  };
}

class RepeatPicker {
  constructor(form) { this.form = form; this.title = 'Repeat'; }
  body() {
    return html`<div class="list">${REPEATS.map((r) => html`<button class="cell tappable" data-act="pick" data-id="${r.id}"><span class="cell-main"><span class="cell-title">${r.label}</span></span>${r.id === this.form.d.repeat ? html`<span class="cell-trailing tint-text">${icon('check')}</span>` : ''}</button>`)}</div>
      <p class="section-footer">Evenly adds the next copy on its due date, on whichever phone opens first. Copies made on two phones merge into one.</p>`;
  }
  on = { pick(el) { this.form.d.repeat = el.dataset.id; this.nav.pop(); } };
}

class PaidByScreen {
  constructor(form) { this.form = form; this.title = 'Who paid?'; }
  body() {
    const d = this.form.d;
    const members = app.store.members(d.g);
    const multi = d.payer === 'multi';
    return html`
      <div class="center-row">${segmented('mode', [{ id: 'one', label: 'One person' }, { id: 'multi', label: 'Multiple people' }], multi ? 'multi' : 'one')}</div>
      ${!multi ? html`<div class="list">${members.map((m) => html`<button class="cell tappable" data-act="pick" data-id="${m.id}"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.id === app.store.meIn(d.g) ? `${m.name} (you)` : m.name}</span></span>${d.payer === m.id ? html`<span class="cell-trailing tint-text">${icon('check')}</span>` : ''}</button>`)}</div>`
      : html`<div class="list">${members.map((m) => html`<label class="cell"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span></span>
          <span class="cell-trailing"><span class="muted">${currencySymbol(d.currency)}</span><input class="num-input" inputmode="decimal" data-field="m:${m.id}" value="${d.multi[m.id] || ''}" placeholder="0.00"></span></label>`)}</div>
        <p class="section-footer paid-status">${this.#status()}</p>`}`;
  }
  #status() {
    const f = this.form;
    const r = checkPayers(f.amount, f.builtPaidBy()).remaining;
    return r === 0 ? `${fmt(f.amount, f.d.currency)} of ${fmt(f.amount, f.d.currency)} ✓` : `${fmt(f.amount - r, f.d.currency)} of ${fmt(f.amount, f.d.currency)} · ${fmt(Math.abs(r), f.d.currency)} ${r > 0 ? 'left' : 'over'}`;
  }
  onInput(f, el) {
    if (f.startsWith('m:')) {
      this.form.d.multi[f.slice(2)] = el.value;
      const s = this.page.querySelector('.paid-status');
      if (s) s.textContent = this.#status();
    }
  }
  on = {
    seg(el) {
      const d = this.form.d;
      if (el.dataset.value === 'multi') { d.payer = 'multi'; }
      else d.payer = app.store.meIn(d.g) || app.store.members(d.g)[0].id;
      this.nav.refresh(this);
    },
    pick(el) { this.form.d.payer = el.dataset.id; haptic(); this.nav.pop(); },
  };
}

class SplitScreen {
  constructor(form) { this.form = form; this.title = 'Split'; }
  actions() { return html`<button class="nav-btn text bold" data-act="done">Done</button>`; }
  body() {
    const d = this.form.d;
    const modes = SPLIT_MODES.map((m) => ({ id: m.id, label: m.short }));
    return html`
      <div class="center-row">${segmented('mode', modes, d.split.mode)}</div>
      <p class="mode-title">${SPLIT_MODES.find((m) => m.id === d.split.mode).label}</p>
      <p class="mode-help">${HELP[d.split.mode]}</p>
      <div class="split-body">${this.#modeBody()}</div>
      <div class="split-status-bar glass"><span class="split-status">${this.#status()}</span></div>
      <div class="bottom-space"></div>`;
  }
  #modeBody() {
    const f = this.form;
    const d = f.d;
    const members = app.store.members(d.g);
    const sym = currencySymbol(d.currency);
    const preview = computeShares(f.amount, f.builtSplit()).shares || {};
    const share = (id) => html`<span class="share-preview num">${preview[id] ? fmt(preview[id], d.currency) : ''}</span>`;
    switch (d.split.mode) {
      case 'equal': {
        const all = members.every((m) => d.split.members.includes(m.id));
        return html`<div class="list">${members.map((m) => {
          const on = d.split.members.includes(m.id);
          return html`<button class="cell tappable" data-act="toggleMember" data-id="${m.id}" role="checkbox" aria-checked="${String(on)}"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span>${share(m.id)}</span><span class="cell-trailing"><span class="check ${on ? 'on' : ''}">${on ? icon('check') : ''}</span></span></button>`;
        })}</div><button class="btn btn-plain" data-act="all">${all ? 'Select none' : 'Select everyone'}</button>`;
      }
      case 'exact':
        return html`<div class="list">${members.map((m) => html`<label class="cell"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span></span><span class="cell-trailing"><span class="muted">${sym}</span><input class="num-input" inputmode="decimal" data-field="t:${m.id}" value="${d.texts[m.id] || ''}" placeholder="0.00"></span></label>`)}</div>`;
      case 'percent':
      case 'shares':
        return html`<div class="list">${members.map((m) => html`<label class="cell"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span>${share(m.id)}</span><span class="cell-trailing"><input class="num-input" inputmode="decimal" data-field="v:${m.id}" value="${d.split.values[m.id] ?? ''}" placeholder="0"><span class="muted">${d.split.mode === 'percent' ? '%' : 'shares'}</span></span></label>`)}</div>`;
      case 'adjust':
        return html`<div class="list">${members.map((m) => {
          const on = d.split.members.includes(m.id);
          return html`<div class="cell"><button class="check-btn" data-act="toggleMember" data-id="${m.id}" role="checkbox" aria-checked="${String(on)}" aria-label="Include ${m.name}"><span class="check ${on ? 'on' : ''}">${on ? icon('check') : ''}</span></button>
            <span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span>${share(m.id)}</span>
            <span class="cell-trailing"><span class="muted">+${sym}</span><input class="num-input" inputmode="decimal" data-field="t:${m.id}" value="${d.texts[m.id] || ''}" placeholder="0.00" ${on ? '' : raw('disabled')}></span></div>`;
        })}</div>`;
      case 'items':
        return html`${d.split.items.map((it, i) => html`<div class="card item-card">
            <div class="item-head"><input class="inline item-name" data-field="in:${i}" value="${it.name || ''}" placeholder="Item name">
              <span class="muted">${sym}</span><input class="num-input" inputmode="decimal" data-field="ia:${i}" value="${it.amountText || ''}" placeholder="0.00">
              <button class="nav-btn" data-act="removeItem" data-i="${i}" aria-label="Remove item">${icon('close')}</button></div>
            <div class="pill-row">${members.map((m) => html`<button class="pill ${(it.people || []).includes(m.id) ? 'on' : ''}" data-act="itemPerson" data-i="${i}" data-id="${m.id}" aria-pressed="${String((it.people || []).includes(m.id))}">${m.name}</button>`)}</div>
          </div>`)}
          <button class="btn btn-tinted wide" data-act="addItem">${icon('plus')} Add item</button>
          <div class="list"><label class="cell"><span class="cell-main"><span class="cell-title">Tax, tip & service</span><span class="cell-sub">Shared in proportion to what each person had</span></span>
            <span class="cell-trailing"><span class="muted">${sym}</span><input class="num-input" inputmode="decimal" data-field="extra" value="${d.split.extraText || ''}" placeholder="0.00"></span></label></div>
          <h3 class="section-header">Each person</h3>
          <div class="list each-list">${this.#eachPerson(preview)}</div>`;
      default:
        return '';
    }
  }
  #eachPerson(preview) {
    const d = this.form.d;
    return html`${app.store.members(d.g).filter((m) => preview[m.id]).map((m) => html`<div class="cell"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span></span><span class="cell-trailing num">${fmt(preview[m.id], d.currency)}</span></div>`)}`;
  }
  #status() {
    const f = this.form;
    const d = f.d;
    const res = computeShares(f.amount, f.builtSplit());
    if (d.split.mode === 'percent') {
      const sum = Object.values(d.split.values).reduce((a, b) => a + (Number(b) || 0), 0);
      return `${Math.round(sum * 100) / 100}% of 100% · ${Math.round((100 - sum) * 100) / 100}% left`;
    }
    if (d.split.mode === 'exact') {
      const r = res.remaining ?? 0;
      return `${fmt(f.amount - r, d.currency)} of ${fmt(f.amount, d.currency)} · ${fmt(Math.abs(r), d.currency)} ${r >= 0 ? 'left' : 'over'}`;
    }
    if (!res.ok) return res.error;
    if (d.split.mode === 'equal') return `${fmt(Math.max(...Object.values(res.shares)), d.currency)} per person (${Object.keys(res.shares).length} people)`;
    if (d.split.mode === 'items') return `Total ${fmt(f.amount, d.currency)} · items ${fmt(res.subtotal, d.currency)} + extras ${fmt(res.extra, d.currency)}`;
    return 'Everything adds up ✓';
  }
  #live() {
    const s = this.page.querySelector('.split-status');
    if (s) s.textContent = this.#status();
    const f = this.form;
    const preview = computeShares(f.amount, f.builtSplit()).shares || {};
    this.page.querySelectorAll('[data-field^="v:"], [data-field^="t:"]').forEach((inp) => {
      const id = inp.dataset.field.slice(2);
      const p = inp.closest('.cell')?.querySelector('.share-preview');
      if (p) p.textContent = preview[id] ? fmt(preview[id], f.d.currency) : '';
    });
    const each = this.page.querySelector('.each-list');
    if (each) each.innerHTML = String(this.#eachPerson(preview));
  }
  /** Itemized splits set the expense total: items + extras. */
  #syncItemsTotal() {
    const d = this.form.d;
    const items = d.split.items.reduce((a, it) => a + (Number.isFinite(parseAmount(it.amountText, d.currency)) ? parseAmount(it.amountText, d.currency) : 0), 0);
    const extra = Number.isFinite(parseAmount(d.split.extraText || '0', d.currency)) ? parseAmount(d.split.extraText || '0', d.currency) : 0;
    d.amountText = formatPlain(items + extra, d.currency);
  }
  onInput(field, el) {
    const d = this.form.d;
    if (field.startsWith('t:')) d.texts[field.slice(2)] = el.value;
    else if (field.startsWith('v:')) d.split.values[field.slice(2)] = Number(el.value.replace(',', '.')) || 0;
    else if (field.startsWith('in:')) d.split.items[Number(field.slice(3))].name = el.value;
    else if (field.startsWith('ia:')) { d.split.items[Number(field.slice(3))].amountText = el.value; this.#syncItemsTotal(); }
    else if (field === 'extra') { d.split.extraText = el.value; this.#syncItemsTotal(); }
    this.#live();
  }
  on = {
    seg(el) {
      const d = this.form.d;
      const mode = el.dataset.value;
      const ids = app.store.members(d.g).map((m) => m.id);
      d.split.mode = mode;
      d.texts = {};
      if (mode === 'equal' || mode === 'adjust') d.split.members = d.split.members.length ? d.split.members : ids;
      if (mode === 'percent') {
        // Even percentages; the first person absorbs the rounding so they total exactly 100.
        const base = Math.floor(10000 / ids.length) / 100;
        d.split.values = Object.fromEntries(ids.map((id, i) => [id, i === 0 ? Math.round((100 - base * (ids.length - 1)) * 100) / 100 : base]));
      }
      if (mode === 'shares') d.split.values = Object.fromEntries(ids.map((id) => [id, 1]));
      if (mode === 'items') {
        if (!d.split.items.length) d.split.items = [{ name: '', amountText: '', people: [...ids] }];
        // Whatever isn't itemized yet counts as extras until items are entered.
        if (!d.split.extraText) d.split.extraText = '';
        this.#syncItemsTotal();
      }
      haptic();
      this.nav.refresh(this);
    },
    toggleMember(el) {
      const m = this.form.d.split.members;
      const id = el.dataset.id;
      const i = m.indexOf(id);
      if (i >= 0) m.splice(i, 1); else m.push(id);
      haptic();
      this.nav.refresh(this);
    },
    all() {
      const d = this.form.d;
      const ids = app.store.members(d.g).map((m) => m.id);
      d.split.members = ids.every((id) => d.split.members.includes(id)) ? [] : ids;
      this.nav.refresh(this);
    },
    addItem() {
      const d = this.form.d;
      d.split.items.push({ name: '', amountText: '', people: app.store.members(d.g).map((m) => m.id) });
      this.nav.refresh(this);
      const names = this.page.querySelectorAll('.item-name');
      names[names.length - 1]?.focus();
    },
    removeItem(el) { this.form.d.split.items.splice(Number(el.dataset.i), 1); this.#syncItemsTotal(); this.nav.refresh(this); },
    itemPerson(el) {
      const it = this.form.d.split.items[Number(el.dataset.i)];
      const i = it.people.indexOf(el.dataset.id);
      if (i >= 0) it.people.splice(i, 1); else it.people.push(el.dataset.id);
      haptic();
      el.classList.toggle('on', i < 0);
      el.setAttribute('aria-pressed', String(i < 0));
      this.#live();
    },
    done() { this.nav.pop(); },
  };
}

const HELP = {
  equal: 'Choose who shares this. Each pays the same.',
  exact: 'Type exactly what each person owes.',
  percent: 'Give each person a percentage. They must add up to 100%.',
  shares: 'Give each person a number of shares, like 2 for a couple.',
  adjust: 'Add extra for anyone who should pay more. The rest is split equally.',
  items: 'Add each item and tap who had it. Tax and tip are shared in proportion.',
};

/* ---------------- Receipt scanning (on-device OCR) ---------------- */

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export async function compressImage(file, max = 900, quality = 0.72) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export class ScanScreen {
  constructor({ g = null, form = null } = {}) {
    this.g = g;
    this.form = form;
    this.title = 'Scan receipt';
    this.stage = 'pick';
    this.progress = 0;
    this.result = null;
  }
  leading() { return this.form ? '' : html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  body() {
    if (this.stage === 'pick') {
      return html`<div class="empty">
        <div class="empty-art">🧾</div>
        <h2>Scan a receipt</h2>
        <p>Take a clear photo of the whole bill. Evenly reads it on this phone and turns the lines into items you can split. The photo isn’t uploaded.</p>
        <label class="btn btn-primary btn-large">${icon('camera')} Take or choose a photo<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-field="photo"></label>
        <p class="fine">The first scan downloads the text-recognition engine (about 4 MB).</p>
      </div>`;
    }
    if (this.stage === 'reading') {
      return html`<div class="empty"><img class="scan-preview" src="${this.preview}" alt="">
        <h2>Reading receipt…</h2><div class="progress"><span style="width:${Math.round(this.progress * 100)}%"></span></div>
        <p class="fine">${this.status || 'Starting'}</p></div>`;
    }
    const r = this.result;
    const cur = this.currency();
    return html`
      <div class="list">
        <label class="cell"><span class="cell-label">Merchant</span><span class="cell-main"><input class="inline" data-field="merchant" value="${r.merchant}"></span></label>
        <label class="cell"><span class="cell-label">Total</span><span class="cell-main"><input class="inline num" inputmode="decimal" data-field="total" value="${formatPlain(r.total, cur)}"></span></label>
      </div>
      <h3 class="section-header">Items found (${r.items.length})</h3>
      ${r.items.length ? html`<div class="list">${r.items.map((it, i) => html`<div class="cell"><button class="check-btn" data-act="toggle" data-i="${i}" role="checkbox" aria-checked="${String(!it.off)}" aria-label="Include ${it.name}"><span class="check ${it.off ? '' : 'on'}">${it.off ? '' : icon('check')}</span></button>
        <span class="cell-main"><input class="inline" data-field="n:${i}" value="${it.name}"></span><span class="cell-trailing"><input class="num-input" inputmode="decimal" data-field="a:${i}" value="${formatPlain(it.amount, cur)}"></span></div>`)}</div>`
        : html`<p class="empty-note">No line items were recognised. You can still use the total.</p>`}
      ${r.extras.length ? html`<h3 class="section-header">Tax, service & discounts</h3><div class="list">${r.extras.map((x) => html`<div class="cell"><span class="cell-main"><span class="cell-title">${x.label}</span></span><span class="cell-trailing num">${fmt(x.amount, cur)}</span></div>`)}</div>` : ''}
      <p class="section-footer">Check the numbers. OCR can misread smudged or crumpled receipts.</p>
      <div class="list"><button class="cell tappable" data-act="use"><span class="cell-main"><span class="cell-title accent-text center">${r.items.some((i) => !i.off) ? 'Split item by item' : 'Use the total'}</span></span></button>
        <button class="cell tappable" data-act="again"><span class="cell-main"><span class="cell-title center">Scan again</span></span></button></div>`;
  }
  currency() { return this.form?.d.currency || (this.g && app.store.state(this.g).group.currency) || app.store.device.currency; }
  async onChange(f, el) {
    if (f !== 'photo' || !el.files?.[0]) return;
    const file = el.files[0];
    this.preview = await compressImage(file, 900, 0.72);
    this.stage = 'reading';
    this.nav.refresh(this);
    try {
      await loadScript(TESSERACT);
      const worker = await globalThis.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (typeof m.progress === 'number') { this.progress = m.progress; this.status = m.status; }
          const bar = this.page?.querySelector('.progress span');
          if (bar) bar.style.width = `${Math.round(this.progress * 100)}%`;
          const s = this.page?.querySelector('.fine');
          if (s && m.status) s.textContent = m.status.replace(/^./, (c) => c.toUpperCase());
        },
      });
      const big = await compressImage(file, 1800, 0.9);
      const { data } = await worker.recognize(big);
      await worker.terminate();
      this.result = parseReceipt(data.text, this.currency());
      this.stage = 'review';
      haptic('success');
    } catch (e) {
      this.stage = 'pick';
      toast(e.message || 'Couldn’t read the receipt', { kind: 'error' });
    }
    this.nav.refresh(this);
  }
  onInput(f, el) {
    const r = this.result;
    const cur = this.currency();
    if (f === 'merchant') r.merchant = el.value;
    if (f === 'total') { const v = parseAmount(el.value, cur); if (Number.isFinite(v)) r.total = v; }
    if (f.startsWith('n:')) r.items[Number(f.slice(2))].name = el.value;
    if (f.startsWith('a:')) { const v = parseAmount(el.value, cur); if (Number.isFinite(v)) r.items[Number(f.slice(2))].amount = v; }
  }
  on = {
    cancel() { this.sheet.close(); },
    again() { this.stage = 'pick'; this.result = null; this.nav.refresh(this); },
    toggle(el) { const it = this.result.items[Number(el.dataset.i)]; it.off = !it.off; this.nav.refresh(this); },
    use() {
      const r = this.result;
      const cur = this.currency();
      const items = r.items.filter((i) => !i.off);
      const apply = (form) => {
        const d = form.d;
        if (!d.desc && r.merchant) d.desc = r.merchant;
        if (r.date && r.date <= app.store.today()) d.date = r.date;
        d.receipt = this.preview;
        if (!d.catManual) d.category = guessCategory(d.desc) || 'food.dining';
        const ids = d.g ? app.store.members(d.g).map((m) => m.id) : [];
        if (items.length && d.g) {
          const sum = items.reduce((a, b) => a + b.amount, 0);
          d.split = { ...d.split, mode: 'items', items: items.map((i) => ({ name: i.name, amountText: formatPlain(i.amount, cur), people: [...ids] })), extraText: formatPlain(Math.max(0, r.total - sum), cur) };
          d.amountText = formatPlain(Math.max(r.total, sum), cur);
        } else {
          d.amountText = formatPlain(r.total, cur);
        }
      };
      if (this.form) {
        apply(this.form);
        this.nav.pop();
        if (items.length && this.form.d.g) this.nav.push(new SplitScreen(this.form));
      } else {
        const form = new ExpenseForm({ g: this.g });
        apply(form);
        this.sheet.close({ silent: true });
        app.present(form);
      }
    },
  };
}
