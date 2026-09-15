import { fromZonedTime } from "date-fns-tz";

import type { AppointmentOrigin } from "../lib/appointment-origin";
import { makeRandom } from "./demo-data";

/**
 * A fortnight booked solid, for seeing how the calendar holds up at capacity.
 *
 * ---------------------------------------------------------------------------
 * **Not a demo generator, and the difference is what it leaves behind.**
 * `demo-data.ts` keeps the future half empty on purpose, because a prospect and
 * the E2E suite both need somewhere to book. This fills every stretch of posted
 * hours that any service could fit into. A shop run through it has no
 * availability at all for two weeks — which is the point of a load test and the
 * reason the runner, `seed-load-test.ts`, refuses a second batch and carries its
 * own purge.
 *
 * **Pure.** It is handed the shop — hours, services, what is already booked —
 * and returns rows, so the properties that matter are tested without touching
 * the database: nothing double-books, nothing sits outside posted hours, and no
 * hole is left that a service could be booked into.
 *
 * **Every phone starts `0560`.** `056` is the prefix every seeded row in this
 * database uses and not an allocated Israeli mobile block. The extra `0` is a
 * block no earlier seed draws from — `seed-week` numbers start at `0561` — so
 * the purge can take exactly this batch and leave the older seeded weeks alone.
 * ---------------------------------------------------------------------------
 */

export const LOAD_TEST_PHONE_PREFIX = "0560";

/** Minutes from local midnight. */
export type OpenWindow = { from: number; to: number };

export type LoadTestService = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  /** Relative popularity. A barber sells more haircuts than colour. */
  weight: number;
  /** Booked by a parent, and sometimes for two children back to back. */
  forChild: boolean;
};

/** Time already spoken for: live bookings and time off. A null staff id is the whole shop. */
export type Occupied = { staffId: string | null; startsAt: Date; endsAt: Date };

export type LoadTestInput = {
  timezone: string;
  /** Local calendar days, "YYYY-MM-DD". */
  days: readonly string[];
  staffIds: readonly string[];
  /** Posted hours for one provider on one weekday (0 = Sunday). Empty when closed. */
  windowsFor: (staffId: string, weekday: number) => readonly OpenWindow[];
  services: readonly LoadTestService[];
  occupied: readonly Occupied[];
  /** The gap the booking page keeps between appointments. */
  bufferMin: number;
  now: Date;
  seed: number;
};

export type LoadTestRow = {
  staffId: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  startsAt: Date;
  endsAt: Date;
  status: "confirmed" | "pending" | "cancelled";
  clientName: string;
  clientPhone: string;
  notes: string | null;
  createdVia: AppointmentOrigin;
  createdAt: Date;
  cancelledAt: Date | null;
};

const MINUTE = 60_000;
const DAY = 1_440 * MINUTE;

/**
 * The space left before each booking, and how often each size happens.
 *
 * Multiples of five and never more than ten, so a finished day's widest hole is
 * narrower than the shortest service. Back to back is a quarter of them: that
 * is the owner squeezing somebody in, which the booking page itself never does.
 */
const GAPS: readonly (readonly [minutes: number, weight: number])[] = [
  [0, 25],
  [5, 50],
  [10, 25],
];

/** Of future bookings that could have come through the booking page. */
const PENDING_CHANCE = 0.2;
/** Of live bookings, the chance somebody else held the slot first and cancelled. */
const CANCELLED_CHANCE = 0.07;
/** A client who was in at least six days earlier and is back. */
const REGULAR_CHANCE = 0.12;
const SIBLING_CHANCE = 0.3;
const NOTE_CHANCE = 0.1;

const NOTES = [
  "בלי מכונה בצדדים",
  "רק מספריים",
  "פייד גבוה, להשאיר אורך למעלה",
  "לקצר את הזקן, לא לגלח",
  "כמו בפעם הקודמת",
  "אולי יאחר בכמה דקות",
  "אם מתפנה מוקדם — להתקשר",
  "משלם בביט",
  // Long enough to wrap: real notes are sometimes a paragraph.
  "בפעם הקודמת יצא קצר מדי מאחור — לשמור על האורך ולסדר רק את הקווים בצדדים",
];
const CHILD_NOTES = ["הילד חושש מהמכונה", "בלי ג'ל", "לקצר מעל האוזניים"];

type Community = {
  weight: number;
  male: readonly string[];
  female: readonly string[];
  last: readonly string[];
  /** Surnames with a feminine form, index for index with `last`. */
  lastFemale?: readonly string[];
};

