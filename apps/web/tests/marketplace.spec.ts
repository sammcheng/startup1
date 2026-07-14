import { expect, test } from "@playwright/test";

test("landing page loads and shows featured tools", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Hackmarket", exact: true })).toBeVisible();
});

test("can browse marketplace and filter by category", async ({ page }) => {
  await page.goto("/marketplace");
  await expect(page.getByRole("heading", { name: "What are you building?" })).toBeVisible();

  await page.getByRole("button", { name: "NLP", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Document Signal Extractor" })).toBeVisible();
  const toolCard = page.locator('a[href="/tools/document-signal-extractor"]');
  await expect(toolCard.getByText("latency", { exact: true })).toBeVisible();
  await expect(toolCard.getByText("calls", { exact: true })).toBeVisible();
  await expect(toolCard.getByText("Test Seller", { exact: true })).toBeVisible();
});

test("can view tool detail page", async ({ page }) => {
  await page.goto("/marketplace");
  const toolLink = page.locator('a[href="/tools/document-signal-extractor"]');
  await expect(toolLink).toBeVisible();
  await toolLink.click();
  await expect(page).toHaveURL(/\/tools\/document-signal-extractor/);
});

test("demo form renders based on input type", async ({ page }) => {
  await page.goto("/marketplace");
  await page.locator('a[href="/tools/document-signal-extractor"]').click();
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
});

test("marketplace cards fit a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/marketplace");
  await expect(page.getByRole("heading", { name: "Document Signal Extractor" })).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Open navigation menu" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const mobileMenu = page.locator("#site-nav-mobile-menu");
  await expect(mobileMenu.getByRole("link", { name: "Docs", exact: true })).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    cardWidths: Array.from(document.querySelectorAll("article")).map((card) => (
      Math.round(card.getBoundingClientRect().width)
    )),
  }));

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.cardWidths.length).toBeGreaterThan(0);
  expect(Math.max(...layout.cardWidths)).toBeLessThanOrEqual(layout.viewportWidth);
});
