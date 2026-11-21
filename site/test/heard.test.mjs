import test from "node:test";
import assert from "node:assert/strict";
import { stem, tokens, match, joinNote, NOTE_MAX } from "../heard.js";

const card = (key, q, listen = "", why = "", probe = "") => ({ key, label: "Disaster recovery", q: { q, listen, why, probe } });
const DR = [
  card("dr#0", "What would one day without your main site cost, and has anyone put a number on it?", "A figure per hour or per day turns recovery time into a budget line.", "Turns recovery objectives into a business decision.", "Which service would the business restore first, and has it agreed that order?"),
  card("dr#1", "When was the last full recovery test, and what went wrong in it?", "No full test in the last year means every recovery time is a guess.", "Tests always find something; no test means it is still hidden.", "What did the test leave out because it was too risky or too hard?"),
  card("dr#2", "Which sites and branches have no copy of their workloads anywhere?", "Branches with no copy are where one fire or one attack becomes permanent loss.", "Unprotected sites are the first gap to close.", "What would be lost for good if the smallest site burned down tonight?"),
  card("dr#3", "Where is the second site, how far away, and what is the network round-trip time between them?", "Under about five milliseconds allows zero-loss copies; beyond that, plan near-continuous or scheduled copies.", "Distance and latency decide whether copies can be synchronous.", "Is there a third place, a cloud or a partner site, that could hold a copy?"),
  card("dr#4", "Has every workload been given a recovery point and a recovery time, agreed with the business?", "Targets set by IT alone are wrong in both directions; agreed with the business they become a design input.", "Without objectives, nothing can be checked or prioritised.", "Which system has the strictest target, and who set it?"),
  card("dr#5", "Which workloads can lose no data at all, which can lose minutes, and which can lose hours?", "Zero loss needs synchronous copies over short distances; minutes or hours cost far less.", "Zero, minutes and hours need different replication, distances and costs.", "How many systems truly need zero data loss, if each had to justify the cost?"),
  card("dr#6", "Could an administrator account delete your backups today?", "If one account can delete the copies, so can ransomware: copies nobody can change, and a second approver, close it.", "If yes, ransomware can too.", "Is there a copy that no administrator can change before it expires?"),
  card("dr#7", "Does the recovery plan include the network: addresses, DNS, firewall rules?", "Failovers fail on addresses, name resolution and firewall rules more often than on data.", "Most failed recoveries fail on the network, not on the data.", "Will machines keep their addresses at the recovery site, or be given new ones?"),
];
const top = (said) => (match(DR, said)[0] || {}).card?.key;

test("words are compared without their endings and folded into the words that mean the same here", () => {
  assert.equal(stem("Copies"), stem("backups"));
  assert.equal(stem("wiped"), stem("delete"));
  assert.equal(stem("restored"), stem("failover"));
  assert.equal(stem("branches"), stem("warehouses"));
  assert.equal(stem("tested"), "test");
  assert.deepEqual(tokens("The data center is 40 km away, 2ms round trip"), [stem("site"), "away", "latency", "latency"]);
  assert.deepEqual(tokens("a recovery point objective"), [stem("target")]);
  assert.deepEqual(tokens("and the of 123"), []);
});

test("what was heard finds the question it answers, even in other words", () => {
  assert.equal(top("Any domain admin can wipe the backup repository"), "dr#6");
  assert.equal(top("Second data centre is 40 km away, about 2 ms"), "dr#3");
  assert.equal(top("The last failover drill was three years ago"), "dr#1");
  assert.equal(top("Nobody ever put a figure on a day of downtime, maybe a million in lost revenue"), "dr#0");
  assert.equal(top("The warehouses have nothing protected at all"), "dr#2");
  assert.equal(top("DNS and the firewall rules were never part of the plan"), "dr#7");
  assert.equal(top("RPO and RTO exist on paper, IT wrote them"), "dr#4");
});

test("at most three, best first, and none when nothing carries meaning", () => {
  const hits = match(DR, "copies of the backups at the second site");
  assert.ok(hits.length <= 3 && hits.length > 0);
  assert.ok(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score));
  assert.deepEqual(match(DR, "yes, and it is what it is"), []);
  assert.deepEqual(match([], "backups"), []);
});

test("a note gains what was heard, without repeating it and within the length of a note", () => {
  assert.equal(joinNote("", "Never tested"), "Never tested");
  assert.equal(joinNote("Only file restores", "Never tested"), "Only file restores; Never tested");
  assert.equal(joinNote("Never tested end to end", "never tested"), "Never tested end to end");
  assert.equal(joinNote("x".repeat(NOTE_MAX), "more").length, NOTE_MAX);
});
