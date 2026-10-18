import { expect, test, type Page } from "@playwright/test";

// Inlined: importing a helper from another spec file also runs that file's tests (see LEARNINGS.md).
async function cityReady(page: Page) {
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __codescape?: { getState(): { assembled: boolean; analysis: unknown } } }).__codescape?.getState();
      return !!s && s.assembled && !!s.analysis;
    },
    undefined,
    { timeout: 60_000 },
  );
}

test("a new city says what it is and walks you to where to start", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/local");
  await cityReady(page);

  // The welcome card: what this is, and one next step.
  const card = page.getByRole("region", { name: "About ts-express-api" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Node.js HTTP service (Express)");

  // Numbered Start-here pins, district signs and a trailhead are in the city.
  await expect(page.getByRole("button", { name: "Start here, stop 1: README.md" })).toBeVisible();
  await expect(page.locator(".wf-pin")).toHaveCount(6);
  await expect(page.locator(".wf-district").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow POST /users through the code" })).toBeVisible();

  // The tour: each stop selects its building and says why.
  await card.getByRole("button", { name: "Show me where to start" }).click();
  const bar = page.getByRole("region", { name: "Start here" });
  await expect(bar).toContainText("1 / 6");
  await expect(bar).toContainText("README.md");
  await expect(page.getByRole("region", { name: /Details for README\.md/ })).toBeVisible();
  await page.keyboard.press("]");
  await expect(bar).toContainText("2 / 6");
  await expect(bar).toContainText("package.json");

  // A pin jumps straight to its stop; the routes file hands over to a code journey.
  await page.keyboard.press("h"); // back to the overview, where every pin is in view
  await page.getByRole("button", { name: /Start here, stop 4: src\/routes\/users\.ts/ }).click();
  await expect(bar).toContainText("4 / 6");
  await bar.getByRole("button", { name: /Follow POST \/users/ }).click();
  await expect(page.getByRole("region", { name: "Journey POST /users" })).toBeVisible();
  await expect(bar).toHaveCount(0);
  // While the journey plays it draws its own stops, so the pins step aside.
  await expect(page.locator(".wf-pin")).toHaveCount(0);

  // Leaving the journey brings the pins back; Esc on an open tour ends it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Journey POST /users" })).toHaveCount(0);
  await expect(page.locator(".wf-pin")).toHaveCount(6);
  // Leaving a journey or the tour must not crash the page mid-animation (both bars once did).
  expect(errors).toEqual([]);
});
