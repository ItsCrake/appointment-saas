import { expect, test } from "@playwright/test";

import { hasOwnerCredentials, signInAsOwner } from "./helpers";

/**
 * The mobile overflow sheet, and the one bug it had that no unit test could
 * have caught: it reopened *by itself*.
 *
 * Its open state was derived from the pathname — "open while the route I was
 * opened on still matches". Navigating away closed it correctly. Coming *back*
 * made the remembered path match again, so the sheet re-derived itself open on
 * a page the owner had navigated to deliberately, with nothing clicked. The
 * whole failure lives in a sequence of two navigations, which is exactly what
 * this suite is for.
 */
test.describe("dashboard navigation", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !hasOwnerCredentials,
      "Set E2E_EMAIL and E2E_PASSWORD in .env.local to run the owner specs",
    );
    // The sheet is `md:hidden` — it does not exist at desktop width.
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAsOwner(page);
  });

  test("the overflow sheet stays closed when you come back to the page it was opened on", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // The consent notice sits over the bottom bar at phone width.
    const consent = page.getByRole("button", { name: "מאשר" });
    if (await consent.isVisible()) await consent.click();

    const sheet = page.getByRole("dialog");

    await page.getByRole("button", { name: "עוד" }).click();
    await expect(sheet).toBeVisible();

    // Out through a link inside the sheet — the bottom bar is behind the
    // modal backdrop, so this is the only exit that navigates.
    await sheet.getByRole("link", { name: "אנליטיקס" }).click();
    await expect(page).toHaveURL(/\/dashboard\/analytics/);
    await expect(sheet).toBeHidden();

    // ...and back to where it was opened. This is the assertion that failed.
    await page.getByRole("link", { name: "היומן" }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(sheet).toBeHidden();
  });
});
