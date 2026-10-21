// Recurring expenses. The original expense carries `repeat`; each later
// occurrence is a normal expense whose id is "<originalId>@<date>". Because the
// id is derived, two phones that both catch up on the same occurrence write
// identical values to the same entity, which merges into one expense.

export const REPEATS = [
  { id: 'off', label: 'Never' },
  { id: 'weekly', label: 'Every week' },
  { id: 'fortnightly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Every month' },
  { id: 'yearly', label: 'Every year' },
];

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
};

/** The k-th occurrence date (k = 0 is the original). Month ends clamp (31 Jan → 28 Feb → 31 Mar). */
export function occurrence(start, repeat, k) {
  const { y, m, d } = parse(start);
  if (repeat === 'weekly' || repeat === 'fortnightly') {
    const step = repeat === 'weekly' ? 7 : 14;
    return isoDate(new Date(Date.UTC(y, m, d + step * k)));
  }
  const months = repeat === 'monthly' ? k : repeat === 'yearly' ? 12 * k : 0;
  const ty = y + Math.floor((m + months) / 12);
  const tm = (m + months) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(ty, tm, Math.min(d, last))));
}

/** Occurrence dates after the original, up to and including `today`. */
export function dueDates(exp, today, cap = 120) {
  if (!exp.repeat || exp.repeat === 'off' || !exp.date) return [];
  const out = [];
  for (let k = 1; k <= cap; k++) {
    const d = occurrence(exp.date, exp.repeat, k);
    if (d > today) break;
    out.push(d);
  }
  return out;
}

export function nextDue(exp, today) {
  if (!exp.repeat || exp.repeat === 'off') return null;
  for (let k = 1; k < 2000; k++) {
    const d = occurrence(exp.date, exp.repeat, k);
    if (d > today) return d;
  }
  return null;
}

/** Fields copied from the original onto each occurrence. */
export const COPIED_FIELDS = ['desc', 'amount', 'currency', 'category', 'paidBy', 'split', 'notes'];
