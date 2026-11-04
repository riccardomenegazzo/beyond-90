// The follow-up after a call, drafted from what was prepared and what was agreed. No DOM, so Node can test it.
const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();

/**
 * @param {{customer:string, contact?:string, date:string, covered:string[], agreed:{what:string, who?:string, when?:string}[], ours:string[], sender?:string}} p
 * @returns {{subject:string, body:string}}
 */
export function recap(p) {
  const first = clean(p.contact).split(" ")[0] || "all";
  const covered = (p.covered || []).map(clean).filter(Boolean).slice(0, 6);
  const agreed = (p.agreed || []).filter((a) => clean(a.what)).slice(0, 8);
  const ours = (p.ours || []).map(clean).filter(Boolean).slice(0, 5);
  const lines = [`Hi ${first},`, "", "Thank you for the time today. A short recap so we stay aligned."];
  if (covered.length) lines.push("", "What we covered:", ...covered.map((c) => `- ${c}`));
  if (agreed.length) lines.push("", "What we agreed:", ...agreed.map((a) => `- ${clean(a.what)}${a.who ? ` (${clean(a.who)}` : ""}${a.when ? `${a.who ? ", " : " ("}by ${clean(a.when)}` : ""}${a.who || a.when ? ")" : ""}`));
  if (ours.length) lines.push("", "What you will get from us:", ...ours.map((o) => `- ${o.charAt(0).toUpperCase()}${o.slice(1)}`));
  lines.push("", "If I missed or misread anything, just reply and I will correct it.", "", `Best,${p.sender ? "\n" + clean(p.sender) : ""}`);
  return { subject: `${clean(p.customer)}: recap of our call on ${clean(p.date)}`, body: lines.join("\n") + "\n" };
}