/**
 * Names drawn within one community, so a first name never lands on a surname
 * from another. Weighted roughly like a city barbershop's client list.
 */
// prettier-ignore
const COMMUNITIES: readonly Community[] = [
  {
    weight: 70,
    male: [
      "יוסי", "אבי", "משה", "דוד", "יעקב", "חיים", "מאיר", "איתן", "עידו",
      "נועם", "אריאל", "עמית", "יובל", "רון", "גל", "אור", "תומר", "ליאור",
      "שי", "אלעד", "אופיר", "נתנאל", "יהונתן", "אביתר", "מתן", "עמרי", "רז",
      "שגיא", "ניר", "ערן", "קובי", "מוטי", "שמעון", "ברק", "יאיר", "אסי",
      "אייל", "דור", "ישי", "ינון", "הראל", "אושר", "אליה", "רפאל", "צביקה",
    ],
    female: [
      "מיכל", "רחל", "שרה", "אורית", "סיגל", "לימור", "מירב", "ענת", "קרן",
      "הילה", "נטע", "תמר", "אסתר", "ליאת", "מאיה", "רינת", "אפרת", "חני",
    ],
    last: [
      "כהן", "לוי", "מזרחי", "פרץ", "ביטון", "דהן", "אברהם", "פרידמן",
      "אזולאי", "מלכה", "חדד", "אוחיון", "גבאי", "שפירא", "רוזנברג",
      "גולדשטיין", "אשכנזי", "עמר", "בן דוד", "שלום", "חזן", "סויסה",
      "בוזגלו", "שמואלי", "וקנין", "אלקיים", "גרינברג", "קליין", "וייס",
      "יצחקי", "ששון", "זכאי", "שטרן", "הורוביץ", "נחמיאס", "סבג",
      "אבוטבול", "טולדנו", "בן שושן", "אלמוג",
    ],
  },
  {
    weight: 12,
    male: [
      "מוחמד", "אחמד", "מחמוד", "עלי", "חוסאם", "סאמר", "ראמי", "וסים",
      "פאדי", "נזאר", "כרים", "באסל", "תאמר", "ג'ורג'", "אליאס", "מג'ד", "ואיל",
    ],
    female: ["רנא", "נסרין", "סמאח", "לינא", "מונא", "ג'נאן", "הבה"],
    last: [
      "עבאס", "חטיב", "מסארווה", "ג'בארין", "עודה", "נאסר", "זועבי", "סלאמה",
      "אבו ריא", "חורי", "מנסור", "ח'ליל", "דאהר", "בשארה", "חלבי", "קבלאן",
    ],
  },
  {
    weight: 12,
    male: [
      "סרגיי", "דמיטרי", "אלכסנדר", "מקסים", "ארטיום", "בוריס", "ולדימיר",
      "איגור", "אנדריי", "פאבל", "יבגני", "רומן", "ויקטור", "קיריל", "אלכסיי",
    ],
    female: ["סבטלנה", "אולגה", "נטליה", "יוליה", "אלנה", "מרינה", "אירינה", "טטיאנה"],
    last: [
      "איבנוב", "פטרוב", "קוזלוב", "סמירנוב", "וולקוב", "פופוב", "מורוזוב",
      "נוביקוב", "קוזנצוב", "סוקולוב", "לבדב", "זייצב", "פבלוב",
    ],
    lastFemale: [
      "איבנובה", "פטרובה", "קוזלובה", "סמירנובה", "וולקובה", "פופובה",
      "מורוזובה", "נוביקובה", "קוזנצובה", "סוקולובה", "לבדבה", "זייצבה", "פבלובה",
    ],
  },
  {
    weight: 6,
    male: ["טספאי", "ברהנו", "אלמו", "מולוגטה", "מלאכו", "גטהון", "אברהם", "שמואל"],
    female: ["טיגיסט", "אביבה", "מזל", "מסרט", "אסתר", "יעל"],
    last: ["מקונן", "אדמסו", "מנגיסטו", "בלאי", "וורקו", "טקה", "אסרס", "מולה"],
  },
];

type Person = {
  name: string;
  phone: string;
  child: boolean;
  lastVisit: number;
};

type Placed = {
  service: LoadTestService;
  start: number;
  end: number;
  person: Person;
  notes: string | null;
  close: number;
};

