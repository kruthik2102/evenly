// Profile, app lock (WebAuthn platform authenticator), onboarding and "How it works".

import { html, raw, toast } from '../ui/dom.js';
import { icon, avatar } from '../ui/kit.js';
import { haptic } from '../ui/motion.js';
import { allCurrencies, currencyName } from '../core/money.js';
import { b64url, unb64url } from '../sync/codec.js';
import { app } from '../app/app.js';

const EMOJI_CHOICES = ['🙂', '😎', '🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦄', '🐝', '🌻', '🌈', '⚡️', '🔥', '🍀', '🎧', '🏏', '🎸', '🚀', '☕️'];

/* ---------------- App lock ---------------- */

export function lockSupported() {
  return !!(globalThis.PublicKeyCredential && navigator.credentials?.create && isSecureContext);
}

const challenge = () => globalThis.crypto.getRandomValues(new Uint8Array(32));

/** Registers a platform credential (fingerprint / face / screen lock). Returns its id. */
export async function enableLock(device) {
  if (!lockSupported()) throw new Error('This browser can’t use your phone’s lock.');
  const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.();
  if (ok === false) throw new Error('Set up a fingerprint or screen lock on this phone first.');
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { name: 'Evenly' },
      user: { id: new TextEncoder().encode(device.id), name: device.name, displayName: device.name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  return b64url(new Uint8Array(cred.rawId));
}

/** Asks the phone to verify the owner. Resolves true if they did. */
export async function verifyOwner(credentialId) {
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        allowCredentials: credentialId ? [{ type: 'public-key', id: unb64url(credentialId) }] : [],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Profile ---------------- */

export class ProfileScreen {
  constructor() {
    const d = app.store.device;
    this.title = 'Your profile';
    this.d = { name: d.name, emoji: d.emoji, upi: d.upi || '' };
  }
  leading() { return html`<button class="nav-btn text" data-act="cancel">Cancel</button>`; }
  actions() { return html`<button class="nav-btn text bold" data-act="save">Done</button>`; }
  body() {
    return html`
      <div class="hero small">${avatar({ name: this.d.name, emoji: this.d.emoji, id: app.store.device.id }, 'xxl')}</div>
      <div class="card"><div class="emoji-grid">${EMOJI_CHOICES.map((e) => html`<button class="emoji-btn ${e === this.d.emoji ? 'on' : ''}" data-act="emoji" data-v="${e}" aria-label="${e}">${e}</button>`)}</div></div>
      <div class="list">
        <label class="cell"><span class="cell-label">Name</span><span class="cell-main"><input class="inline" data-field="name" value="${this.d.name}" autocomplete="name"></span></label>
        <label class="cell"><span class="cell-label">UPI ID</span><span class="cell-main"><input class="inline" data-field="upi" value="${this.d.upi}" placeholder="name@okbank" autocomplete="off" autocapitalize="none"></span></label>
      </div>
      <p class="section-footer">Your name and UPI ID are shared with the groups you’re in, so friends can pay you straight from Evenly.</p>`;
  }
  onInput(f, el) { this.d[f] = el.value; }
  on = {
    cancel() { this.sheet.close(); },
    emoji(el) { this.d.emoji = el.dataset.v; this.nav.refresh(this); },
    async save() {
      if (!this.d.name.trim()) return toast('Your name can’t be empty');
      await app.store.updateDevice({ name: this.d.name.trim(), emoji: this.d.emoji, upi: this.d.upi.trim() });
      haptic('success');
      this.sheet.close();
    },
  };
}

/* ---------------- Onboarding ---------------- */

export class WelcomeScreen {
  constructor({ invite = false } = {}) {
    this.invite = invite;
    this.title = '';
    this.className = 'welcome-page';
    this.d = { name: '', emoji: '🙂', currency: guessCurrency(), upi: '' };
  }
  body() {
    return html`
      <div class="welcome">
        <div class="app-icon" aria-hidden="true"><span>=</span></div>
        <h1 class="welcome-title">Evenly</h1>
        <p class="welcome-sub">${this.invite ? 'You’ve been invited to split expenses. Tell us your name to join.' : 'Split expenses with friends. Free, private, no accounts.'}</p>
        <ul class="welcome-points">
          <li><span class="sq tint-green">${icon('lock')}</span><span><strong>Stays on your phone</strong>No sign-up and no server. Your data is yours.</span></li>
          <li><span class="sq tint-blue">${icon('link')}</span><span><strong>Syncs through links</strong>Send updates in WhatsApp, or sync phone to phone.</span></li>
          <li><span class="sq tint-purple">${icon('wand')}</span><span><strong>Everything free</strong>Receipt scanning, charts, search, itemized splits and currency conversion.</span></li>
        </ul>
        <div class="list">
          <label class="cell"><span class="cell-label">Your name</span><span class="cell-main"><input class="inline" data-field="name" value="${this.d.name}" placeholder="As friends know you" autocomplete="given-name" autofocus></span></label>
          <label class="cell"><span class="cell-label">Currency</span><span class="cell-main"><select class="inline-select" data-field="currency">${allCurrencies().map((c) => html`<option value="${c}" ${c === this.d.currency ? raw('selected') : ''}>${c} · ${currencyName(c)}</option>`)}</select></span></label>
          <label class="cell"><span class="cell-label">UPI ID</span><span class="cell-main"><input class="inline" data-field="upi" value="${this.d.upi}" placeholder="Optional, so friends can pay you" autocapitalize="none" autocomplete="off"></span></label>
        </div>
        <button class="btn btn-primary btn-large wide" data-act="go">${this.invite ? 'Join' : 'Get started'}</button>
        ${this.invite ? '' : html`<label class="btn btn-plain wide">Restore from a backup<input type="file" class="visually-hidden" accept=".json,application/json" data-field="file"></label>`}
      </div>`;
  }
  onInput(f, el) { this.d[f] = el.value; }
  async onChange(f, el) {
    if (f === 'currency') this.d.currency = el.value;
    if (f === 'file' && el.files?.[0]) {
      try {
        await app.store.restore(JSON.parse(await el.files[0].text()));
        app.boot();
      } catch (e) { toast(e.message || 'That isn’t a backup file', { kind: 'error' }); }
    }
  }
  on = {
    async go() {
      if (!this.d.name.trim()) {
        toast('Type your name first');
        this.page.querySelector('[data-field="name"]')?.focus();
        return;
      }
      await app.store.setupDevice(this.d);
      haptic('success');
      app.boot();
    },
  };
}

function guessCurrency() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const map = { IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD', AU: 'AUD', CA: 'CAD', JP: 'JPY', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', NP: 'NPR', LK: 'LKR', TH: 'THB', MY: 'MYR', ID: 'IDR' };
    return map[region] || 'INR';
  } catch {
    return 'INR';
  }
}

