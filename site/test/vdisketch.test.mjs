import test from "node:test";
import assert from "node:assert/strict";
import { vdiSketch, cleanVdi, validVdi, vdiNotes, vdiMarkdown, VDI_DEFAULTS, KINDS } from "../vdisketch.js";

test("the hosts are counted by processor and by memory, the larger wins, and a host is kept free", () => {
  const sk = vdiSketch({});
  assert.equal(sk.ok, true);
  assert.equal(sk.concurrent, 800, "1000 users, 80% at once");
  assert.deepEqual(sk.kinds.map((k) => k.desktops), [240, 400, 120, 40]);
  // processor: 480/8 + 800/6 + 480/4 + 160/4 = 353.3 cores over 64 = 6 hosts; memory: 6720 GiB over 992 = 7 hosts
  assert.equal(sk.by_cpu, 6);
  assert.equal(sk.by_ram, 7);
  assert.equal(sk.binding, "memory");
  assert.equal(sk.hosts, 8);
  assert.equal(sk.graphics, 40);
  const cpuBound = vdiSketch({ host_ram: 4096 });
  assert.equal(cpuBound.binding, "processor");
  assert.equal(cpuBound.hosts, 6 + 1);
  assert.equal(vdiSketch({ spare_hosts: 0 }).hosts, 7);
});

test("storage: full disks for desktops that keep their changes, deltas for fresh ones, images and every user's profile", () => {
  const sk = vdiSketch({});
  // 200 x 60 + 640 x 10 + 3 x 60 x 2 + 1000 x 10 = 28760 GiB = 28.1 TiB; below 80% = 35.1 TiB
  assert.equal(sk.used_tib, 28.1);
  assert.equal(sk.usable_tib, 35.1);
  assert.ok(vdiSketch({ persistent_pct: 100 }).used_tib > sk.used_tib);
});

test("the mix is read as shares, kinds left at zero drop out, and nothing is sized without users or a mix", () => {
  const two = vdiSketch({ task_pct: 1, knowledge_pct: 1, power_pct: 0, graphics_pct: 0 });
  assert.deepEqual(two.kinds.map((k) => k.id), ["task", "knowledge"]);
  assert.equal(two.kinds[0].desktops, 400);
  assert.equal(two.graphics, 0);
  assert.equal(vdiSketch({ users: 0 }).ok, false);
  assert.equal(vdiSketch({ task_pct: 0, knowledge_pct: 0, power_pct: 0, graphics_pct: 0 }).ok, false);
  assert.match(vdiMarkdown(vdiSketch({ users: 0 })), /Give the number of users/);
});

test("settings are kept within their limits, and only known ones in range are valid", () => {
  assert.equal(cleanVdi({ users: -5, host_cores: 9999, fill_pct: "x" }).users, 0);
  assert.equal(cleanVdi({ host_cores: 9999 }).host_cores, 512);
  assert.equal(cleanVdi({ fill_pct: "x" }).fill_pct, VDI_DEFAULTS.fill_pct);
  assert.equal(validVdi(cleanVdi({ users: 250 })), true);
  assert.equal(validVdi({ users: 250, colour: 1 }), false);
  assert.equal(validVdi({ users: "250" }), false);
  assert.equal(validVdi({ fill_pct: 99 }), false);
  assert.equal(validVdi([]), false);
  assert.equal(KINDS.length, 4);
});

test("the notes follow the design, and the markdown carries the count, each step and the notes", () => {
  const notes = vdiNotes(vdiSketch({})).join(" ");
  assert.match(notes, /pilot group of each kind/);
  assert.match(notes, /40 graphics desktops at once need hosts with GPUs/);
  assert.doesNotMatch(notes, /no host kept free/);
  const risky = vdiNotes(vdiSketch({ spare_hosts: 0, persistent_pct: 80, task_ratio: 16 })).join(" ");
  assert.match(risky, /With no host kept free/);
  assert.match(risky, /Ask which users truly need one/);
  assert.match(risky, /More than ten virtual processors per core/);
  const md = vdiMarkdown(vdiSketch({}));
  assert.ok(md.startsWith("### A first desktop sizing sketch\n\n**8 hosts** for 800 desktops at once (the memory decides), and **35.1 TiB** of usable storage."));
  assert.match(md, /\n1\. 1,000 users, 80% connected/);
});

test("the workshop keeps it, and the handover carries it when desktops are in scope", async () => {
  const { readFileSync } = await import("node:fs");
  const { makeWorkshop, setVdi, validWorkshop, summaryMarkdown, assess } = await import("../workshop.js");
  const { handoverMarkdown } = await import("../delivery.js");
  let w = makeWorkshop({ customer: "Lumen Insurance (mock)", scope: ["euc", "hci"], createdOn: "2026-11-01", nonce: "abcdef" });
  w = setVdi(w, { users: 2000 }, "2026-11-02");
  assert.equal(w.vdi.users, 2000);
  assert.equal(validWorkshop(w), true);
  assert.equal(validWorkshop({ ...w, vdi: { users: -1 } }), false);
  assert.throws(() => setVdi(w, { users: "many" }, "2026-11-02"), /desktop sizing/);
  assert.equal(setVdi(w, null, "2026-11-02").vdi, undefined);
  const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
  const withDesktops = { ...cat, lines: { ...cat.lines, euc: { ...cat.lines.hci, label: "Virtual desktops", questions: [] } } };
  const sk = vdiSketch({ users: 2000 });
  assert.match(handoverMarkdown(withDesktops, w, null, "2026-11-20"), new RegExp(`Desktop sizing: ${sk.hosts} hosts for 1600 desktops at once`));
  assert.match(summaryMarkdown(withDesktops, w, assess(withDesktops, w)), /### A first desktop sizing sketch/);
  assert.doesNotMatch(handoverMarkdown(withDesktops, { ...w, scope: ["hci"] }, null, "2026-11-20"), /Desktop sizing/);
});
