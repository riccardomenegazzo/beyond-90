import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv, pct, pts } from "../ui.js";

test("a spreadsheet formula in an exported value stays a value", () => {
  for (const evil of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) assert.ok(csvCell(evil).startsWith("'") || csvCell(evil).startsWith('"\''), evil);
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(-5), "'-5");   // numbers that start with a minus are prefixed too: a column of text is safer than a formula
});

test("a CSV has a header and one line per row", () => {
  const out = toCsv([{ key: "a", label: "A" }, { key: "b", label: "B", csv: (r) => r.b * 2 }], [{ a: "x", b: 1 }, { a: "y,z", b: 2 }]);
  assert.equal(out, 'A,B\nx,2\n"y,z",4\n');
});

test("percent and points read the way the reports do", () => {
  assert.equal(pct(0.7261), "72.6%");
  assert.equal(pct(null), "n/a");
  assert.equal(pts(1.234), "+1.2 pts");
  assert.equal(pts(-0.46), "−0.5 pts");
});
