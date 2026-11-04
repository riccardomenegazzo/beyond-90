// Optional protection of what this browser has saved, with a passphrase. Nothing here talks to a server.
//
//  - the key is derived with PBKDF2-SHA-256 (600,000 rounds, a random 16-byte salt) and kept only in memory
//  - each snapshot is sealed on its own with AES-256-GCM, a fresh random 12-byte nonce, and its id as associated data,
//    so a sealed record cannot be swapped for another one and any change to it is detected
//  - a small check value tells a wrong passphrase from damaged data without revealing anything about the content
//  - an exported workspace is sealed the same way, with the vault's salt, so the passphrase opens it on another device
//  - there is no recovery: a forgotten passphrase means the saved copy is gone
const enc = new TextEncoder(), dec = new TextDecoder();
const KDF_ITERATIONS = 600_000;
const MIN_PASSPHRASE = 12;

const b64 = (buf) => { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function derive(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(key, obj, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function openSealed(key, sealed, aad) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv), additionalData: enc.encode(aad) }, key, unb64(sealed.ct));
  return JSON.parse(dec.decode(pt));
}

export function checkPassphrase(p) {
  if (typeof p !== "string" || [...p].length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters. A few unrelated words is better than a short clever one.`;
  return "";
}

export async function createVault(passphrase, iterations = KDF_ITERATIONS) {
  const bad = checkPassphrase(passphrase);
  if (bad) throw new Error(bad);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(passphrase, salt, iterations);
  return { key, meta: { v: 1, kdf: "PBKDF2-SHA256", iterations, salt: b64(salt), check: await seal(key, { ok: "beyond90" }, "vault") } };
}

const SEALED_FORMAT = "beyond90-sealed-workspace";

/** A workspace file sealed with the vault's key; the same passphrase opens it anywhere. */
export async function sealWorkspace(key, meta, text) {
  return JSON.stringify({ format: SEALED_FORMAT, v: 1, kdf: meta.kdf, iterations: meta.iterations, salt: meta.salt, check: meta.check, sealed: await seal(key, { text }, "workspace") });
}

export const isSealedWorkspace = (doc) => !!doc && doc.format === SEALED_FORMAT;

/** The workspace text inside a sealed file, or null if the passphrase is wrong. */
export async function openWorkspace(doc, passphrase) {
  const key = await unlockVault({ v: doc.v, iterations: doc.iterations, salt: doc.salt, check: doc.check }, passphrase);
  if (!key) return null;
  const { text } = await openSealed(key, doc.sealed, "workspace");
  if (typeof text !== "string") throw new Error("The sealed workspace is damaged.");
  return text;
}

/** The key for this passphrase, or null if it is wrong. */
export async function unlockVault(meta, passphrase) {
  if (!meta || meta.v !== 1 || !Number.isInteger(meta.iterations) || meta.iterations < 1000 || meta.iterations > 5_000_000) throw new Error("The protection record is damaged or from a newer version.");
  const key = await derive(passphrase, unb64(meta.salt), meta.iterations);
  try { return (await openSealed(key, meta.check, "vault")).ok === "beyond90" ? key : null; } catch { return null; }
}
