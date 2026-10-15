import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (`pnpm build` first), served
 * for the ts-express-api fixture as a local repository. WebGL runs through
 * SwiftShader so the 3D city renders headlessly.
 */
const PORT = 4610;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    // Headless WebGL (SwiftShader) is slow; reduced motion makes the city assemble immediately.
    reducedMotion: "reduce",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/workspace/status`,
    env: { CODESCAPE_ROOT: "test/fixtures/ts-express-api" },
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
