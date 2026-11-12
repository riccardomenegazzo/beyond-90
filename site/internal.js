// Parts of Beyond 90's own documents that are for the person using it, not for the customer.
// The QBR draft ends with a section marked "For you only", and a few phrases only appear in private material.
const MARKERS = [
  { label: "a section marked “For you only”", re: /for you only/i },
  { label: "renewal readiness", re: /renewal readiness/i },
  { label: "the relationship and trust reading", re: /influence-weighted trust|trust index/i },
  { label: "ratings of people (credibility, intimacy, self-orientation)", re: /self-orientation|\bintimacy\b/i },
  { label: "notes on missing sponsors or contacts", re: /no executive sponsor is on record|you depend on fewer than two/i },
];

export function internalMarkers(text) {
  if (typeof text !== "string") return [];
  return MARKERS.filter((m) => m.re.test(text)).map((m) => m.label);
}

export function internalWarning(text) {
  const found = internalMarkers(text);
  if (!found.length) return "";
  return `This text has material meant for you only: ${found.join("; ")}. Remove it before you send it to the customer.`;
}