/* ---------------- How it works ---------------- */

export class AboutScreen {
  constructor() { this.title = 'How Evenly works'; }
  body() {
    const card = (emoji, title, text) => html`<div class="card about-card"><span class="about-emoji">${emoji}</span><div><h3>${title}</h3><p>${text}</p></div></div>`;
    return html`
      ${card('📱', 'Your phone is the database', 'Every group is a log of small changes saved in this browser’s storage. There’s no account, no server and no database anywhere else.')}
      ${card('🔀', 'Changes merge, never clash', 'Each change records who made it and when. When two phones meet, they swap what the other is missing and every phone ends up with the same balances. If two people edit the same thing, the later edit wins, field by field.')}
      ${card('🔐', 'Encrypted links', 'Each group has its own secret key. Update links are encrypted with it, and everything travels after the “#” in the link, which browsers never send to a web server.')}
      ${card('📡', 'Phone to phone', 'Live sync connects two phones directly over WebRTC. You swap two QR codes instead of using a server to introduce them.')}
      ${card('🧮', 'Exact money', 'Amounts are whole paise or cents, and splits round so they always add up to the total. Every phone rounds the same way.')}
      ${card('🆓', 'Everything is free', 'Receipt scanning runs on your phone, charts and search work on local data, and currency rates come from a free public source. There’s nothing to charge for.')}
      <h3 class="section-header">What it can’t do without a server</h3>
      <div class="list">
        <div class="cell"><span class="cell-main"><span class="cell-title">Push notifications</span><span class="cell-sub">You see new activity when you open a link or sync.</span></span></div>
        <div class="cell"><span class="cell-main"><span class="cell-title">Emails and automatic reminders</span><span class="cell-sub">“Remind…” writes the message for you to send.</span></span></div>
        <div class="cell"><span class="cell-main"><span class="cell-title">Account recovery</span><span class="cell-sub">Keep a backup file, or re-join from a friend’s invite.</span></span></div>
      </div>
      <div class="bottom-space"></div>`;
  }
}
