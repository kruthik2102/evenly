// Packing ops for transport: JSON → deflate → AES-GCM → base64url.
// Everything here uses web platform APIs only (WebCrypto, CompressionStream),
// so it runs the same in the browser and in Node's test runner.

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
export const inflate = (bytes) => pipe(bytes, new DecompressionStream('deflate-raw'));

export function newGroupKey() {
  const k = new Uint8Array(32);
  globalThis.crypto.getRandomValues(k);
  return b64url(k);
}

const keyCache = new Map();
async function importKey(keyB64) {
  if (!keyCache.has(keyB64)) {
    keyCache.set(keyB64, subtle().importKey('raw', unb64url(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return keyCache.get(keyB64);
}

/** obj → compressed, encrypted, base64url string. `aad` binds the ciphertext to its group id. */
export async function seal(obj, keyB64, aad = '') {
  const plain = await deflate(enc.encode(JSON.stringify(obj)));
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await importKey(keyB64), plain),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64url(out);
}

export async function open(str, keyB64, aad = '') {
  const raw = unb64url(str);
  const iv = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await importKey(keyB64), ct);
  return JSON.parse(dec.decode(await inflate(new Uint8Array(plain))));
}

/** Unencrypted but compressed (used for WebRTC handshakes, which carry no ledger data). */
export async function pack(obj) {
  return b64url(await deflate(enc.encode(JSON.stringify(obj))));
}
export async function unpack(str) {
  return JSON.parse(dec.decode(await inflate(unb64url(str))));
}
