// Share links. Everything after "#" stays on the device that opens the link:
// browsers never send the fragment to the web host.
//
//   Invite:  <app>#join=<groupId>.<groupKey>.<sealed {ops, claim, from}>
//   Update:  <app>#sync=<groupId>.<sealed {ops, from}>

import { seal, open } from './codec.js';

const RE = /#(join|sync)=([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)/;

export function appBase() {
  if (typeof location === 'undefined') return 'https://evenly.local/';
  return location.origin + location.pathname;
}

export async function makeInvite({ groupId, key, ops, claim, from, name }) {
  const body = await seal({ v: 1, ops, claim: claim || null, from, name }, key, groupId);
  return `${appBase()}#join=${groupId}.${key}.${body}`;
}

export async function makeSync({ groupId, key, ops, from }) {
  const body = await seal({ v: 1, ops, from }, key, groupId);
  return `${appBase()}#sync=${groupId}.${body}`;
}

/**
 * Finds an Evenly link anywhere in pasted text and decodes it.
 * `keyFor(groupId)` returns the stored key for groups we already belong to.
 */
export async function readLink(text, keyFor) {
  const m = RE.exec(text || '');
  if (!m) throw new Error('That isn’t an Evenly link.');
  const [, kind, groupId, rest] = m;
  if (kind === 'join') {
    const dot = rest.indexOf('.');
    const key = rest.slice(0, dot);
    const payload = await open(rest.slice(dot + 1), key, groupId).catch(() => {
      throw new Error('This invite is damaged or incomplete. Ask for a fresh link.');
    });
    return { kind, groupId, key, ...payload };
  }
  const key = keyFor(groupId);
  if (!key) throw new Error('This update is for a group you haven’t joined yet. Open the group’s invite link first.');
  const payload = await open(rest, key, groupId).catch(() => {
    throw new Error('This update is damaged or incomplete.');
  });
  return { kind, groupId, key, ...payload };
}

export function hasLink(text) {
  return RE.test(text || '');
}
