// The four root tabs (Groups, Friends, Activity, Account) plus Search and Friend detail.

import { html, raw, toast, relativeTime, fmtDate } from '../ui/dom.js';
import { icon, groupTile, avatar, balanceText, money, catIcon, segmented, toggle } from '../ui/kit.js';
import { showMenu, confirmAction } from '../ui/menu.js';
import { formatMoney, allCurrencies, currencyName } from '../core/money.js';
import { groupBalances, personView, expenseEffect } from '../core/balances.js';
import { live } from '../core/ledger.js';
import { app } from '../app/app.js';
import { describe } from './describe.js';
import { GroupScreen, NewGroupScreen } from './group.js';
import { ExpenseScreen, ExpenseForm, ScanScreen } from './expense.js';
import { SettleScreen, PaymentScreen, RemindScreen, ConvertScreen } from './settle.js';
import { ImportScreen, NearbyScreen, InviteScreen, BackupScreen } from './sync.js';
import { ProfileScreen, AboutScreen, lockSupported, enableLock } from './account.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'outstanding', label: 'Outstanding balances' },
  { id: 'owe', label: 'You owe' },
  { id: 'owed', label: 'Owe you' },
];

const passes = (filter, totals) => {
  const vals = Object.values(totals);
  if (filter === 'outstanding') return vals.some((v) => v);
  if (filter === 'owe') return vals.some((v) => v < 0);
  if (filter === 'owed') return vals.some((v) => v > 0);
  return true;
};

function overallLine(total) {
  const entries = Object.entries(total);
  if (!entries.length) return html`<p class="summary-line">You’re all settled up.</p>`;
  const pos = entries.filter(([, v]) => v > 0);
  const neg = entries.filter(([, v]) => v < 0);
  return html`<p class="summary-line">Overall, ${pos.length ? html`you are owed <span class="pos">${pos.map(([c, v]) => formatMoney(v, c)).join(' + ')}</span>` : ''}${pos.length && neg.length ? ' and ' : ''}${neg.length ? html`you owe <span class="neg">${neg.map(([c, v]) => formatMoney(-v, c)).join(' + ')}</span>` : ''}</p>`;
}

function addAccessory() {
  return html`<button class="capsule glass" data-act="scan" aria-label="Scan a receipt">${icon('scan')}</button>
    <button class="capsule glass primary" data-act="add">${icon('plus')}<span>Add expense</span></button>`;
}

export const sharedAddHandlers = {
  add() { app.present(new ExpenseForm({ g: this.g || null })); },
  scan() { app.present(new ScanScreen({ g: this.g || null })); },
};

/* ---------------- Groups ---------------- */

