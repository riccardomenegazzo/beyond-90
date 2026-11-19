/**
 * Bid or no bid: whether a tender is worth answering, decided before the work starts and reviewed as it goes.
 * Eleven questions bid teams ask, in four groups: can we take part, can we win, is it worth it, can we deliver.
 * Four are read from what the tender already records (the mandatory requirements, the time left, price and quality,
 * the partner on the deal) unless answered by hand; the rest are answered yes, partly or no. A "no" on a question
 * that can exclude the bid stops it; what is not known is what to find out. The team's call is kept with its date,
 * and a short letter declines politely when the call is not to bid.
 * Plain functions, no DOM, so Node can test them; nothing here names a product or a company.
 */

export const GROUPS = { take: "Can we take part", win: "Can we win", worth: "Is it worth it", deliver: "Can we deliver" };
export const QUESTIONS = [
  { id: "standing", label: "Standing to take part", group: "take", stop: true, text: "We, or the partner who bids, meet the standing the tender asks: turnover, certifications, registrations, references.",
    hint: "Read the tender's conditions to take part: a bidder that lacks one is excluded before any requirement is read." },
  { id: "musts", label: "Every mandatory requirement", group: "take", stop: true, read: true, text: "Every mandatory requirement can be met.",
    hint: "Read from the answers: a mandatory requirement not met can exclude the bid." },
  { id: "time", label: "Time to write it well", group: "take", read: true, text: "There is time to write a good response before it is due.",
    hint: "Read from the bid's date and the requirements still open." },
  { id: "known", label: "Known before it was published", group: "win", text: "We knew of it before it was published, and the customer knows what we bring.",
    hint: "A tender first seen when it is published is rarely won: someone else talked to the customer while it was written." },
  { id: "fair", label: "Not written for a rival", group: "win", text: "It is not written around a rival: no requirement only one rival can meet.",
    hint: "A requirement that names a rival's feature, or describes an incumbent's exact setup, says who it was written for." },
  { id: "award", label: "First on price and quality", group: "win", read: true, text: "We can come first on price and quality.",
    hint: "Read from What wins it, once our bid and the rivals' guessed ones are in." },
  { id: "proof", label: "References and evidence", group: "win", text: "We have the references and the evidence the tender rewards: customers of its size and sector, certifications, test results.",
    hint: "Points for quality often go to what can be shown, not to what is claimed." },
  { id: "value", label: "Worth what it costs", group: "worth", text: "Its value, and what it opens next, justify what answering costs.",
    hint: "The hours of presales, partner, legal and commercial work, against the margin and the account it opens." },
  { id: "terms", label: "Contract terms we can sign", group: "worth", stop: true, text: "The contract terms are acceptable: penalties, liability, payment, service levels.",
    hint: "Terms the business cannot sign end the bid as surely as a requirement it cannot meet." },
  { id: "partner", label: "A partner who delivers", group: "deliver", read: true, text: "A partner able to deliver is on the deal, and leads it.",
    hint: "Read from Partners: one partner leads, with the skills for the lines the tender asks about." },
  { id: "people", label: "People to deliver it", group: "deliver", text: "We, and the partner, have the people to deliver it on the dates the tender sets.",
    hint: "Delivery capacity and skills for the dates asked, not only for the bid." },
];
export const ANSWERS = { yes: "Yes", partly: "Partly", no: "No" };
export const CALLS = { bid: "We bid", no_bid: "We do not bid" };
export const WHY_MAX = 300;

const IDS = new Set(QUESTIONS.map((q) => q.id));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const plain = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const flat = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** Whether a stored review is well formed: answers to known questions, a call, its date and why. */
export function validDecision(d) {
  if (!plain(d) || !Object.keys(d).every((k) => ["a", "call", "on", "why"].includes(k))) return false;
  if (!plain(d.a) || !Object.entries(d.a).every(([k, v]) => IDS.has(k) && Object.hasOwn(ANSWERS, v))) return false;
  if (!(d.call === "" || Object.hasOwn(CALLS, d.call))) return false;
  if (!(d.on === "" || (typeof d.on === "string" && DATE.test(d.on) && !Number.isNaN(Date.parse(d.on))))) return false;
  if (d.call && !d.on) return false;
  return typeof d.why === "string" && d.why.length <= WHY_MAX && !CONTROL.test(d.why);
}

export const emptyDecision = () => ({ a: {}, call: "", on: "", why: "" });

/** One answer changed: "" takes it back, so a question read from the tender is read again. */
export function withAnswer(d, id, a) {
  if (!IDS.has(id)) throw new Error("That question is not part of the review.");
  if (a && !Object.hasOwn(ANSWERS, a)) throw new Error("Answer yes, partly or no.");
  const next = { ...(d || emptyDecision()), a: { ...((d && d.a) || {}) } };
  if (a) next.a[id] = a;
  else delete next.a[id];
  return next;
}

/** The team's call, dated, with why; an empty call takes it back. */
export function withCall(d, call, on, why) {
  if (call && !Object.hasOwn(CALLS, call)) throw new Error("The call is to bid or not to bid.");
  if (call && !(typeof on === "string" && DATE.test(on))) throw new Error("Give the date of the call.");
  return { ...(d || emptyDecision()), call: call || "", on: call ? on : "", why: flat(why).slice(0, WHY_MAX) };
}

/**
 * What the tender already says about the questions it can answer: `st` is rfpState, `w` the workshop.
 * Each: { a, why } with a = "" when it cannot tell yet.
 */
