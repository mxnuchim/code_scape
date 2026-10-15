import { expect, test, type Page } from "@playwright/test";

/** Wait until the city has assembled (read from the store, which is exposed to automation). */
export async function cityReady(page: Page) {
  await page.waitForFunction(
    () => {
      const store = (window as unknown as { __codescape?: { getState(): { assembled: boolean; analysis: unknown } } }).__codescape;
      const s = store?.getState();
      return !!s && s.assembled && !!s.analysis;
    },
    undefined,
    { timeout: 60_000 },
  );
}

test("local repository: the guide explains the project with evidence", async ({ page }) => {
  await page.goto("/local");
  await cityReady(page);
  const guide = page.getByRole("region", { name: "Guide" });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Node.js HTTP service (Express)" })).toBeVisible();
  await expect(guide.getByText("src/server.ts", { exact: false }).first()).toBeVisible();
  await expect(guide.getByText("Static", { exact: true }).first()).toBeVisible();
  await expect(guide.getByText("Heuristic", { exact: true }).first()).toBeVisible();
});

test("a code journey can be played, stepped and deep-linked", async ({ page, browser }) => {
  await page.goto("/local");
  await cityReady(page);
  await page.getByRole("region", { name: "Guide" }).getByRole("button", { name: /POST \/users/ }).click();
  const bar = page.getByRole("region", { name: "Journey POST /users" });
  await expect(bar).toContainText("1 / 5");
  await expect(bar).toContainText("createUserHandler");
  await page.keyboard.press("]");
  await expect(bar).toContainText("2 / 5");
  await expect(bar).toContainText("createUser");
  await expect(bar).toContainText("called at");
  await expect(page).toHaveURL(/journey=http-post-users-/);
  await expect(page.getByRole("region", { name: /Details for userService\.ts/ })).toBeVisible();

  // The same URL, opened fresh, restores the journey and selection.
  const url = page.url();
  await page.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const fresh = await context.newPage();
  await fresh.goto(url);
  await expect(fresh.getByRole("region", { name: "Journey POST /users" })).toBeVisible({ timeout: 30_000 });
  await expect(fresh.getByRole("region", { name: "Journey POST /users" })).toContainText("1 / 5");
  await expect(fresh.getByRole("region", { name: /Details for users\.ts/ })).toBeVisible();
  await context.close();

});

test("Escape leaves a journey", async ({ page }) => {
  await page.goto("/local?journey=http-get-users-id-1duqz");
  await cityReady(page);
  const bar = page.getByRole("region", { name: "Journey GET /users/:id" });
  await expect(bar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("search finds declarations and shows their source with line numbers", async ({ page }) => {
  await page.goto("/local");
  await cityReady(page);
  await page.keyboard.press("Escape"); // close the guide
  await page.getByRole("button", { name: "Search files and folders" }).first().click();
  await page.getByRole("combobox").fill("findUser");
  await expect(page.getByRole("option").first()).toContainText("Database.findUser");
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: /Details for client\.ts/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("option", { name: /Database\.findUser/ })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("select * from users where id = $1", { exact: false })).toBeVisible();
  await expect(panel.getByRole("link", { name: /Open in VS Code · 8/ })).toHaveAttribute("href", /^vscode:\/\/file\/.+\/src\/db\/client\.ts:8$/);
  await expect(page).toHaveURL(/select=src%2Fdb%2Fclient\.ts/);
});

test("the file tree reaches any file from the keyboard", async ({ page }) => {
  await page.goto("/local");
  await cityReady(page);
  const guide = page.getByRole("region", { name: /Guide/ });
  await guide.getByRole("tab", { name: "Files" }).click();
  const tree = page.getByRole("tree", { name: "Files and folders" });
  await tree.getByRole("treeitem").first().focus();
  await page.keyboard.press("ArrowRight"); // expand src
  await page.keyboard.press("ArrowDown"); // src/db
  await page.keyboard.press("ArrowRight"); // expand db
  await page.keyboard.press("ArrowDown"); // client.ts
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /Details for client\.ts/ })).toBeVisible();
});

test("a failing local server shows a recoverable error", async ({ page }) => {
  await page.route("**/api/workspace", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Disk on fire" }) }));
  await page.goto("/local");
  const alert = page.locator("section[role=alert]");
  await expect(alert).toContainText("The local repository couldn’t be loaded");
  await expect(alert).toContainText("Disk on fire");
  await page.unroute("**/api/workspace");
  await page.getByRole("button", { name: "Try again" }).click();
  await cityReady(page);
});

test("the local API refuses traversal and foreign hosts", async ({ request }) => {
  const traversal = await request.get("/api/workspace/file?path=../../package.json");
  expect(traversal.status()).toBe(403);
  const secret = await request.get("/api/workspace/file?path=.env");
  expect([403, 404]).toContain(secret.status());
  const foreign = await request.get("/api/workspace/status", { headers: { host: "attacker.example" } });
  expect(foreign.status()).toBe(403);
});
