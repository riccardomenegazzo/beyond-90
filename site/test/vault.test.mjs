import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../vault.js";

const FAST = 1000;      // the production count is 600,000; the tests only need the same code path

test("a passphrase opens its vault and a wrong one does not", async () => {
  const { key, meta } = await V.createVault("correct horse battery staple", FAST);
  assert.ok(await V.unlockVault(meta, "correct horse battery staple"));
  assert.equal(await V.unlockVault(meta, "correct horse battery stapl3"), null);
  assert.equal(await V.unlockVault(meta, ""), null);
  assert.ok(key);
});

test("what is sealed comes back, and is bound to its id", async () => {
  const { key } = await V.createVault("a long enough passphrase", FAST);
  const snap = { id: "abc", customer: "Acme", files: { "contacts.csv": "id,name\nn1,Ana\n" } };
  const sealed = await V.seal(key, snap, "abc");
  assert.ok(!JSON.stringify(sealed).includes("Acme") && !JSON.stringify(sealed).includes("Ana"), "nothing readable in a sealed record");
  assert.deepEqual(await V.openSealed(key, sealed, "abc"), snap);
  await assert.rejects(V.openSealed(key, sealed, "other"), "a record cannot be moved under another id");
});

test("a changed byte is detected", async () => {
  const { key } = await V.createVault("a long enough passphrase", FAST);
  const sealed = await V.seal(key, { x: 1 }, "id");
  const raw = Uint8Array.from(atob(sealed.ct), (c) => c.charCodeAt(0));
  raw[0] ^= 1;
  const bent = { ...sealed, ct: btoa(String.fromCharCode(...raw)) };
  await assert.rejects(V.openSealed(key, bent, "id"));
});

test("every seal uses a new nonce and every vault a new salt", async () => {
  const a = await V.createVault("a long enough passphrase", FAST), b = await V.createVault("a long enough passphrase", FAST);
  assert.notEqual(a.meta.salt, b.meta.salt);
  const s1 = await V.seal(a.key, { x: 1 }, "i"), s2 = await V.seal(a.key, { x: 1 }, "i");
  assert.notEqual(s1.iv, s2.iv);
  assert.notEqual(s1.ct, s2.ct);
  assert.equal(await V.unlockVault(a.meta, "a long enough passphrase") !== null, true);
  assert.equal(await V.unlockVault({ ...a.meta, salt: b.meta.salt }, "a long enough passphrase"), null, "the salt is part of the key");
});

test("weak or hostile input is refused", async () => {
  await assert.rejects(V.createVault("short", FAST), /at least 12/);
  assert.match(V.checkPassphrase("eleven char"), /at least/);
  assert.equal(V.checkPassphrase("twelve chars!"), "");
  const { meta } = await V.createVault("a long enough passphrase", FAST);
  await assert.rejects(V.unlockVault({ ...meta, iterations: 1 }, "x"), /damaged/, "a tiny iteration count would make guessing cheap");
  await assert.rejects(V.unlockVault({ ...meta, iterations: 1e12 }, "x"), /damaged/, "a huge one would freeze the page");
  await assert.rejects(V.unlockVault({ ...meta, v: 2 }, "x"), /newer version/);
  await assert.rejects(V.unlockVault(null, "x"));
});

test("the same passphrase typed in a different Unicode form still works", async () => {
  const { meta } = await V.createVault("café au lait, s'il vous plaît", FAST);
  assert.ok(await V.unlockVault(meta, "café au lait, s'il vous plaît"));
});

test("a sealed workspace opens with the vault's passphrase, on any device, and only with it", async () => {
  const { key, meta } = await V.createVault("correct horse battery staple", FAST);
  const text = JSON.stringify({ format: "beyond90-workspace", snapshots: [{ customer: "Acme" }] });
  const file = await V.sealWorkspace(key, meta, text);
  assert.ok(!file.includes("Acme"));
  const doc = JSON.parse(file);
  assert.ok(V.isSealedWorkspace(doc) && !V.isSealedWorkspace({ format: "beyond90-workspace" }));
  assert.equal(await V.openWorkspace(doc, "correct horse battery staple"), text);
  assert.equal(await V.openWorkspace(doc, "wrong passphrase here"), null);
  doc.sealed.ct = doc.sealed.ct.slice(0, -4) + "AAAA";
  await assert.rejects(V.openWorkspace(doc, "correct horse battery staple"));
});
