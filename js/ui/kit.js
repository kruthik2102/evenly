// Shared building blocks: categories, colours, avatars, money labels, charts.

import { html, raw, esc } from './dom.js';
import { formatMoney } from '../core/money.js';

export const COLORS = ['indigo', 'blue', 'teal', 'green', 'mint', 'yellow', 'orange', 'red', 'pink', 'purple', 'brown', 'gray'];

export const GROUP_TYPES = [
  { id: 'trip', label: 'Trip', emoji: '✈️' },
  { id: 'home', label: 'Home', emoji: '🏠' },
  { id: 'couple', label: 'Couple', emoji: '💞' },
  { id: 'other', label: 'Other', emoji: '👥' },
];

export const CATEGORIES = [
  { id: 'entertainment', label: 'Entertainment', color: 'purple', items: [['games', 'Games', '🎮'], ['movies', 'Movies', '🎬'], ['music', 'Music', '🎵'], ['sports', 'Sports', '⚽️'], ['other', 'Other', '🎟️']] },
  { id: 'food', label: 'Food and drink', color: 'orange', items: [['dining', 'Dining out', '🍽️'], ['groceries', 'Groceries', '🛒'], ['liquor', 'Liquor', '🍷'], ['other', 'Other', '🍕']] },
  { id: 'home', label: 'Home', color: 'teal', items: [['electronics', 'Electronics', '💻'], ['furniture', 'Furniture', '🛋️'], ['supplies', 'Household supplies', '🧴'], ['maintenance', 'Maintenance', '🛠️'], ['mortgage', 'Mortgage', '🏦'], ['pets', 'Pets', '🐾'], ['rent', 'Rent', '🏠'], ['services', 'Services', '🧹'], ['other', 'Other', '🏡']] },
  { id: 'life', label: 'Life', color: 'pink', items: [['childcare', 'Childcare', '🧸'], ['clothing', 'Clothing', '👕'], ['education', 'Education', '🎓'], ['gifts', 'Gifts', '🎁'], ['insurance', 'Insurance', '🛡️'], ['medical', 'Medical expenses', '💊'], ['taxes', 'Taxes', '🧾'], ['other', 'Other', '✨']] },
  { id: 'transport', label: 'Transportation', color: 'blue', items: [['bicycle', 'Bicycle', '🚲'], ['train', 'Bus or train', '🚆'], ['car', 'Car', '🚗'], ['fuel', 'Fuel', '⛽️'], ['hotel', 'Hotel', '🏨'], ['parking', 'Parking', '🅿️'], ['plane', 'Plane', '✈️'], ['taxi', 'Taxi', '🚕'], ['other', 'Other', '🧭']] },
  { id: 'utilities', label: 'Utilities', color: 'yellow', items: [['cleaning', 'Cleaning', '🧽'], ['electricity', 'Electricity', '💡'], ['gas', 'Heat or gas', '🔥'], ['trash', 'Trash', '🗑️'], ['internet', 'TV, phone, internet', '📶'], ['water', 'Water', '🚰'], ['other', 'Other', '🔌']] },
  { id: 'general', label: 'Uncategorized', color: 'gray', items: [['general', 'General', '🧾']] },
];

const CAT_INDEX = new Map();
for (const g of CATEGORIES) for (const [id, label, emoji] of g.items) CAT_INDEX.set(g.id === 'general' ? 'general' : `${g.id}.${id}`, { id: g.id === 'general' ? 'general' : `${g.id}.${id}`, label, emoji, group: g.label, color: g.color });

export function category(id) {
  return CAT_INDEX.get(id) || CAT_INDEX.get('general');
}

export function categoryGroupOf(id) {
  return CATEGORIES.find((g) => (id || 'general').startsWith(g.id)) || CATEGORIES[CATEGORIES.length - 1];
}

