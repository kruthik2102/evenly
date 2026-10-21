// Balances are derived, never stored: every device computes them from the same
// ledger and gets the same answer.

import { allocate } from './money.js';
import { computeShares } from './split.js';
import { live } from './ledger.js';

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** { paid, owed } for one expense, or null if its split doesn't add up. */
export function expenseParts(exp) {
  const res = computeShares(exp.amount || 0, exp.split);
  if (!res.ok) return null;
  return { paid: exp.paidBy || {}, owed: res.shares };
}

/**
 * Directed debts before any simplification, per currency:
 * { INR: Map("a|b" → n) } where n > 0 means a owes b, n < 0 means b owes a (a < b).
 */
export function pairwise(state) {
  const out = {};
  const add = (cur, debtor, creditor, amt) => {
    if (!amt || debtor === creditor) return;
    const m = (out[cur] ||= new Map());
    const [a, b, sign] = debtor < creditor ? [debtor, creditor, 1] : [creditor, debtor, -1];
    const k = a + '|' + b;
    m.set(k, (m.get(k) || 0) + sign * amt);
  };

  for (const exp of live(state, 'expense')) {
    const parts = expenseParts(exp);
    if (!parts) continue;
    const payers = Object.keys(parts.paid).filter((id) => parts.paid[id] > 0).sort(byId);
    const weights = payers.map((id) => parts.paid[id]);
    for (const [debtor, owed] of Object.entries(parts.owed)) {
      allocate(owed, weights).forEach((amt, i) => add(exp.currency, debtor, payers[i], amt));
    }
  }
  for (const p of live(state, 'payment')) {
    // "from paid to": to now owes from that much back (cancels from's debt).
    add(p.currency, p.to, p.from, p.amount);
  }
  for (const c of live(state, 'conversion')) {
    for (const t of c.transfers || []) {
      add(c.from, t.creditor, t.debtor, t.fromAmount); // remove the old-currency debt
      add(c.to, t.debtor, t.creditor, t.toAmount); // re-create it in the new currency
    }
  }
  return out;
}

/** Net per person per currency: positive = gets back. */
export function netBalances(state, pw = pairwise(state)) {
  const out = {};
  for (const [cur, m] of Object.entries(pw)) {
    const net = (out[cur] ||= {});
    for (const [k, v] of m) {
      const [a, b] = k.split('|');
      net[a] = (net[a] || 0) - v;
      net[b] = (net[b] || 0) + v;
    }
  }
  return out;
}

/** Pairwise map → list of { debtor, creditor, amount } with amount > 0. */
export function edges(m) {
  const list = [];
  for (const [k, v] of m || []) {
    if (!v) continue;
    const [a, b] = k.split('|');
    list.push(v > 0 ? { debtor: a, creditor: b, amount: v } : { debtor: b, creditor: a, amount: -v });
  }
  return list.sort((x, y) => y.amount - x.amount || byId(x.debtor, y.debtor) || byId(x.creditor, y.creditor));
}

/**
 * Greedy min-cash-flow: the biggest debtor pays the biggest creditor until
 * everyone is square. At most n − 1 transfers. Deterministic on ties.
 */
export function simplify(net) {
  const cred = [];
  const debt = [];
  for (const [id, v] of Object.entries(net)) {
    if (v > 0) cred.push({ id, v });
    else if (v < 0) debt.push({ id, v: -v });
  }
  const order = (a, b) => b.v - a.v || byId(a.id, b.id);
  const out = [];
  while (cred.length && debt.length) {
    cred.sort(order);
    debt.sort(order);
    const c = cred[0];
    const d = debt[0];
    const amt = Math.min(c.v, d.v);
    out.push({ debtor: d.id, creditor: c.id, amount: amt });
    c.v -= amt;
    d.v -= amt;
    if (!c.v) cred.shift();
    if (!d.v) debt.shift();
  }
  return out;
}

/**
 * Everything the UI needs about a group's balances.
 * debts: the repayments people should actually make (simplified if the group says so).
 */
export function groupBalances(state) {
  const pw = pairwise(state);
  const net = netBalances(state, pw);
  const simplifyOn = !!state.group.simplify;
  const debts = {};
  let rawCount = 0;
  let simpleCount = 0;
  for (const cur of Object.keys(net)) {
    const raw = edges(pw[cur]);
    const simple = simplify(net[cur]);
    rawCount += raw.length;
    simpleCount += simple.length;
    debts[cur] = simplifyOn ? simple : raw;
  }
  return { net, debts, simplifyOn, saved: Math.max(0, rawCount - simpleCount) };
}

/** From one person's point of view: who owes them and whom they owe, per currency. */
export function personView(balances, me) {
  const lines = [];
  const total = {};
  for (const [cur, list] of Object.entries(balances.debts)) {
    for (const d of list) {
      if (d.creditor === me) { lines.push({ other: d.debtor, amount: d.amount, currency: cur }); total[cur] = (total[cur] || 0) + d.amount; }
      else if (d.debtor === me) { lines.push({ other: d.creditor, amount: -d.amount, currency: cur }); total[cur] = (total[cur] || 0) - d.amount; }
    }
  }
  lines.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  for (const k of Object.keys(total)) if (!total[k]) delete total[k];
  return { lines, total };
}

/** How one expense lands for a given person: lent (+), borrowed (−), or not involved. */
export function expenseEffect(exp, me) {
  const parts = expenseParts(exp);
  if (!parts) return { kind: 'invalid', amount: 0 };
  const paid = parts.paid[me] || 0;
  const owed = parts.owed[me] || 0;
  if (!paid && !owed) return { kind: 'none', amount: 0 };
  const d = paid - owed;
  if (d > 0) return { kind: 'lent', amount: d };
  if (d < 0) return { kind: 'borrowed', amount: -d };
  return { kind: 'even', amount: 0 };
}

const monthKey = (date) => (date || '').slice(0, 7);

/** Spending stats for Totals and Charts. All amounts in one currency. */
export function spending(state, me, currency) {
  const months = {};
  const categories = {};
  const members = {};
  let total = 0;
  let mine = 0;
  for (const exp of live(state, 'expense')) {
    if (exp.currency !== currency) continue;
    const parts = expenseParts(exp);
    if (!parts) continue;
    const m = monthKey(exp.date);
    const mm = (months[m] ||= { total: 0, mine: 0 });
    mm.total += exp.amount;
    mm.mine += parts.owed[me] || 0;
    total += exp.amount;
    mine += parts.owed[me] || 0;
    const cat = exp.category || 'general';
    categories[cat] = (categories[cat] || 0) + exp.amount;
    for (const [id, v] of Object.entries(parts.owed)) members[id] = (members[id] || 0) + v;
  }
  return { months, categories, members, total, mine };
}

/** The currency a group mostly uses (for totals and default new expenses). */
export function mainCurrency(state, fallback = 'INR') {
  const count = {};
  for (const e of live(state, 'expense')) count[e.currency] = (count[e.currency] || 0) + 1;
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : state.group.currency || fallback;
}
