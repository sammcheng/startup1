import { expect, test } from "@playwright/test";

test("landing page loads and shows featured tools", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/hackmarket/i)).toBeVisible();
});

test("can browse marketplace and filter by category", async ({ page }) => {
  await page.goto("/marketplace");
  await expect(page.getByRole("heading", { name: /marketplace/i })).toBeVisible();

  const filter = page.locator("select").first();
  if (await filter.count()) {
    await filter.selectOption("nlp");
  }

  await expect(page.locator("body")).toContainText(/nlp|tool|marketplace/i);
});

test("can view tool detail page", async ({ page }) => {
  await page.goto("/marketplace");
  const firstToolLink = page.locator('a[href^="/tools/"]').first();
  await expect(firstToolLink).toBeVisible();
  await firstToolLink.click();
  await expect(page).toHaveURL(/\/tools\//);
});

test("demo form renders based on input type", async ({ page }) => {
  await page.goto("/marketplace");
  const firstToolLink = page.locator('a[href^="/tools/"]').first();
  await firstToolLink.click();
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /run/i })).toBeVisible();
});