// A small, local guess so most expenses don't need a manual category.
const GUESS = [
  [/uber|ola|taxi|cab|rapido|auto\b|lyft/i, 'transport.taxi'],
  [/flight|airline|indigo air|plane|air ?india/i, 'transport.plane'],
  [/train|metro|bus|irctc/i, 'transport.train'],
  [/petrol|diesel|fuel|gas station/i, 'transport.fuel'],
  [/parking|toll/i, 'transport.parking'],
  [/hotel|hostel|airbnb|stay|resort|booking/i, 'transport.hotel'],
  [/scooter|bike rent|car rent|zoomcar/i, 'transport.car'],
  [/dinner|lunch|breakfast|brunch|restaurant|cafe|coffee|pizza|biry?ani|burger|food|swiggy|zomato|meal|snacks|chai|kunafa|noodles/i, 'food.dining'],
  [/grocer|bigbasket|blinkit|zepto|instamart|vegetable|fruit|milk|supermarket|dmart/i, 'food.groceries'],
  [/beer|wine|liquor|bar\b|pub|drinks|alcohol/i, 'food.liquor'],
  [/movie|cinema|pvr|inox|netflix|film/i, 'entertainment.movies'],
  [/concert|spotify|music/i, 'entertainment.music'],
  [/game|bowling|arcade|playstation/i, 'entertainment.games'],
  [/match|cricket|football|turf|gym|badminton|rafting|trek/i, 'entertainment.sports'],
  [/rent\b/i, 'home.rent'],
  [/electric|power bill|bescom/i, 'utilities.electricity'],
  [/wifi|internet|broadband|airtel|jio|phone bill|recharge/i, 'utilities.internet'],
  [/water/i, 'utilities.water'],
  [/clean|maid|laundry/i, 'utilities.cleaning'],
  [/medicine|pharmacy|doctor|hospital|clinic/i, 'life.medical'],
  [/gift|birthday/i, 'life.gifts'],
  [/clothes|shirt|shoes|myntra/i, 'life.clothing'],
];
export function guessCategory(desc) {
  for (const [re, id] of GUESS) if (re.test(desc || '')) return id;
  return null;
}

export function catIcon(id, size = '') {
  const c = category(id);
  return html`<span class="cat-icon tint-${c.color} ${size}" aria-hidden="true">${c.emoji}</span>`;
}

export function groupTile(g, size = '') {
  return html`<span class="group-tile tint-${g.color || 'indigo'} ${size}" aria-hidden="true">${g.emoji || '👥'}</span>`;
}

