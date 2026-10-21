// Settling up: pick a balance, record a payment (optionally paying through a
// UPI app first), remind people, and convert balances between currencies.

import { html, raw, toast, fmtDate, shareText, copyText } from '../ui/dom.js';
import { icon, avatar, groupTile } from '../ui/kit.js';
import { haptic } from '../ui/motion.js';
import { confirmAction } from '../ui/menu.js';
import { formatMoney, formatPlain, parseAmount, currencySymbol, allCurrencies, currencyName, minorDigits } from '../core/money.js';
import { groupBalances, personView, pairwise, edges } from '../core/balances.js';
import { app } from '../app/app.js';
import { actorName } from './describe.js';
import { deleteWithUndo } from './group.js';

/** Balances that involve me, from one group or all groups (optionally one friend). */
function myLines({ g, friendKey }) {
  const store = app.store;
  const out = [];
  const groups = g ? [g] : store.liveGroups();
  for (const gid of groups) {
    const me = store.meIn(gid);
    if (!me) continue;
    const view = personView(groupBalances(store.state(gid)), me);
    for (const l of view.lines) {
      if (friendKey) {
        const m = store.state(gid).member.get(l.other);
        if (!m || store.personRoot(m) !== friendKey) continue;
      }
      out.push({ g: gid, me, ...l });
    }
  }
  return out;
}

export class SettleScreen {
  constructor({ g = null, friendKey = null } = {}) { this.g = g; this.friendKey = friendKey; this.title = 'Settle up'; }
  body() {
    const store = app.store;
    const lines = myLines(this);
    return html`
      ${lines.length ? html`<h3 class="section-header">Choose a balance to settle</h3>
      <div class="list">${lines.map((l) => {
        const m = store.state(l.g).member.get(l.other);
        return html`<button class="cell tappable" data-act="pick" data-g="${l.g}" data-other="${l.other}" data-amount="${l.amount}" data-c="${l.currency}">
          <span class="cell-leading">${avatar(m)}</span>
          <span class="cell-main"><span class="cell-title">${m?.name}</span>${!this.g ? html`<span class="cell-sub">in ${store.state(l.g).group.direct ? 'non-group expenses' : store.state(l.g).group.name}</span>` : ''}</span>
          <span class="cell-trailing stacked"><span class="tiny ${l.amount > 0 ? 'pos' : 'neg'}">${l.amount > 0 ? 'owes you' : 'you owe'}</span><span class="num ${l.amount > 0 ? 'pos' : 'neg'}">${formatMoney(Math.abs(l.amount), l.currency)}</span></span>
        </button>`;
      })}</div>` : html`<div class="empty compact"><div class="empty-art">🎉</div><h2>You’re all settled up</h2><p>Nobody owes anybody${this.g ? ' in this group' : ''}.</p></div>`}
      ${this.g ? html`<div class="list"><button class="cell tappable" data-act="other"><span class="cell-main"><span class="cell-title accent-text">Record a different payment</span><span class="cell-sub">Between any two people in the group</span></span></button></div>` : ''}
      <p class="section-footer">Recording a payment here doesn’t move money. Pay in cash or with your UPI app, then record it so everyone’s balances update.</p>`;
  }
  on = {
    pick(el) {
      const { g, other, c } = el.dataset;
      const amount = Number(el.dataset.amount);
      const me = app.store.meIn(g);
      app.present(new PaymentForm({ g, from: amount > 0 ? other : me, to: amount > 0 ? me : other, amount: Math.abs(amount), currency: c }));
    },
    other() {
      const ms = app.store.members(this.g);
      const me = app.store.meIn(this.g);
      app.present(new PaymentForm({ g: this.g, from: me, to: ms.find((m) => m.id !== me)?.id, amount: 0, currency: app.store.state(this.g).group.currency || app.store.device.currency }));
    },
  };
}

function upiLink({ vpa, name, amount, currency, note }) {
  const p = new URLSearchParams({ pa: vpa, pn: name, am: formatPlain(amount, currency), cu: currency, tn: note.slice(0, 60) });
  return `upi://pay?${p.toString()}`;
}

