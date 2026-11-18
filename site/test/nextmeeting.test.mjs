import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorkshop, setAnswer, setPlan, setRaised } from "../workshop.js";
import { nextMeeting, agendaText, meetingIcs } from "../nextmeeting.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-02";

test("the next meeting carries what the last one left open, and who to bring", () => {
  let w = makeWorkshop({ customer: "Acme; Rivers (mock)", scope: ["dr-backup"], createdOn: D, nonce: "abcdef" });
  ["gap", "gap", "gap", "unknown", "gap", "unknown"].forEach((a, i) => { w = setAnswer(w, "dr-backup", i, a, "", D); });
  w = setPlan(w, "dr-backup", 0, "together", "2026-11-10", D);
  w = setPlan(w, "dr-backup", 2, "us", "2026-12-01", D);
  w = setRaised(w, "dr-backup", 0, true, D);
  const m = nextMeeting(CAT, w, "2026-11-20");
  assert.equal(m.empty, false);
  assert.equal(m.settle.length, 2);
  assert.equal(m.late.length, 1);
  assert.equal(m.late[0].who, "together");
  assert.equal(m.due.length, 1);
  assert.equal(m.prove.length, 1);
  assert.ok(m.people.length >= 3);
  const t = agendaText(m, "Thursday 26 November");
  assert.match(t, /^Next meeting with Acme; Rivers \(mock\), Thursday 26 November/);
  assert.match(t, /1\. What has slipped/);
  assert.match(t, /Your concerns, and how we will prove them/);
  assert.match(t, /Next steps, owners and dates/);
  assert.match(t, /It helps to have in the room:/);
  const ics = meetingIcs(w, m, "2026-11-26", "20261120T000000Z");
  assert.match(ics, /DTSTART;VALUE=DATE:20261126/);
  assert.ok(ics.includes("SUMMARY:Acme\\; Rivers (mock): next meeting"), "the name is escaped as the format asks");
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

test("a workshop with nothing open says so", () => {
  const w = makeWorkshop({ customer: "Acme (mock)", scope: ["dr-backup"], createdOn: D, nonce: "abcdef" });
  const m = nextMeeting(CAT, w, D);
  assert.equal(m.empty, true);
  assert.match(agendaText(m), /Next steps, owners and dates/);
});
