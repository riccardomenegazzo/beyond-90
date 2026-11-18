/**
 * Calendar files (RFC 5545), made in the page: text escaped, long lines folded, all-day events.
 * Nothing goes in but what the caller passes.
 */

export const icsText = (v) => String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const octets = (t) => new TextEncoder().encode(t).length;

/** Lines longer than 75 octets are folded, as the format asks; never inside a character. */
export function fold(line) {
  const out = [];
  let rest = line;
  while (octets(rest) > 74) {
    let cut = 74;
    while (octets(rest.slice(0, cut)) > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

const compact = (d) => d.replace(/-/g, "");
export function addDays(d, n) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** A calendar of all-day events: [{ uid, date, summary, description }]. */
export function calendar(product, events, stamp) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//Beyond 90//${product}//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@beyond90`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`,
      fold(`SUMMARY:${icsText(e.summary)}`), fold(`DESCRIPTION:${icsText(e.description)}`), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
