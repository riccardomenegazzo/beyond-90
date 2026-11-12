import test from "node:test";
import assert from "node:assert/strict";
import { internalMarkers, internalWarning } from "../internal.js";

test("a customer-ready text raises nothing", () => {
  assert.deepEqual(internalMarkers("Where you are: 72% yield. Next: connect 6 accounts."), []);
  assert.equal(internalWarning("All good."), "");
});
test("the private section and its phrases are found", () => {
  const t = "## For you only: remove before sharing\n### Renewal readiness\nInfluence-weighted trust index 6.1\n- No executive sponsor is on record.";
  const found = internalMarkers(t);
  assert.equal(found.length, 4);
  assert.match(internalWarning(t), /Remove it before you send it to the customer/);
});
test("a binary or missing text is ignored", () => {
  assert.deepEqual(internalMarkers(null), []);
  assert.deepEqual(internalMarkers(new Uint8Array(2)), []);
});
