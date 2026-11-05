import test from "node:test";
import assert from "node:assert/strict";
import { problems, starterFiles } from "../starter.js";

const form = (over = {}) => ({
  customer: { name: "Acme", tier: "enterprise", arr: "250000", as_of: "2026-11-05", renewal_date: "", ...over.customer },
  accounts: over.accounts || [{ id: "prod", provider: "aws", connected: true, owner: "platform", spend: "1200" }, { id: "", provider: "aws" }],
});

test("a complete form makes the two files", () => {
  assert.deepEqual(problems(form()), []);
  const f = starterFiles(form());
  assert.equal(f["customer.toml"], '[customer]\nname = "Acme"\ntier = "enterprise"\narr = 250000\nas_of = 2026-11-05\n');
  assert.equal(f["accounts.csv"], "id,provider,sources,connected,owner,last_spend,status,in_plan,created_at\nprod,aws,manual,true,platform,1200,active,true,\n");
});

test("what is missing is said in words", () => {
  const p = problems(form({ customer: { name: " ", as_of: "soon" }, accounts: [{ id: "a", provider: "" }, { id: "a", provider: "aws", spend: "lots" }] }));
  assert.ok(p.includes("Give the customer a name.") && p.includes("The date of the data must be a date."));
  assert.ok(p.includes("The account a is listed twice.") && p.includes("Choose a provider for a.") && p.includes("The spend of a must be a number, or left empty."));
});

test("hostile text stays text in both files", () => {
  const f = starterFiles(form({ customer: { name: 'x"]\n[evil]\nname = "y' }, accounts: [{ id: "=cmd|' /C calc'!A0", provider: "aws", owner: 'a,"b"' }] }));
  assert.match(f["customer.toml"], /^name = "x\\"] \[evil] name = \\"y"$/m);
  assert.ok(!/^\[evil]/m.test(f["customer.toml"]));
  assert.ok(f["accounts.csv"].includes("'=cmd") && f["accounts.csv"].includes('"a,""b"""'));
});
