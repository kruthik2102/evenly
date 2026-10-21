// Boot, layout and routing. Phones get a tab bar with one navigation stack per
// tab; tablets get an iPad-style split view (sidebar + detail).

import { Store, idbPersistence } from './app/store.js';
import { app } from './app/app.js';
import { Nav } from './ui/nav.js';
import { openSheet, topSheet, sheetNavs, closeAllSheets } from './ui/sheet.js';
import { installPressFeedback, html, el, toast } from './ui/dom.js';
import { installSwipeRows } from './ui/swipe.js';
import { icon } from './ui/kit.js';
import { haptic } from './ui/motion.js';
import { GroupsScreen, FriendsScreen, ActivityScreen, AccountScreen } from './screens/home.js';
import { GroupScreen, deleteWithUndo } from './screens/group.js';
import { ShareUpdatesScreen, JoinScreen } from './screens/sync.js';
import { WelcomeScreen, verifyOwner } from './screens/account.js';
import { hasLink } from './sync/links.js';

const TABS = [
  { id: 'groups', label: 'Groups', icon: 'people', make: () => new GroupsScreen() },
  { id: 'friends', label: 'Friends', icon: 'person', make: () => new FriendsScreen() },
  { id: 'activity', label: 'Activity', icon: 'pulse', make: () => new ActivityScreen() },
  { id: 'account', label: 'Account', icon: 'account', make: () => new AccountScreen() },
];

const wideQuery = matchMedia('(min-width: 820px)');
const root = document.getElementById('app');
const navs = {};
let detail = null;
let current = 'groups';
let pendingLink = null;

/* ---------------- theme ---------------- */

function applyTheme() {
  const t = app.store?.settings.theme || 'system';
  const html = document.documentElement;
  html.classList.add('theme-fade');
  if (t === 'system') html.removeAttribute('data-theme');
  else html.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#f2f2f7';
  setTimeout(() => html.classList.remove('theme-fade'), 400);
}

/* ---------------- history: Android back = in-app back ---------------- */

let guard = false;
function ensureGuard() {
  if (!guard) { history.pushState({ evenly: true }, ''); guard = true; }
}
function canGoBack() {
  return !!topSheet() || (navs[current]?.stack.length > 1) || (app.wide && detail?.stack.length > 0);
}
function goBack() {
  const s = topSheet();
  if (s) { s.close(); return true; }
  if (app.wide && detail.stack.length > 1) { detail.pop(); return true; }
  if (app.wide && detail.stack.length === 1) { clearDetail(); return true; }
  const nav = navs[current];
  if (nav?.stack.length > 1) { nav.pop(); return true; }
  return false;
}
addEventListener('popstate', () => {
  guard = false;
  goBack();
  if (canGoBack()) ensureGuard();
});

/* ---------------- layout ---------------- */

function shell() {
  root.className = 'shell';
  root.innerHTML = String(html`
    <div class="sidebar">
      ${TABS.map((t) => html`<div class="tab-host" data-tab="${t.id}" hidden></div>`)}
      <nav class="tabbar glass" role="tablist" aria-label="Sections">
        ${TABS.map((t) => html`<button role="tab" class="tab" data-tab="${t.id}" aria-label="${t.label}">${icon(t.icon)}<span>${t.label}</span><span class="tab-badge" hidden></span></button>`)}
      </nav>
    </div>
    <div class="detail">
      <div class="detail-host"></div>
      <div class="placeholder"><div class="ph-art">🧾</div><p>Choose a group or a friend</p></div>
    </div>`);
  for (const k of Object.keys(navs)) delete navs[k];
  detail = new Nav(root.querySelector('.detail-host'), { onTopChange: () => updateDetailPlaceholder() });
  root.querySelector('.tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    if (b.dataset.tab === current) {
      // Tapping the current tab pops to its root, as on iOS.
      const nav = navs[current];
      if (nav.stack.length > 1) nav.popToRoot();
      else nav.top?.page?.querySelector('.scroller')?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    haptic();
    app.selectTab(b.dataset.tab);
  });
  app.wide = wideQuery.matches;
  root.classList.toggle('wide', app.wide);
  app.selectTab(current);
  updateDetailPlaceholder();
  updateBadge();
}

function updateDetailPlaceholder() {
  root.querySelector('.placeholder')?.toggleAttribute('hidden', !!detail?.stack.length);
}

function clearDetail() {
  for (const s of detail.stack) { s.unmount?.(); s.page?.remove(); }
  detail.stack = [];
  updateDetailPlaceholder();
}

function updateBadge() {
  const n = app.store.unreadCount();
  const b = root.querySelector('.tab[data-tab="activity"] .tab-badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
}

app.selectTab = (id) => {
  current = id;
  for (const host of root.querySelectorAll('.tab-host')) host.hidden = host.dataset.tab !== id;
  for (const b of root.querySelectorAll('.tab')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === id));
    b.classList.toggle('on', b.dataset.tab === id);
  }
  if (!navs[id]) {
    const host = root.querySelector(`.tab-host[data-tab="${id}"]`);
    navs[id] = new Nav(host);
    navs[id].reset(TABS.find((t) => t.id === id).make());
  } else {
    navs[id].refreshAll();
  }
};

