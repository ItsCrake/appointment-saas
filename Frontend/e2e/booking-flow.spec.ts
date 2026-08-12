import { expect, test } from "@playwright/test";

import {
  bookAppointment,
  cleanupE2EBookings,
  countE2EBookings,
  E2E_PHONE,
  E2E_SLUG,
  hasOwnerCredentials,
  signInAsOwner,
  type BookedSlot,
} from "./helpers";

/**
 * The whole loop a real client and owner walk: book on the public page, see it
 * on the owner's agenda, cancel it from the client's link, and watch the
 * agenda reflect that.
 *
 * Serial by necessity — each step depends on the appointment the previous one
 * created.
 */
test.describe.configure({ mode: "serial" });

test.describe("public booking → dashboard → cancellation", () => {
  const clientName = "בדיקת E2E";
  let booked: BookedSlot;

  test.beforeAll(async () => {
    await cleanupE2EBookings();
  });

  test.afterAll(async () => {
    await cleanupE2EBookings();
  });

  test("a client books an appointment on the public page", async ({ page }) => {
    booked = await bookAppointment(page, clientName);

    expect(booked.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(booked.time).toMatch(/^\d{2}:\d{2}$/);
    expect(booked.token).toMatch(/^[0-9a-f-]{36}$/i);

    // The confirmation is backed by a real row, not the honeypot's fake one.
    expect(await countE2EBookings()).toBe(1);
  });

  test("the confirmation offers a calendar file for the right instant", async ({
    page,
  }) => {
    await page.goto(`/b/${booked.token}`);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "הוספה ליומן" }).click(),
    ]);

    const stream = await download.createReadStream();
    const ics = (
      await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      })
    ).toString("utf8");

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain(`DTSTART:${booked.date.replace(/-/g, "")}T`);
  });

  test("the owner sees it on the dashboard agenda", async ({ page }) => {
    test.skip(
      !hasOwnerCredentials,
      "Set E2E_EMAIL and E2E_PASSWORD in .env.local to run the owner specs",
    );

    await signInAsOwner(page);
    await page.goto(`/dashboard?view=day&date=${booked.date}`);

    await expect(page.getByText(clientName)).toBeVisible();
    await expect(page.getByText(booked.time).first()).toBeVisible();
    await expect(page.getByText(E2E_PHONE)).toBeVisible();
  });

  test("today's empty agenda still points at the upcoming booking", async ({
    page,
  }) => {
    test.skip(!hasOwnerCredentials, "Owner credentials not configured");

    await signInAsOwner(page);
    await page.goto("/dashboard");

    // Regression guard: an owner whose bookings are days out must never see a
    // bare empty day with no sign the appointment exists.
    //
    // Both wordings, because the pointer is pluralised: one upcoming booking
    // reads "יש תור אחד קרוב" and several read "יש N תורים קרובים". Matching
    // only the plural meant this passed solely when the calendar happened to
    // hold two or more — and the suite creates exactly one.
    const upcomingCard = page.getByRole("link", {
      name: /תור אחד קרוב|תורים קרובים/,
    });
    await expect(upcomingCard).toBeVisible();
  });

  test("the client cancels through their own link", async ({ page }) => {
    await page.goto(`/b/${booked.token}`);

    await expect(page.getByRole("heading", { name: "התור שלך" })).toBeVisible();
    await expect(page.getByText(clientName)).toBeVisible();

    await page.getByRole("button", { name: "ביטול התור" }).click();
    await page.getByRole("button", { name: "כן, בטלו את התור" }).click();

    await expect(
      page.getByRole("heading", { name: "התור בוטל" }),
    ).toBeVisible();
  });

  test("the cancelled slot is offered to the next client", async ({ page }) => {
    await page.goto(`/${E2E_SLUG}`);
    await page.getByRole("button").filter({ hasText: "תספורת גבר" }).click();

    const dayChips = page
      .getByRole("radiogroup", { name: "בחירת יום" })
      .getByRole("radio");

    // Find the day the cancelled appointment was on.
    const dayOfMonth = String(Number(booked.date.slice(8, 10)));
    await dayChips.filter({ hasText: dayOfMonth }).first().click();

    await expect(page.getByRole("radio", { name: booked.time })).toBeVisible();
  });

  test("the owner's agenda no longer counts it as active", async ({ page }) => {
    test.skip(!hasOwnerCredentials, "Owner credentials not configured");

    await signInAsOwner(page);
    await page.goto(`/dashboard?view=day&date=${booked.date}`);

    // Cancelled appointments are excluded from the agenda query entirely.
    await expect(page.getByText(clientName)).toHaveCount(0);
  });
});
