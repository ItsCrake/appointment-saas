import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

import { DEMO_SLUG } from "../src/lib/demo";
import { BOOKING_RULES, buildRateLimitKey } from "../src/lib/rate-limit";

/**
 * The public booking page used by the suite. The seeded demo shop is owned by
 * the E2E auth user, so one business covers both the public flow and the
 * dashboard assertions.
 */
export const E2E_SLUG = DEMO_SLUG;

/**
 * Every booking this suite creates carries this phone number, which is what
 * teardown deletes. Nothing else in the database is touched.
 */
export const E2E_PHONE = "0559990001";

export const E2E_EMAIL = process.env.E2E_EMAIL ?? "";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

export const hasOwnerCredentials = Boolean(E2E_EMAIL && E2E_PASSWORD);

function connect() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url)
    throw new Error("DIRECT_URL is not set — cannot clean up E2E data.");
  return postgres(url, { max: 1 });
}

/** Removes only rows this suite created. */
export async function cleanupE2EBookings() {
  const sql = connect();
  try {
    const rows = await sql`
      DELETE FROM appointments WHERE client_phone = ${E2E_PHONE} RETURNING id`;
    return rows.length;
  } finally {
    await sql.end();
  }
}

export async function countE2EBookings() {
  const sql = connect();
  try {
    const [row] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM appointments WHERE client_phone = ${E2E_PHONE}`;
    return row.c;
  } finally {
    await sql.end();
  }
}

/**
 * Pushes the per-phone booking counter to its limit so the next attempt is
 * guaranteed to be rejected. Lets the error-surfacing path be tested without
 * making five real bookings first.
 */
export async function exhaustPhoneRateLimit() {
  const sql = connect();
  try {
    const [business] = await sql<{ id: string }[]>`
      SELECT id FROM businesses WHERE slug = ${E2E_SLUG}`;
    if (!business) throw new Error(`${E2E_SLUG} not found`);

    const rule = BOOKING_RULES.phoneDaily;
    const { key, windowStart, expiresAt } = buildRateLimitKey(
      rule,
      `${business.id}:${E2E_PHONE}`,
      new Date(),
    );

    await sql`
      INSERT INTO rate_limits (key, count, window_start, expires_at)
      VALUES (${key}, ${rule.limit + 1}, ${windowStart}, ${expiresAt})
      ON CONFLICT (key) DO UPDATE SET count = ${rule.limit + 1}`;

    return key;
  } finally {
    await sql.end();
  }
}

export async function clearRateLimit(key: string) {
  const sql = connect();
  try {
    await sql`DELETE FROM rate_limits WHERE key = ${key}`;
  } finally {
    await sql.end();
  }
}

export type BookedSlot = {
  /** "yyyy-MM-dd" in the business timezone. */
  date: string;
  /** "HH:mm". */
  time: string;
  /** Self-service management token from the confirmation screen. */
  token: string;
  clientName: string;
};

/**
 * Pulls the appointment's date and time out of the confirmation screen's text.
 *
 * The two are matched **independently rather than as one ordered pattern**. The
 * screen used to read "יום ראשון, 02/08/2026 בשעה 09:15" in a single line; it
 * now leads with the time in display size and puts the weekday and date
 * underneath, so a pattern anchored on "date, then time" silently stopped
 * matching. Order is presentation, and this helper only wants the two values.
 */
export function parseConfirmationWhen(text: string) {
  const date = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const time = text.match(/(?<!\d)(\d{2}:\d{2})(?!\d)/);

  if (!date || !time) {
    throw new Error(`Could not parse date/time from: ${text}`);
  }

  const [, dd, mm, yyyy] = date;
  return { date: `${yyyy}-${mm}-${dd}`, time: time[1] };
}

/**
 * Picks a provider when the shop has a team, and does nothing when it does not.
 *
 * `demo-barber` has two active providers, so the public flow is genuinely four
 * steps for it and this helper was walking three. Which of the two screens
 * appears depends on how many people are free at the chosen time, and that
 * varies with whatever is really on the calendar that day — so the helper has
 * to handle both rather than assume:
 *
 * - **the picker**, when more than one provider is free;
 * - **the sole-provider card**, when exactly one is. A team shop never skips
 *   silently to the form, deliberately: being handed the only person left
 *   without being told is a decision made for the client that they cannot see.
 *
 * A single-staff tenant reaches neither, so `Promise.race` settles on the
 * details heading and the helper falls through untouched.
 */
export async function chooseProviderIfAsked(page: Page) {
  const picker = page.getByRole("heading", { name: /^עם מי בשעה/ });
  const soleProvider = page.getByRole("button", { name: /^להמשיך עם/ });
  const details = page.getByRole("heading", { name: "הפרטים שלכם" });

  await Promise.race([
    picker.waitFor({ timeout: 20_000 }).catch(() => {}),
    soleProvider.waitFor({ timeout: 20_000 }).catch(() => {}),
    details.waitFor({ timeout: 20_000 }).catch(() => {}),
  ]);

  if (await soleProvider.isVisible()) {
    await soleProvider.click();
    return;
  }

  if (await picker.isVisible()) {
    /**
     * Scoped to the picker's own section, not to "the last list on the page".
     * The booking page also carries the stepper, the gallery and the reviews,
     * each of them a list — so an unscoped locator quietly resolved to the
     * testimonials and waited 20 seconds for a button that was never there.
     *
     * Whoever is listed first. The point of the step is that *something* is
     * chosen explicitly, not which one.
     */
    await page
      .locator("section")
      .filter({ has: picker })
      .getByRole("button")
      .first()
      .click();
  }
}

/**
 * Walks the public flow: service, then the first day far enough ahead that
 * has free slots, then a provider if the shop has a team, then details.
 *
 * Starting at day index 2 keeps every booking comfortably outside the
 * business's 12-hour cancellation window, so the cancel spec has something to
 * click.
 */
export async function bookAppointment(
  page: Page,
  clientName: string,
): Promise<BookedSlot> {
  await page.goto(`/${E2E_SLUG}`);

  await expect(page.getByRole("heading", { name: "בחרו שירות" })).toBeVisible();
  await page.getByRole("button").filter({ hasText: "תספורת גבר" }).click();

  await expect(page.getByRole("heading", { name: "בחרו מועד" })).toBeVisible();

  const dayChips = page
    .getByRole("radiogroup", { name: "בחירת יום" })
    .getByRole("radio");
  const timeSlot = page.getByRole("radio", { name: /^\d{2}:\d{2}$/ });

  // Whichever of these settles first tells us the fetch finished.
  //
  // A `group`, not a `radiogroup`: slots are grouped into morning / afternoon /
  // evening and each period is its own radiogroup, labelled by its own heading
  // — and that heading carries a count, so no radiogroup has a stable name.
  // The wrapper is rendered only when there are slots, which is what keeps this
  // a real wait rather than one that settles on the skeleton.
  const slotsLoaded = page
    .getByRole("group", { name: "בחירת שעה" })
    .or(page.getByText("אין מועדים פנויים"));

  let chosenTime: string | null = null;
  const dayCount = await dayChips.count();

  for (let i = 2; i < Math.min(dayCount, 10); i++) {
    await dayChips.nth(i).click();
    await slotsLoaded.first().waitFor({ timeout: 20_000 });

    if ((await timeSlot.count()) > 0) {
      chosenTime = (await timeSlot.first().innerText()).trim();
      await timeSlot.first().click();
      break;
    }
  }

  if (!chosenTime)
    throw new Error("No bookable slot found in the next 10 days");

  await chooseProviderIfAsked(page);

  await expect(
    page.getByRole("heading", { name: "הפרטים שלכם" }),
  ).toBeVisible();

  await page.locator("#clientName").fill(clientName);
  await page.locator("#clientPhone").fill(E2E_PHONE);
  // The honeypot (#contact_reference) is deliberately left untouched.

  // The form rejects anything submitted within 2.5s of slot selection.
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "אישור וקביעת התור" }).click();

  await expect(
    page.getByRole("heading", { name: "התור נקבע בהצלחה!" }),
  ).toBeVisible();

  // The whole confirmation section, not the `dl` inside it: the date and time
  // live in the hero block above that list, so `dl` alone carries the service,
  // the price and the client — and none of what this is looking for.
  const summary = await page
    .locator('section[aria-labelledby="confirm-heading"]')
    .innerText();
  const { date, time } = parseConfirmationWhen(summary);

  const manageHref = await page
    .getByRole("link", { name: "צפייה או ביטול התור" })
    .getAttribute("href");
  if (!manageHref) throw new Error("Confirmation screen had no manage link");

  return { date, time, token: manageHref.replace("/b/", ""), clientName };
}

/** Signs the owner in and lands on the dashboard. */
export async function signInAsOwner(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(E2E_EMAIL);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page
    .locator("#email")
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "התחברות" })
    .click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
}