function pickWeighted<T>(
  items: readonly T[],
  weight: (item: T) => number,
  random: () => number,
): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/** A wall-clock minute on a local day, as an instant. 24:00 is the next midnight. */
export function atLocal(
  day: string,
  minutes: number,
  timezone: string,
): number {
  const date =
    minutes >= 1_440
      ? new Date(Date.parse(`${day}T00:00:00Z`) + DAY)
          .toISOString()
          .slice(0, 10)
      : day;
  const rest = minutes % 1_440;
  const hh = String(Math.floor(rest / 60)).padStart(2, "0");
  const mm = String(rest % 60).padStart(2, "0");
  return fromZonedTime(`${date}T${hh}:${mm}:00`, timezone).getTime();
}

const FIVE = 5 * MINUTE;
const snapUp = (t: number) => Math.ceil(t / FIVE) * FIVE;
const snapDown = (t: number) => Math.floor(t / FIVE) * FIVE;

/**
 * When the booking was made.
 *
 * Mostly days ahead, some the same morning, a few three weeks out — and never
 * later than the clock, so a booking for next Thursday with a ten-day lead reads
 * as made in the last few days rather than in the future.
 */
function bookedAt(start: number, now: number, random: () => number): number {
  const roll = random();
  const leadDays =
    roll < 0.08
      ? (30 + random() * 270) / 1_440
      : roll < 0.38
        ? 1 + random() * 2
        : roll < 0.8
          ? 3 + random() * 7
          : 10 + random() * 11;
  let at = start - leadDays * DAY;
  if (at > now) at = now - (5 + random() * 4_000) * MINUTE;
  return Math.floor(at / 1_000) * 1_000;
}

