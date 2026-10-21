// Share links. Everything after "#" stays on the device that opens the link:
// browsers never send the fragment to the web host.
//
//   Group link:  <app>#join=<groupId>.<groupKey>.<sealed {ops, claim, from, name}>
//     The only kind Evenly creates: new people join, members get the latest.
//   Old update:  <app>#sync=<groupId>.<sealed {ops, from}>
//     Created by early versions; still readable by people already in the group.

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
  if (!key) throw new Error('This is an older update link, which only works for people already in the group. Ask the sender to tap Share in the group and send the new link.');
  const payload = await open(rest, key, groupId).catch(() => {
    throw new Error('This update is damaged or incomplete.');
  });
  return { kind, groupId, key, ...payload };
}

export function hasLink(text) {
  return RE.test(text || '');
}
