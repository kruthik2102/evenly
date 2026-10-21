import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allocate, parseAmount, formatPlain, minorDigits } from '../js/core/money.js';
import { computeShares } from '../js/core/split.js';
import { GroupLedger } from '../js/core/ledger.js';
import { groupBalances, simplify, personView } from '../js/core/balances.js';
import { occurrence, dueDates } from '../js/core/recurring.js';
import { Store, memoryPersistence } from '../js/app/store.js';
import { seal, open } from '../js/sync/codec.js';
import { parseReceipt } from '../js/core/receipt.js';

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('allocate always sums to the total and is deterministic', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  for (let i = 0; i < 500; i++) {
    const total = Math.floor(Math.random() * 1e7);
    const w = Array.from({ length: 1 + (i % 9) }, () => Math.random() * 10);
    assert.equal(allocate(total, w).reduce((a, b) => a + b, 0), total);
  }
});

test('parseAmount handles grouping, decimal commas and float traps', () => {
  assert.equal(parseAmount('1,23,456.50', 'INR'), 12345650);
  assert.equal(parseAmount('1,234.5', 'USD'), 123450);
  assert.equal(parseAmount('12,5', 'EUR'), 1250);
  assert.equal(parseAmount('1.005', 'USD'), 101);
  assert.equal(parseAmount('₹ 899', 'INR'), 89900);
  assert.equal(parseAmount('1500', 'JPY'), 1500);
  assert.equal(minorDigits('KWD'), 3);
  assert.equal(parseAmount('2.5', 'KWD'), 2500);
  assert.ok(Number.isNaN(parseAmount('abc', 'INR')));
  assert.equal(formatPlain(12345, 'INR'), '123.45');
});

test('every split mode produces shares that add up exactly', () => {
  const total = 100000; // ₹1000.00
  const eq = computeShares(total, { mode: 'equal', members: ['c', 'a', 'b'] });
  assert.ok(eq.ok);
  assert.equal(sum(eq.shares), total);
  assert.deepEqual(eq.shares, { a: 33334, b: 33333, c: 33333 });

  const ex = computeShares(total, { mode: 'exact', values: { a: 60000, b: 30000 } });
  assert.equal(ex.ok, false);
  assert.equal(ex.remaining, 10000);
  assert.ok(computeShares(total, { mode: 'exact', values: { a: 70000, b: 30000 } }).ok);

  const pc = computeShares(total, { mode: 'percent', values: { a: 33.33, b: 33.33, c: 33.34 } });
  assert.ok(pc.ok);
  assert.equal(sum(pc.shares), total);
  assert.equal(computeShares(total, { mode: 'percent', values: { a: 50 } }).remaining, 50);

  const sh = computeShares(total, { mode: 'shares', values: { a: 2, b: 1, c: 1 } });
  assert.deepEqual(sh.shares, { a: 50000, b: 25000, c: 25000 });

  const ad = computeShares(total, { mode: 'adjust', members: ['a', 'b'], values: { a: 10000 } });
  assert.deepEqual(ad.shares, { a: 55000, b: 45000 });

  const it = computeShares(110000, {
    mode: 'items',
    items: [
      { name: 'Pizza', amount: 60000, people: ['a', 'b'] },
      { name: 'Beer', amount: 40000, people: ['b'] },
    ],
  });
  assert.ok(it.ok);
  assert.equal(it.extra, 10000);
  assert.equal(sum(it.shares), 110000);
  assert.deepEqual(it.shares, { a: 33000, b: 77000 }); // tax shared 30/70
});

test('the ledger converges regardless of delivery order', () => {
  const ops = [];
  let c = 1000;
  const mk = (d, s, t, e, v) => ({ i: `${d}:${s}`, g: 'g1', d, s, c: c++, t, e, v });
  ops.push(mk('A', 1, 'group', 'g1', { name: 'Trip' }));
  ops.push(mk('A', 2, 'expense', 'x', { desc: 'Dinner', amount: 900 }));
  ops.push(mk('B', 1, 'expense', 'x', { desc: 'Dinner at Toit' }));
  ops.push(mk('A', 3, 'expense', 'x', { amount: 1200 }));
  ops.push(mk('B', 2, 'expense', 'x', { deleted: true }));
  ops.push(mk('A', 4, 'expense', 'x', { deleted: false }));

  const ref = new GroupLedger('g1');
  ref.add(ops);
  const strip = (l) => [...l.state.expense.values()].map(({ _ops, ...e }) => e);
  const want = strip(ref);
  for (let k = 0; k < 50; k++) {
    const shuffled = [...ops].sort(() => Math.random() - 0.5);
    const l = new GroupLedger('g1');
    l.add(shuffled);
    l.add(shuffled.slice(0, 3)); // duplicates are ignored
    assert.deepEqual(strip(l), want);
  }
  const x = ref.state.expense.get('x');
  assert.equal(x.desc, 'Dinner at Toit');
  assert.equal(x.amount, 1200);
  assert.equal(x.deleted, false);

  const other = new GroupLedger('g1');
  other.add(ops.slice(0, 2));
  assert.deepEqual(ref.missingFor(other.summary()).map((o) => o.i).sort(), ['A:3', 'A:4', 'B:1', 'B:2']);
});

