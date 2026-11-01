import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as W from "../workspace-core.js";

const here = dirname(fileURLToPath(import.meta.url));
const demo = join(here, "..", "..", "examples", "portfolio", "northwind");
const load = (d) => Object.fromEntries(readdirSync(d).filter((f) => /\.(csv|toml)$/.test(f)).map((f) => [f, readFileSync(join(d, f), "utf8")]));

test("the fingerprint matches the one pinned in the Python tests", async () => {
  assert.equal(await W.fingerprint({ "a.csv": "x\n", "b.csv": "y\n" }), await W.fingerprint({}));   // neither is an input file: both are the empty fingerprint
  const f = { "customer.toml": "x\n", "accounts.csv": "y\n" };
  assert.equal(await W.fingerprint(f), "9638e700961eabd22e0b9cb2facaa66b42f7195680e19520bb9ed745d4d03afd");               // the value tests/test_provenance.py computes in Python
  const body = `accounts.csv\t${await W.sha256Hex("y\n")}\ncustomer.toml\t${await W.sha256Hex("x\n")}\n`;
  assert.equal(await W.fingerprint(f), await W.sha256Hex(body));
});

test("line endings, a BOM and non-input files do not change the identity; content does", async () => {
  const base = load(demo), id = await W.fingerprint(base);
  assert.equal(id, await W.fingerprint(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.replace(/\n/g, "\r\n")]))));
  assert.equal(id, await W.fingerprint({ ...base, "notes.txt": "hello", "dir/accounts.csv.bak": "x" }));
  assert.equal(id, await W.fingerprint({ ...base, "accounts.csv": "﻿" + base["accounts.csv"] }));
  assert.notEqual(id, await W.fingerprint({ ...base, "accounts.csv": base["accounts.csv"] + " " }));
});

test("personal files are left out of a snapshot unless asked for, and that is recorded", async () => {
  const f = load(demo);
  const a = await W.makeSnapshot(f, { customer: "N", asOf: "2026-10-31" });
  assert.ok(!("contacts.csv" in a.files) && !("commitments.csv" in a.files) && a.personal_excluded);
  const b = await W.makeSnapshot(f, { customer: "N", asOf: "2026-10-31", includePersonal: true });
  assert.ok("contacts.csv" in b.files && !b.personal_excluded && a.id !== b.id);
  assert.equal(a.id, (await W.makeSnapshot(f, { customer: "N", asOf: "2026-10-31" })).id);   // saving twice names the same snapshot
});

test("peekCustomer reads the name and date, and tolerates their absence", () => {
  assert.deepEqual(W.peekCustomer({ "customer.toml": '[customer]\nname = "Acme"\nas_of = 2026-09-30\n' }), { customer: "Acme", asOf: "2026-09-30" });
  assert.deepEqual(W.peekCustomer({ "customer.toml": '[customer]\nas_of = "2026-09-30"\n' }), { customer: "", asOf: "2026-09-30" });
  assert.deepEqual(W.peekCustomer({}), { customer: "", asOf: "" });
});

const snap = async (customer, asOf, text, extra = {}) => ({ ...(await W.makeSnapshot({ "customer.toml": text }, { customer, asOf })), ...extra });

test("merging is commutative, associative and idempotent", async () => {
  const a = [await snap("N", "2026-09-30", "a"), await snap("N", "2026-10-31", "b")];
  const b = [await snap("N", "2026-10-31", "b", { saved_on: "2026-11-02" }), await snap("C", "2026-10-31", "c")];
  const c = [await snap("Z", "2026-01-01", "z")];
  const j = (x) => JSON.stringify(x);
  assert.equal(j(W.mergeSnapshots(a, b)), j(W.mergeSnapshots(b, a)));
  assert.equal(j(W.mergeSnapshots(W.mergeSnapshots(a, b), c)), j(W.mergeSnapshots(a, W.mergeSnapshots(b, c))));
  assert.equal(j(W.mergeSnapshots(a, a)), j(W.mergeSnapshots(a, [])));
  assert.equal(W.mergeSnapshots(a, b).length, 3);
});

test("the earliest save date wins and an empty one never does", async () => {
  const x = await snap("N", "2026-10-31", "q", { saved_on: "2026-11-05" });
  const y = { ...x, saved_on: "2026-11-02" }, z = { ...x, saved_on: "" };
  assert.equal(W.mergeSnapshots([x], [y])[0].saved_on, "2026-11-02");
  assert.equal(W.mergeSnapshots([z], [x])[0].saved_on, "2026-11-05");
});

test("unknown fields written by a newer page survive a round trip and a merge", async () => {
  const s = await snap("N", "2026-10-31", "q", { tags: ["board"], sync: { rev: 3 } });
  const text = W.serializeWorkspace([s], { engine: "0.9.0", extra: { future_field: { k: 1 } } });
  const { snapshots, unknown } = W.parseWorkspace(text);
  assert.deepEqual(unknown, { future_field: { k: 1 } });
  const back = W.mergeSnapshots(snapshots, [await snap("N", "2026-10-31", "q")]);
  assert.deepEqual(back[0].tags, ["board"]);
  assert.deepEqual(back[0].sync, { rev: 3 });
});

test("a workspace from a newer major format is refused with a clear message, other files are rejected", () => {
  assert.throws(() => W.parseWorkspace(JSON.stringify({ format: W.WORKSPACE_FORMAT, version: 99, snapshots: [] })), /newer version/);
  assert.throws(() => W.parseWorkspace("{nope"), /not a JSON file/);
  assert.throws(() => W.parseWorkspace(JSON.stringify({ format: "other", version: 1, snapshots: [] })), /not a Beyond 90 workspace/);
  assert.throws(() => W.parseWorkspace(JSON.stringify({ format: W.WORKSPACE_FORMAT, version: 1 })), /no snapshots/);
});

test("a snapshot whose content does not match its name is rejected on the way in", async () => {
  const good = await snap("N", "2026-10-31", "q");
  const tampered = { ...good, files: { "customer.toml": "something else" } };
  const { ok, rejected } = await W.acceptSnapshots([good, tampered, { id: 5 }, null]);
  assert.equal(ok.length, 1);
  assert.equal(rejected, 3);
});

test("previousOf finds earlier snapshots of the same customer, newest first", async () => {
  const list = [await snap("N", "2026-06-30", "a"), await snap("N", "2026-09-30", "b"), await snap("N", "2026-10-31", "c"), await snap("C", "2026-09-30", "d")];
  const got = W.previousOf(list, "N", "2026-10-31");
  assert.deepEqual(got.map((s) => s.as_of), ["2026-09-30", "2026-06-30"]);
});
