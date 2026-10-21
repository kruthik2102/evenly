// Money is always an integer count of the currency's minor unit (paise, cents…).
// Decimal places come from Intl so JPY (0), INR (2) and KWD (3) all just work.

const digitsCache = new Map();

export function minorDigits(currency) {
  if (!digitsCache.has(currency)) {
    let d = 2;
    try {
      d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    } catch { /* unknown code: keep 2 */ }
    digitsCache.set(currency, d);
  }
  return digitsCache.get(currency);
}

/** "1,234.5" → 123450 (for INR). Returns NaN for junk. */
export function parseAmount(text, currency) {
  const d = minorDigits(currency);
  if (typeof text === 'number') text = text.toFixed(d + 1);
  let s = String(text).trim().replace(/[^\d.,-]/g, '');
  // "1,23,456.50" and "1,234.50" → drop grouping; a lone ",50" at the end is a decimal comma.
  if (s.includes('.')) s = s.replace(/,/g, '');
  else if (/^[^,]*,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return NaN;
  // Work on the digits, not on floats, so "1.005" never becomes 100.4999.
  const [ip, fp = ''] = s.split('.');
  const frac = (fp + '0'.repeat(d + 1)).slice(0, d + 1);
  let v = Number(ip || '0') * 10 ** d + Number(frac.slice(0, d) || '0');
  if (Number(frac[d]) >= 5) v += 1;
  return neg ? -v : v;
}

export function toMajor(minor, currency) {
  return minor / 10 ** minorDigits(currency);
}

const fmtCache = new Map();
function formatter(currency, locale) {
  const key = currency + '|' + (locale || '');
  if (!fmtCache.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat(locale || undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' });
    } catch {
      f = new Intl.NumberFormat(locale || undefined, { style: 'currency', currency: 'USD' });
    }
    fmtCache.set(key, f);
  }
  return fmtCache.get(key);
}

export function formatMoney(minor, currency, { abs = false, locale } = {}) {
  const v = toMajor(abs ? Math.abs(minor) : minor, currency);
  return formatter(currency, locale).format(v);
}

/** Plain number for inputs: 123450 → "1234.50" */
export function formatPlain(minor, currency) {
  return toMajor(minor, currency).toFixed(minorDigits(currency));
}

/**
 * Split `total` into integer parts proportional to `weights`, using the
 * largest-remainder method so the parts always sum to exactly `total`.
 * Ties go to the earlier index, so every device rounds the same way.
 */
export function allocate(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const t = Math.abs(total);
  const raw = weights.map((w) => (t * w) / sum);
  const parts = raw.map(Math.floor);
  let left = t - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) parts[order[k].i] += 1;
  return parts.map((p) => p * sign);
}

export const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'THB', 'LKR', 'NPR', 'IDR', 'MYR', 'CHF', 'CNY', 'HKD', 'NZD', 'ZAR', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'VND', 'PHP', 'KRW', 'TRY', 'BRL', 'MXN'];

export function allCurrencies() {
  try {
    const list = Intl.supportedValuesOf('currency');
    return [...new Set([...COMMON_CURRENCIES, ...list])];
  } catch {
    return COMMON_CURRENCIES;
  }
}

export function currencyName(code) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) || code;
  } catch {
    return code;
  }
}

export function currencySymbol(code) {
  try {
    const parts = formatter(code).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || code;
  } catch {
    return code;
  }
}
