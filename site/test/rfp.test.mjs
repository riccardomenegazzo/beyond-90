import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRequirements, suggestLine, lineOrder, rfpState, clarificationQuestions, rfpCsv, rfpMarkdown, bidCommitments, validRfp, withRequirement, EXAMPLE_TENDER, KEYWORDS, MAX_REQS,
  sheetsToText, csvToText, matchedWords, questionFor, tenderAsks, suggestAnswer, pastAnswer, evidenceFor } from "../rfp.js";
import { nextMeeting, agendaText } from "../nextmeeting.js";
import { makeWorkshop, addRequirements, setRequirement, removeRequirement, setRfpMeta, clearRfp, validWorkshop, summaryMarkdown, assess, fillSuggestedNotes } from "../workshop.js";
import { pipeline, agenda } from "../desk.js";
import { forward } from "../forward.js";
import { handoverMarkdown } from "../delivery.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";
const ws = (scope = ["hci", "dr-backup"]) => makeWorkshop({ customer: "Comune di Esempio (mock)", scope, createdOn: D, nonce: "abcdef" });

test("numbered lines are read with their reference, whether mandatory, and their points", () => {
  const rs = parseRequirements(EXAMPLE_TENDER);
  assert.equal(rs.length, 16);
  assert.deepEqual(rs[0], { ref: "1.1", text: "The solution must provide a hyperconverged platform of at least 3 nodes per site, with no single point of failure.", must: true, points: null });
  assert.equal(rs[3].must, false, "'should' with points is scored");
  assert.equal(rs[3].points, 5);
  assert.equal(rs.filter((r) => r.must).length, 11);
  assert.equal(rs.reduce((s, r) => s + (r.points || 0), 0), 41);
});

test("continuation lines join the requirement they belong to; Italian wording and points are understood", () => {
  const rs = parseRequirements("3.2.1 Il sistema deve garantire la replica dei dati\nverso il sito secondario con RPO di 15 minuti.\n3.2.2 Sono preferibili copie immutabili (punteggio max 6)");
  assert.equal(rs.length, 2);
  assert.match(rs[0].text, /replica dei dati verso il sito secondario/);
  assert.equal(rs[0].must, true);
  assert.deepEqual([rs[1].must, rs[1].points], [false, 6]);
});

test("rows copied from a spreadsheet: the longest cell is the requirement, a yes or no says mandatory, a number its points", () => {
  const rs = parseRequirements("Ref\tRequirement\tMandatory\tPoints\n1.1\tThe platform must keep running when a node fails\tYes\t\n1.2\tUpgrades without downtime are preferred\tNo\t5\nRT-3\tImmutable backup copies for 30 days\tsi\t");
  assert.deepEqual(rs.map((r) => [r.ref, r.must, r.points]), [["1.1", true, null], ["1.2", false, 5], ["RT-3", true, null]]);
});

test("a sentence starting with a number is not mistaken for a reference; bullets are dropped; unclear wording counts as mandatory", () => {
  const rs = parseRequirements("- The system must encrypt data at rest\n- 3 nodes at least in each room\n* Snapshots should be kept for 30 days (4 punti)");
  assert.deepEqual(rs.map((r) => [r.ref, r.must, r.points]), [["", true, null], ["", true, null], ["", false, 4]]);
  assert.equal(rs[1].text, "3 nodes at least in each room");
  assert.deepEqual(parseRequirements(""), []);
  assert.deepEqual(parseRequirements("short\n\n"), [], "too short to be a requirement");
});

test("each requirement is matched to the line it asks about; the platform line yields to a more specific one", () => {
  const lines = Object.keys(KEYWORDS);
  const got = parseRequirements(EXAMPLE_TENDER).map((r) => suggestLine(r.text, lines));
  assert.deepEqual(got, ["hci", "hci", "hci", "hci", "dr-backup", "dr-backup", "dr-backup", "dr-backup", "object-storage", "file-storage", "platform-migration", "cloud-operations", "cloud-operations", "edge-sites", "euc", "cloud-operations"]);
  assert.equal(suggestLine("La soluzione deve includere desktop virtuali per 200 postazioni di lavoro", lines), "euc");
  assert.equal(suggestLine("The supplier shall provide training", lines), "", "nothing points at a line");
  assert.deepEqual(lineOrder(CAT, ["dr-backup"]).slice(0, 2), ["dr-backup", "hci"], "lines in scope come first");
});