export class GroupsScreen {
  constructor() {
    this.title = 'Groups';
    this.large = true;
    this.filter = 'all';
    this.showSettled = false;
    this.accessory = addAccessory;
  }
  actions() {
    return html`<button class="nav-btn" data-act="search" aria-label="Search">${icon('search')}</button>
      <button class="nav-btn" data-act="newGroup" aria-label="Create a group">${icon('plus')}</button>`;
  }
  body() {
    const store = app.store;
    const groups = store.liveGroups({ includeDirect: false });
    const direct = store.liveGroups().filter((g) => store.state(g).group.direct);
    if (!groups.length && !direct.length) {
      return html`<div class="empty">
        <div class="empty-art">🧾</div>
        <h2>Split costs with anyone</h2>
        <p>Create a group for a trip, your flat or a dinner. Everything stays on your phone and syncs with friends through links.</p>
        <button class="btn btn-primary btn-large" data-act="newGroup">Create a group</button>
        <button class="btn btn-tinted" data-act="addFriend">Split with one friend</button>
        <button class="btn btn-plain" data-act="paste">I have an invite link</button>
      </div>`;
    }
    const monthAgo = store.now() - 30 * 864e5;
    const rows = [];
    let hidden = 0;
    for (const g of groups) {
      const st = store.state(g);
      const bal = groupBalances(st);
      const view = personView(bal, store.meIn(g));
      if (!passes(this.filter, view.total)) continue;
      const lastTouch = Math.max(st.group._updated || 0, ...[...st.expense.values(), ...st.payment.values()].map((e) => e._updated || 0));
      const settled = !Object.keys(view.total).length;
      if (settled && lastTouch < monthAgo && !this.showSettled && this.filter === 'all') { hidden++; continue; }
      rows.push({ g, st, view, lastTouch });
    }
    rows.sort((a, b) => b.lastTouch - a.lastTouch);
    const directTotals = {};
    const directLines = [];
    for (const g of direct) {
      const v = personView(groupBalances(store.state(g)), store.meIn(g));
      for (const [c, n] of Object.entries(v.total)) directTotals[c] = (directTotals[c] || 0) + n;
      v.lines.forEach((l) => directLines.push({ ...l, g }));
    }
    return html`
      <div class="summary">
        ${overallLine(store.overall())}
        <button class="nav-btn tinted" data-act="filter" aria-label="Filter groups">${icon('filter')}</button>
      </div>
      ${this.filter !== 'all' ? html`<p class="filter-note">Showing: ${FILTERS.find((f) => f.id === this.filter).label} <button class="link" data-act="clearFilter">Show all</button></p>` : ''}
      <div class="cards">
        ${rows.map(({ g, st, view }) => html`
          <button class="group-card" data-act="open" data-g="${g}">
            ${groupTile(st.group, 'xl')}
            <span class="gc-main">
              <span class="gc-name">${st.group.name}</span>
              <span class="gc-bal">${balanceText(view.total)}</span>
              ${view.lines.slice(0, 2).map((l) => html`<span class="gc-line">${l.amount > 0
                ? html`${store.memberName(g, l.other)} owes you <span class="pos">${formatMoney(l.amount, l.currency)}</span>`
                : html`You owe ${store.memberName(g, l.other)} <span class="neg">${formatMoney(-l.amount, l.currency)}</span>`}</span>`)}
              ${view.lines.length > 2 ? html`<span class="gc-line muted">Plus ${view.lines.length - 2} more</span>` : ''}
            </span>
          </button>`)}
        ${direct.length && passes(this.filter, directTotals) ? html`
          <button class="group-card" data-act="friendsTab">
            <span class="group-tile tint-gray xl" aria-hidden="true">🤝</span>
            <span class="gc-main">
              <span class="gc-name">Non-group expenses</span>
              <span class="gc-bal">${balanceText(directTotals)}</span>
              ${directLines.slice(0, 2).map((l) => html`<span class="gc-line">${l.amount > 0
                ? html`${store.memberName(l.g, l.other)} owes you <span class="pos">${formatMoney(l.amount, l.currency)}</span>`
                : html`You owe ${store.memberName(l.g, l.other)} <span class="neg">${formatMoney(-l.amount, l.currency)}</span>`}</span>`)}
            </span>
          </button>` : ''}
      </div>
      ${!rows.length && this.filter !== 'all' ? html`<p class="empty-note">No groups match this filter.</p>` : ''}
      ${hidden ? html`<div class="settled-note"><p>Hiding groups that have been settled up for over a month.</p><button class="btn btn-tinted" data-act="showSettled">Show ${hidden} settled-up group${hidden > 1 ? 's' : ''}</button></div>` : ''}
      <div class="bottom-space"></div>`;
  }
  on = {
    ...sharedAddHandlers,
    open(el) { app.show(new GroupScreen(el.dataset.g), this); },
    newGroup() { app.present(new NewGroupScreen()); },
    addFriend() { app.present(new AddFriendScreen()); },
    paste() { app.present(new ImportScreen()); },
    search() { app.show(new SearchScreen(), this); },
    friendsTab() { app.selectTab('friends'); },
    showSettled() { this.showSettled = true; this.nav.refresh(this); },
    clearFilter() { this.filter = 'all'; this.nav.refresh(this); },
    async filter(el) {
      const id = await showMenu(el, FILTERS.map((f) => ({ ...f, checked: f.id === this.filter })));
      if (id) { this.filter = id; this.nav.refresh(this); }
    },
  };
}