test('balances, payments and simplify debts', () => {
  const l = new GroupLedger('g');
  let c = 1;
  const op = (t, e, v) => l.add([{ i: `D:${c}`, g: 'g', d: 'D', s: c, c: c++, t, e, v }]);
  op('group', 'g', { name: 'G', simplify: false });
  op('expense', 'e1', { amount: 30000, currency: 'INR', paidBy: { a: 30000 }, split: { mode: 'equal', members: ['a', 'b', 'c'] } });
  let bal = groupBalances(l.state);
  assert.deepEqual(bal.net.INR, { a: 20000, b: -10000, c: -10000 });
  assert.equal(bal.debts.INR.length, 2);

  op('payment', 'p1', { from: 'b', to: 'a', amount: 10000, currency: 'INR' });
  bal = groupBalances(l.state);
  assert.equal(bal.net.INR.b, 0);
  assert.deepEqual(personView(bal, 'a').total, { INR: 10000 });

  // A chain a→b→c collapses to a→c when simplified.
  assert.deepEqual(simplify({ a: -1000, b: 0, c: 1000 }), [{ debtor: 'a', creditor: 'c', amount: 1000 }]);

  // Multiple payers: debts are shared out by how much each paid.
  op('expense', 'e2', { amount: 9000, currency: 'INR', paidBy: { b: 6000, c: 3000 }, split: { mode: 'equal', members: ['a'] } });
  bal = groupBalances(l.state);
  assert.equal(sum(bal.net.INR), 0);
});

