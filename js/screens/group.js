// Group detail and everything hanging off it: balances, totals, charts,
// whiteboard, settings, members, default split.

import { html, raw, toast, fmtDate, shareFile, monthLabel } from '../ui/dom.js';
import { icon, groupTile, avatar, balanceText, money, catIcon, segmented, toggle, barChart, donut, hbar, category, categoryGroupOf, CATEGORIES, COLORS, GROUP_TYPES } from '../ui/kit.js';
import { confirmAction } from '../ui/menu.js';
import { haptic } from '../ui/motion.js';
import { formatMoney, allCurrencies, currencyName } from '../core/money.js';
import { groupBalances, personView, expenseEffect, spending, mainCurrency } from '../core/balances.js';
import { live } from '../core/ledger.js';
import { app } from '../app/app.js';
import { ExpenseScreen, ExpenseForm, ScanScreen } from './expense.js';
import { SettleScreen, PaymentScreen, PaymentForm, RemindScreen, ConvertScreen } from './settle.js';
import { InviteScreen, ShareUpdatesScreen, JoinScreen, NearbyScreen } from './sync.js';

const monthKey = (d) => (d || '').slice(0, 7);

export async function exportGroupCSV(g) {
  const name = (app.store.state(g).group.name || 'group').replace(/[^\w\- ]+/g, '').trim() || 'group';
  await shareFile(`${name}.csv`, app.store.exportCSV(g), 'text/csv');
}

/* ---------------- Group detail ---------------- */

