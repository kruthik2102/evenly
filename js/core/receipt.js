// Turns OCR text from a receipt into a merchant, date, items, extras and total.
// Pure function, so it's testable and runs entirely on the device.

import { parseAmount } from './money.js';

// Commas only as thousands separators: "Naan x2 120.00" must not read as 2,120.
const PRICE = /(-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)\s*$/;
const TOTAL = /grand\s*total|net\s*(amount|total|payable)|amount\s*(due|payable)|bill\s*(amount|total)|total\s*(amount|due|payable)?\s*[:\-]?$|^total\b/i;
const SUBTOTAL = /sub\s*-?\s*total/i;
const EXTRA = /\b([csi]\s*gst|gst|vat|tax|cess|service\s*(charge|tax|chg)|s\.?\s*c\.?|tip|gratuity|packing|delivery)\b/i;
const DISCOUNT = /discount|savings|offer|coupon|promo/i;
const NOISE = /change|cash|card|tender|paid|balance\s*due|round\s*(ing)?\s*off|r\/off|qty|quantity|item\s*count|no\.?\s*of\s*items|invoice|bill\s*no|order\s*no|table|cover|phone|tel\b|mob|gstin|fssai|cin\b|pan\b|upi|ref|txn|time|date|hsn|sac|rate\b|amount$|^\W*$/i;

function iso(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseReceipt(text, currency = 'INR') {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const merchant = lines.find((l) => /[a-z]{3,}/i.test(l) && !NOISE.test(l) && !PRICE.test(l) && l.length <= 40) || '';

  let date = null;
  for (const l of lines) {
    const m = /(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(l);
    if (!m) continue;
    const [a, b, c] = m.slice(1).map(Number);
    date = a > 31 ? iso(a, b, c) : currency === 'USD' ? iso(c, a, b) : iso(c, b, a);
    if (date) break;
  }

  const items = [];
  const extras = [];
  const totals = [];
  let subtotal = null;
  for (const l of lines) {
    const m = PRICE.exec(l);
    if (!m) continue;
    const label = l.slice(0, m.index).replace(/[:\-–=]+\s*$/, '').trim();
    const value = parseAmount(m[1], currency);
    if (!Number.isFinite(value) || value === 0) continue;
    if (SUBTOTAL.test(label)) { subtotal = value; continue; }
    if (TOTAL.test(label)) { totals.push(value); continue; }
    if (DISCOUNT.test(label)) { extras.push({ label, amount: -Math.abs(value) }); continue; }
    if (EXTRA.test(label)) { extras.push({ label, amount: value }); continue; }
    if (NOISE.test(label) || !/[a-z]{2,}/i.test(label)) continue;
    // "2 x Paneer Tikka 250.00 500.00" → "Paneer Tikka"
    const name = label.replace(/^\d+\s*[x×*]\s*/i, '').replace(/(\s+[\d.,@x×]+)+$/i, '').trim();
    if (name.length < 2 || value < 0) continue;
    items.push({ name, amount: value });
  }

  const itemsSum = items.reduce((a, b) => a + b.amount, 0);
  const extrasSum = extras.reduce((a, b) => a + b.amount, 0);
  const total = totals.length ? Math.max(...totals) : itemsSum + extrasSum;
  return { merchant, date, items, extras, subtotal: subtotal ?? itemsSum, total };
}