export function avatar(m, size = '') {
  const name = m?.name || '?';
  const emoji = m?.emoji && m.emoji !== '🙂' ? m.emoji : null; // the default face makes everyone look alike
  const hue = [...(m?.id || name)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
  return html`<span class="avatar ${size}" style="--h:${hue}" aria-hidden="true">${emoji || name.trim().charAt(0).toUpperCase()}</span>`;
}

/** "you are owed ₹120" / "you owe ₹80" / "settled up", colour-coded. */
export function balanceText(totals, { prefix = true } = {}) {
  const entries = Object.entries(totals || {}).filter(([, v]) => v);
  if (!entries.length) return html`<span class="muted">settled up</span>`;
  const pos = entries.filter(([, v]) => v > 0);
  const neg = entries.filter(([, v]) => v < 0);
  const parts = [];
  if (pos.length) parts.push(html`<span class="pos">${prefix ? 'you are owed ' : ''}${pos.map(([c, v]) => formatMoney(v, c)).join(' + ')}</span>`);
  if (neg.length) parts.push(html`<span class="neg">${prefix ? 'you owe ' : ''}${neg.map(([c, v]) => formatMoney(-v, c)).join(' + ')}</span>`);
  return html`${parts.map((p, i) => html`${i ? html`<br>` : ''}${p}`)}`;
}

export function money(v, cur, { signed = false } = {}) {
  const cls = signed ? (v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted') : '';
  return html`<span class="num ${cls}">${formatMoney(signed ? Math.abs(v) : v, cur)}</span>`;
}

export function icon(name) {
  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
    share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M6 11H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 9h10M7 12h10M7 15h6"/>',
    camera: '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.6 0 4.4 1.4 5 4"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    account: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.2c1.2-2.2 3.2-3.2 5.5-3.2s4.3 1 5.5 3.2"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2"/>',
    sync: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.6M20 12a8 8 0 0 1-13.7 5.7L4 15.4"/><path d="M20 4v4.6h-4.6M4 20v-4.6h4.6"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    chart: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    receipt: '<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    note: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19h14"/>',
    wand: '<path d="m4 20 11-11M14 4v3M12.5 5.5h3M19 8v3M17.5 9.5h3M18 15v2M17 16h2"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
    repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/>',
    whiteboard: '<rect x="3.5" y="4" width="17" height="12" rx="2"/><path d="M8 20l4-4 4 4M7.5 8.5h6M7.5 11.5h9"/>',
  };
  return raw(`<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
}

export function toggle(field, on, label) {
  return html`<label class="switch"><input type="checkbox" role="switch" data-field="${field}" ${on ? raw('checked') : ''} aria-label="${label || field}"><span class="track"><span class="thumb"></span></span></label>`;
}

/** Segmented control; the selection thumb slides with a spring (see main.js). */
export function segmented(field, options, value) {
  const i = Math.max(0, options.findIndex((o) => o.id === value));
  return html`<div class="segmented" role="tablist" data-seg="${field}" style="--n:${options.length};--i:${i}">
    <span class="seg-thumb" aria-hidden="true"></span>
    ${options.map((o) => html`<button role="tab" aria-selected="${o.id === value}" data-act="seg" data-field="${field}" data-value="${o.id}">${o.label}</button>`)}
  </div>`;
}

/* ---------- charts (plain SVG, themed by CSS variables) ---------- */

export function barChart(series, { currency, height = 160, highlight } = {}) {
  if (!series.length) return html`<p class="empty-note">No spending yet.</p>`;
  const max = Math.max(...series.map((s) => s.value), 1);
  const w = 100 / series.length;
  return html`<div class="bars" style="--h:${height}px">
    ${series.map((s) => html`<div class="bar-col ${s.key === highlight ? 'hl' : ''}" style="width:${w}%" title="${s.label}: ${formatMoney(s.value, currency)}">
      <div class="bar-track"><div class="bar" style="height:${(s.value / max) * 100}%"><span class="bar-mine" style="height:${s.value ? ((s.mine || 0) / s.value) * 100 : 0}%"></span></div></div>
      <div class="bar-label">${s.short || s.label}</div>
    </div>`)}
  </div>`;
}

export function donut(slices, { currency, size = 180 } = {}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (!total) return html`<p class="empty-note">No spending yet.</p>`;
  const r = 15.9155; // circumference 100
  let acc = 0;
  const arcs = slices.map((s) => {
    const pct = (s.value / total) * 100;
    const seg = html`<circle r="${r}" cx="21" cy="21" fill="none" class="stroke-${s.color}" stroke-width="5.2" stroke-dasharray="${Math.max(0, pct - 0.6)} ${100 - Math.max(0, pct - 0.6)}" stroke-dashoffset="${25 - acc}"></circle>`;
    acc += pct;
    return seg;
  });
  return html`<div class="donut-wrap">
    <svg viewBox="0 0 42 42" width="${size}" height="${size}" role="img" aria-label="Spending by category">
      <circle r="${r}" cx="21" cy="21" fill="none" class="donut-bg" stroke-width="5.2"></circle>${arcs}
      <text x="21" y="20" class="donut-total">${formatMoney(total, currency)}</text>
      <text x="21" y="25.5" class="donut-sub">total</text>
    </svg>
    <ul class="legend">${slices.map((s) => html`<li><span class="dot tint-${s.color}"></span><span class="legend-label">${s.label}</span><span class="num">${formatMoney(s.value, currency)}</span><span class="pct">${Math.round((s.value / total) * 100)}%</span></li>`)}</ul>
  </div>`;
}

export function hbar(rows, { currency } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return html`<ul class="hbars">${rows.map((r) => html`<li>
    <span class="hb-label">${r.label}</span>
    <span class="hb-track"><span class="hb-fill" style="width:${(r.value / max) * 100}%"></span></span>
    <span class="num">${formatMoney(r.value, currency)}</span></li>`)}</ul>`;
}

export const nl2br = (s) => raw(esc(s).replace(/\n/g, '<br>'));