export class GroupScreen {
  constructor(g) {
    this.g = g;
    this.backTitle = () => app.store.state(g)?.group.name || 'Group';
  }
  title() { return app.store.state(this.g)?.group.name || 'Group'; }
  actions() {
    if (!this.alive()) return '';
    const n = app.store.unsharedCount(this.g);
    return html`<button class="nav-btn" data-act="share" aria-label="Share updates${n ? `, ${n} new` : ''}">${icon('share')}${n ? html`<span class="badge">${n > 99 ? '99+' : n}</span>` : ''}</button>
      <button class="nav-btn" data-act="settings" aria-label="Group settings">${icon('gear')}</button>`;
  }
  accessory() {
    if (!this.alive()) return '';
    return html`<button class="capsule glass" data-act="scan" aria-label="Scan a receipt">${icon('scan')}</button>
      <button class="capsule glass primary" data-act="add">${icon('plus')}<span>Add expense</span></button>`;
  }
  alive() {
    const st = app.store.state(this.g);
    return st && !st.group.deleted;
  }
  body() {
    const store = app.store;
    const st = store.state(this.g);
    if (!this.alive()) return html`<div class="empty"><div class="empty-art">🗑️</div><h2>This group was deleted</h2><p>Someone deleted it for everyone.</p><button class="btn btn-tinted" data-act="forget">Remove from this phone</button></div>`;
    const me = store.meIn(this.g);
    const bal = groupBalances(st);
    const view = personView(bal, me);
    const members = store.members(this.g);
    const unclaimed = members.filter((m) => !m.claimedBy);
    const feed = [
      ...live(st, 'expense').map((e) => ({ kind: 'expense', date: e.date, c: e._created, e })),
      ...live(st, 'payment').map((p) => ({ kind: 'payment', date: p.date, c: p._created, p })),
      ...live(st, 'conversion').map((x) => ({ kind: 'conversion', date: x.date, c: x._created, x })),
    ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.c - a.c);
    let lastMonth = null;
    const thisMonth = monthKey(store.today());
    const currencies = new Set(feed.filter((f) => f.e).map((f) => f.e.currency));
    return html`
      <div class="hero group-hero">
        ${groupTile(st.group, 'xxl')}
        <div class="hero-text">
          <h2>${st.group.name}</h2>
          <button class="chip small" data-act="settings">${icon('people')} ${members.length} ${members.length === 1 ? 'person' : 'people'}</button>
        </div>
      </div>
      ${!me ? html`<div class="banner tint-orange"><span>Which member are you? Pick yourself so your balances show correctly.</span><button class="btn btn-small" data-act="claim">Choose</button></div>` : ''}
      <div class="balance-card ${this.expanded ? 'expanded' : ''}">
        <button class="bc-head" data-act="toggleBal" aria-expanded="${String(!!this.expanded)}">
          <span class="bc-total">${Object.keys(view.total).length ? balanceText(view.total) : html`<span class="muted">You’re all settled up in this group</span>`}</span>
          ${view.lines.length ? html`<span class="bc-chev">${icon('chevron')}</span>` : ''}
        </button>
        ${view.lines.length ? html`<div class="bc-lines">${(this.expanded ? view.lines : view.lines.slice(0, 2)).map((l) => html`<p>${l.amount > 0
          ? html`${store.memberName(this.g, l.other)} owes you <span class="pos num">${formatMoney(l.amount, l.currency)}</span>`
          : html`You owe ${store.memberName(this.g, l.other)} <span class="neg num">${formatMoney(-l.amount, l.currency)}</span>`}</p>`)}
          ${!this.expanded && view.lines.length > 2 ? html`<p class="muted">Plus ${view.lines.length - 2} more</p>` : ''}</div>` : ''}
      </div>
      <div class="chips" role="toolbar" aria-label="Group actions">
        <button class="chip accent" data-act="settle">Settle up</button>
        <button class="chip" data-act="balances">Balances</button>
        <button class="chip" data-act="totals">Totals</button>
        <button class="chip" data-act="charts">Charts</button>
        <button class="chip" data-act="whiteboard">Whiteboard</button>
        ${currencies.size > 1 || Object.keys(bal.net).length > 1 ? html`<button class="chip" data-act="convert">Convert currency</button>` : ''}
        <button class="chip" data-act="export">Export</button>
      </div>
      ${unclaimed.length && me ? html`<div class="banner tint-indigo"><span>${unclaimed.length === 1 ? `${unclaimed[0].name} hasn’t` : `${unclaimed.length} people haven’t`} joined on their phone yet.</span><button class="btn btn-small" data-act="invite">Invite</button></div>` : ''}
      ${!feed.length ? html`<div class="empty compact"><div class="empty-art">🧾</div><h2>No expenses yet</h2><p>Add the first one. Everyone you invite sees it once you share updates.</p></div>` : ''}
      <div class="feed">
        ${feed.map((item) => {
          const mk = monthKey(item.date);
          const header = mk !== lastMonth && mk !== thisMonth ? html`<h3 class="month-header">${monthLabel(mk)}</h3>` : '';
          lastMonth = mk;
          return html`${header}${this.#row(item, me)}`;
        })}
      </div>
      <div class="bottom-space"></div>`;
  }
  #row(item, me) {
    const store = app.store;
    const [, m, d] = (item.date || '----').split('-');
    const mon = item.date ? new Date(2000, Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short' }) : '';
    const dateBlock = html`<span class="date-block"><span class="mon">${mon}</span><span class="day">${d}</span></span>`;
    if (item.kind === 'expense') {
      const e = item.e;
      const eff = expenseEffect(e, me);
      const payers = Object.keys(e.paidBy || {}).filter((id) => e.paidBy[id] > 0);
      const who = payers.length > 1 ? `${payers.length} people paid` : `${store.memberName(this.g, payers[0])} paid`;
      return html`<div class="swipe-row" data-g="${this.g}" data-t="expense" data-id="${e.id}">
        <div class="swipe-actions"><button class="swipe-del" data-act="del" data-t="expense" data-id="${e.id}">Delete</button></div>
        <button class="swipe-content exp-row" data-act="exp" data-id="${e.id}">
          ${dateBlock}${catIcon(e.category)}
          <span class="cell-main"><span class="cell-title">${e.desc}${e.repeat && e.repeat !== 'off' ? html` <span class="rep" title="Repeats">${icon('repeat')}</span>` : ''}${e.receipt ? html` <span class="rep" title="Has a receipt">${icon('receipt')}</span>` : ''}</span>
            <span class="cell-sub">${who} ${formatMoney(e.amount, e.currency)}</span></span>
          <span class="cell-trailing stacked">${eff.kind === 'none' ? html`<span class="tiny muted">not involved</span>`
            : eff.kind === 'invalid' ? html`<span class="tiny neg">check split</span>`
            : html`<span class="tiny ${eff.kind === 'lent' ? 'pos' : eff.kind === 'borrowed' ? 'neg' : 'muted'}">${eff.kind === 'lent' ? 'you lent' : eff.kind === 'borrowed' ? 'you borrowed' : 'even'}</span>
              ${eff.amount ? html`<span class="num ${eff.kind === 'lent' ? 'pos' : 'neg'}">${formatMoney(eff.amount, e.currency)}</span>` : ''}`}</span>
        </button></div>`;
    }
    if (item.kind === 'payment') {
      const p = item.p;
      return html`<div class="swipe-row" data-g="${this.g}" data-t="payment" data-id="${p.id}">
        <div class="swipe-actions"><button class="swipe-del" data-act="del" data-t="payment" data-id="${p.id}">Delete</button></div>
        <button class="swipe-content exp-row payment-row" data-act="pay" data-id="${p.id}">
          ${dateBlock}<span class="cat-icon tint-green" aria-hidden="true">💸</span>
          <span class="cell-main"><span class="cell-title">${store.memberName(this.g, p.from)} paid ${p.to === me ? 'you' : store.memberName(this.g, p.to)} ${formatMoney(p.amount, p.currency)}</span>
          ${p.notes ? html`<span class="cell-sub">${p.notes}</span>` : ''}</span>
          ${p.from === me || p.to === me ? html`<span class="cell-trailing stacked"><span class="tiny ${p.from === me ? 'pos' : 'neg'}">${p.from === me ? 'you paid' : 'you received'}</span><span class="num">${formatMoney(p.amount, p.currency)}</span></span>` : ''}
        </button></div>`;
    }
    const x = item.x;
    return html`<div class="exp-row static">${dateBlock}<span class="cat-icon tint-blue" aria-hidden="true">💱</span>
      <span class="cell-main"><span class="cell-title">Converted ${x.from} balances to ${x.to}</span><span class="cell-sub">1 ${x.from} = ${x.rate} ${x.to}</span></span></div>`;
  }
  on = {
    add() { app.present(new ExpenseForm({ g: this.g })); },
    scan() { app.present(new ScanScreen({ g: this.g })); },
    exp(el) { app.show(new ExpenseScreen(this.g, el.dataset.id), this); },
    pay(el) { app.show(new PaymentScreen(this.g, el.dataset.id), this); },
    async del(el) { await deleteWithUndo(this.g, el.dataset.t, el.dataset.id); },
    settings() { app.show(new GroupSettingsScreen(this.g), this); },
    share() { app.present(new ShareUpdatesScreen(this.g)); },
    settle() { app.show(new SettleScreen({ g: this.g }), this); },
    balances() { app.show(new BalancesScreen(this.g), this); },
    totals() { app.show(new TotalsScreen(this.g), this); },
    charts() { app.show(new ChartsScreen(this.g), this); },
    whiteboard() { app.show(new WhiteboardScreen(this.g), this); },
    convert() { app.present(new ConvertScreen(this.g)); },
    export() { exportGroupCSV(this.g); },
    invite() { app.present(new InviteScreen(this.g)); },
    claim() { app.present(new JoinScreen(this.g)); },
    toggleBal() { this.expanded = !this.expanded; this.nav.refresh(this); },
    async forget() { await app.store.leaveGroup(this.g, { force: true }); this.nav.pop(); },
  };
}

export async function deleteWithUndo(g, t, id) {
  await app.store.deleteEntity(g, t, id);
  haptic('warning');
  toast(t === 'payment' ? 'Payment deleted' : 'Expense deleted', { action: { label: 'Undo', run: () => app.store.restoreEntity(g, t, id) } });
}

/* ---------------- Balances ---------------- */

export class BalancesScreen {
  constructor(g) { this.g = g; this.title = 'Balances'; this.open = new Set(); }
  body() {
    const store = app.store;
    const st = store.state(this.g);
    const bal = groupBalances(st);
    const me = store.meIn(this.g);
    const name = (id) => store.memberName(this.g, id, { you: false });
    const members = store.members(this.g, { includeLeft: true });
    return html`
      ${!bal.simplifyOn && bal.saved ? html`<div class="banner tint-green"><span>Turning on simplify debts would save this group ${bal.saved} repayment${bal.saved > 1 ? 's' : ''}.</span><button class="btn btn-small" data-act="simplify">Turn on</button></div>` : ''}
      ${bal.simplifyOn ? html`<p class="section-footer">Simplify debts is on: debts are combined so the group needs as few repayments as possible.</p>` : ''}
      <div class="list">
        ${members.map((m) => {
          const totals = Object.entries(bal.net).map(([c, n]) => [c, n[m.id] || 0]).filter(([, v]) => v);
          const lines = Object.entries(bal.debts).flatMap(([c, list]) => list.filter((d) => d.debtor === m.id || d.creditor === m.id).map((d) => ({ ...d, c })));
          const isOpen = this.open.has(m.id);
          return html`<div class="bal-member ${isOpen ? 'open' : ''}">
            <button class="cell tappable" data-act="toggle" data-id="${m.id}" aria-expanded="${String(isOpen)}">
              <span class="cell-leading">${avatar(m, 'lg')}</span>
              <span class="cell-main"><span class="cell-title">${m.name}${m.id === me ? ' (you)' : ''}</span>
                <span class="cell-sub">${totals.length ? totals.map(([c, v]) => html`<span class="${v > 0 ? 'pos' : 'neg'}">${v > 0 ? 'gets back' : 'owes'} ${formatMoney(Math.abs(v), c)} in total</span> `) : html`<span class="muted">settled up</span>`}</span></span>
              ${lines.length ? html`<span class="cell-trailing chev-rot">${icon('chevron')}</span>` : ''}
            </button>
            ${isOpen ? html`<div class="bal-lines">${lines.map((d) => html`<div class="bal-line">
              <p>${name(d.debtor)} owes <span class="num">${formatMoney(d.amount, d.c)}</span> to ${name(d.creditor)}</p>
              <div class="bal-actions">
                ${d.creditor === me ? html`<button class="btn btn-small btn-tinted" data-act="remind" data-debtor="${d.debtor}" data-amount="${d.amount}" data-c="${d.c}">Remind…</button>` : ''}
                <button class="btn btn-small" data-act="settle" data-from="${d.debtor}" data-to="${d.creditor}" data-amount="${d.amount}" data-c="${d.c}">Settle up</button>
              </div></div>`)}</div>` : ''}
          </div>`;
        })}
      </div><div class="bottom-space"></div>`;
  }
  on = {
    toggle(el) {
      const id = el.dataset.id;
      this.open.has(id) ? this.open.delete(id) : this.open.add(id);
      this.nav.refresh(this);
    },
    async simplify() { await app.store.setGroup(this.g, { simplify: true }); haptic('success'); toast('Simplify debts is on'); },
    remind(el) { app.present(new RemindScreen({ g: this.g, name: app.store.memberName(this.g, el.dataset.debtor, { you: false }), amount: Number(el.dataset.amount), currency: el.dataset.c, debtor: el.dataset.debtor })); },
    settle(el) { app.present(new PaymentForm({ g: this.g, from: el.dataset.from, to: el.dataset.to, amount: Number(el.dataset.amount), currency: el.dataset.c })); },
  };
}

/* ---------------- Totals ---------------- */

export class TotalsScreen {
  constructor(g) {
    this.g = g;
    this.title = 'Totals';
    this.month = monthKey(app.store.today());
    this.allTime = false;
    this.currency = mainCurrency(app.store.state(g), app.store.device.currency);
  }
  body() {
    const store = app.store;
    const st = store.state(this.g);
    const me = store.meIn(this.g);
    const currencies = [...new Set(live(st, 'expense').map((e) => e.currency))];
    const s = spending(st, me, this.currency);
    const [y, m] = this.month.split('-').map(Number);
    const series = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(y, m - 1 - k, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      series.push({ key, label: monthLabel(key), short: d.toLocaleDateString(undefined, { month: 'short' }), value: s.months[key]?.total || 0, mine: s.months[key]?.mine || 0 });
    }
    const cur = this.allTime ? { total: s.total, mine: s.mine } : s.months[this.month] || { total: 0, mine: 0 };
    const pct = cur.total ? Math.round((cur.mine / cur.total) * 1000) / 10 : null;
    return html`
      <p class="totals-sub">${this.allTime ? 'All-time group spending' : `${monthLabel(this.month)} group spending`}</p>
      ${currencies.length > 1 ? html`<div class="center-row">${segmented('currency', currencies.map((c) => ({ id: c, label: c })), this.currency)}</div>` : ''}
      <div class="card chart-card">${barChart(series, { currency: this.currency, highlight: this.allTime ? null : this.month })}
        <p class="legend-inline"><span class="dot tint-indigo"></span>Group <span class="dot tint-mint"></span>Your share</p></div>
      <div class="stat-grid">
        <div class="stat"><span class="stat-label">Total spent</span><span class="stat-value num">${formatMoney(cur.total, this.currency)}</span></div>
        <div class="stat"><span class="stat-label">Your share</span><span class="stat-value num">${formatMoney(cur.mine, this.currency)}</span><span class="stat-foot">${pct === null ? '—' : `${pct}%`} of group spending</span></div>
      </div>
      <div class="stepper-row">
        <button class="btn btn-tinted ${this.allTime ? 'on' : ''}" data-act="all" aria-pressed="${String(this.allTime)}">All time</button>
        <div class="stepper ${this.allTime ? 'disabled' : ''}">
          <button class="nav-btn" data-act="prev" aria-label="Previous month">${raw('<svg viewBox="0 0 12 20" class="i"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>')}</button>
          <span class="stepper-label">${monthLabel(this.month)}</span>
          <button class="nav-btn" data-act="next" aria-label="Next month" ${this.month >= monthKey(store.today()) ? raw('disabled') : ''}>${icon('chevron')}</button>
        </div>
      </div>
      <div class="bottom-space"></div>`;
  }
  #shift(n) {
    const [y, m] = this.month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    this.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this.allTime = false;
    this.nav.refresh(this);
  }
  on = {
    prev() { this.#shift(-1); },
    next() { this.#shift(1); },
    all() { this.allTime = !this.allTime; this.nav.refresh(this); },
    seg(el) { this.currency = el.dataset.value; this.nav.refresh(this); },
  };
}

/* ---------------- Charts ---------------- */

export class ChartsScreen {
  constructor(g) {
    this.g = g;
    this.title = 'Charts';
    this.currency = mainCurrency(app.store.state(g), app.store.device.currency);
  }
  body() {
    const store = app.store;
    const st = store.state(this.g);
    const me = store.meIn(this.g);
    const currencies = [...new Set(live(st, 'expense').map((e) => e.currency))];
    const s = spending(st, me, this.currency);
    const byGroup = {};
    for (const [cat, v] of Object.entries(s.categories)) {
      const top = categoryGroupOf(cat);
      byGroup[top.id] = (byGroup[top.id] || 0) + v;
    }
    const slices = CATEGORIES.filter((c) => byGroup[c.id]).map((c) => ({ label: c.label, value: byGroup[c.id], color: c.color })).sort((a, b) => b.value - a.value);
    const topCats = Object.entries(s.categories).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => ({ label: `${category(id).emoji} ${category(id).label}`, value: v }));
    const months = Object.keys(s.months).sort().slice(-12).map((k) => ({ key: k, label: monthLabel(k), short: new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'short' }), value: s.months[k].total, mine: s.months[k].mine }));
    const people = Object.entries(s.members).map(([id, v]) => ({ label: store.memberName(this.g, id), value: v })).sort((a, b) => b.value - a.value);
    return html`
      ${currencies.length > 1 ? html`<div class="center-row">${segmented('currency', currencies.map((c) => ({ id: c, label: c })), this.currency)}</div>` : ''}
      <h3 class="section-header">By category</h3>
      <div class="card">${donut(slices, { currency: this.currency })}</div>
      ${topCats.length ? html`<h3 class="section-header">Top categories</h3><div class="card">${hbar(topCats, { currency: this.currency })}</div>` : ''}
      <h3 class="section-header">By month</h3>
      <div class="card chart-card">${barChart(months, { currency: this.currency })}</div>
      ${people.length ? html`<h3 class="section-header">Who spent on what</h3><div class="card">${hbar(people, { currency: this.currency })}</div>
        <p class="section-footer">Each person’s share of the group’s expenses, whoever paid.</p>` : ''}
      <div class="bottom-space"></div>`;
  }
  on = { seg(el) { this.currency = el.dataset.value; this.nav.refresh(this); } };
}

/* ---------------- Whiteboard ---------------- */

export class WhiteboardScreen {
  constructor(g) { this.g = g; this.title = 'Whiteboard'; this.timer = 0; }
  body() {
    const st = app.store.state(this.g);
    const by = st.group._ts.whiteboard;
    return html`<div class="whiteboard">
      <textarea data-field="wb" placeholder="Wi-Fi password, the landlord’s number, who brings what…" aria-label="Whiteboard">${st.group.whiteboard || ''}</textarea>
      <p class="section-footer"><span class="wb-status">${by ? `Last edited ${new Date(by[0]).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Everyone in the group can read and edit this.'}</span></p>
    </div>`;
  }
  onInput(f, el) {
    clearTimeout(this.timer);
    this.page.querySelector('.wb-status').textContent = 'Editing…';
    this.timer = setTimeout(() => this.#save(el.value), 900);
  }
  async #save(text) {
    if ((app.store.state(this.g).group.whiteboard || '') === text) return;
    await app.store.setGroup(this.g, { whiteboard: text });
    const s = this.page?.querySelector('.wb-status');
    if (s) s.textContent = 'Saved';
  }
  unmount() {
    const ta = this.page?.querySelector('textarea');
    if (ta) { clearTimeout(this.timer); this.#save(ta.value); }
  }
}

