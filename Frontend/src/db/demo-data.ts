import { fromZonedTime } from "date-fns-tz";

/**
 * The bookings, clients and queue that make a demo tenant look like a shop
 * somebody actually runs.
 *
 * ---------------------------------------------------------------------------
 * **Pure, and deterministic.** Given the same seed it produces the same
 * calendar every time, which is the property marketing screenshots need: a
 * re-run to fix a typo must not reshuffle every appointment behind it. It
 * touches no database — it is handed ids and returns rows — so the whole
 * generator can be tested without one, and `demo-data.test.ts` checks the
 * things a screenshot would show up: that nothing double-books, that the
 * genders are consistent, and that the future is left bookable.
 *
 * **The future is deliberately left half empty.** The E2E suite books a real
 * appointment against `demo-barber` and needs a free slot to book it into, and
 * a prospect clicking the demo link needs to see availability rather than a
 * wall. Past days are dense — that is where the revenue charts come from —
 * and the days ahead run at roughly half occupancy.
 * ---------------------------------------------------------------------------
 */

export type DemoService = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

export type DemoShift = { start: string; end: string };

export type DemoClient = { name: string; phone: string };

export type DemoAppointmentRow = {
  businessId: string;
  serviceId: string;
  staffId: string;
  startsAt: Date;
  endsAt: Date;
  status: "confirmed" | "completed" | "cancelled" | "no_show" | "pending";
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  notes: string | null;
  serviceName: string;
  priceCents: number;
  cancelToken: string;
  cancelledAt: Date | null;
  createdAt: Date;
};

export type GenerateInput = {
  businessId: string;
  timezone: string;
  services: DemoService[];
  staffIds: string[];
  /** Sunday-first. Return [] for a closed day. */
  shiftsForWeekday: (weekday: number) => DemoShift[];
  clients: DemoClient[];
  bufferMin: number;
  /** "Today" — injected so a generated week can be asserted against. */
  now: Date;
  /** Any integer. The same one always produces the same calendar. */
  seed: number;
  /** Notes a few clients left, cycled through so some bookings carry one. */
  notes: string[];
  /**
   * Whether this shop takes bookings as requests.
   *
   * **Off means no `pending` row is ever generated**, because off means the
   * product cannot produce one: `createBookingAction` writes `confirmed`
   * directly. A demo carrying pending bookings for a shop that does not use
   * approval is a screenshot of a state the software will not reach.
   */
  requiresApproval: boolean;
};

const DAY_MS = 86_400_000;

/** How far back the history runs, and how far ahead the demo is populated. */
export const DEMO_PAST_DAYS = 30;
export const DEMO_FUTURE_DAYS = 6;

/**
 * A small deterministic generator.
 *
 * `Math.random()` would make every run a different shop, so a screenshot could
 * never be reproduced and a test could only assert vague properties. This is
 * mulberry32 — short, well-distributed enough for placing haircuts, and seeded
 * per tenant so the two demos do not come out as the same calendar with
 * different names on it.
 */
export function makeRandom(seed: number) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "YYYY-MM-DD" in the shop's own clock, which is the day a booking belongs to. */
function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Picks one, weighted. Weights need not sum to anything in particular. */
function weighted<T>(random: () => number, table: [T, number][]): T {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of table) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return table[table.length - 1][0];
}

/**
 * A month of history and the week ahead, for one tenant.
 *
 * Appointments are laid down per provider per day by walking that provider's
 * shift with a cursor, so **two bookings can never overlap on one person** —
 * which matters beyond tidiness: `appointments_no_overlap_staff` would reject
 * the insert and take the whole seed transaction down with it.
 */
