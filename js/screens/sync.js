// Moving data between phones without a server: invite links, update links,
// QR codes, live peer-to-peer sync, and file backups.

import { html, raw, toast, shareText, copyText, loadScript, shareFile, downloadFile } from '../ui/dom.js';
import { icon, avatar, groupTile } from '../ui/kit.js';
import { haptic } from '../ui/motion.js';
import { app } from '../app/app.js';
import { PeerSync } from '../sync/peer.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

/** SVG QR code for text, or null if it's too long for a scannable code. */
async function qrSvg(text) {
  if (text.length > 2300) return null;
  await loadScript(QR_LIB);
  const qr = globalThis.qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function fillQR(page, text) {
  const box = page?.querySelector('.qr');
  if (!box) return;
  try {
    const svg = await qrSvg(text);
    box.innerHTML = svg || '<p class="fine">Too much to fit in a QR code. Share the link instead.</p>';
    box.classList.toggle('empty-qr', !svg);
  } catch {
    box.innerHTML = '<p class="fine">QR codes need an internet connection the first time. Share the link instead.</p>';
  }
}

/** Live camera QR scanning with the browser's BarcodeDetector. */
export function qrScanSupported() {
  return 'BarcodeDetector' in globalThis && !!navigator.mediaDevices?.getUserMedia;
}

async function scanQR(container) {
  const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  container.innerHTML = '';
  container.append(video);
  await video.play();
  return new Promise((resolve) => {
    let stop = false;
    const done = (v) => { stop = true; stream.getTracks().forEach((t) => t.stop()); resolve(v); };
    container.__cancel = () => done(null);
    const tick = async () => {
      if (stop) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) { haptic('success'); return done(codes[0].rawValue); }
      } catch { /* frame not ready */ }
      setTimeout(tick, 180);
    };
    tick();
  });
}

/* ---------------- The group link ---------------- */

const LINK_TOO_LONG = 50000; // chat apps cap messages around 64k characters

/**
 * One link for everything: new people join with it, people already in the
 * group get the latest changes. With a member id it's a personal invite that
 * sets the opener up as that person.
 */