test("the tender is kept with the workshop; answers, notes, who and corrections are checked", () => {
  let w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  assert.equal(validWorkshop(w), true);
  assert.equal(w.rfp.reqs.length, 16);
  assert.deepEqual(w.rfp.reqs.slice(0, 2).map((r) => r.id), ["r1", "r2"]);
  w = setRequirement(w, "r1", { a: "yes", note: "Three nodes a site, one may fail", who: "presales" }, D);
  w = setRequirement(w, "r4", { points: "7", must: false }, D);
  assert.equal(w.rfp.reqs[3].points, 7);
  assert.throws(() => setRequirement(w, "r99", { a: "yes" }, D), /no longer in the list/);
  assert.throws(() => setRequirement(w, "r1", { a: "maybe" }, D));
  assert.throws(() => setRequirement(w, "r1", { text: "  " }, D), /needs its text/);
  w = removeRequirement(w, "r5", D);
  assert.equal(w.rfp.reqs.length, 15);
  w = addRequirements(w, [{ ref: "7.1", text: "The supplier shall provide training for six people", must: true, points: null }], CAT, D);
  assert.equal(w.rfp.reqs.at(-1).id, "r17", "ids follow the highest one");
  w = setRfpMeta(w, { title: "Data centre renewal (mock)", questions_due: "2026-11-24", due: "2026-12-05" }, D);
  assert.equal(w.rfp.title, "Data centre renewal (mock)");
  assert.throws(() => setRfpMeta(w, { questions_due: "2026-12-10", due: "2026-12-05" }, D), /before the bid/);
  assert.equal("rfp" in clearRfp(w, D), false);
  assert.throws(() => addRequirements(ws(), [], CAT, D), /No requirement was found/);
  const many = Array.from({ length: MAX_REQS + 1 }, (_, i) => ({ ref: String(i), text: `Requirement number ${i} must hold`, must: true, points: null }));
  assert.throws(() => addRequirements(ws(), many, CAT, D), /at most 400/);
});

test("whether to bid: a mandatory requirement not met is a risk, partly or unclear ones are to clarify", () => {
  let w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  assert.equal(rfpState(CAT, w, D).verdict.level, "clarify");
  w.rfp.reqs.filter((r) => r.must).forEach((r) => { w = setRequirement(w, r.id, { a: "yes" }, D); });
  assert.equal(rfpState(CAT, w, D).verdict.level, "go");
  w = setRequirement(w, "r9", { a: "no", note: "Object lock on a separate appliance" }, D);
  w = setRequirement(w, "r14", { a: "partly", note: "Two nodes with a witness at the core" }, D);
  w = setRequirement(w, "r16", { a: "check" }, D);
  const st = rfpState(CAT, w, D);
  assert.equal(st.verdict.level, "risk");
  assert.match(st.verdict.text, /1 mandatory requirement not met/);
  const qs = clarificationQuestions(w);
  assert.equal(qs.length, 3);
  assert.match(qs[0].text, /^Requirement 3\.1 \(".*"\): is an equivalent solution .* accepted, for example: Object lock on a separate appliance\?$/);
  assert.match(qs[2].text, /could you clarify what is expected/);
  assert.deepEqual(st.outside.map((l) => l.profile).sort(), ["cloud-operations", "edge-sites", "euc", "file-storage", "object-storage", "platform-migration"].filter((p) => CAT.lines[p]).sort());
});

test("points: sure, likely and at best", () => {
  let w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  const scored = w.rfp.reqs.filter((r) => r.points != null);
  w = setRequirement(w, scored[0].id, { a: "yes" }, D);          // 5
  w = setRequirement(w, scored[1].id, { a: "partly" }, D);       // 8
  w = setRequirement(w, scored[2].id, { a: "no" }, D);           // 10
  const p = rfpState(CAT, w, D).points;
  assert.deepEqual(p, { total: 41, sure: 5, likely: 9, best: 31 });
});

