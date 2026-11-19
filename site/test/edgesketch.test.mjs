import test from "node:test";
import assert from "node:assert/strict";
import { edgeSketch, cleanEdge, validEdge, edgeNotes, edgeMarkdown, EDGE_DEFAULTS, edgeHours } from "../edgesketch.js";

test("each kind of site gets the servers its load and its tolerance call for", () => {
  const sk = edgeSketch({});
  assert.equal(sk.ok, true);
  assert.equal(sk.kinds.length, 3, "a kind with no sites is left out");
  const [small, large, plants] = sk.kinds;
  assert.equal(small.servers_each, 1, "4 machines, can wait: one server");
  assert.equal(large.servers_each, 2, "12 machines need one server, plus one to ride through a failure");
  assert.equal(plants.servers_each, 3, "30 machines need two servers, plus one, and three at least");
  assert.equal(sk.servers, 120 * 1 + 30 * 2 + 6 * 3);
  assert.equal(sk.sites, 156);
  assert.equal(sk.witness_sites, 30, "only the two-server sites need a witness");
  assert.equal(large.witness, true);
  assert.equal(plants.witness, false);
});

test("the load can need more servers than the tolerance", () => {
  const sk = edgeSketch({ vms_per_server: 10, kinds: [{ sites: 5, vms: 35, servers_min: 2 }, { sites: 0 }, { sites: 0 }, { sites: 0 }] });
  assert.equal(sk.kinds[0].servers_each, 5, "35 machines need four servers, plus one spare");
  const solo = edgeSketch({ vms_per_server: 10, kinds: [{ sites: 5, vms: 35, servers_min: 1 }, { sites: 0 }, { sites: 0 }, { sites: 0 }] });
  assert.equal(solo.kinds[0].servers_each, 4, "a site that can wait has no spare");
});

test("the daily copy is checked against the night, and a restore over the link is timed", () => {
  const sk = edgeSketch({});
  const small = sk.kinds[0];
  // 1 TiB x 2% = 20.48 GiB over 70% of 50 Mbit/s
  const expect = (20.48 * 1024 ** 3 * 8) / 1e6 / 35 / 3600;
  assert.ok(Math.abs(small.copy_h - expect) < 0.01);
  assert.equal(small.copy_fits, true);
  const thin = edgeSketch({ kinds: [{ sites: 10, vms: 4, data_tib: 8, change_pct: 10, link_mbps: 10, servers_min: 1 }, { sites: 0 }, { sites: 0 }, { sites: 0 }] });
  assert.equal(thin.kinds[0].copy_fits, false);
  assert.ok(thin.kinds[0].restore_h > 24);
  const notes = edgeNotes(thin).join(" ");
  assert.match(notes, /does not fit the night/);
  assert.match(notes, /keep a local copy at each site/);
  assert.match(edgeMarkdown(thin), /\(does not fit the night\)/);
});

test("upgrades start with one site of each kind, then go in waves", () => {
  const sk = edgeSketch({ wave_size: 50, waves_per_week: 1 });
  assert.equal(sk.pilot, 3);
  assert.equal(sk.waves, Math.ceil((156 - 3) / 50));
  assert.equal(sk.weeks, sk.waves + 1);
  assert.match(sk.steps.join(" "), /one site of each kind first, then 4 waves/);
});

test("trips to sites are counted only when both figures are given", () => {
  assert.equal(edgeSketch({ visits_year: 300 }).visits, null);
  const sk = edgeSketch({ visits_year: 300, visit_cost: 400 });
  assert.equal(sk.visits.year, 120000);
  assert.match(edgeMarkdown(sk), /Trips to sites cost 120,000 a year today/);
});

test("notes follow the design: witness, single-server sites", () => {
  const notes = edgeNotes(edgeSketch({})).join(" ");
  assert.match(notes, /30 two-server sites need a small witness/);
  assert.match(notes, /Single-server sites stop when their server fails/);
  assert.equal(edgeNotes(edgeSketch({ kinds: [{ sites: 0 }, { sites: 0 }, { sites: 0 }, { sites: 0 }] })).length, 3);
});

test("no sites at all is said plainly", () => {
  const sk = edgeSketch({ kinds: [{ sites: 0 }, { sites: 0 }, { sites: 0 }, { sites: 0 }] });
  assert.equal(sk.ok, false);
  assert.match(sk.error, /number of sites of at least one kind/);
  assert.match(edgeMarkdown(sk), /A first edge design/);
});

test("settings are cleaned, and only valid ones are stored", () => {
  assert.deepEqual(cleanEdge(null), EDGE_DEFAULTS);
  assert.equal(cleanEdge({ link_use_pct: 500 }).link_use_pct, 100);
  assert.equal(cleanEdge({ kinds: [{ sites: 12.6, name: "  Shops\n north  " }] }).kinds[0].sites, 13);
  assert.equal(cleanEdge({ kinds: [{ name: "  Shops\n north  " }] }).kinds[0].name, "Shops  north");
  assert.equal(cleanEdge({ kinds: [{ name: "   " }] }).kinds[0].name, "Small sites", "a blank name keeps the default");
  assert.equal(validEdge(cleanEdge({})), true);
  assert.equal(validEdge({ window_h: 6 }), true);
  for (const bad of [{ kinds: [] }, { kinds: [{}, {}, {}, { servers_min: 4 }] }, { kinds: [{ name: "" }, {}, {}, {}] }, { kinds: [{ name: "a\u0007b" }, {}, {}, {}] },
    { kinds: [{ sites: 1.5 }, {}, {}, {}] }, { wave_size: 2.5 }, { window_h: "6" }, { toString: 1 }, [], null]) assert.equal(validEdge(bad), false, JSON.stringify(bad));
});

test("durations read as people say them", () => {
  assert.equal(edgeHours(0.2), "12 minutes");
  assert.equal(edgeHours(5), "5 hours");
  assert.equal(edgeHours(72), "3 days");
});