/* ---------------- Settings ---------------- */

export class GroupSettingsScreen {
  constructor(g) { this.g = g; this.title = 'Group settings'; }
  body() {
    const store = app.store;
    const st = store.state(this.g);
    if (!st || st.group.deleted) return html`<p class="empty-note">This group is gone.</p>`;
    const me = store.meIn(this.g);
    const bal = groupBalances(st);
    const members = store.members(this.g);
    const ds = st.group.defaultSplit;
    const type = GROUP_TYPES.find((t) => t.id === st.group.type) || GROUP_TYPES[3];
    const unshared = store.unsharedCount(this.g);
    return html`
      <div class="list">
        <button class="cell tappable" data-act="edit">
          <span class="cell-leading">${groupTile(st.group, 'lg')}</span>
          <span class="cell-main"><span class="cell-title big">${st.group.name}</span><span class="cell-sub">${type.label} · ${st.group.currency || store.device.currency}</span></span>
          <span class="cell-trailing tint-text">Edit</span>
        </button>
      </div>

      <h3 class="section-header">Members</h3>
      <div class="list">
        <button class="cell tappable" data-act="addPeople"><span class="cell-leading"><span class="sq tint-indigo">${icon('plus')}</span></span><span class="cell-main"><span class="cell-title accent-text">Add people</span></span></button>
        <button class="cell tappable" data-act="invite"><span class="cell-leading"><span class="sq tint-green">${icon('link')}</span></span><span class="cell-main"><span class="cell-title accent-text">Invite via link or QR code</span></span></button>
        ${members.map((m) => {
          const totals = Object.entries(bal.net).map(([c, n]) => [c, n[m.id] || 0]).filter(([, v]) => v);
          return html`<button class="cell tappable" data-act="member" data-id="${m.id}">
            <span class="cell-leading">${avatar(m, 'lg')}</span>
            <span class="cell-main"><span class="cell-title">${m.name}${m.id === me ? ' (you)' : ''}</span>
              <span class="cell-sub">${m.claimedBy ? 'On their phone' : 'Not joined yet'}${m.upi ? ` · UPI ${m.upi}` : ''}</span></span>
            <span class="cell-trailing stacked">${totals.length ? totals.map(([c, v]) => html`<span class="tiny ${v > 0 ? 'pos' : 'neg'}">${v > 0 ? 'gets back' : 'owes'}</span><span class="num ${v > 0 ? 'pos' : 'neg'}">${formatMoney(Math.abs(v), c)}</span>`) : html`<span class="tiny muted">settled up</span>`}</span>
          </button>`;
        })}
      </div>

      <h3 class="section-header">Advanced</h3>
      <div class="list">
        <div class="cell"><span class="cell-main"><span class="cell-title">Simplify group debts</span></span><span class="cell-trailing">${toggle('simplify', st.group.simplify, 'Simplify group debts')}</span></div>
        <button class="cell tappable" data-act="defaultSplit"><span class="cell-main"><span class="cell-title">Default split</span>
          <span class="cell-sub">${ds ? describeDefault(this.g, ds) : 'Paid by whoever adds it, split equally'}</span></span></button>
        <label class="cell"><span class="cell-main"><span class="cell-title">Group currency</span></span>
          <span class="cell-trailing"><select class="inline-select" data-field="currency">${allCurrencies().map((c) => html`<option value="${c}" ${c === (st.group.currency || store.device.currency) ? raw('selected') : ''}>${c} · ${currencyName(c)}</option>`)}</select></span></label>
      </div>
      <p class="section-footer">Simplify debts combines what people owe so the group needs fewer repayments. A owes B and B owes C becomes A pays C.</p>

      <h3 class="section-header">Sync</h3>
      <div class="list">
        <button class="cell tappable" data-act="share"><span class="cell-leading"><span class="sq tint-blue">${icon('share')}</span></span><span class="cell-main"><span class="cell-title">Share updates</span><span class="cell-sub">${unshared ? `${unshared} change${unshared > 1 ? 's' : ''} not shared yet` : 'Everything has been shared'}</span></span></button>
        <button class="cell tappable" data-act="nearby"><span class="cell-leading"><span class="sq tint-green">${icon('sync')}</span></span><span class="cell-main"><span class="cell-title">Live sync with a nearby phone</span></span></button>
        <button class="cell tappable" data-act="export"><span class="cell-leading"><span class="sq tint-gray">${icon('download')}</span></span><span class="cell-main"><span class="cell-title">Export as spreadsheet (CSV)</span></span></button>
      </div>

      <div class="list">
        <button class="cell tappable destructive-cell" data-act="leave"><span class="cell-main"><span class="cell-title">Leave group</span><span class="cell-sub">Removes it from this phone only</span></span></button>
        <button class="cell tappable destructive-cell" data-act="delete"><span class="cell-main"><span class="cell-title">Delete group</span><span class="cell-sub">For everyone, once they sync</span></span></button>
      </div>
      <div class="bottom-space"></div>`;
  }
  async onChange(field, el) {
    if (field === 'simplify') { await app.store.setGroup(this.g, { simplify: el.checked }); haptic(); }
    if (field === 'currency') await app.store.setGroup(this.g, { currency: el.value });
  }
  on = {
    edit() { app.present(new NewGroupScreen(this.g)); },
    addPeople() { app.present(new AddPeopleScreen(this.g)); },
    invite() { app.present(new InviteScreen(this.g)); },
    member(el) { app.present(new MemberScreen(this.g, el.dataset.id)); },
    defaultSplit() { this.nav.push(new DefaultSplitScreen(this.g)); },
    share() { app.present(new ShareUpdatesScreen(this.g)); },
    nearby() { app.present(new NearbyScreen()); },
    export() { exportGroupCSV(this.g); },
    async leave() {
      const ok = await confirmAction({ title: 'Leave this group?', message: 'It will be removed from this phone. Other members keep their copy.', confirm: 'Leave group' });
      if (!ok) return;
      try {
        await app.store.leaveGroup(this.g);
        app.goHome();
        toast('You left the group');
      } catch (e) { toast(e.message, { kind: 'error' }); }
    },
    async delete() {
      const ok = await confirmAction({ title: 'Delete this group for everyone?', message: 'Members’ phones remove it the next time they sync with you. This can’t be undone.', confirm: 'Delete group' });
      if (!ok) return;
      await app.store.deleteGroup(this.g);
      app.goHome();
      toast('Group deleted. Share updates so others see it too.');
    },
  };
}