export class PaymentForm {
  constructor({ g, from, to, amount, currency, id = null }) {
    this.g = g;
    this.editing = id;
    this.title = id ? 'Edit payment' : 'Record a payment';
    this.d = { from, to, amountText: amount ? formatPlain(amount, currency) : '', currency, date: app.store.today(), notes: '' };
    if (id) {
      const p = app.store.state(g).payment.get(id);
      Object.assign(this.d, { from: p.from, to: p.to, amountText: formatPlain(p.amount, p.currency), currency: p.currency, date: p.date, notes: p.notes || '' });
    }
  }
  leading() { return html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  actions() { return html`<button class="nav-btn text bold" data-act="save">Save</button>`; }
  get amount() { const v = parseAmount(this.d.amountText, this.d.currency); return Number.isFinite(v) ? v : 0; }
  body() {
    const store = app.store;
    const st = store.state(this.g);
    const d = this.d;
    const from = st.member.get(d.from);
    const to = st.member.get(d.to);
    const me = store.meIn(this.g);
    const canUpi = d.from === me && to?.upi && d.currency === 'INR';
    const members = store.members(this.g);
    return html`
      <div class="pay-hero">
        <div class="pay-person"><label class="pay-pick">${avatar(from, 'xxl')}<select data-field="from" aria-label="Who paid">${members.map((m) => html`<option value="${m.id}" ${m.id === d.from ? raw('selected') : ''}>${m.id === me ? 'You' : m.name}</option>`)}</select></label><span>${d.from === me ? 'You' : from?.name}</span></div>
        <button class="pay-arrow" data-act="swap" aria-label="Swap payer and recipient">${icon('arrow')}</button>
        <div class="pay-person"><label class="pay-pick">${avatar(to, 'xxl')}<select data-field="to" aria-label="Who received">${members.map((m) => html`<option value="${m.id}" ${m.id === d.to ? raw('selected') : ''}>${m.id === me ? 'You' : m.name}</option>`)}</select></label><span>${d.to === me ? 'You' : to?.name}</span></div>
      </div>
      <p class="pay-sentence">${d.from === me ? 'You' : from?.name} paid ${d.to === me ? 'you' : to?.name}</p>
      <div class="card amount-card"><span class="cur">${currencySymbol(d.currency)}</span><input class="amount-input num big" inputmode="decimal" data-field="amount" value="${d.amountText}" placeholder="0.00" aria-label="Amount" autofocus></div>
      ${canUpi ? html`<button class="btn btn-primary btn-large wide" data-act="upi">Pay ${to.name} with a UPI app</button>
        <p class="section-footer center">Opens GPay, PhonePe, Paytm or any UPI app with ${to.upi} and the amount filled in. Come back here and save when it’s done.</p>` : ''}
      <div class="list">
        <label class="cell"><span class="cell-label">Date</span><span class="cell-main"><input type="date" class="inline" data-field="date" value="${d.date}"></span></label>
        <label class="cell"><span class="cell-label">Note</span><span class="cell-main"><input class="inline" data-field="notes" value="${d.notes}" placeholder="Optional"></span></label>
      </div>
      <p class="section-footer">This records a payment that happened outside Evenly. No money moves.</p>
      ${this.editing ? html`<div class="list"><button class="cell tappable destructive-cell" data-act="delete"><span class="cell-main"><span class="cell-title center">Delete payment</span></span></button></div>` : ''}`;
  }
  onInput(f, el) {
    if (f === 'amount') this.d.amountText = el.value;
    if (f === 'notes') this.d.notes = el.value;
  }
  onChange(f, el) {
    if (f === 'date') this.d.date = el.value;
    if (f === 'from' || f === 'to') { this.d[f] = el.value; this.nav.refresh(this); }
  }
  on = {
    cancel() { this.sheet.close(); },
    swap() { [this.d.from, this.d.to] = [this.d.to, this.d.from]; haptic(); this.nav.refresh(this); },
    upi() {
      const to = app.store.state(this.g).member.get(this.d.to);
      if (!this.amount) return toast('Enter an amount first');
      location.href = upiLink({ vpa: to.upi, name: to.name, amount: this.amount, currency: this.d.currency, note: `Evenly: ${app.store.state(this.g).group.name}` });
    },
    async save() {
      const d = this.d;
      if (!this.amount || this.amount < 0) return toast('Enter an amount');
      if (d.from === d.to) return toast('Choose two different people');
      if (this.editing) await app.store.savePayment(this.g, this.editing, { from: d.from, to: d.to, amount: this.amount, currency: d.currency, date: d.date, notes: d.notes });
      else await app.store.recordPayment(this.g, { from: d.from, to: d.to, amount: this.amount, currency: d.currency, date: d.date, notes: d.notes });
      haptic('success');
      this.sheet.close();
      toast('Payment recorded', { action: { label: 'Share', run: () => app.shareUpdates(this.g) } });
    },
    async delete() {
      const ok = await confirmAction({ title: 'Delete this payment?', confirm: 'Delete payment' });
      if (!ok) return;
      this.sheet.close();
      await deleteWithUndo(this.g, 'payment', this.editing);
    },
  };
}

export class PaymentScreen {
  constructor(g, id) { this.g = g; this.id = id; this.title = 'Payment'; }
  get p() { return app.store.state(this.g)?.payment.get(this.id); }
  actions() { return this.p && !this.p.deleted ? html`<button class="nav-btn text bold" data-act="edit">Edit</button>` : ''; }
  body() {
    const p = this.p;
    if (!p) return html`<p class="empty-note">This payment isn’t on this phone.</p>`;
    const store = app.store;
    const st = store.state(this.g);
    return html`
      ${p.deleted ? html`<div class="banner tint-red"><span>This payment was deleted.</span><button class="btn btn-small" data-act="restore">Restore</button></div>` : ''}
      <div class="pay-hero static">
        <div class="pay-person">${avatar(st.member.get(p.from), 'xxl')}<span>${store.memberName(this.g, p.from)}</span></div>
        <span class="pay-arrow">${icon('arrow')}</span>
        <div class="pay-person">${avatar(st.member.get(p.to), 'xxl')}<span>${store.memberName(this.g, p.to)}</span></div>
      </div>
      <p class="hero-amount num center">${formatMoney(p.amount, p.currency)}</p>
      <p class="hero-meta center">${fmtDate(p.date)} · ${st.group.name}</p>
      <p class="hero-meta center">Recorded by ${actorName(this.g, p._ops[0].d)}</p>
      ${p.notes ? html`<div class="card notes">${p.notes}</div>` : ''}`;
  }
  on = {
    edit() { app.present(new PaymentForm({ g: this.g, id: this.id })); },
    async restore() { await app.store.restoreEntity(this.g, 'payment', this.id); },
  };
}

/* ---------------- Remind ---------------- */

export class RemindScreen {
  constructor({ g = null, name, amount, currency, debtor = null }) {
    this.title = 'Remind';
    const store = app.store;
    const upi = store.device.upi;
    const where = g ? ` for “${store.state(g).group.name}”` : '';
    this.text = `Hi ${name}! Just a friendly reminder: you owe me ${formatMoney(amount, currency)}${where}.`
      + (upi && currency === 'INR' ? `\nYou can pay by UPI to ${upi}.` : '')
      + '\n— sent from Evenly';
  }
  leading() { return html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  body() {
    return html`<p class="section-footer">Evenly can’t send messages for you (there’s no server). Edit the text, then send it with WhatsApp, SMS or any app.</p>
      <div class="card"><textarea class="remind-text" data-field="text" rows="6" aria-label="Reminder message">${this.text}</textarea></div>
      <div class="button-stack">
        <button class="btn btn-primary btn-large wide" data-act="share">${icon('share')} Send with…</button>
        <button class="btn btn-tinted wide" data-act="whatsapp">Open in WhatsApp</button>
        <button class="btn btn-plain wide" data-act="copy">Copy text</button>
      </div>`;
  }
  onInput(f, el) { this.text = el.value; }
  on = {
    cancel() { this.sheet.close(); },
    async share() {
      if (!(await shareText({ text: this.text }))) { await copyText(this.text); toast('Copied. Paste it in any app.'); }
    },
    whatsapp() { window.open(`https://wa.me/?text=${encodeURIComponent(this.text)}`, '_blank', 'noopener'); },
    async copy() { await copyText(this.text); toast('Copied'); haptic(); },
  };
}

/* ---------------- Currency conversion ---------------- */

export class ConvertScreen {
  constructor(g) {
    this.g = g;
    this.title = 'Convert currency';
    const pw = pairwise(app.store.state(g));
    const owing = Object.keys(pw).filter((c) => edges(pw[c]).length);
    this.from = owing.find((c) => c !== (app.store.state(g).group.currency || app.store.device.currency)) || owing[0] || 'USD';
    this.to = app.store.state(g).group.currency || app.store.device.currency;
    this.rateText = '';
    this.fetched = null;
  }
  leading() { return html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  body() {
    const store = app.store;
    const pw = pairwise(store.state(this.g));
    const owing = Object.keys(pw).filter((c) => edges(pw[c]).length);
    const list = edges(pw[this.from]);
    const rate = Number(this.rateText.replace(',', '.'));
    const scale = 10 ** (minorDigits(this.to) - minorDigits(this.from));
    const opt = (cur, sel) => html`<option value="${cur}" ${cur === sel ? raw('selected') : ''}>${cur} · ${currencyName(cur)}</option>`;
    return html`
      <p class="section-footer">Turns every debt in one currency into another at a rate you choose. The rate is saved with the conversion, so everyone’s phone gets the same numbers.</p>
      <div class="list">
        <label class="cell"><span class="cell-label">From</span><span class="cell-main"><select class="inline-select" data-field="from">${(owing.length ? owing : [this.from]).map((c) => opt(c, this.from))}</select></span></label>
        <label class="cell"><span class="cell-label">To</span><span class="cell-main"><select class="inline-select" data-field="to">${allCurrencies().map((c) => opt(c, this.to))}</select></span></label>
        <label class="cell"><span class="cell-label">Rate</span><span class="cell-main"><input class="inline num" inputmode="decimal" data-field="rate" value="${this.rateText}" placeholder="1 ${this.from} = ? ${this.to}"></span>
          <button class="btn btn-small btn-tinted" data-act="fetch">Today’s rate</button></label>
      </div>
      ${this.fetched ? html`<p class="section-footer">Rate from the European Central Bank via frankfurter.app, ${this.fetched}. Only the two currency codes were sent.</p>` : ''}
      <h3 class="section-header">Preview</h3>
      ${list.length ? html`<div class="list">${list.map((e) => html`<div class="cell"><span class="cell-main"><span class="cell-title">${store.memberName(this.g, e.debtor)} → ${store.memberName(this.g, e.creditor)}</span>
        <span class="cell-sub">${formatMoney(e.amount, this.from)}${rate > 0 ? html` becomes <strong>${formatMoney(Math.round(e.amount * rate * scale), this.to)}</strong>` : ''}</span></span></div>`)}</div>`
        : html`<p class="empty-note">Nothing is owed in ${this.from}.</p>`}
      <div class="list"><button class="cell tappable" data-act="convert" ${list.length && rate > 0 && this.from !== this.to ? '' : raw('disabled')}><span class="cell-main"><span class="cell-title accent-text center">Convert ${this.from} to ${this.to}</span></span></button></div>`;
  }
  onInput(f, el) { if (f === 'rate') this.rateText = el.value; }
  onChange(f, el) {
    if (f === 'from' || f === 'to') { this[f] = el.value; this.fetched = null; this.rateText = ''; }
    if (f === 'rate') this.rateText = el.value;
    this.nav.refresh(this);
  }
  on = {
    cancel() { this.sheet.close(); },
    async fetch(el) {
      el.disabled = true;
      try {
        const r = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(this.from)}&to=${encodeURIComponent(this.to)}`);
        if (!r.ok) throw new Error();
        const j = await r.json();
        const rate = j.rates?.[this.to];
        if (!rate) throw new Error();
        this.rateText = String(rate);
        this.fetched = j.date;
      } catch {
        toast(`No published rate for ${this.from} → ${this.to}. Type one in.`);
      }
      this.nav.refresh(this);
    },
    async convert() {
      const rate = Number(this.rateText.replace(',', '.'));
      const ok = await confirmAction({ title: `Convert ${this.from} balances to ${this.to}?`, message: `1 ${this.from} = ${rate} ${this.to}. Everyone sees the same result once you share updates.`, confirm: 'Convert', destructive: false });
      if (!ok) return;
      try {
        await app.store.convertCurrency(this.g, this.from, this.to, rate);
        haptic('success');
        this.sheet.close();
        toast('Converted');
      } catch (e) { toast(e.message, { kind: 'error' }); }
    },
  };
}
