// Turns an expense's split description into exact per-person shares.
// Every mode returns integers (minor units) that sum to the expense total.

import { allocate } from './money.js';

export const SPLIT_MODES = [
  { id: 'equal', label: 'Equally', short: '=' },
  { id: 'exact', label: 'Exact amounts', short: '1.23' },
  { id: 'percent', label: 'Percentages', short: '%' },
  { id: 'shares', label: 'Shares', short: '▤' },
  { id: 'adjust', label: 'Adjustment', short: '+/−' },
  { id: 'items', label: 'Itemized', short: '☰' },
];

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function toMap(ids, parts) {
  const m = {};
  ids.forEach((id, i) => { if (parts[i]) m[id] = parts[i]; });
  return m;
}

/**
 * @returns {{ ok: boolean, shares: Record<string, number>, error?: string, remaining?: number, unit?: string }}
 * `remaining` is what's still unassigned (minor units, or percent points for
 * the percent mode) so the UI can show "₹120 left" / "40% left" live.
 */
export function computeShares(amount, split) {
  const mode = split?.mode || 'equal';
  const values = split?.values || {};

  if (mode === 'equal') {
    const ids = [...(split.members || [])].sort(byId);
    if (!ids.length) return { ok: false, shares: {}, error: 'Choose at least one person' };
    return { ok: true, shares: toMap(ids, allocate(amount, ids.map(() => 1))) };
  }

  if (mode === 'exact') {
    const ids = Object.keys(values).sort(byId);
    const sum = ids.reduce((s, id) => s + (values[id] || 0), 0);
    const remaining = amount - sum;
    const shares = {};
    ids.forEach((id) => { if (values[id]) shares[id] = values[id]; });
    if (remaining !== 0) return { ok: false, shares, remaining, unit: 'money', error: remaining > 0 ? 'Amounts are short of the total' : 'Amounts are over the total' };
    return { ok: true, shares, remaining: 0, unit: 'money' };
  }

  if (mode === 'percent') {
    const ids = Object.keys(values).filter((id) => values[id] > 0).sort(byId);
    const sum = ids.reduce((s, id) => s + values[id], 0);
    const remaining = Math.round((100 - sum) * 1000) / 1000;
    const shares = toMap(ids, allocate(amount, ids.map((id) => Math.round(values[id] * 1000))));
    if (Math.abs(remaining) > 0.0005) return { ok: false, shares, remaining, unit: 'percent', error: 'Percentages must add up to 100%' };
    return { ok: true, shares, remaining: 0, unit: 'percent' };
  }

  if (mode === 'shares') {
    const ids = Object.keys(values).filter((id) => values[id] > 0).sort(byId);
    if (!ids.length) return { ok: false, shares: {}, error: 'Give someone at least one share' };
    return { ok: true, shares: toMap(ids, allocate(amount, ids.map((id) => values[id]))) };
  }

  if (mode === 'adjust') {
    const ids = [...(split.members || Object.keys(values))].sort(byId);
    if (!ids.length) return { ok: false, shares: {}, error: 'Choose at least one person' };
    const adj = ids.map((id) => values[id] || 0);
    const base = amount - adj.reduce((a, b) => a + b, 0);
    if (base < 0) return { ok: false, shares: {}, remaining: base, unit: 'money', error: 'Adjustments are larger than the total' };
    const parts = allocate(base, ids.map(() => 1)).map((p, i) => p + adj[i]);
    if (parts.some((p) => p < 0)) return { ok: false, shares: {}, error: 'Someone would owe a negative amount' };
    return { ok: true, shares: toMap(ids, parts) };
  }

  if (mode === 'items') {
    const items = split.items || [];
    const base = {};
    for (const it of items) {
      const ids = [...(it.people || [])].sort(byId);
      if (!it.amount) continue;
      if (!ids.length) return { ok: false, shares: {}, error: `Choose who had “${it.name || 'an item'}”` };
      allocate(it.amount, ids.map(() => 1)).forEach((p, i) => { base[ids[i]] = (base[ids[i]] || 0) + p; });
    }
    const ids = Object.keys(base).sort(byId);
    const subtotal = ids.reduce((s, id) => s + base[id], 0);
    if (!subtotal) return { ok: false, shares: {}, error: 'Add at least one item' };
    const extra = amount - subtotal; // tax, tip, service charge, rounding
    if (extra < 0) return { ok: false, shares: {}, remaining: extra, unit: 'money', error: 'Items add up to more than the total' };
    const extraParts = allocate(extra, ids.map((id) => base[id]));
    return { ok: true, shares: toMap(ids, ids.map((id, i) => base[id] + extraParts[i])), subtotal, extra };
  }

  return { ok: false, shares: {}, error: 'Unknown split' };
}

/** Validates who paid. `paidBy` is { personId: minor }. */
export function checkPayers(amount, paidBy) {
  const sum = Object.values(paidBy || {}).reduce((a, b) => a + (b || 0), 0);
  const remaining = amount - sum;
  return { ok: remaining === 0 && sum > 0, remaining };
}

/** Builds an equal split's description from a member list (used for defaults). */
export function equalSplit(memberIds) {
  return { mode: 'equal', members: [...memberIds] };
}

export function describeSplit(split, nameOf) {
  const mode = split?.mode || 'equal';
  if (mode === 'equal') {
    const n = (split.members || []).length;
    return n ? `split equally between ${n}` : 'split equally';
  }
  if (mode === 'items') return `itemized (${(split.items || []).length} items)`;
  return { exact: 'split by exact amounts', percent: 'split by percentages', shares: 'split by shares', adjust: 'split by adjustment' }[mode] || 'split';
}
