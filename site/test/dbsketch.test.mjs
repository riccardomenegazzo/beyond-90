import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dbSketch, cleanDb, validDb, dbNotes, dbMarkdown, DB_DEFAULTS } from "../dbsketch.js";

test("the busy processors at the planned peak are the cores to give, on whole hosts, with the spare as the agreement says", () => {
  const sk = dbSketch({});
  assert.equal(sk.ok, true);
  // 120 x 4 = 480 given, 25% busy = 120, at 60% = 200 cores, on 32-core hosts = 7, plus a licensed spare = 256 cores
  assert.deepEqual([sk.busy, sk.needed, sk.hosts, sk.licensed, sk.freed, sk.money], [120, 200, 7, 256, 256, null]);
  assert.equal(dbSketch({ spare_licensed: 0 }).licensed, 224);
  assert.equal(dbSketch({ spare_hosts: 0 }).licensed, 224);
  assert.match(dbSketch({ spare_licensed: 0 }).steps[2], /not licensed, as the agreement allows/);
});

test("the cores freed are priced only when a core's yearly cost is given, and more cores than today are said plainly", () => {
  const sk = dbSketch({ core_year: 2500 });
  assert.equal(sk.money, 640000);
  assert.match(dbMarkdown(sk), /256 fewer than today \(about 640,000 a year\)/);
  const busy = dbSketch({ busy_pct: 80, cores_today: 256 });
  assert.ok(busy.freed < 0);
  assert.match(busy.steps[3], /more\. Today's hosts may be too busy/);
  const unknown = dbSketch({ cores_today: 0 });
  assert.equal(unknown.freed, null);
  assert.match(unknown.steps[3], /not given/);
  assert.equal(dbSketch({ databases: 0 }).ok, false);
});

test("settings are kept within their limits, and only known ones in range are valid", () => {
  assert.equal(cleanDb({ target_pct: 99 }).target_pct, 95);
  assert.equal(cleanDb({ spare_licensed: 0.7 }).spare_licensed, 1);
  assert.equal(cleanDb({ busy_pct: "x" }).busy_pct, DB_DEFAULTS.busy_pct);
  assert.equal(validDb(cleanDb({ databases: 40 })), true);
  assert.equal(validDb({ databases: 40, engine: 1 }), false);
  assert.equal(validDb({ spare_licensed: 0.5 }), false);
  assert.equal(validDb("x"), false);
});

test("the notes name the licence agreement first, and warn on a hot peak and on a saving too good to show", () => {
  const notes = dbNotes(dbSketch({})).join(" ");
  assert.match(notes, /licence agreement decides/);
  assert.match(notes, /busiest hour, database by database/);
  const risky = dbNotes(dbSketch({ target_pct: 85, cores_today: 2000 })).join(" ");
  assert.match(risky, /above 75%/);
  assert.match(risky, /More than half the licensed cores freed/);
});

test("the workshop keeps it, and the journey and the handover carry it when databases are in scope", async () => {
  const { makeWorkshop, setDb, validWorkshop, summaryMarkdown, assess } = await import("../workshop.js");
  const { handoverMarkdown } = await import("../delivery.js");
  let w = makeWorkshop({ customer: "Corvo Bank (mock)", scope: ["dbaas", "hci"], createdOn: "2026-11-01", nonce: "abcdef" });
  w = setDb(w, { databases: 60, core_year: 2000 }, "2026-11-02");
  assert.equal(validWorkshop(w), true);
  assert.equal(validWorkshop({ ...w, db: { databases: -1 } }), false);
  assert.throws(() => setDb(w, { databases: "many" }, "2026-11-02"), /database licence/);
  assert.equal(setDb(w, null, "2026-11-02").db, undefined);
  const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
  const sk = dbSketch({ databases: 60, core_year: 2000 });
  assert.match(handoverMarkdown(cat, w, null, "2026-11-20"), new RegExp(`Database licences: ${sk.licensed} cores to license on ${sk.hosts} hosts`));
  assert.match(summaryMarkdown(cat, w, assess(cat, w)), /### A first database licence sketch/);
  assert.doesNotMatch(handoverMarkdown(cat, { ...w, scope: ["hci"] }, null, "2026-11-20"), /Database licences/);
});
