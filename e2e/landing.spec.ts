import { expect, test } from "@playwright/test";

test("landing page explains the product and validates input", async ({ page }) => {
  // Keep this offline: no GitHub calls in tests.
  await page.route("https://api.github.com/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Understand any codebase. Find your way around." })).toBeVisible();
  await page.getByLabel("GitHub repository URL").fill("not a repo url");
  await page.getByRole("button", { name: "Build" }).click();
  await expect(page.locator("#repo-url-error")).toBeVisible();
});

test("respects reduced motion: the city is ready almost immediately", async ({ page }) => {
  const started = Date.now();
  await page.goto("/local");
  await page.waitForFunction(() => (window as unknown as { __codescape?: { getState(): { assembled: boolean } } }).__codescape?.getState().assembled === true, undefined, {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => (window as unknown as { __codescape: { getState(): { reducedMotion: boolean } } }).__codescape.getState().reducedMotion)).toBe(true);
  expect(Date.now() - started).toBeLessThan(30_000);
  await expect(page.getByRole("region", { name: "Guide" })).toBeVisible();
});

test("the repository library opens, searches and closes", async ({ page }) => {
  await page.route("https://api.github.com/**", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: /Browse all \d+/ }).click();
  const library = page.getByRole("dialog", { name: "Explore famous codebases" });
  await expect(library).toBeVisible();
  await expect(page.locator("#library-search")).toBeFocused();
  await page.locator("#library-search").fill("docker");
  await expect(library.locator("[data-library-item]")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(library.getByRole("button", { name: "Docker Engine (Moby), moby/moby" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(library).toHaveCount(0);
});