function describeDefault(g, ds) {
  const payer = ds.payer === 'adder' || !ds.payer ? 'Paid by whoever adds it' : `Paid by ${app.store.memberName(g, ds.payer)}`;
  const split = ds.split?.mode === 'percent' ? 'split by percentages' : ds.split?.mode === 'shares' ? 'split by shares' : 'split equally';
  return `${payer}, ${split}`;
}

/* ---------------- Create / edit group ---------------- */

const EMOJIS = ['👥', '✈️', '🏖️', '🏔️', '🏠', '🍽️', '🎉', '💞', '🚗', '🏕️', '🎬', '⚽️', '🎓', '💼', '🛒', '🍻', '🎂', '🧳', '🛕', '🌴'];

export class NewGroupScreen {
  constructor(g = null) {
    this.g = g;
    const st = g && app.store.state(g);
    this.title = g ? 'Edit group' : 'New group';
    this.d = st
      ? { name: st.group.name, emoji: st.group.emoji, color: st.group.color, type: st.group.type, currency: st.group.currency || app.store.device.currency, people: [] }
      : { name: '', emoji: '👥', color: 'indigo', type: 'trip', currency: app.store.device.currency, people: [] };
    this.person = '';
  }
  leading() { return html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  actions() { return html`<button class="nav-btn text bold" data-act="save">${this.g ? 'Done' : 'Create'}</button>`; }
  body() {
    const d = this.d;
    const friends = this.g ? [] : app.store.friends().filter((f) => !d.people.some((p) => p.key === f.key));
    return html`
      <div class="group-editor">
        <span class="group-tile tint-${d.color} xxl preview">${d.emoji}</span>
        <input class="title-input" data-field="name" placeholder="Group name" value="${d.name}" ${this.g ? '' : raw('autofocus')} autocomplete="off" aria-label="Group name">
      </div>
      <div class="center-row">${segmented('type', GROUP_TYPES.map((t) => ({ id: t.id, label: t.label })), d.type)}</div>
      <h3 class="section-header">Icon</h3>
      <div class="card"><div class="emoji-grid">${EMOJIS.map((e) => html`<button class="emoji-btn ${e === d.emoji ? 'on' : ''}" data-act="emoji" data-v="${e}" aria-label="${e}">${e}</button>`)}</div>
        <div class="swatches">${COLORS.map((c) => html`<button class="swatch tint-${c} ${c === d.color ? 'on' : ''}" data-act="color" data-v="${c}" aria-label="${c}"></button>`)}</div></div>
      <div class="list"><label class="cell"><span class="cell-main"><span class="cell-title">Currency</span></span>
        <span class="cell-trailing"><select class="inline-select" data-field="currency">${allCurrencies().map((c) => html`<option value="${c}" ${c === d.currency ? raw('selected') : ''}>${c} · ${currencyName(c)}</option>`)}</select></span></label></div>
      ${this.g ? '' : html`
        <h3 class="section-header">People</h3>
        <div class="list">
          <div class="cell"><span class="cell-leading">${avatar({ name: app.store.device.name, emoji: app.store.device.emoji, id: app.store.device.id })}</span><span class="cell-main"><span class="cell-title">${app.store.device.name} (you)</span></span></div>
          ${d.people.map((p, i) => html`<div class="cell"><span class="cell-leading">${avatar({ name: p.name, emoji: p.emoji, id: p.key || p.name })}</span><span class="cell-main"><span class="cell-title">${p.name}</span></span>
            <button class="nav-btn" data-act="removePerson" data-i="${i}" aria-label="Remove ${p.name}">${icon('close')}</button></div>`)}
          <form class="cell add-person" data-act="noop"><span class="cell-main"><input class="inline" data-field="person" placeholder="Add a person’s name" value="${this.person}" autocomplete="off" enterkeyhint="done"></span>
            <button class="nav-btn tinted" data-act="addPerson" aria-label="Add">${icon('plus')}</button></form>
        </div>
        ${friends.length ? html`<h3 class="section-header">Add a friend</h3><div class="pill-row">${friends.slice(0, 20).map((f) => html`<button class="pill" data-act="addFriend" data-key="${f.key}">${f.emoji || ''} ${f.name}</button>`)}</div>` : ''}
        <p class="section-footer">You can add more people and invite them later.</p>`}
      <div class="bottom-space"></div>`;
  }
  onInput(f, el) {
    if (f === 'name') this.d.name = el.value;
    if (f === 'person') this.person = el.value;
  }
  onChange(f, el) { if (f === 'currency') this.d.currency = el.value; }
  afterRender(page) {
    page.querySelector('form.add-person')?.addEventListener('submit', (e) => { e.preventDefault(); this.on.addPerson.call(this); });
  }
  on = {
    noop() {},
    cancel() { this.sheet.close(); },
    seg(el) { this.d.type = el.dataset.value; if (!this.g && this.d.emoji === '👥') this.d.emoji = GROUP_TYPES.find((t) => t.id === el.dataset.value).emoji; this.nav.refresh(this); },
    emoji(el) { this.d.emoji = el.dataset.v; this.nav.refresh(this); },
    color(el) { this.d.color = el.dataset.v; this.nav.refresh(this); },
    addPerson() {
      const n = this.person.trim();
      if (!n) return;
      this.d.people.push({ name: n });
      this.person = '';
      this.nav.refresh(this);
      this.page.querySelector('[data-field="person"]')?.focus();
    },
    addFriend(el) {
      const f = app.store.friends().find((x) => x.key === el.dataset.key);
      if (f) this.d.people.push({ name: f.name, emoji: f.emoji, key: f.key, person: f.anyPersonId, upi: f.upi });
      this.nav.refresh(this);
    },
    removePerson(el) { this.d.people.splice(Number(el.dataset.i), 1); this.nav.refresh(this); },
    async save() {
      const d = this.d;
      if (this.person.trim()) d.people.push({ name: this.person.trim() });
      if (!d.name.trim()) { toast('Give the group a name'); return; }
      if (this.g) {
        await app.store.setGroup(this.g, { name: d.name.trim(), emoji: d.emoji, color: d.color, type: d.type, currency: d.currency });
        this.sheet.close();
        return;
      }
      const g = await app.store.createGroup({ name: d.name, type: d.type, emoji: d.emoji, color: d.color, currency: d.currency, members: d.people.map((p) => ({ name: p.name, emoji: p.emoji || '🙂', person: p.person, upi: p.upi || '' })) });
      haptic('success');
      this.sheet.close();
      app.openGroup(g);
    },
  };
}

/* ---------------- Members ---------------- */

export class AddPeopleScreen {
  constructor(g) { this.g = g; this.title = 'Add people'; this.name = ''; }
  leading() { return html`<button class="nav-btn text" data-act="done">Done</button>`; }
  body() {
    const inGroup = new Set(app.store.members(this.g).map((m) => app.store.personRoot(m)));
    const friends = app.store.friends().filter((f) => !inGroup.has(f.key));
    return html`
      <div class="list"><form class="cell add-person"><span class="cell-main"><input class="inline" data-field="name" placeholder="Name" autofocus autocomplete="off" enterkeyhint="done" value="${this.name}"></span>
        <button class="nav-btn tinted" data-act="add" aria-label="Add">${icon('plus')}</button></form></div>
      ${friends.length ? html`<h3 class="section-header">Your friends</h3><div class="list">${friends.map((f) => html`<button class="cell tappable" data-act="friend" data-key="${f.key}"><span class="cell-leading">${avatar({ ...f, id: f.key })}</span><span class="cell-main"><span class="cell-title">${f.name}</span></span><span class="cell-trailing tint-text">Add</span></button>`)}</div>` : ''}
      <p class="section-footer">After adding someone, send them an invite so they can join on their own phone.</p>`;
  }
  afterRender(page) { page.querySelector('form')?.addEventListener('submit', (e) => { e.preventDefault(); this.on.add.call(this); }); }
  onInput(f, el) { this.name = el.value; }
  on = {
    done() { this.sheet.close(); },
    async add() {
      if (!this.name.trim()) return;
      await app.store.addMember(this.g, { name: this.name });
      toast(`Added ${this.name.trim()}`);
      this.name = '';
      this.nav.refresh(this);
    },
    async friend(el) {
      const f = app.store.friends().find((x) => x.key === el.dataset.key);
      await app.store.addMember(this.g, { name: f.name, emoji: f.emoji || '🙂', person: f.anyPersonId, upi: f.upi || '' });
      toast(`Added ${f.name}`);
      this.nav.refresh(this);
    },
  };
}

export class MemberScreen {
  constructor(g, id) {
    this.g = g;
    this.id = id;
    const m = app.store.state(g).member.get(id);
    this.d = { name: m.name, upi: m.upi || '' };
    this.title = m.name;
  }
  leading() { return html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  actions() { return html`<button class="nav-btn text bold" data-act="save">Done</button>`; }
  body() {
    const store = app.store;
    const m = store.state(this.g).member.get(this.id);
    const isMe = this.id === store.meIn(this.g);
    return html`
      <div class="hero small">${avatar(m, 'xxl')}</div>
      <div class="list">
        <label class="cell"><span class="cell-label">Name</span><span class="cell-main"><input class="inline" data-field="name" value="${this.d.name}" ${isMe ? raw('disabled') : ''}></span></label>
        <label class="cell"><span class="cell-label">UPI ID</span><span class="cell-main"><input class="inline" data-field="upi" placeholder="name@bank" value="${this.d.upi}" ${isMe ? raw('disabled') : ''} autocomplete="off" autocapitalize="none"></span></label>
      </div>
      ${isMe ? html`<p class="section-footer">This is you. Change your name and UPI ID in Account.</p>` : ''}
      ${!m.claimedBy ? html`<div class="list"><button class="cell tappable" data-act="invite"><span class="cell-leading"><span class="sq tint-green">${icon('link')}</span></span><span class="cell-main"><span class="cell-title accent-text">Send ${m.name} their invite</span><span class="cell-sub">Opens Evenly on their phone already set up as ${m.name}</span></span></button></div>` : html`<p class="section-footer">${m.name} uses Evenly on their own phone.</p>`}
      ${!isMe ? html`<div class="list"><button class="cell tappable destructive-cell" data-act="remove"><span class="cell-main"><span class="cell-title">Remove from group</span></span></button></div>` : ''}`;
  }
  onInput(f, el) { this.d[f] = el.value; }
  on = {
    cancel() { this.sheet.close(); },
    async save() {
      const m = app.store.state(this.g).member.get(this.id);
      const patch = {};
      if (this.d.name.trim() && this.d.name.trim() !== m.name) patch.name = this.d.name.trim();
      if (this.d.upi.trim() !== (m.upi || '')) patch.upi = this.d.upi.trim();
      if (Object.keys(patch).length) await app.store.updateMember(this.g, this.id, patch);
      this.sheet.close();
    },
    invite() { this.sheet.close(); app.present(new InviteScreen(this.g, this.id)); },
    async remove() {
      try {
        const ok = await confirmAction({ title: `Remove ${app.store.memberName(this.g, this.id)}?`, message: 'Their past expenses stay in the group.', confirm: 'Remove' });
        if (!ok) return;
        await app.store.removeMember(this.g, this.id);
        this.sheet.close();
      } catch (e) { toast(e.message, { kind: 'error' }); }
    },
  };
}

/* ---------------- Default split ---------------- */

export class DefaultSplitScreen {
  constructor(g) {
    this.g = g;
    this.title = 'Default split';
    const ds = app.store.state(g).group.defaultSplit;
    this.d = ds ? structuredClone(ds) : { payer: 'adder', split: { mode: 'equal' } };
  }
  body() {
    const members = app.store.members(this.g);
    const mode = this.d.split.mode;
    const vals = this.d.split.values || {};
    const sum = Object.values(vals).reduce((a, b) => a + (Number(b) || 0), 0);
    return html`
      <h3 class="section-header">Paid by</h3>
      <div class="list">
        <button class="cell tappable" data-act="payer" data-v="adder"><span class="cell-main"><span class="cell-title">Whoever adds the expense</span></span>${this.d.payer === 'adder' ? html`<span class="cell-trailing tint-text">${icon('check')}</span>` : ''}</button>
        ${members.map((m) => html`<button class="cell tappable" data-act="payer" data-v="${m.id}"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span></span>${this.d.payer === m.id ? html`<span class="cell-trailing tint-text">${icon('check')}</span>` : ''}</button>`)}
      </div>
      <h3 class="section-header">Split</h3>
      <div class="center-row">${segmented('mode', [{ id: 'equal', label: 'Equally' }, { id: 'percent', label: 'Percent' }, { id: 'shares', label: 'Shares' }], mode)}</div>
      ${mode === 'equal' ? html`<p class="section-footer">New expenses are split equally between everyone in the group.</p>` : html`
        <div class="list">${members.map((m) => html`<label class="cell"><span class="cell-leading">${avatar(m)}</span><span class="cell-main"><span class="cell-title">${m.name}</span></span>
          <span class="cell-trailing"><input class="num-input" inputmode="decimal" data-field="v:${m.id}" value="${vals[m.id] ?? ''}" placeholder="0">${mode === 'percent' ? ' %' : ''}</span></label>`)}</div>
        <p class="section-footer ${mode === 'percent' && Math.abs(sum - 100) > 0.001 ? 'neg' : ''}">${mode === 'percent' ? `${Math.round(sum * 100) / 100}% of 100%` : `${sum} shares in total`}</p>`}
      <div class="list"><button class="cell tappable" data-act="save"><span class="cell-main"><span class="cell-title accent-text center">Save default</span></span></button>
        <button class="cell tappable destructive-cell" data-act="clear"><span class="cell-main"><span class="cell-title center">Reset to “split equally”</span></span></button></div>`;
  }
  onInput(f, el) {
    if (f.startsWith('v:')) {
      (this.d.split.values ||= {})[f.slice(2)] = Number(el.value.replace(',', '.')) || 0;
      const foot = this.page.querySelectorAll('.section-footer');
      const sum = Object.values(this.d.split.values).reduce((a, b) => a + b, 0);
      const last = foot[foot.length - 1];
      if (last) last.textContent = this.d.split.mode === 'percent' ? `${Math.round(sum * 100) / 100}% of 100%` : `${sum} shares in total`;
    }
  }
  on = {
    payer(el) { this.d.payer = el.dataset.v; this.nav.refresh(this); },
    seg(el) { this.d.split = { mode: el.dataset.value, values: el.dataset.value === 'equal' ? undefined : {} }; this.nav.refresh(this); },
    async save() {
      const s = this.d.split;
      if (s.mode === 'percent') {
        const sum = Object.values(s.values || {}).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 0.001) return toast('Percentages must add up to 100%');
      }
      if (s.mode === 'shares' && !Object.values(s.values || {}).some((v) => v > 0)) return toast('Give someone at least one share');
      await app.store.setGroup(this.g, { defaultSplit: this.d });
      haptic('success');
      this.nav.pop();
    },
    async clear() { await app.store.setGroup(this.g, { defaultSplit: null }); this.nav.pop(); },
  };
}