test('recurring dates clamp month ends', () => {
  assert.equal(occurrence('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(occurrence('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(occurrence('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.deepEqual(dueDates({ date: '2026-10-01', repeat: 'weekly' }, '2026-10-21'), ['2026-10-08', '2026-10-15']);
});

test('sealed bundles round-trip and reject tampering', async () => {
  const key = (await import('../js/sync/codec.js')).newGroupKey();
  const s = await seal({ hello: 'world', n: [1, 2, 3] }, key, 'g1');
  assert.deepEqual(await open(s, key, 'g1'), { hello: 'world', n: [1, 2, 3] });
  await assert.rejects(open(s, key, 'g2')); // bound to its group id
});

test('two phones: invite, claim, add expenses offline, exchange links, agree', async () => {
  let t = Date.UTC(2026, 9, 21, 6);
  const now = () => (t += 1000);
  const a = await new Store(memoryPersistence(), { now }).init();
  const b = await new Store(memoryPersistence(), { now }).init();
  await a.setupDevice({ name: 'Asha', currency: 'INR' });
  await b.setupDevice({ name: 'Bharat', currency: 'INR' });

  const g = await a.createGroup({ name: 'Goa', type: 'trip', members: [{ name: 'Bharat' }, { name: 'Chetan' }] });
  const [meA, bharat, chetan] = a.members(g).map((m) => m.id);
  const invite = await a.inviteLink(g, bharat);
  const joined = await b.importText(`Join my group: ${invite}`);
  assert.equal(joined.isNew, true);
  assert.equal(b.meIn(g), bharat);

  // Both add an expense without talking to each other.
  await a.saveExpense(g, null, { desc: 'Hotel', amount: 900000, currency: 'INR', date: '2026-10-20', paidBy: { [meA]: 900000 }, split: { mode: 'equal', members: [meA, bharat, chetan] } });
  await b.saveExpense(g, null, { desc: 'Scooters', amount: 150000, currency: 'INR', date: '2026-10-20', paidBy: { [bharat]: 150000 }, split: { mode: 'equal', members: [meA, bharat, chetan] }, repeat: 'off' });

  // A monthly rent that both phones will materialise independently.
  await a.saveExpense(g, null, { desc: 'Locker', amount: 30000, currency: 'INR', date: '2026-08-21', paidBy: { [meA]: 30000 }, split: { mode: 'equal', members: [meA, bharat] }, repeat: 'monthly' });

  const fromA = await a.shareLink(g);
  const fromB = await b.shareLink(g);
  await b.importText(fromA.link);
  await a.importText(fromB.link);
  await a.catchUpRecurring();
  await b.catchUpRecurring();
  const again = await a.shareLink(g);
  await b.importText(again.link);
  const back = await b.shareLink(g);
  await a.importText(back.link);

  const net = (s) => groupBalances(s.state(g)).net;
  assert.deepEqual(net(a), net(b));
  const count = (s) => [...s.state(g).expense.values()].filter((e) => !e.deleted).length;
  assert.equal(count(a), 5); // hotel, scooters, locker + 2 occurrences, no duplicates
  assert.equal(count(b), 5);

  // Concurrent edits to different fields both survive.
  const hotel = [...a.state(g).expense.values()].find((e) => e.desc === 'Hotel');
  await a.saveExpense(g, hotel.id, { notes: 'Two rooms' });
  await b.saveExpense(g, hotel.id, { category: 'transport.hotel' });
  await b.importText((await a.shareLink(g)).link);
  await a.importText((await b.shareLink(g)).link);
  for (const s of [a, b]) {
    const h = s.state(g).expense.get(hotel.id);
    assert.equal(h.notes, 'Two rooms');
    assert.equal(h.category, 'transport.hotel');
  }

  // Friends view merges the same person across groups.
  assert.ok(a.friends().some((f) => f.name === 'Bharat'));
});

test('currency conversion moves debts into another currency', async () => {
  let t = Date.UTC(2026, 9, 21);
  const s = await new Store(memoryPersistence(), { now: () => (t += 1000) }).init();
  await s.setupDevice({ name: 'Me' });
  const g = await s.createGroup({ name: 'Bangkok', members: [{ name: 'Friend' }] });
  const [me, fr] = s.members(g).map((m) => m.id);
  await s.saveExpense(g, null, { desc: 'Boat', amount: 200000, currency: 'THB', date: '2026-10-01', paidBy: { [me]: 200000 }, split: { mode: 'equal', members: [me, fr] } });
  await s.convertCurrency(g, 'THB', 'INR', 2.5);
  const net = groupBalances(s.state(g)).net;
  assert.equal(net.THB?.[me] || 0, 0);
  assert.equal(net.INR[me], 250000);
});

test('receipt OCR text becomes items, extras and a total', () => {
  // The exact text Tesseract read from a rendered test bill.
  const text = `SEA BREEZE CAFE

Date: 18/10/2026

Paneer Tikka 320.00
Butter Naan x2 120.00
Prawn Curry 480.00
Fresh Lime Soda 90.00
Sub Total 1010.00
CGST 2.5% 25.25
SGST 2.5% 25.25
Service Charge 50.50
Grand Total 1,111.00
Paid by Card 1111.00
`;
  const r = parseReceipt(text, 'INR');
  assert.equal(r.merchant, 'SEA BREEZE CAFE');
  assert.equal(r.date, '2026-10-18');
  assert.deepEqual(r.items, [
    { name: 'Paneer Tikka', amount: 32000 },
    { name: 'Butter Naan', amount: 12000 },
    { name: 'Prawn Curry', amount: 48000 },
    { name: 'Fresh Lime Soda', amount: 9000 },
  ]);
  assert.equal(r.extras.reduce((a, x) => a + x.amount, 0), 10100);
  assert.equal(r.total, 111100);
});

test('any shared link lets a friend join, even one shared after the invite', async () => {
  let t = Date.UTC(2026, 9, 21, 9);
  const now = () => (t += 1000);
  const me = await new Store(memoryPersistence(), { now }).init();
  const nitin = await new Store(memoryPersistence(), { now }).init();
  await me.setupDevice({ name: 'Kruthik' });
  await nitin.setupDevice({ name: 'Nitin' });

  const g = await me.createGroup({ name: 'Flat', members: [{ name: 'Nitin' }] });
  const [mine, nitinId] = me.members(g).map((m) => m.id);
  await me.saveExpense(g, null, { desc: 'Rent', amount: 2000000, currency: 'INR', date: '2026-10-01', paidBy: { [mine]: 2000000 }, split: { mode: 'equal', members: [mine, nitinId] }, receipt: 'data:image/jpeg;base64,AAAA' });

  // The everyday "Share" link, not a special invite: it still lets Nitin in.
  const { link, count } = await me.shareLink(g);
  assert.ok(count > 0);
  assert.ok(link.includes('#join='));
  const res = await nitin.importText(`“Flat” on Evenly. Tap to join: ${link}`);
  assert.equal(res.isNew, true);
  assert.equal(res.needsClaim, true);
  await nitin.claim(g, nitinId);
  assert.deepEqual(groupBalances(nitin.state(g)).net, groupBalances(me.state(g)).net);

  // Receipt photos stay out of links (they'd make them huge) but travel phone to phone.
  assert.equal(nitin.receiptOf(g, [...nitin.state(g).expense.keys()][0]), null);
  const missing = me.groups.get(g).ledger.missingFor(nitin.groups.get(g).ledger.summary());
  assert.ok(missing.some((op) => op.t === 'receipt'));
  assert.equal(me.receiptOf(g, [...me.state(g).expense.keys()][0]), 'data:image/jpeg;base64,AAAA');

  // Opening the same kind of link again as a member just merges.
  await me.saveExpense(g, null, { desc: 'Wi-Fi', amount: 100000, currency: 'INR', date: '2026-10-02', paidBy: { [mine]: 100000 }, split: { mode: 'equal', members: [mine, nitinId] } });
  const again = await nitin.importText((await me.shareLink(g)).link);
  assert.equal(again.isNew, false);
  assert.equal(again.added, 1);
});
