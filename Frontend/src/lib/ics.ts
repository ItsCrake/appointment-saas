export type IcsEvent = {
  uid: string;
  startsAt: string;
  endsAt: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
};

/** RFC 5545 §3.3.5 — UTC form, e.g. 20260731T090000Z. */
function toIcsDate(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** RFC 5545 §3.3.11 — backslash, semicolon, comma and newlines are special. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold to 75 *octets* per line (§3.1). Hebrew is multi-byte in UTF-8, so this
 * counts encoded length and never splits a character across the boundary.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // Continuation lines start with a space, which costs one of the 75 octets.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  if (current) out.push(current);

  return out.join("\r\n ");
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Appointment SaaS//Booking//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(event.startsAt)}`,
    `DTEND:${toIcsDate(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.description
      ? [`DESCRIPTION:${escapeText(event.description)}`]
      : []),
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.url ? [`URL:${escapeText(event.url)}`] : []),
    "STATUS:CONFIRMED",
    // A reminder an hour ahead, which is the point of adding it to a calendar.
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF is required by the spec; some parsers reject bare LF.
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Triggers a browser download without a round-trip to the server. */
export function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
