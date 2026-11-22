import test from "node:test";
import assert from "node:assert/strict";
import { FAQ } from "../guide.js";

test("every help answer is short enough to read in the panel, and every question is asked once", () => {
  const all = FAQ.flatMap((g) => g.items);
  assert.ok(all.length >= 30);
  for (const x of all) assert.ok(x.q && x.a && x.a.length <= 600, x.q);
  assert.equal(new Set(all.map((x) => x.q)).size, all.length);
});

test("the presales help answers the questions asked before and during a first meeting", () => {
  const pre = FAQ.find((g) => g.group === "Presales").items.map((x) => `${x.q} ${x.a}`).join(" ");
  for (const words of ["questions to send ahead", "notes in Italian", "virtual desktops", "container platform", "licensed cores for databases", "Essential questions only", "copies ahead of its cutover"]) {
    assert.ok(pre.includes(words), words);
  }
});