export function generateDemoAppointments(
  input: GenerateInput,
): DemoAppointmentRow[] {
  const {
    businessId,
    timezone,
    services,
    staffIds,
    shiftsForWeekday,
    clients,
    bufferMin,
    now,
    notes,
  } = input;

  const random = makeRandom(input.seed);
  const rows: DemoAppointmentRow[] = [];
  const today = localDate(now, timezone);

  let tokenCounter = 0;
  let noteCounter = 0;

  for (
    let offset = -DEMO_PAST_DAYS;
    offset <= DEMO_FUTURE_DAYS;
    offset += 1
  ) {
    const date = localDate(new Date(now.getTime() + offset * DAY_MS), timezone);
    const shifts = shiftsForWeekday(weekdayOf(date));
    if (shifts.length === 0) continue;

    const past = date < today;
    /**
     * Dense behind, airy ahead. History is what fills the revenue chart and the
     * heatmap; the days in front have to stay bookable — for the E2E suite, and
     * for a prospect who opens the demo link expecting to find a slot.
     */
    const occupancy = past ? 0.72 : 0.45;

    for (const staffId of staffIds) {
      for (const shift of shifts) {
        let cursor = toMinutes(shift.start);
        const shiftEnd = toMinutes(shift.end);

        while (cursor < shiftEnd) {
          const service = services[Math.floor(random() * services.length)];
          const end = cursor + service.durationMin;
          if (end > shiftEnd) break;

          if (random() > occupancy) {
            // A gap. Advanced by a slot rather than a whole service so the
            // holes land at plausible times rather than in fixed blocks.
            cursor += Math.max(15, Math.round(service.durationMin / 2));
            continue;
          }

          const client = clients[Math.floor(random() * clients.length)];

          const status = past
            ? weighted<DemoAppointmentRow["status"]>(random, [
                ["completed", 82],
                ["cancelled", 9],
                ["no_show", 6],
                // A past booking nobody ever marked up. Every real calendar has
                // these, and a demo without them looks administered by a robot.
                ["confirmed", 3],
              ])
            : weighted<DemoAppointmentRow["status"]>(
                random,
                input.requiresApproval
                  ? [
                      ["confirmed", 74],
                      ["pending", 14],
                      ["cancelled", 12],
                    ]
                  : // No approval step, so nothing can be waiting for one.
                    [
                      ["confirmed", 86],
                      ["cancelled", 14],
                    ],
              );

          const startsAt = fromZonedTime(
            `${date}T${hhmm(cursor)}:00`,
            timezone,
          );
          const endsAt = fromZonedTime(`${date}T${hhmm(end)}:00`, timezone);

          // Booked some days before it happens, which is what makes the
          // "new clients this week" and lead-time figures look real.
          const createdAt = new Date(
            startsAt.getTime() - (1 + Math.floor(random() * 9)) * DAY_MS,
          );

          rows.push({
            businessId,
            serviceId: service.id,
            staffId,
            startsAt,
            endsAt,
            status,
            clientName: client.name,
            clientPhone: client.phone,
            clientEmail: null,
            notes:
              notes.length > 0 && random() < 0.12
                ? notes[noteCounter++ % notes.length]
                : null,
            serviceName: service.name,
            priceCents: service.priceCents,
            // Deterministic, so a re-seed does not invalidate a link that was
            // pasted into a screenshot.
            cancelToken: `demo-${businessId.slice(0, 8)}-${tokenCounter++}`,
            cancelledAt:
              status === "cancelled"
                ? new Date(startsAt.getTime() - Math.floor(random() * 3) * DAY_MS)
                : null,
            createdAt,
          });

          cursor = end + bufferMin;
        }
      }
    }
  }

  return rows;
}

/**
 * One future booking, cancelled an hour ago, that the waitlist can be offered.
 *
 * Seeded on purpose so the freed-slot banner is *on screen* in a screenshot
 * rather than being a feature somebody has to be told about. It is placed on
 * the first provider two days out, at a time the generator leaves alone, so it
 * cannot collide with anything above.
 */
export function makeFreedSlot(input: {
  businessId: string;
  timezone: string;
  service: DemoService;
  staffId: string;
  client: DemoClient;
  now: Date;
}): DemoAppointmentRow {
  const { businessId, timezone, service, staffId, client, now } = input;

  const date = localDate(new Date(now.getTime() + 2 * DAY_MS), timezone);
  const startsAt = fromZonedTime(`${date}T17:30:00`, timezone);
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

  return {
    businessId,
    serviceId: service.id,
    staffId,
    startsAt,
    endsAt,
    status: "cancelled",
    clientName: client.name,
    clientPhone: client.phone,
    clientEmail: null,
    notes: null,
    serviceName: service.name,
    priceCents: service.priceCents,
    cancelToken: `demo-${businessId.slice(0, 8)}-freed`,
    // Recent, because the banner only announces the last week of cancellations.
    cancelledAt: new Date(now.getTime() - 3_600_000),
    createdAt: new Date(now.getTime() - 6 * DAY_MS),
  };
}