test("the compliance matrix and the bid summary", () => {
  let w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  w = setRequirement(w, "r1", { a: "yes", note: "=SUM(A1) three nodes", who: "partner" }, D);
  w = setRfpMeta(w, { title: "Data centre renewal (mock)", questions_due: "2026-11-24", due: "2026-12-05" }, D);
  const csv = rfpCsv(CAT, w);
  assert.match(csv, /^ref,requirement,mandatory,points,product_line,answer,how_it_is_met,who_answers,evidence_to_attach\r\n/);
  assert.match(csv, /The proposed design, with the failures it tolerates; The failure test from the proof of value/, "the evidence for a requirement met");
  assert.match(csv, /'=SUM\(A1\) three nodes/, "a formula is defused");
  assert.equal(csv.trim().split("\r\n").length, 17);
  const md = rfpMarkdown(CAT, w, D);
  assert.match(md, /^# Bid summary: Data centre renewal \(mock\)/);
  assert.match(md, /Questions to the contracting authority by 2026-11-24 \(in 5 days\)/);
  assert.match(md, /## Coverage by product line/);
  assert.match(md, /lines not in this conversation yet/);
  assert.match(md, /## Still to answer, by who\n\n- Nobody asked yet: 15/);
  const owing = setRequirement(setRequirement(w, "r2", { who: "specialist" }, D), "r3", { who: "specialist", a: "check" }, D);
  const st = rfpState(CAT, owing, D);
  assert.deepEqual(st.owed, [{ who: "specialist", label: "A specialist", count: 2 }]);
  assert.equal(st.unassigned, 13);
  assert.match(summaryMarkdown(CAT, w, assess(CAT, w)), /## The tender: Data centre renewal \(mock\)/);
});

test("on the desk: deadlines in the agenda, and what could exclude the bid as risks", () => {
  let w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  w = setRfpMeta(w, { title: "Data centre renewal (mock)", questions_due: "2026-11-24", due: "2026-12-01" }, D);
  w = setRequirement(w, "r9", { a: "no" }, D);
  const risks = pipeline([w], [], CAT, D)[0].risks.map((r) => r.text).join(" ");
  assert.match(risks, /1 mandatory requirement of the tender is not met/);
  assert.match(risks, /Questions to the contracting authority are due in 5 days, with 1 requirement to raise/);
  const items = agenda([w], [], CAT, D).filter((i) => i.kind === "tender");
  assert.deepEqual(items.map((i) => i.on), ["2026-11-24", "2026-12-01"]);
  assert.match(items[0].what, /Questions on "Data centre renewal \(mock\)" due/);
});

test("the way forward checks the mandatory requirements before the decision; the handover carries what the bid committed to", () => {
  let w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  let c = forward(CAT, w, null, D).phases.find((p) => p.id === "decision").checks.find((x) => /tender/.test(x.text));
  assert.equal(c.ok, false);
  assert.equal(c.go, "wsrfp");
  w.rfp.reqs.filter((r) => r.must).forEach((r) => { w = setRequirement(w, r.id, { a: "yes", note: r.id === "r2" ? "Included, with live migration" : "" }, D); });
  c = forward(CAT, w, null, D).phases.find((p) => p.id === "decision").checks.find((x) => /tender/.test(x.text));
  assert.equal(c.ok, true);
  assert.equal(bidCommitments(w).length, 11);
  const md = handoverMarkdown(CAT, w, null, D);
  assert.match(md, /## What the bid committed to/);
  assert.match(md, /- 1\.2: The hypervisor must be included.* How: Included, with live migration/);
});

test("anything off in a stored tender refuses it", () => {
  const w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  assert.equal(validRfp(w.rfp), true);
  const bad = (patch) => ({ ...w.rfp, reqs: w.rfp.reqs.map((r, i) => (i ? r : { ...r, ...patch })) });
  for (const t of [bad({ id: "x1" }), bad({ a: "maybe" }), bad({ points: -1 }), bad({ points: 5000 }), bad({ text: "" }), bad({ text: "a\u0007b" }), bad({ who: "boss" }), bad({ line: "Not A Line" }), bad({ extra: 1 }),
    { ...w.rfp, due: "2026-11-20", questions_due: "2026-11-30" }, { ...w.rfp, reqs: [w.rfp.reqs[0], w.rfp.reqs[0]] }, { ...w.rfp, smuggled: 1 }, { ...w.rfp, title: "x".repeat(121) }]) assert.equal(validRfp(t), false, JSON.stringify(t).slice(0, 80));
  assert.throws(() => withRequirement(w.rfp, "r1", { who: "boss" }), /not valid/);
});

test("a tender's own sheet: header rows in Italian are skipped, the type column says mandatory or scored", () => {
  const rs = parseRequirements("N.\tRequisito\tTipologia (Obbligatorio/Migliorativo)\tPunteggio\n1\tLa soluzione deve garantire la replica dei dati verso il sito secondario\tObbligatorio\t\n2\tCopie immutabili per 30 giorni\tMigliorativo\t6\n3\tAssistenza in lingua italiana\tPremiante\t4");
  assert.deepEqual(rs.map((r) => [r.ref, r.must, r.points]), [["1", true, null], ["2", false, 6], ["3", false, 4]]);
});

test("a workbook: the sheet with the requirements is found; a CSV is read whatever its delimiter", () => {
  const sheets = [{ name: "Cover", rows: [["Tender", "Lot 1"], ["Date", "2026-11-19"]] },
    { name: "Requirements", rows: [["Ref", "Requirement", "Mandatory"], ["1.1", "The platform must keep running when a node fails, with no data loss", "Yes"], ["1.2", "Upgrades without downtime of the virtual machines are preferred", "No"]] }];
  const got = sheetsToText(sheets);
  assert.equal(got.sheet, "Requirements");
  assert.deepEqual(parseRequirements(got.text).map((r) => [r.ref, r.must]), [["1.1", true], ["1.2", false]]);
  assert.deepEqual(sheetsToText([{ name: "Cover", rows: [["a", "b"]] }]), { text: "", sheet: "" });
  const csv = 'Ref;Requirement;Points\n2.1;"Backups must be immutable; for 30 days";\n2.2;"Recovery plans are desirable";8\n';
  assert.deepEqual(parseRequirements(csvToText(csv)).map((r) => [r.ref, r.must, r.points]), [["2.1", true, null], ["2.2", false, 8]]);
});

test("the words a requirement was matched on are shown, so the match can be trusted or fixed", () => {
  assert.deepEqual(matchedWords("Backup and disaster recovery must protect 400 machines with an RPO of 15 minutes", "dr-backup"), ["backup", "disaster recovery", "rpo"]);
  assert.deepEqual(matchedWords("Anything", "nope"), []);
});

test("a requirement leads to the discovery question it touches most, and only when the words say so", () => {
  let w = addRequirements(ws(["hci", "dr-backup", "cloud-operations", "edge-sites"]), parseRequirements(EXAMPLE_TENDER), CAT, D);
  const q = (id) => questionFor(CAT, w.rfp.reqs.find((r) => r.id === id));
  assert.match(q("r6").q, /administrator account delete your backups/, "immutable copies, administrators included");
  assert.match(q("r8").q, /come back together, in the same state and in a set order/, "recovery plans with a power-on order");
  assert.match(q("r14").q, /How are upgrades done across the sites/, "sites upgraded without a visit");
  assert.match(q("r16").q, /management plane and its data stay on your own premises/, "data that must stay in the European Union");
  assert.equal(q("r1"), null, "no question shares enough words: none is forced");
  const asks = tenderAsks(CAT, w);
  assert.ok([...asks.keys()].every((k) => /^[a-z-]+#\d+$/.test(k)));
  assert.ok([...asks.values()].flat().some((r) => r.id === "r6"));
});

test("who issued it decides where questions go: a company's requirements to check reach the next meeting, a public body's never", () => {
  let w = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  w = setRequirement(w, "r7", { a: "check" }, D);
  assert.deepEqual(nextMeeting(CAT, w, D).tender, [], "not said yet: nothing goes on an agenda");
  const pub = setRfpMeta(w, { issuer: "public" }, D);
  assert.equal(pub.rfp.issuer, "public");
  assert.equal(validRfp(pub.rfp), true);
  assert.deepEqual(nextMeeting(CAT, pub, D).tender, []);
  const co = setRfpMeta(w, { issuer: "company" }, D);
  const m = nextMeeting(CAT, co, D);
  assert.equal(m.tender.length, 1);
  assert.match(agendaText(m, ""), /Your requirements we want to understand well\n   - 2\.3: A test failover must be possible/);
  assert.equal(validRfp({ ...co.rfp, issuer: "someone" }), false);
  assert.equal("issuer" in setRfpMeta(co, { issuer: "" }, D).rfp, false);
});

test("the answer kit: each requirement gets its line's answer, or one for any line, with the evidence to attach", () => {
  const w = addRequirements(ws(["hci", "dr-backup", "object-storage", "cloud-operations", "edge-sites"]), parseRequirements(EXAMPLE_TENDER), CAT, D);
  const kit = (id) => suggestAnswer(CAT, w.rfp.reqs.find((r) => r.id === id));
  assert.equal(kit("r1").id, "ha", "no single point of failure");
  assert.equal(kit("r3").id, "upgrades");
  assert.equal(kit("r5").id, "rpo_rto");
  assert.equal(kit("r6").id, "immutable");
  assert.equal(kit("r7").id, "test_failover");
  assert.equal(kit("r8").id, "recovery_plans");
  assert.equal(kit("r9").id, "object_api", "S3-compatible object storage, its main ask");
  assert.equal(kit("r16").id, "data_residency", "an answer for any line");
  assert.ok(kit("r1").answer.length <= 300 && kit("r1").evidence.length);
  assert.equal(suggestAnswer(CAT, { text: "The supplier shall deliver a printed manual", line: "" }), null, "nothing is forced");
});

test("the kit's answers fill the empty notes in one go; notes already written are kept", () => {
  let w = addRequirements(ws(["hci", "dr-backup"]), parseRequirements(EXAMPLE_TENDER), CAT, D);
  w = setRequirement(w, "r1", { note: "Three nodes, two copies" }, D);
  const filled = fillSuggestedNotes(w, CAT, D);
  assert.equal(filled.rfp.reqs[0].note, "Three nodes, two copies");
  assert.match(filled.rfp.reqs.find((r) => r.id === "r6").note, /^At least one copy is immutable for \[days\]/);
  assert.equal(validWorkshop(filled), true);
  assert.equal(fillSuggestedNotes(filled, CAT, D), filled, "nothing left to fill: unchanged");
});

test("answers given before, in another tender in this browser, are offered for a similar requirement", () => {
  let old = addRequirements(makeWorkshop({ customer: "Regione Esempio (mock)", scope: ["hci", "dr-backup"], createdOn: D, nonce: "fedcba" }), parseRequirements("4.2 Backup copies must be immutable for at least 30 days, including for administrators"), CAT, D);
  old = setRequirement(old, "r1", { a: "yes", note: "Immutable copies for 30 days on the backup target, tested in the proof of value" }, D);
  const now = addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D);
  const got = pastAnswer([old], now.rfp.reqs.find((r) => r.id === "r6"));
  assert.equal(got.customer, "Regione Esempio (mock)");
  assert.match(got.note, /Immutable copies for 30 days/);
  assert.equal(pastAnswer([old], now.rfp.reqs.find((r) => r.id === "r12")), null, "an unrelated requirement gets nothing");
  const unanswered = setRequirement(old, "r1", { a: "" }, D);
  assert.equal(pastAnswer([unanswered], now.rfp.reqs.find((r) => r.id === "r6")), null, "only notes of requirements met or partly");
});

test("the evidence to gather, for the requirements answered met or partly", () => {
  let w = addRequirements(ws(["hci", "dr-backup"]), parseRequirements(EXAMPLE_TENDER), CAT, D);
  w = setRequirement(setRequirement(w, "r1", { a: "yes" }, D), "r6", { a: "partly" }, D);
  const ev = evidenceFor(CAT, w);
  assert.deepEqual(ev.map((e) => e.item), ["The proposed design, with the failures it tolerates", "The failure test from the proof of value",
    "How the immutable copy is enforced, and by what", "A delete refused during the proof of value"]);
  assert.deepEqual(ev[0].refs, ["1.1"]);
  assert.match(rfpMarkdown(CAT, w, D), /## Evidence to gather\n\n- The proposed design, with the failures it tolerates \(for 1\.1\)/);
});