export class GroupLinkScreen {
  constructor(g, memberId = null) {
    this.g = g;
    // In a one-to-one ledger the link is always the friend's personal invite until they've joined.
    if (!memberId && app.store.state(g).group.direct) {
      const other = app.store.members(g).find((x) => x.id !== app.store.meIn(g));
      if (other && !other.claimedBy) memberId = other.id;
    }
    this.memberId = memberId;
    const m = memberId && app.store.state(g).member.get(memberId);
    this.title = m ? `Invite ${m.name}` : 'Share group link';
    this.count = app.store.unsharedCount(g);
    this.link = null;
    this.noAutoRefresh = true; // keep the QR code on screen while data changes
  }
  leading() { return html`<button class="nav-btn text bold" data-act="close">Done</button>`; }
  #member() { return this.memberId && app.store.state(this.g).member.get(this.memberId); }
  body() {
    const st = app.store.state(this.g);
    const m = this.#member();
    const others = app.store.members(this.g).filter((x) => x.id !== app.store.meIn(this.g));
    const name = st.group.direct ? `You and ${m?.name || others[0]?.name || 'a friend'}` : st.group.name;
    const tooLong = this.link && this.link.length > LINK_TOO_LONG;
    const hasPhotos = st.receipt.size > 0;
    return html`
      <div class="invite-head">${groupTile(st.group, 'xl')}<h2>${name}</h2>
        <p>${m ? `This link opens Evenly on ${m.name}’s phone, already set up as ${m.name}.`
          : st.group.direct ? `Send this to ${app.store.groupName(this.g)}. Opening it brings in your latest changes.`
          : 'Send this to the group chat. New people join with it, and people already in the group get the latest changes.'}</p>
        ${!m && this.count ? html`<p class="fine">Includes the ${this.count} change${this.count === 1 ? '' : 's'} since you last shared.</p>` : ''}</div>
      <div class="qr-card"><div class="qr">${raw('<div class="spinner"></div>')}</div><p class="fine">Scan with a phone camera, or send the link.</p></div>
      <div class="button-stack">
        ${tooLong ? html`<button class="btn btn-primary btn-large wide" data-act="file">${icon('share')} Send as a file</button>
          <p class="section-footer">This group’s history is too long to fit in a chat message, so send it as a file. Opening the file in Evenly works the same as tapping a link.</p>`
        : html`<button class="btn btn-primary btn-large wide" data-act="share" ${this.link ? '' : raw('disabled')}>${icon('share')} ${m ? `Send to ${m.name}` : 'Share link'}</button>`}
        <button class="btn btn-tinted wide" data-act="copy" ${this.link ? '' : raw('disabled')}>${icon('link')} Copy link</button>
      </div>
      ${hasPhotos ? html`<p class="section-footer">Receipt photos aren’t included in links, to keep them short. Use live phone-to-phone sync to share photos.</p>` : ''}
      <p class="section-footer">The link carries the group’s encryption key and its history inside the part after “#”, which never reaches any web server. Treat it like a group chat invite: only send it to people in the group.</p>`;
  }
  async mount(page) {
    const { link } = await app.store.shareLink(this.g, { claim: this.memberId });
    this.link = link;
    if (!page.isConnected) return;
    this.nav.refresh(this);
    await fillQR(this.page, link);
  }
  #message() {
    const st = app.store.state(this.g);
    const m = this.#member();
    if (m && st.group.direct) return `Hi ${m.name}! Let’s keep track of what we owe each other on Evenly. Tap to join:`;
    if (m) return `Hi ${m.name}! I’ve added you to “${st.group.name}” on Evenly to split costs. Tap to join:`;
    if (st.group.direct) return `Our expenses on Evenly, updated. Tap to see the latest:`;
    return `“${st.group.name}” on Evenly. Tap to join, or to get the latest changes:`;
  }
  on = {
    close() { this.sheet.close(); },
    async share() {
      if (!this.link) return;
      if (!(await shareText({ title: 'Evenly', text: this.#message(), url: this.link }))) { await copyText(`${this.#message()} ${this.link}`); toast('Link copied. Paste it in any chat.'); }
    },
    async copy() {
      if (!this.link) return;
      await copyText(this.link);
      haptic();
      toast('Link copied');
    },
    async file() {
      const name = app.store.state(this.g).group.name.replace(/[^\w\- ]+/g, '') || 'group';
      await shareFile(`${name}.evenly.txt`, this.link, 'text/plain');
    },
  };
}

// Older names, kept so every entry point opens the same screen.
export const InviteScreen = GroupLinkScreen;
export const ShareUpdatesScreen = GroupLinkScreen;

/* ---------------- Import (paste, file, camera) ---------------- */

export class ImportScreen {
  constructor() { this.title = 'Open a link'; this.text = ''; }
  leading() { return html`<button class="nav-btn text" data-act="close">Cancel</button>`; }
  actions() { return html`<button class="nav-btn text bold" data-act="open">Open</button>`; }
  body() {
    return html`
      <p class="section-footer">Paste an invite or update link a friend sent you. Links usually open Evenly by themselves; this is for when they don’t.</p>
      <div class="card"><textarea class="paste-box" data-field="text" rows="5" placeholder="Paste the link here" autofocus>${this.text}</textarea></div>
      <div class="button-stack">
        <button class="btn btn-tinted wide" data-act="paste">Paste from clipboard</button>
        ${qrScanSupported() ? html`<button class="btn btn-tinted wide" data-act="scan">${icon('qr')} Scan a QR code</button>` : ''}
        <label class="btn btn-plain wide">Open a file<input type="file" class="visually-hidden" accept=".txt,.evenly,.json,text/plain,application/json" data-field="file"></label>
      </div>
      <div class="camera"></div>`;
  }
  onInput(f, el) { this.text = el.value; }
  async onChange(f, el) {
    if (f === 'file' && el.files?.[0]) {
      this.text = await el.files[0].text();
      this.on.open.call(this);
    }
  }
  unmount() { this.page?.querySelector('.camera')?.__cancel?.(); }
  on = {
    close() { this.sheet.close(); },
    async paste() {
      try { this.text = await navigator.clipboard.readText(); this.nav.refresh(this); } catch { toast('Long-press the box and choose Paste'); }
    },
    async scan() {
      try {
        const v = await scanQR(this.page.querySelector('.camera'));
        if (v) { this.text = v; this.on.open.call(this); }
      } catch { toast('Camera not available'); }
    },
    async open() {
      const text = this.text.trim();
      if (!text) return toast('Paste a link first');
      try {
        if (text.startsWith('{')) {
          const n = await app.store.restore(JSON.parse(text));
          toast(`Restored ${n} changes`);
          this.sheet.close();
          return;
        }
        this.sheet.close();
        await app.importLink(text);
      } catch (e) { toast(e.message, { kind: 'error' }); }
    },
  };
}

/* ---------------- Join: which member are you? ---------------- */

export class JoinScreen {
  constructor(g, from = null) { this.g = g; this.from = from; this.title = 'Join group'; this.modalLock = true; }
  body() {
    const st = app.store.state(this.g);
    const open = app.store.members(this.g).filter((m) => !m.claimedBy);
    return html`
      <div class="invite-head">${groupTile(st.group, 'xl')}<h2>${st.group.name}</h2>
        <p>${this.from ? `${this.from.name} invited you. ` : ''}Which one is you?</p></div>
      <div class="list">${open.map((m) => html`<button class="cell tappable" data-act="pick" data-id="${m.id}"><span class="cell-leading">${avatar(m, 'lg')}</span><span class="cell-main"><span class="cell-title">${m.name}</span></span></button>`)}
        <button class="cell tappable" data-act="new"><span class="cell-leading"><span class="sq tint-indigo">${icon('plus')}</span></span><span class="cell-main"><span class="cell-title accent-text">I’m not on the list</span><span class="cell-sub">Join as ${app.store.device.name}</span></span></button>
      </div>
      <p class="section-footer">Picking yourself links your phone to that name, so expenses already added for you show up as yours.</p>`;
  }
  on = {
    async pick(el) { await app.store.claim(this.g, el.dataset.id); haptic('success'); this.sheet.close(); app.afterJoin(this.g); },
    async new() { await app.store.joinAsNew(this.g); haptic('success'); this.sheet.close(); app.afterJoin(this.g); },
  };
}

/* ---------------- Nearby live sync (WebRTC) ---------------- */

export class NearbyScreen {
  constructor() { this.title = 'Nearby sync'; this.stage = 'choose'; this.code = ''; this.state = ''; this.internet = false; this.received = 0; this.noAutoRefresh = true; }
  leading() { return html`<button class="nav-btn text bold" data-act="close">${this.stage === 'live' ? 'Done' : 'Cancel'}</button>`; }
  body() {
    const s = this.stage;
    if (s === 'choose') {
      return html`
        <div class="invite-head"><span class="group-tile tint-green xl">📡</span><h2>Sync phone to phone</h2>
          <p>Connect directly to a friend’s phone and swap every change for the groups you share. Nothing goes through a server.</p></div>
        <div class="button-stack">
          <button class="btn btn-primary btn-large wide" data-act="start">Start on this phone</button>
          <button class="btn btn-tinted wide" data-act="join">The other phone started</button>
        </div>
        <div class="list"><div class="cell"><span class="cell-main"><span class="cell-title">Not on the same Wi-Fi</span><span class="cell-sub">Uses a public STUN server only to find each other’s address</span></span>
          <span class="cell-trailing"><label class="switch"><input type="checkbox" role="switch" data-field="internet" ${this.internet ? raw('checked') : ''} aria-label="Not on the same Wi-Fi"><span class="track"><span class="thumb"></span></span></label></span></div></div>`;
    }
    if (s === 'offer') {
      return html`<p class="step">Step 1 of 2 · On the other phone, choose “The other phone started” and scan this.</p>
        <div class="qr-card"><div class="qr">${raw('<div class="spinner"></div>')}</div></div>
        <button class="btn btn-tinted wide" data-act="copyCode">${icon('link')} Copy code instead</button>
        <p class="step">Step 2 of 2 · Then scan or paste the answer it shows.</p>
        ${this.#reader('Paste the answer code')}`;
    }
    if (s === 'scanOffer') {
      return html`<p class="step">Scan or paste the code shown on the phone that started.</p>${this.#reader('Paste the code')}`;
    }
    if (s === 'answer') {
      return html`<p class="step">Show this to the first phone to finish connecting.</p>
        <div class="qr-card"><div class="qr">${raw('<div class="spinner"></div>')}</div></div>
        <button class="btn btn-tinted wide" data-act="copyCode">${icon('link')} Copy code instead</button>
        <p class="status-line">${this.state === 'connecting' ? 'Waiting for the other phone…' : ''}</p>`;
    }
    return html`<div class="invite-head"><span class="group-tile tint-green xl live-dot">🔗</span>
      <h2>${this.state === 'closed' ? 'Disconnected' : 'Connected'}</h2>
      <p>${this.state === 'closed' ? 'The connection ended. Start again to sync more.' : `Synced. ${this.received} change${this.received === 1 ? '' : 's'} received so far. While this stays open, new changes on either phone arrive instantly.`}</p></div>`;
  }
  #reader(placeholder) {
    return html`<div class="card"><textarea class="paste-box" data-field="code" rows="3" placeholder="${placeholder}">${this.code}</textarea></div>
      <div class="button-stack">${qrScanSupported() ? html`<button class="btn btn-tinted wide" data-act="scan">${icon('qr')} Scan with camera</button>` : ''}
      <button class="btn btn-primary wide" data-act="submit">Connect</button></div><div class="camera"></div>`;
  }
  #peer() {
    const store = app.store;
    const base = store.peerHooks((state) => {
      this.state = state;
      if (state === 'open' || state === 'synced') { this.stage = 'live'; haptic('success'); }
      this.nav.refresh(this);
    });
    const receive = base.receive;
    base.receive = async (g, ops) => { this.received += ops.length; await receive(g, ops); };
    this.peer = new PeerSync(base, { internet: this.internet });
    store.addPeer(this.peer);
  }
  onInput(f, el) { if (f === 'code') this.code = el.value; }
  onChange(f, el) { if (f === 'internet') this.internet = el.checked; }
  unmount() {
    this.page?.querySelector('.camera')?.__cancel?.();
    if (this.peer) { app.store.removePeer(this.peer); this.peer.close(); }
  }
  on = {
    close() { this.sheet.close(); },
    async start() {
      this.#peer();
      this.stage = 'offer';
      this.nav.refresh(this);
      this.myCode = await this.peer.createOffer();
      await fillQR(this.page, this.myCode);
    },
    join() { this.#peer(); this.stage = 'scanOffer'; this.nav.refresh(this); },
    async scan() {
      try {
        const v = await scanQR(this.page.querySelector('.camera'));
        if (v) { this.code = v; this.on.submit.call(this); }
      } catch { toast('Camera not available'); }
    },
    async submit() {
      const code = this.code.trim();
      if (!code) return toast('Paste the code first');
      try {
        if (this.stage === 'scanOffer') {
          this.myCode = await this.peer.acceptOffer(code);
          this.stage = 'answer';
          this.code = '';
          this.nav.refresh(this);
          await fillQR(this.page, this.myCode);
        } else {
          await this.peer.acceptAnswer(code);
          toast('Connecting…');
        }
      } catch (e) { toast(e.message || 'That code didn’t work', { kind: 'error' }); }
    },
    async copyCode() { await copyText(this.myCode); toast('Code copied'); },
  };
}

/* ---------------- Backup & restore ---------------- */

export class BackupScreen {
  constructor() { this.title = 'Back up or restore'; }
  leading() { return html`<button class="nav-btn text bold" data-act="close">Done</button>`; }
  body() {
    return html`
      <p class="section-footer">Your data lives only on this phone and your friends’ phones. Save a backup file somewhere safe (Drive, email to yourself) to move to a new phone or recover after clearing the browser.</p>
      <div class="list">
        <button class="cell tappable" data-act="backup"><span class="cell-leading"><span class="sq tint-indigo">${icon('download')}</span></span><span class="cell-main"><span class="cell-title accent-text">Save a backup file</span><span class="cell-sub">Everything, including group keys. Keep it private.</span></span></button>
        <label class="cell tappable"><span class="cell-leading"><span class="sq tint-green">${icon('upload')}</span></span><span class="cell-main"><span class="cell-title accent-text">Restore from a backup file</span><span class="cell-sub">Merges into what’s here. Nothing is overwritten.</span></span>
          <input type="file" class="visually-hidden" accept=".json,application/json" data-field="file"></label>
      </div>`;
  }
  async onChange(f, el) {
    if (f !== 'file' || !el.files?.[0]) return;
    try {
      const n = await app.store.restore(JSON.parse(await el.files[0].text()));
      haptic('success');
      toast(`Restored ${n} change${n === 1 ? '' : 's'}`);
    } catch (e) { toast(e.message || 'That file isn’t a backup', { kind: 'error' }); }
  }
  on = {
    close() { this.sheet.close(); },
    async backup() {
      const data = JSON.stringify(app.store.backup());
      const name = `evenly-backup-${app.store.today()}.json`;
      await shareFile(name, data, 'application/json');
    },
  };
}

export { downloadFile };