/* ---------------- Friends ---------------- */

export class FriendsScreen {
  constructor() {
    this.title = 'Friends';
    this.large = true;
    this.filter = 'all';
    this.accessory = addAccessory;
  }
  actions() {
    return html`<button class="nav-btn" data-act="search" aria-label="Search">${icon('search')}</button>
      <button class="nav-btn" data-act="addFriend" aria-label="Add a friend">${icon('plus')}</button>`;
  }
  body() {
    const store = app.store;
    const friends = store.friends().filter((f) => passes(this.filter, f.total));
    if (!store.friends().length) {
      return html`<div class="empty">
        <div class="empty-art">🤝</div>
        <h2>No friends yet</h2>
        <p>People you share a group with show up here, with one balance across all your groups.</p>
        <button class="btn btn-primary btn-large" data-act="addFriend">Add a friend</button>
      </div>`;
    }
    return html`
      <div class="summary">${overallLine(store.overall())}
        <button class="nav-btn tinted" data-act="filter" aria-label="Filter friends">${icon('filter')}</button></div>
      <div class="list"><button class="cell tappable" data-act="addFriend"><span class="cell-leading"><span class="sq tint-indigo">${icon('plus')}</span></span>
        <span class="cell-main"><span class="cell-title accent-text">Add a friend</span><span class="cell-sub">Track what you owe each other outside any group</span></span></button></div>
      <div class="list">
        ${friends.map((f) => {
          const t = Object.entries(f.total);
          const sign = t.length ? Math.sign(t[0][1]) : 0;
          return html`<button class="cell tappable friend-cell" data-act="open" data-key="${f.key}">
            <span class="cell-leading">${avatar({ ...f, id: f.key }, 'lg')}</span>
            <span class="cell-main">
              <span class="cell-title">${f.name}</span>
              ${f.breakdown.slice(0, 3).map((b) => html`<span class="cell-sub">${b.amount > 0 ? 'Owes you' : 'You owe'} ${formatMoney(Math.abs(b.amount), b.currency)} in “${store.state(b.g).group.direct ? 'non-group' : store.state(b.g).group.name}”</span>`)}
            </span>
            <span class="cell-trailing stacked">${t.length ? html`<span class="tiny ${sign > 0 ? 'pos' : 'neg'}">${sign > 0 ? 'owes you' : 'you owe'}</span>
              ${t.map(([c, v]) => html`<span class="num ${v > 0 ? 'pos' : 'neg'}">${formatMoney(Math.abs(v), c)}</span>`)}` : html`<span class="tiny muted">settled up</span>`}</span>
          </button>`;
        })}
      </div>
      <div class="bottom-space"></div>`;
  }
  on = {
    ...sharedAddHandlers,
    open(el) {
      const f = app.store.friends().find((x) => x.key === el.dataset.key);
      if (f) app.show(new FriendScreen(f.key), this);
    },
    search() { app.show(new SearchScreen(), this); },
    addFriend() { app.present(new AddFriendScreen()); },
    async filter(el) {
      const id = await showMenu(el, FILTERS.map((f) => ({ ...f, checked: f.id === this.filter })));
      if (id) { this.filter = id; this.nav.refresh(this); }
    },
  };
}

/**
 * A one-to-one ledger with a friend. Standalone it ends by opening the
 * ledger and the friend's invite; inside the expense form, `onDone(g)` picks it.
 */
