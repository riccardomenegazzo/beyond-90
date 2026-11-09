import test from "node:test";
import assert from "node:assert/strict";
import { assign, emptyTable, redact, redactName, restore, leftovers, validTable, dropCustomer, kindsFor } from "../aliases.js";

const ids = { customer: ["Northwind Traders"], person: ["Ana Rossi", "Ana"], team: ["Platform"], account: ["nw-prod", "nw-prod-eu"] };
const table = (level = "pseudonym") => assign(emptyTable(), ids, level, "Northwind Traders");

test("levels decide which kinds are replaced", () => {
  assert.deepEqual(kindsFor("full"), []);
  assert.deepEqual(kindsFor("people"), ["person"]);
  assert.equal(kindsFor("pseudonym").length, 4);
  assert.equal(table("full").entries.length, 0);
  assert.equal(table("people").entries.length, 2);
});

test("aliases are stable: assigning again keeps them and adds only new ones", () => {
  const t = table();
  const again = assign(t, { ...ids, person: [...ids.person, "Bo Li"] }, "pseudonym", "Northwind Traders");
  for (const e of t.entries) assert.equal(again.entries.find((x) => x.o === e.o).a, e.a);
  assert.equal(again.entries.length, t.entries.length + 1);
  assert.equal(assign(t, ids, "pseudonym", "x").entries.length, t.entries.length);
});

test("redacts whole words only, longest name first, case-insensitively", () => {
  const t = table();
  const r = redact("Ana Rossi owns nw-prod-eu; ana said nw-prod is fine. Banana stays. NORTHWIND  traders renews.", t, "pseudonym");
  assert.ok(!/Rossi|nw-prod|Northwind/i.test(r.text));
  assert.match(r.text, /Banana stays/);
  assert.equal(r.replaced, 5);
  const a = t.entries.find((e) => e.o === "nw-prod-eu").a, b = t.entries.find((e) => e.o === "nw-prod").a;
  assert.notEqual(a, b);
});

test("a level that does not cover a kind leaves it alone", () => {
  const t = table();
  const r = redact("Ana Rossi at Northwind Traders", t, "people");
  assert.match(r.text, /Northwind Traders/);
  assert.doesNotMatch(r.text, /Rossi/);
});

test("restore puts the originals back, Person 10 is not read as Person 1", () => {
  const many = assign(emptyTable(), { person: Array.from({ length: 12 }, (_, i) => `Name${i}x`) }, "people", "c");
  const p1 = many.entries[0], p10 = many.entries[9];
  const back = restore(`${p10.a} and ${p1.a}`, many);
  assert.equal(back.text, `${p10.o} and ${p1.o}`);
  assert.equal(back.restored, 2);
  const t = table();
  const shared = redact("Ana Rossi / Northwind Traders / Platform", t, "pseudonym").text;
  assert.equal(restore(shared, t).text, "Ana Rossi / Northwind Traders / Platform");
});

test("file names read as slugs", () => {
  const t = table();
  const n = redactName("beyond90-handoff-northwind-traders-2026-11-09.md", t, "pseudonym");
  assert.ok(!/northwind/.test(n));
  assert.match(n, /customer-a/);
});

test("a file name with punctuation in the customer's name still matches its slug", () => {
  const t = assign(emptyTable(), { customer: ["Northwind (mock)"] }, "pseudonym", "Northwind (mock)");
  const n = redactName("beyond90-handoff-northwind-mock-2026-11-09.md", t, "pseudonym");
  assert.equal(n, "beyond90-handoff-customer-a-2026-11-09.md");
});

test("regex characters in a name are plain text", () => {
  const t = assign(emptyTable(), { customer: ["A.C. (Corp)+", "x|y"] }, "pseudonym", "c");
  const r = redact("A.C. (Corp)+ and x|y and AxC", t, "pseudonym");
  assert.equal(r.replaced, 2);
  assert.match(r.text, /AxC/);
});

test("leftovers report uncovered identifiers and emails", () => {
  const found = leftovers("Northwind Traders, nw-prod, ana@example.com, ana@example.com", ids, "people");
  const kinds = Object.fromEntries(found.map((f) => [f.kind, f.hits]));
  assert.ok(kinds.customer && kinds.account && kinds.email);
  assert.equal(kinds.email[0].count, 2);
  assert.equal(leftovers("nothing here", ids, "people").length, 0);
  assert.equal(leftovers("Northwind Traders", ids, "pseudonym").length, 0);
});

test("a table is validated and a customer can be dropped", () => {
  const t = table();
  assert.ok(validTable(t));
  assert.ok(!validTable({ v: 2 }) && !validTable(null) && !validTable({ ...t, entries: [{ o: 1 }] }));
  assert.equal(dropCustomer(t, "Northwind Traders").entries.length, 0);
  assert.equal(dropCustomer(t, "Other").entries.length, t.entries.length);
});

test("empty names and short text do no harm", () => {
  assert.equal(redact("", table(), "pseudonym").text, "");
  assert.equal(redact("abc", emptyTable(), "pseudonym").replaced, 0);
});
