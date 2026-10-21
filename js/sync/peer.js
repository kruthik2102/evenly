// Live phone-to-phone sync over a WebRTC data channel.
// The handshake (offer → answer) travels as two codes the people exchange by
// QR or message ("manual signalling"), so there's no signalling server. On the
// same Wi-Fi no third party is involved at all; across networks an optional
// public STUN server only tells each phone its own public address.

import { pack, unpack, b64url } from './codec.js';

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

const fingerprint = (sdp) => (/a=fingerprint:(\S+ \S+)/.exec(sdp || '') || [])[1] || '';

// Proof that the sender holds a group's key, bound to the sender's own DTLS
// fingerprint so the other side can't replay it back. Group ids never travel
// in the clear, and ops are only accepted for groups proven this way.
async function groupTag(key, g, fp) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`evenly|${key}|${g}|${fp}`));
  return b64url(new Uint8Array(h)).slice(0, 22);
}

function waitForIce(pc, ms = 4000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms); // good-enough candidates are usually in by now
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

/**
 * @param {object} hooks
 *   summaries(): [{ g, key, summary }] for every group we hold
 *   missing(g, summary): ops the peer lacks
 *   receive(g, ops): merge ops from the peer
 *   onState(state): 'connecting' | 'open' | 'synced' | 'closed'
 */
export class PeerSync {
  constructor(hooks, { internet = false } = {}) {
    this.hooks = hooks;
    this.pc = new RTCPeerConnection({ iceServers: internet ? STUN : [] });
    this.channel = null;
    this.peerGroups = new Set();
    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') hooks.onState?.('closed');
    });
    this.pc.addEventListener('datachannel', (e) => this.#wire(e.channel));
  }

  async createOffer() {
    this.#wire(this.pc.createDataChannel('evenly', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitForIce(this.pc);
    return pack({ t: 'o', sdp: this.pc.localDescription.sdp });
  }

  async acceptOffer(code) {
    const { t, sdp } = await unpack(code.trim());
    if (t !== 'o') throw new Error('That’s an answer code. Paste the code from the phone that started.');
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitForIce(this.pc);
    this.hooks.onState?.('connecting');
    return pack({ t: 'a', sdp: this.pc.localDescription.sdp });
  }

  async acceptAnswer(code) {
    const { t, sdp } = await unpack(code.trim());
    if (t !== 'a') throw new Error('That’s an offer code. Paste the answer from the other phone.');
    this.hooks.onState?.('connecting');
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  /** Push freshly written ops while the channel is open (real-time mode). */
  push(g, ops) {
    if (this.channel?.readyState === 'open' && this.peerGroups.has(g) && ops.length) {
      this.#send({ type: 'ops', g, ops });
    }
  }

  close() {
    try { this.channel?.close(); this.pc.close(); } catch { /* already closed */ }
  }

  #wire(ch) {
    this.channel = ch;
    ch.addEventListener('open', async () => {
      this.hooks.onState?.('open');
      const fp = fingerprint(this.pc.localDescription?.sdp);
      const groups = await Promise.all(
        this.hooks.summaries().map(async ({ g, key, summary }) => ({ tag: await groupTag(key, g, fp), summary })),
      );
      this.#send({ type: 'hello', groups });
    });
    ch.addEventListener('close', () => this.hooks.onState?.('closed'));
    // Handle messages strictly in order: "ops" must not overtake the "hello" that authorises them.
    this.queue = Promise.resolve();
    ch.addEventListener('message', (e) => {
      this.queue = this.queue.then(() => this.#onMessage(JSON.parse(e.data))).catch(() => {});
    });
  }

  #send(msg) {
    // Data channels cap message size; split big op lists.
    if (msg.type === 'ops' && msg.ops.length > 150) {
      for (let i = 0; i < msg.ops.length; i += 150) this.channel.send(JSON.stringify({ ...msg, ops: msg.ops.slice(i, i + 150) }));
      return;
    }
    this.channel.send(JSON.stringify(msg));
  }

  async #onMessage(msg) {
    if (msg.type === 'hello') {
      const remoteFp = fingerprint(this.pc.remoteDescription?.sdp);
      const expected = new Map();
      for (const { g, key } of this.hooks.summaries()) expected.set(await groupTag(key, g, remoteFp), g);
      let sent = 0;
      for (const { tag, summary } of msg.groups || []) {
        const g = expected.get(tag);
        if (!g) continue; // we can only sync groups we both belong to
        this.peerGroups.add(g);
        const ops = this.hooks.missing(g, summary);
        if (ops.length) { this.#send({ type: 'ops', g, ops }); sent += ops.length; }
      }
      this.#send({ type: 'done', sent });
    } else if (msg.type === 'ops') {
      if (!this.peerGroups.has(msg.g)) return; // not a group the peer proved it belongs to
      await this.hooks.receive(msg.g, msg.ops);
    } else if (msg.type === 'done') {
      this.hooks.onState?.('synced');
    }
  }
}