export class AddFriendScreen {
  constructor({ onDone = null } = {}) { this.title = 'Add a friend'; this.name = ''; this.onDone = onDone; }
  leading() { return this.onDone ? '' : html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  actions() { return html`<button class="nav-btn text bold" data-act="save">Add</button>`; }
  body() {
    return html`<div class="form-intro"><p>Evenly makes a private ledger for the two of you. Next you’ll get a link to send them on WhatsApp, so they can see and add expenses too.</p></div>
      <div class="list"><form class="cell add-person"><span class="cell-main"><input class="inline" data-field="name" placeholder="Friend’s name" autocomplete="off" autofocus enterkeyhint="done" value="${this.name}"></span></form></div>`;
  }
  afterRender(page) { page.querySelector('form')?.addEventListener('submit', (e) => { e.preventDefault(); this.on.save.call(this); }); }
  onInput(f, el) { this.name = el.value; }
  on = {
    cancel() { this.sheet.close(); },
    async save() {
      if (!this.name.trim()) return toast('Type a name first');
      const g = await app.store.directWith({ key: 'new:' + this.name, name: this.name.trim(), emoji: null, anyPersonId: null });
      if (this.onDone) return this.onDone(g);
      this.sheet.close();
      app.openGroup(g);
      app.present(new InviteScreen(g));
    },
  };
}

export class FriendScreen {
  constructor(key) { this.key = key; this.backTitle = 'Friends'; }
  get friend() { return app.store.friends().find((f) => f.key === this.key); }
  title() { return this.friend?.name || 'Friend'; }
  accessory() { return html`<button class="capsule glass primary" data-act="add">${icon('plus')}<span>Add expense</span></button>`; }
  body() {
    const f = this.friend;
    if (!f) return html`<div class="empty"><p>This person isn’t in any of your groups any more.</p></div>`;
    const store = app.store;
    const t = Object.entries(f.total);
    const currencies = new Set();
    const items = [];
    for (const { g, id } of f.members) {
      const st = store.state(g);
      const me = store.meIn(g);
      for (const e of live(st, 'expense')) {
        const eff = expenseEffect(e, me);
        const theirs = expenseEffect(e, id);
        if (eff.kind === 'none' || theirs.kind === 'none') continue; // only what you both share
        currencies.add(e.currency);
        items.push({ g, e, eff });
      }
    }
    items.sort((a, b) => (b.e.date || '').localeCompare(a.e.date || ''));
    const direct = f.members.find(({ g }) => store.state(g).group.direct);
    return html`
      <div class="hero">
        ${avatar({ ...f, id: f.key }, 'xxl')}
        <h2>${f.name}</h2>
        <p class="hero-bal">${t.length ? t.map(([c, v]) => html`<span class="${v > 0 ? 'pos' : 'neg'}">${v > 0 ? `${f.name} owes you ` : `You owe ${f.name} `}${formatMoney(Math.abs(v), c)}</span><br>`) : html`<span class="muted">You’re settled up</span>`}</p>
      </div>
      <div class="chips">
        <button class="chip accent" data-act="settle">Settle up</button>
        <button class="chip" data-act="remind">Remind…</button>
        ${currencies.size > 1 || t.length > 1 ? html`<button class="chip" data-act="convert">Convert currency</button>` : ''}
        ${!direct ? html`<button class="chip" data-act="direct">Non-group expense</button>` : ''}
        ${direct ? html`<button class="chip" data-act="invite">Invite to sync</button>` : ''}
      </div>
      ${f.breakdown.length ? html`<h3 class="section-header">Balances by group</h3><div class="list">
        ${f.breakdown.map((b) => html`<button class="cell tappable" data-act="group" data-g="${b.g}">
          <span class="cell-leading">${groupTile(store.state(b.g).group)}</span>
          <span class="cell-main"><span class="cell-title">${store.state(b.g).group.direct ? 'Non-group expenses' : store.state(b.g).group.name}</span></span>
          <span class="cell-trailing">${money(b.amount, b.currency, { signed: true })}</span></button>`)}
      </div>` : ''}
      <h3 class="section-header">Shared expenses</h3>
      ${items.length ? html`<div class="list">${items.slice(0, 80).map(({ g, e, eff }) => html`
        <button class="cell tappable" data-act="expense" data-g="${g}" data-id="${e.id}">
          <span class="cell-leading">${catIcon(e.category)}</span>
          <span class="cell-main"><span class="cell-title">${e.desc}</span><span class="cell-sub">${fmtDate(e.date)} · ${store.state(g).group.direct ? 'Non-group' : store.state(g).group.name}</span></span>
          <span class="cell-trailing stacked"><span class="tiny ${eff.kind === 'lent' ? 'pos' : eff.kind === 'borrowed' ? 'neg' : 'muted'}">${eff.kind === 'lent' ? 'you lent' : eff.kind === 'borrowed' ? 'you borrowed' : ''}</span>${eff.amount ? money(eff.amount, e.currency) : ''}</span>
        </button>`)}</div>` : html`<p class="empty-note">Nothing shared yet.</p>`}
      <div class="bottom-space"></div>`;
  }
  on = {
    add() {
      const f = this.friend;
      const direct = f?.members.find(({ g }) => app.store.state(g).group.direct);
      app.present(new ExpenseForm({ g: direct?.g || f?.members[0]?.g || null }));
    },
    settle() { app.show(new SettleScreen({ friendKey: this.key }), this); },
    remind() {
      const f = this.friend;
      const line = Object.entries(f.total).find(([, v]) => v > 0);
      if (!line) return toast(`${f.name} doesn’t owe you anything.`);
      app.present(new RemindScreen({ name: f.name, amount: line[1], currency: line[0] }));
    },
    convert() {
      const b = this.friend.breakdown[0];
      if (b) app.present(new ConvertScreen(b.g));
    },
    async direct() {
      const g = await app.store.directWith(this.friend);
      app.present(new ExpenseForm({ g }));
    },
    invite() {
      const f = this.friend;
      const d = f.members.find(({ g }) => app.store.state(g).group.direct);
      app.present(new InviteScreen(d.g, d.id));
    },
    group(el) { app.show(new GroupScreen(el.dataset.g), this); },
    expense(el) { app.show(new ExpenseScreen(el.dataset.g, el.dataset.id), this); },
  };
}

/* ---------------- Activity ---------------- */

export class ActivityScreen {
  constructor() { this.title = 'Activity'; this.large = true; }
  actions() { return html`<button class="nav-btn" data-act="search" aria-label="Search">${icon('search')}</button>`; }
  body() {
    const items = app.store.activity({ limit: 300 });
    if (!items.length) return html`<div class="empty"><div class="empty-art">✨</div><h2>Nothing yet</h2><p>Changes you and your friends make show up here.</p></div>`;
    return html`<div class="list activity">
      ${items.map((it) => {
        const d = describe(it);
        const st = app.store.state(it.g);
        const actor = [...st.member.values()].find((m) => m.claimedBy === it.op.d);
        return html`<button class="cell tappable act-cell ${it.unread ? 'unread' : ''}" data-act="open" data-g="${it.g}" data-t="${it.op.t}" data-id="${it.op.e}" data-on="${it.ent.on || ''}">
          <span class="cell-leading">${it.op.t === 'expense' ? catIcon(it.ent.category) : avatar(actor || { name: '?', id: it.op.d })}</span>
          <span class="cell-main"><span class="cell-text">${d.text}</span>
            ${d.effect ? html`<span class="cell-sub ${d.effectKind}">${d.effect}</span>` : ''}
            <span class="cell-meta">${relativeTime(it.op.c, app.store.now())}</span></span>
          ${it.unread ? html`<span class="unread-dot" aria-label="New"></span>` : ''}
        </button>`;
      })}
    </div><div class="bottom-space"></div>`;
  }
  mount() { setTimeout(() => app.store.markSeen(), 1500); }
  on = {
    search() { app.show(new SearchScreen(), this); },
    open(el) {
      const { g, t, id, on } = el.dataset;
      if (t === 'expense' || t === 'receipt') app.show(new ExpenseScreen(g, id), this);
      else if (t === 'comment' && on) app.show(new ExpenseScreen(g, on), this);
      else if (t === 'payment') app.show(new PaymentScreen(g, id), this);
      else if (app.store.state(g) && !app.store.state(g).group.deleted) app.show(new GroupScreen(g), this);
    },
  };
}

/* ---------------- Search ---------------- */

export class SearchScreen {
  constructor() { this.title = 'Search'; this.q = ''; }
  body() {
    const res = app.store.search(this.q);
    return html`
      <div class="searchbar"><span class="sb-icon">${icon('search')}</span>
        <input type="search" data-field="q" placeholder="Expenses, notes, amounts, items" value="${this.q}" autofocus enterkeyhint="search"></div>
      <div class="results">${this.#results(res)}</div>`;
  }
  #results(res) {
    if (!this.q.trim()) return html`<p class="empty-note">Search every group on this phone. Try a place, an amount or an item name.</p>`;
    if (!res.length) return html`<p class="empty-note">No results for “${this.q}”.</p>`;
    return html`<div class="list">${res.slice(0, 200).map(({ g, e }) => {
      const eff = expenseEffect(e, app.store.meIn(g));
      return html`<button class="cell tappable" data-act="open" data-g="${g}" data-id="${e.id}">
        <span class="cell-leading">${catIcon(e.category)}</span>
        <span class="cell-main"><span class="cell-title">${e.desc}</span><span class="cell-sub">${fmtDate(e.date)} · ${app.store.state(g).group.name}</span></span>
        <span class="cell-trailing stacked"><span class="num">${formatMoney(e.amount, e.currency)}</span>
        ${eff.amount ? html`<span class="tiny ${eff.kind === 'lent' ? 'pos' : 'neg'}">${eff.kind === 'lent' ? 'you lent' : 'you borrowed'} ${formatMoney(eff.amount, e.currency)}</span>` : ''}</span></button>`;
    })}</div>`;
  }
  onInput(f, el) {
    this.q = el.value;
    this.page.querySelector('.results').innerHTML = String(this.#results(app.store.search(this.q)));
  }
  on = { open(el) { app.show(new ExpenseScreen(el.dataset.g, el.dataset.id), this); } };
}

/* ---------------- Account ---------------- */

export class AccountScreen {
  constructor() { this.title = 'Account'; this.large = true; }
  body() {
    const { device, settings } = app.store;
    const groups = app.store.liveGroups().length;
    const ops = app.store.liveGroups().reduce((n, g) => n + app.store.groups.get(g).ledger.ops.size, 0);
    return html`
      <div class="list">
        <button class="cell tappable profile-cell" data-act="profile">
          <span class="cell-leading">${avatar({ name: device.name, emoji: device.emoji, id: device.id }, 'xl')}</span>
          <span class="cell-main"><span class="cell-title big">${device.name}</span>
            <span class="cell-sub">${device.upi ? `UPI: ${device.upi}` : 'Add your UPI ID so friends can pay you'}</span></span>
        </button>
      </div>

      <h3 class="section-header">Sync with friends</h3>
      <div class="list">
        <button class="cell tappable" data-act="paste"><span class="cell-leading">${raw('<span class="sq tint-blue">')}${icon('link')}${raw('</span>')}</span><span class="cell-main"><span class="cell-title">Open an invite or update link</span></span></button>
        <button class="cell tappable" data-act="nearby"><span class="cell-leading">${raw('<span class="sq tint-green">')}${icon('sync')}${raw('</span>')}</span><span class="cell-main"><span class="cell-title">Live sync with a nearby phone</span><span class="cell-sub">Phone to phone over Wi-Fi, no server</span></span></button>
      </div>
      <p class="section-footer">There’s no Evenly server. Your groups live on this phone and on your friends’ phones, and changes travel in encrypted links you send each other.</p>

      <h3 class="section-header">Preferences</h3>
      <div class="list">
        <div class="cell"><span class="cell-main"><span class="cell-title">Appearance</span></span>
          <span class="cell-trailing">${segmented('theme', [{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'system', label: 'Auto' }], settings.theme)}</span></div>
        <label class="cell"><span class="cell-main"><span class="cell-title">Default currency</span></span>
          <span class="cell-trailing"><select data-field="currency" class="inline-select">${allCurrencies().map((c) => html`<option value="${c}" ${c === device.currency ? raw('selected') : ''}>${c} · ${currencyName(c)}</option>`)}</select></span></label>
        <div class="cell"><span class="cell-main"><span class="cell-title">App lock</span><span class="cell-sub">${lockSupported() ? 'Fingerprint, face or screen lock to open Evenly' : 'Not available in this browser'}</span></span>
          <span class="cell-trailing">${toggle('lock', settings.lock, 'App lock')}</span></div>
        ${settings.lock ? html`<label class="cell"><span class="cell-main"><span class="cell-title">Lock after</span></span>
          <span class="cell-trailing"><select data-field="lockTimeout" class="inline-select">
            ${[[0, 'Immediately'], [5, '5 seconds'], [60, '1 minute'], [300, '5 minutes'], [900, '15 minutes']].map(([v, l]) => html`<option value="${v}" ${v === settings.lockTimeout ? raw('selected') : ''}>${l}</option>`)}
          </select></span></label>` : ''}
      </div>
      ${settings.lock ? html`<p class="section-footer">The lock keeps people from opening Evenly on your unlocked phone. It doesn’t encrypt what’s stored on this phone.</p>` : ''}

      <h3 class="section-header">Your data</h3>
      <div class="list">
        <button class="cell tappable" data-act="backup"><span class="cell-leading">${raw('<span class="sq tint-indigo">')}${icon('download')}${raw('</span>')}</span><span class="cell-main"><span class="cell-title">Back up or restore</span><span class="cell-sub">${groups} group${groups === 1 ? '' : 's'} · ${ops} changes stored on this phone</span></span></button>
        <button class="cell tappable" data-act="about"><span class="cell-leading">${raw('<span class="sq tint-gray">')}${icon('globe')}${raw('</span>')}</span><span class="cell-main"><span class="cell-title">How Evenly works</span><span class="cell-sub">Free, private, no servers</span></span></button>
      </div>

      <div class="list">
        <button class="cell tappable destructive-cell" data-act="erase"><span class="cell-main"><span class="cell-title">Erase everything on this phone</span></span></button>
      </div>
      <p class="section-footer center">Evenly 1.0 · Every feature is free</p>
      <div class="bottom-space"></div>`;
  }
  async onChange(field, el) {
    const store = app.store;
    if (field === 'currency') return store.updateDevice({ currency: el.value });
    if (field === 'lockTimeout') return store.updateSettings({ lockTimeout: Number(el.value) });
    if (field === 'lock') {
      if (!el.checked) return store.updateSettings({ lock: false, credentialId: null });
      try {
        const credentialId = await enableLock(store.device);
        await store.updateSettings({ lock: true, credentialId });
        toast('App lock is on');
      } catch (e) {
        el.checked = false;
        toast(e.message || 'Couldn’t turn on the lock');
      }
    }
  }
  on = {
    profile() { app.present(new ProfileScreen()); },
    paste() { app.present(new ImportScreen()); },
    nearby() { app.present(new NearbyScreen()); },
    backup() { app.present(new BackupScreen()); },
    about() { app.show(new AboutScreen(), this); },
    seg(el) { app.store.updateSettings({ theme: el.dataset.value }); },
    async erase() {
      const ok = await confirmAction({ title: 'Erase everything?', message: 'All groups, expenses and your profile will be removed from this phone. Friends keep their copies. Back up first if you might want this again.', confirm: 'Erase everything' });
      if (!ok) return;
      await app.store.wipe();
      location.hash = '';
      location.reload();
    },
  };
}

