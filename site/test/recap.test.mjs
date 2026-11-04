import test from "node:test";
import assert from "node:assert/strict";
import { recap } from "../recap.js";

test("a recap lists what was covered, agreed and promised, in that order", () => {
  const r = recap({ customer: "Acme", contact: "Priya Raman", date: "2026-11-04", covered: ["What we owe", "What changed"],
    agreed: [{ what: "Grant admin consent", who: "identity team", when: "2026-11-11" }, { what: "Share the owner list" }], ours: ["send the findings without an owner"] });
  assert.equal(r.subject, "Acme: recap of our call on 2026-11-04");
  assert.ok(r.body.startsWith("Hi Priya,"));
  const i = (s) => r.body.indexOf(s);
  assert.ok(i("What we covered:") < i("What we agreed:") && i("What we agreed:") < i("What you will get from us:"));
  assert.ok(r.body.includes("- Grant admin consent (identity team, by 2026-11-11)") && r.body.includes("- Share the owner list\n"));
  assert.ok(r.body.includes("- Send the findings without an owner"));
});

test("empty parts are left out and odd input is tidied", () => {
  const r = recap({ customer: " Acme\n", date: "2026-11-04", covered: ["", "  a   b "], agreed: [{ what: " " }], ours: [] });
  assert.ok(r.body.startsWith("Hi all,") && !r.body.includes("What we agreed") && !r.body.includes("from us"));
  assert.ok(r.body.includes("- a b\n") && r.subject === "Acme: recap of our call on 2026-11-04");
});
