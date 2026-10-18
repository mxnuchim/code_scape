import { expect, test, type Page } from "@playwright/test";

/** Wait until the city has assembled (read from the store, which is exposed to automation). */
async function cityReady(page: Page) {
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

interface Pose {
  polar: number;
  azimuth: number;
  distance: number;
  tx: number;
  tz: number;
}

/**
 * Where the camera is heading, read from the controls exposed to automation. The controls
 * ease towards this pose, so it doesn't depend on how fast frames render.
 */
function pose(page: Page): Promise<Pose> {
  return page.evaluate(() => {
    type Controls = {
      _sphericalEnd: { phi: number; theta: number; radius: number };
      _targetEnd: { x: number; z: number };
    };
    const c = (window as unknown as { __codescapeCamera?: Controls }).__codescapeCamera!;
    const s = c._sphericalEnd;
    return {
      polar: s.phi,
      azimuth: Math.atan2(Math.sin(s.theta), Math.cos(s.theta)),
      distance: s.radius,
      tx: c._targetEnd.x,
      tz: c._targetEnd.z,
    };
  });
}

/** Let a few frames render. Headless WebGL (SwiftShader) on a busy machine can take seconds per frame. */
async function frames(page: Page, count: number) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let n = 0;
        const tick = () => (++n >= count ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/** Hold a key for a few rendered frames, so the per-frame flight code sees it. */
async function hold(page: Page, key: string, count = 3) {
  await page.keyboard.down(key);
  await frames(page, count);
  await page.keyboard.up(key);
}

test("a city opens on a low three-quarter aerial view, and the keyboard flies around it", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/local");
  await cityReady(page);
  await page.keyboard.press("Escape"); // close the welcome card
  await frames(page, 2);
  const opening = await pose(page);
  // About 22° above the horizon, looking in from a corner (between +X and +Z).
  expect(Math.PI / 2 - opening.polar).toBeGreaterThan(0.3);
  expect(Math.PI / 2 - opening.polar).toBeLessThan(0.48);
  expect(opening.azimuth).toBeGreaterThan(0.3);
  expect(opening.azimuth).toBeLessThan(Math.PI / 2);

  // R tilts towards top-down; F and PageDown back towards the ground, never under it.
  await hold(page, "r");
  const up = await pose(page);
  expect(up.polar).toBeLessThan(opening.polar - 0.01);
  await hold(page, "PageDown");
  await hold(page, "f");
  const down = await pose(page);
  expect(down.polar).toBeGreaterThan(up.polar + 0.01);
  expect(down.polar).toBeLessThanOrEqual(1.42 + 1e-3);

  // Q and E turn; W moves the view across the ground.
  await hold(page, "e");
  const turned = await pose(page);
  expect(Math.abs(turned.azimuth - down.azimuth)).toBeGreaterThan(0.01);
  await hold(page, "w");
  const moved = await pose(page);
  expect(Math.hypot(moved.tx - turned.tx, moved.tz - turned.tz)).toBeGreaterThan(0.2);

  // Keys typed into search don't move the camera.
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox")).toBeFocused();
  await hold(page, "w");
  const typed = await pose(page);
  expect(Math.hypot(typed.tx - moved.tx, typed.tz - moved.tz)).toBeLessThan(1e-6);
  await expect(page.getByRole("combobox")).toHaveValue(/w/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);

  // H returns to the opening view, and so does the Home button.
  await page.keyboard.press("h");
  await frames(page, 1);
  const homeKey = await pose(page);
  expect(homeKey.polar).toBeCloseTo(opening.polar, 3);
  await hold(page, "e");
  await page.getByRole("button", { name: "Show the whole city (H)" }).click();
  await frames(page, 1);
  const home = await pose(page);
  expect(home.polar).toBeCloseTo(opening.polar, 3);
  expect(home.azimuth).toBeCloseTo(opening.azimuth, 3);
  expect(home.distance).toBeCloseTo(opening.distance, 1);
});
