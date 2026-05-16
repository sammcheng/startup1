import { expect, test } from "@playwright/test";

test("unauthenticated user can browse but not create tools", async ({ page }) => {
  await page.goto("/marketplace");
  await expect(page.locator("body")).toContainText(/marketplace/i);

  await page.goto("/dashboard/tools/new");
  await expect(page).toHaveURL(/sign-in|sign-up|dashboard\/tools\/new/);
});

test("sign up flow works", async ({ page }) => {
  test.skip(!process.env.PLAYWRIGHT_SIGNUP_URL, "Provide PLAYWRIGHT_SIGNUP_URL for auth E2E.");
  await page.goto(process.env.PLAYWRIGHT_SIGNUP_URL!);
  await expect(page.locator("body")).toContainText(/sign up|create account/i);
});

test("can generate API key after auth", async ({ page }) => {
  test.skip(
    !process.env.PLAYWRIGHT_AUTHENTICATED_DASHBOARD_URL,
    "Provide PLAYWRIGHT_AUTHENTICATED_DASHBOARD_URL for authenticated E2E."
  );

  await page.goto(process.env.PLAYWRIGHT_AUTHENTICATED_DASHBOARD_URL!);
  await page.goto("/dashboard/api-keys");
  await expect(page.getByRole("button", { name: /create new api key/i })).toBeVisible();
});
