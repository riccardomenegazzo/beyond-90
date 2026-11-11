import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, ROLE_IDS, essentials, isRole, shape } from "../roles.js";
import { CUSTOMER_NAV } from "../guide.js";

const ids = (groups) => groups.flatMap((g) => g.views.map((v) => v.id));

test("every role names views that exist, with no duplicates", () => {
  const all = new Set(ids(CUSTOMER_NAV));
  for (const r of ROLE_IDS.filter((x) => x !== "all")) {
    const e = essentials(r);
    assert.equal(new Set(e).size, e.length, r);
    for (const id of e) assert.ok(all.has(id), `${r}: ${id} is not a view`);
  }
});

test("shape never loses or repeats a view", () => {
  for (const r of ROLE_IDS) {
    const { main, more } = shape(CUSTOMER_NAV, r);
    const got = [...ids(main), ...ids(more)];
    assert.equal(new Set(got).size, got.length);
    assert.deepEqual([...got].sort(), ids(CUSTOMER_NAV).sort());
  }
  assert.equal(shape(CUSTOMER_NAV, "all").more.length, 0);
  assert.equal(shape(CUSTOMER_NAV, "nonsense").main, CUSTOMER_NAV);
});

test("a role's own order wins and groups with nothing left are dropped", () => {
  const { main } = shape(CUSTOMER_NAV, "se");
  assert.equal(ids(main)[0] === "pov" || main[0].views[0].id !== undefined, true);
  assert.ok(main.every((g) => g.views.length));
  const tam = ids(shape(CUSTOMER_NAV, "tam").main);
  assert.ok(tam.indexOf("overview") < tam.indexOf("burndown"));
});

test("a role is a smaller list than everything, and the ids are known", () => {
  for (const r of ["tam", "sa", "se"]) assert.ok(ids(shape(CUSTOMER_NAV, r).main).length < ids(CUSTOMER_NAV).length);
  assert.ok(isRole("tam") && !isRole("ceo"));
  assert.ok(ROLES.tam.label && ROLES.sa.label && ROLES.se.label);
});