export function planLoadTest(input: LoadTestInput): LoadTestRow[] {
  const random = makeRandom(input.seed);
  const now = input.now.getTime();
  const services = input.services;
  const shortest = Math.min(...services.map((service) => service.durationMin));

  const people: Person[] = [];
  const phones = new Set<string>();
  const rows: LoadTestRow[] = [];

  function newPerson(child: boolean): Person {
    const community = pickWeighted(COMMUNITIES, (c) => c.weight, random);
    // A parent books a child's haircut; everything else here is mostly men.
    const female = random() < (child ? 0.55 : 0.06);
    const index = Math.floor(random() * community.last.length);
    const last =
      female && community.lastFemale
        ? community.lastFemale[index]
        : community.last[index];
    const first = pick(female ? community.female : community.male, random);

    let phone: string;
    do {
      phone = `${LOAD_TEST_PHONE_PREFIX}${String(Math.floor(random() * 1_000_000)).padStart(6, "0")}`;
    } while (phones.has(phone));
    phones.add(phone);

    const person = { name: `${first} ${last}`, phone, child, lastVisit: 0 };
    people.push(person);
    return person;
  }

  function clientFor(service: LoadTestService, start: number): Person {
    if (random() < REGULAR_CHANCE) {
      const regulars = people.filter(
        (person) =>
          person.child === service.forChild &&
          start - person.lastVisit >= 6 * DAY,
      );
      if (regulars.length > 0) {
        const person = pick(regulars, random);
        person.lastVisit = start;
        return person;
      }
    }
    const person = newPerson(service.forChild);
    person.lastVisit = start;
    return person;
  }

  const noteFor = (service: LoadTestService) =>
    random() < NOTE_CHANCE
      ? pick(service.forChild ? CHILD_NOTES : NOTES, random)
      : null;

  /** One free stretch, left to right, until nothing else fits. */
  function fill(
    from: number,
    to: number,
    atOpening: boolean,
    close: number,
  ): Placed[] {
    const placed: Placed[] = [];
    let cursor = from;

    for (;;) {
      const room = (to - cursor) / MINUTE;
      if (room < shortest) break;

      // The first client of a shift is usually there when the door opens.
      const wanted =
        placed.length === 0 && atOpening
          ? random() < 0.85
            ? 0
            : 5
          : pickWeighted(GAPS, ([, weight]) => weight, random)[0];
      // Narrowed rather than skipped, so a stretch that only fits the shortest
      // service back to back still gets it.
      const gap =
        [wanted, 5, 0].find(
          (g) => g <= wanted && services.some((s) => g + s.durationMin <= room),
        ) ?? 0;

      const fitting = services.filter((s) => gap + s.durationMin <= room);
      const service = pickWeighted(fitting, (s) => s.weight, random);
      const start = cursor + gap * MINUTE;
      const end = start + service.durationMin * MINUTE;
      const person = clientFor(service, start);
      placed.push({
        service,
        start,
        end,
        person,
        notes: noteFor(service),
        close,
      });
      cursor = end;

      // Two children, one parent, one after the other.
      if (
        service.forChild &&
        random() < SIBLING_CHANCE &&
        (to - cursor) / MINUTE >= service.durationMin
      ) {
        placed[placed.length - 1].notes = "שני אחים, אחד אחרי השני";
        placed.push({
          service,
          start: cursor,
          end: cursor + service.durationMin * MINUTE,
          person,
          notes: "האח הקטן",
          close,
        });
        cursor += service.durationMin * MINUTE;
      }
    }

    return placed;
  }

  for (const staffId of input.staffIds) {
    for (const day of input.days) {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const windows = [...input.windowsFor(staffId, weekday)].sort(
        (a, b) => a.from - b.from,
      );

      for (const window of windows) {
        const open = atLocal(day, window.from, input.timezone);
        const close = atLocal(day, window.to, input.timezone);

        const taken = input.occupied
          .filter(
            (o) =>
              (o.staffId === null || o.staffId === staffId) &&
              o.startsAt.getTime() < close &&
              o.endsAt.getTime() > open,
          )
          .map((o) => ({
            start: o.startsAt.getTime(),
            end: o.endsAt.getTime(),
          }))
          .sort((a, b) => a.start - b.start);

        const placed: Placed[] = [];
        let cursor = open;
        for (const span of taken) {
          if (span.start > cursor) {
            placed.push(
              ...fill(
                snapUp(cursor),
                snapDown(span.start),
                cursor === open,
                close,
              ),
            );
          }
          cursor = Math.max(cursor, span.end);
        }
        if (cursor < close) {
          placed.push(
            ...fill(snapUp(cursor), snapDown(close), cursor === open, close),
          );
        }

        /**
         * Who booked it follows from what is either side of it. The booking page
         * keeps `bufferMin` clear around every appointment, so a booking flush
         * against a neighbour was put there by the owner or by ליבי — never by a
         * client online, and so never a request awaiting approval either.
         */
        const timeline = [...taken, ...placed].sort(
          (a, b) => a.start - b.start,
        );

        for (const item of placed) {
          const at = timeline.indexOf(item);
          const before =
            at > 0 ? (item.start - timeline[at - 1].end) / MINUTE : Infinity;
          const after =
            at < timeline.length - 1
              ? (timeline[at + 1].start - item.end) / MINUTE
              : Infinity;
          const squeezed = Math.min(before, after) < input.bufferMin;

          const roll = random();
          const createdVia: AppointmentOrigin = squeezed
            ? roll < 0.9
              ? "manual"
              : "voice"
            : roll < 0.75
              ? "online"
              : roll < 0.95
                ? "manual"
                : "voice";

          const pending =
            item.start > now &&
            createdVia === "online" &&
            random() < PENDING_CHANCE;
          const createdAt = bookedAt(item.start, now, random);

          rows.push({
            staffId,
            serviceId: item.service.id,
            serviceName: item.service.name,
            priceCents: item.service.priceCents,
            startsAt: new Date(item.start),
            endsAt: new Date(item.end),
            status: pending ? "pending" : "confirmed",
            clientName: item.person.name,
            clientPhone: item.person.phone,
            notes: item.notes,
            createdVia,
            createdAt: new Date(createdAt),
            cancelledAt: null,
          });

          /**
           * Somebody held this slot first and cancelled; this booking took it.
           * A cancelled row frees its time, so it sits under the live one rather
           * than leaving a hole — the calendar stays full and the cancellation
           * still counts everywhere cancellations are counted.
           */
          if (random() < CANCELLED_CHANCE) {
            const fits = services.filter(
              (s) => item.start + s.durationMin * MINUTE <= item.close,
            );
            const service = pickWeighted(fits, (s) => s.weight, random);
            const person = newPerson(service.forChild);
            const heldFrom = createdAt - (60 + random() * 6 * 1_440) * MINUTE;
            const cancelledAt = heldFrom + random() * (createdAt - heldFrom);

            rows.push({
              staffId,
              serviceId: service.id,
              serviceName: service.name,
              priceCents: service.priceCents,
              startsAt: new Date(item.start),
              endsAt: new Date(item.start + service.durationMin * MINUTE),
              status: "cancelled",
              clientName: person.name,
              clientPhone: person.phone,
              notes: null,
              createdVia: random() < 0.8 ? "online" : "manual",
              createdAt: new Date(Math.floor(heldFrom / 1_000) * 1_000),
              cancelledAt: new Date(Math.floor(cancelledAt / 1_000) * 1_000),
            });
          }
        }
      }
    }
  }

  return rows.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      Number(a.status === "cancelled") - Number(b.status === "cancelled"),
  );
}