export function readAnswers(w, st) {
  const out = {};
  if (st && st.total) {
    out.musts = st.must_no.length ? { a: "no", why: `${st.must_no.length} mandatory not met` }
      : st.open_must.length ? { a: "", why: `${st.open_must.length} mandatory still to answer` } : { a: "yes", why: st.must ? `all ${st.must} mandatory met or partly` : "none mandatory" };
    const dl = st.deadlines;
    if (dl.due_in == null) out.time = { a: "", why: "no date for the bid yet" };
    else if (dl.due_in < 0) out.time = { a: "no", why: "the bid's date has passed" };
    else if (!st.open) out.time = { a: "yes", why: "every requirement answered" };
    else out.time = { a: dl.due_in >= 10 ? "yes" : dl.due_in >= 4 ? "partly" : "no", why: `${dl.due_in} days left, ${st.open} requirements open` };
  }
  const aw = st && st.award;
  if (aw && aw.ready) {
    out.award = aw.rank === 1 ? { a: "yes", why: "first at the price planned" }
      : aw.turn.kind === "none" ? { a: "no", why: "behind on quality, more than price can close" } : { a: "partly", why: `${ordinal(aw.rank)} at the price planned, first at a lower one` };
  }
  const ps = (w.channel && w.channel.partners) || [];
  if (ps.length) out.partner = ps.some((p) => p.lead) ? { a: "yes", why: `${ps.find((p) => p.lead).name} leads` } : { a: "partly", why: "partners on the deal, none leads" };
  return out;
}
const ordinal = (n) => ["first", "second", "third", "fourth", "fifth"][n - 1] || `${n}th`;

/**
 * The review: each question with its answer and where it came from, what stops the bid, what is not known,
 * and the recommendation: no_bid (a question that can exclude it is "no"), bid (all answered, little against),
 * doubt (much against), or check (questions still to answer first).
 */
export function review(w, st) {
  const d = (w.rfp && w.rfp.decision) || emptyDecision();
  const read = readAnswers(w, st);
  const qs = QUESTIONS.map((q) => {
    const typed = d.a[q.id] || "";
    const r = q.read ? read[q.id] : null;
    return { ...q, a: typed || (r ? r.a : ""), from: typed ? "typed" : r && r.a ? "read" : "", why: r ? r.why : "" };
  });
  const stops = qs.filter((q) => q.stop && q.a === "no");
  const unknown = qs.filter((q) => !q.a);
  const against = qs.filter((q) => q.a === "no" && !q.stop);
  const answered = qs.filter((q) => q.a);
  const score = answered.length ? answered.reduce((s, q) => s + (q.a === "yes" ? 1 : q.a === "partly" ? 0.5 : 0), 0) / answered.length : null;
  let level; let head; let sep = ": "; let detail;
  if (stops.length) {
    level = "no_bid"; head = "Do not bid as it stands"; sep = ". ";
    detail = `Answered no on a question that can exclude the bid: ${stops.map((q) => short(q.text)).join("; ")}.`;
  } else if (unknown.length > 3) {
    level = "check"; head = "Answer the review first";
    detail = `${unknown.length} of ${qs.length} questions are not known yet.`;
  } else if (score != null && (score < 0.5 || against.length >= 3)) {
    level = "doubt"; head = "Think twice";
    detail = `${against.length ? `${against.length} answered no` : "much answered only partly"}. Bid only with a reason the review does not show.`;
  } else if (unknown.length) {
    level = "check"; head = "Likely worth bidding"; sep = "; ";
    detail = `find out first: ${unknown.map((q) => short(q.text)).join("; ")}.`;
  } else {
    level = "bid"; head = "Bid";
    if (against.length) { sep = ", "; detail = `knowing what is against it: ${against.map((q) => short(q.text)).join("; ")}.`; } else detail = "nothing in the review excludes it, and little is against it.";
  }
  const text = `${head}${sep}${detail}`;
  return { questions: qs, stops, unknown, against, score, level, head, detail: detail.charAt(0).toUpperCase() + detail.slice(1), text, call: d.call, on: d.on, why: d.why, typed: Object.keys(d.a).length };
}
const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const short = (t) => lower(t.split(/[:.]/)[0]);

/** The review in Markdown, for the bid decision meeting. */
export function reviewMarkdown(w, rv) {
  const title = flat(w.rfp && w.rfp.title) || "the tender";
  const out = [`## Bid or no bid: ${title}`, "", `**${rv.text}**`, ""];
  if (rv.call) out.push(`Decided on ${rv.on}: ${CALLS[rv.call].toLowerCase()}${rv.why ? `. ${rv.why}` : "."}`, "");
  for (const [g, label] of Object.entries(GROUPS)) {
    out.push(`### ${label}`, "");
    for (const q of rv.questions.filter((x) => x.group === g)) {
      out.push(`- ${q.a ? ANSWERS[q.a] : "Not known"}${q.stop ? " (can exclude the bid)" : ""}: ${q.text}${q.from === "read" && q.why ? ` _Read from the tender: ${q.why}._` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** A short, polite letter declining to bid, to adapt: square brackets mark what to fill in. */
export function declineLetter(w) {
  const t = (w.rfp && w.rfp.title) ? `"${flat(w.rfp.title)}"` : "your tender";
  return [`Subject: ${t}: our decision not to bid`, "",
    `Dear [name],`, "",
    `Thank you for inviting us to take part in ${t}. We have read the requirements with care, and decided not to submit a bid on this occasion.`, "",
    "[One sentence on why, if you wish to share it: for example, the timeline does not allow a response of the quality you should expect.]", "",
    `We value the relationship with ${flat(w.customer)}, and would welcome the chance to hear about your plans and to be considered for what comes next.`, "",
    "Kind regards,", "[Your name]", ""].join("\n");
}
