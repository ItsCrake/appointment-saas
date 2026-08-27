# HD screenshots

Drop a file here named after a slot and the landing page picks it up on the
next build. Nothing else changes — no import, no component edit.
`lib/screenshots.ts` checks this folder first, reads the real pixel dimensions
out of the file header, and falls back to `../<slot>.jpg` when a slot is absent.

## Why the current ones look soft

The originals came through WhatsApp, which downscales and recompresses hard:

| | current | wanted |
| --- | --- | --- |
| Width | 736px | **≥ 852px** |
| Compression | ~0.06 bytes/px | ~0.3–0.5 bytes/px, or lossless |

Two separate problems, and the second is the larger one:

1. **Resolution.** The frame renders at a hard cap of **284 CSS px**, so a 3×
   phone needs **852px** and a 2× display needs 568px. At 736px the 3× case is
   upscaled ~16%.
2. **Compression.** 0.06 bytes per pixel is five to eight times more compressed
   than a quality-90 JPEG. **No encoder setting recovers this** — the detail is
   not in the file. `quality={90}` in `PhoneFrame` stops the pipeline adding a
   *second* lossy generation, which is worth doing and is not a fix.

## The spec

| Property | Value |
| --- | --- |
| **Minimum width** | **852px** (3× of the 284px render cap) |
| **Recommended** | **1179 × 2556** — a native iPhone 15/14 Pro capture |
| **Aspect ratio** | **≈ 0.461** (9:19.5). Anything between 0.44 and 0.48 is fine |
| **Format** | **PNG** preferred, WebP accepted, JPEG last |
| **Colour** | sRGB |
| **Max file size** | ~2 MB each; they are never served raw |

**PNG, not JPEG.** iOS produces PNG natively, and `next/image` re-encodes to
AVIF/WebP for delivery regardless — so a lossless source means exactly one
lossy generation instead of two. A JPEG straight off the phone is fine too; a
JPEG that has been through a messaging app is what produced this problem.

**Do not send them through WhatsApp, Telegram or Slack.** That is what
compressed the originals. AirDrop, iCloud, a USB cable, or email as an
*attachment* rather than an inline image all preserve the file.

**Aspect ratio need not match exactly.** The resolver reads each file's real
dimensions and hands them to `next/image`, so a 1290×2796 and a 1179×2556 can
sit side by side without either being distorted. Keeping them consistent just
looks tidier in the frames.

## Filenames

Exactly these, with any accepted extension. The three marked **used** are the
only ones the landing page currently renders; the rest resolve correctly and
are there for future sections.

| Filename | Shows | Status |
| --- | --- | --- |
| `agenda-today.png` | Today's agenda — 4 appointments, expected revenue, approve/cancel per row | **used — hero** |
| `week-calendar.png` | Weekly calendar, overlapping bookings stacked across three days | **used — tour 1** |
| `approval-request.png` | Agenda with one pending request and approve/reject buttons | **used — tour 2** |
| `clients.png` | Client list with visit counts, last visit, call and WhatsApp buttons | **used — tour 3** |
| `agenda-stats.png` | Agenda with the stats panel expanded (week, new clients, no-shows) | spare |
| `week-calendar-pending.png` | Weekly calendar with a pending block and a business-wide break | spare |
| `appointment-sheet.png` | Appointment detail sheet over the calendar | spare |
| `analytics.png` | Analytics — revenue, busiest day, load heatmap | spare |

## Checking it worked

`screenshots.test.ts` fails the build if a filename is not web-safe. After
adding files, run `npm run build` — anything unreadable throws at build time
with the slot named, rather than rendering a broken image in production.