/** Open a detail screen. On tablets, roots open into the detail column. */
app.show = (screen, from) => {
  if (from?.sheet) return from.nav.push(screen);
  if (app.wide) {
    if (from?.nav === detail) detail.push(screen);
    else { clearDetail(); detail.reset(screen); updateDetailPlaceholder(); }
  } else {
    (from?.nav || navs[current]).push(screen);
  }
  ensureGuard();
};

app.present = (screen, opts = {}) => {
  const s = openSheet(screen, opts);
  ensureGuard();
  return s;
};

app.goHome = () => {
  closeAllSheets();
  if (app.wide) clearDetail();
  const nav = navs[current];
  while (nav && nav.stack.length > 1) nav.pop();
};

app.openGroup = (g) => {
  if (current !== 'groups') app.selectTab('groups');
  const nav = navs.groups;
  if (!app.wide && nav.stack.length > 1) nav.popToRoot();
  app.show(new GroupScreen(g), nav.stack[0]);
};

app.shareUpdates = (g) => app.present(new ShareUpdatesScreen(g));
app.afterJoin = (g) => app.openGroup(g);

app.refresh = () => {
  if (!root.classList.contains('shell')) return;
  navs[current]?.refreshAll();
  detail?.refreshAll();
  for (const nav of sheetNavs()) nav.refreshAll();
  updateBadge();
};

/* ---------------- links ---------------- */

app.importLink = async (text) => {
  const res = await app.store.importText(text);
  const st = app.store.state(res.g);
  if (res.kind === 'join' && res.isNew) {
    await app.store.markSeen(); // a group's history isn't "new activity" to someone who just joined
    haptic('success');
    toast(`You joined “${st.group.name}”`);
    app.openGroup(res.g);
    if (res.needsClaim) app.present(new JoinScreen(res.g, res.from));
  } else {
    toast(res.added ? `Merged ${res.added} change${res.added === 1 ? '' : 's'} from ${res.from?.name || 'a friend'} into “${st.group.name}”` : `“${st.group.name}” was already up to date`);
    if (res.added) haptic('success');
    if (res.needsClaim) app.present(new JoinScreen(res.g, res.from));
    else app.openGroup(res.g);
  }
};

async function consumeHash() {
  const link = location.href;
  if (!hasLink(link)) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!app.store.device) {
    pendingLink = link;
    if (root.classList.contains('onboarding')) app.boot(); // show the "you've been invited" welcome
    return;
  }
  try { await app.importLink(link); } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); }
}
addEventListener('hashchange', consumeHash);

/* ---------------- lock ---------------- */

let hiddenAt = 0;
let locked = false;
async function lock() {
  if (locked || !app.store.settings.lock) return;
  locked = true;
  const layer = el(String(html`<div class="lock-layer" role="dialog" aria-label="Evenly is locked">
    <div class="app-icon" aria-hidden="true"><span>=</span></div><h2>Evenly is locked</h2>
    <button class="btn btn-primary btn-large">${icon('lock')} Unlock</button></div>`));
  document.body.append(layer);
  const tryUnlock = async () => {
    if (await verifyOwner(app.store.settings.credentialId)) {
      layer.classList.add('out');
      setTimeout(() => layer.remove(), 300);
      locked = false;
      haptic('success');
    }
  };
  layer.querySelector('button').addEventListener('click', tryUnlock);
  tryUnlock();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (app.store?.settings.lock && Date.now() - hiddenAt >= (app.store.settings.lockTimeout || 0) * 1000) lock();
});

/* ---------------- boot ---------------- */

app.boot = async () => {
  applyTheme();
  if (!app.store.device) {
    root.className = 'onboarding';
    // A child host, so the onboarding Nav's listeners disappear with it when the shell replaces it.
    root.innerHTML = '<div class="onboarding-host"></div>';
    const nav = new Nav(root.firstElementChild);
    nav.reset(new WelcomeScreen({ invite: !!pendingLink }));
    return;
  }
  shell();
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    try { await app.importLink(link); } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); }
  }
};

async function start() {
  app.store = await new Store(idbPersistence()).init();
  let lastTheme = app.store.settings.theme;
  app.store.subscribe(() => {
    if (app.store.settings.theme !== lastTheme) { lastTheme = app.store.settings.theme; applyTheme(); }
    app.refresh();
  });
  installPressFeedback(document.body);
  installSwipeRows(document.body, (row) => deleteWithUndo(row.dataset.g, row.dataset.t, row.dataset.id));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  wideQuery.addEventListener('change', () => { if (root.classList.contains('shell')) { closeAllSheets(); shell(); } });
  // Segmented controls: slide the thumb right away, before the screen re-renders.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.segmented [data-act="seg"]');
    if (!b) return;
    const seg = b.closest('.segmented');
    seg.style.setProperty('--i', String([...seg.querySelectorAll('[data-act="seg"]')].indexOf(b)));
  }, true);
  if (hasLink(location.href)) await consumeHash();
  await app.boot();
  if (app.store.settings.lock) lock();
  setInterval(() => app.store.device && app.store.catchUpRecurring(), 60 * 60e3);
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start().catch((e) => {
  console.error(e);
  root.innerHTML = `<div class="fatal"><h2>Evenly couldn’t start</h2><p>${String(e.message || e).replace(/</g, '&lt;')}</p><p>If you’re in a private window, storage may be blocked.</p></div>`;
});
