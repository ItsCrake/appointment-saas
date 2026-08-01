import { expect, test } from "@playwright/test";

import {
  cleanupE2EBookings,
  clearRateLimit,
  countE2EBookings,
  E2E_PHONE,
  E2E_SLUG,
  exhaustPhoneRateLimit,
} from "./helpers";

/**
 * A rejected booking must land as a readable Hebrew message inside the form,
 * not as an unhandled rejection or a blank screen. These drive the two
 * rejection paths that a real client can actually hit.
 */
test.describe.configure({ mode: "serial" });

test.describe("booking failures surface in the UI", () => {
  test.afterAll(async () => {
    await cleanupE2EBookings();
  });

  test("an unknown business slug renders the 404 page, not an error", async ({
    page,
  }) => {
    const response = await page.goto("/no-such-business-at-all");

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "העמוד לא נמצא" }),
    ).toBeVisible();
    await expect(page.getByText("לא מצאנו עסק בכתובת הזו")).toBeVisible();
  });

  test("a rate-limited booking shows a Hebrew alert and writes nothing", async ({
    page,
  }) => {
    const key = await exhaustPhoneRateLimit();
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await page.goto(`/${E2E_SLUG}`);
      await page.getByRole("button").filter({ hasText: "תספורת גבר" }).click();

      const dayChips = page
        .getByRole("radiogroup", { name: "בחירת יום" })
        .getByRole("radio");
      const timeSlot = page.getByRole("radio", { name: /^\d{2}:\d{2}$/ });
      const slotsLoaded = page
        .getByRole("radiogroup", { name: "בחירת שעה" })
        .or(page.getByText("אין מועדים פנויים"));

      for (let i = 2; i < 10; i++) {
        await dayChips.nth(i).click();
        await slotsLoaded.first().waitFor({ timeout: 20_000 });
        if ((await timeSlot.count()) > 0) break;
      }

      await timeSlot.first().click();
      await page.locator("#clientName").fill("בדיקת חסימה");
      await page.locator("#clientPhone").fill(E2E_PHONE);
      await page.waitForTimeout(3000);
      await page.getByRole("button", { name: "אישור וקביעת התור" }).click();

      // The alert is the contract: a specific Hebrew sentence, in an ARIA
      // alert, telling the client when to try again.
      const alert = page.getByRole("alert").filter({
        hasText: "נשלחו יותר מדי בקשות",
      });
      await expect(alert.first()).toBeVisible();

      // No confirmation screen, and nothing written.
      await expect(
        page.getByRole("heading", { name: "התור נקבע בהצלחה!" }),
      ).toHaveCount(0);
      expect(await countE2EBookings()).toBe(0);

      // And no uncaught client-side exception along the way.
      expect(consoleErrors).toEqual([]);
    } finally {
      await clearRateLimit(key);
    }
  });

  test("an unknown booking token renders the 404 page", async ({ page }) => {
    const response = await page.goto("/b/00000000-0000-0000-0000-000000000000");
    expect(response?.status()).toBe(404);
  });
});
