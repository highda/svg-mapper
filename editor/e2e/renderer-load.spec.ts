import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Fetched definitions show loading, then either the map or a visible, path-specific error (#169).

const ORIGIN = "http://load.test";
const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

async function serve(page: Page, mapBody: string, release: Promise<void>) {
  const [js, css] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8")]);
  await page.route(`${ORIGIN}/map.json`, async (route) => {
    await release;
    await route.fulfill({ contentType: "application/json", body: mapBody });
  });
  await page.route(`${ORIGIN}/`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>${css}</style></head><body><div id="map" style="width:600px;height:400px"></div>
      <script>${js}</script><script>
        window.events = [];
        const map = ClickMapRenderer.create({ container: "#map", definitionUrl: "map.json" });
        map.on("error", (e) => window.events.push(e.code + " " + e.message));
        map.on("ready", () => window.events.push("ready"));
      </script></body></html>`,
  }));
}

test("an invalid fetched map shows loading, then an accessible path-specific error", async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  fixture.views[0].canvas.width = -5;
  let release!: () => void;
  await serve(page, JSON.stringify(fixture), new Promise<void>((done) => { release = done; }));
  await page.goto(`${ORIGIN}/`);

  await expect(page.getByRole("status")).toHaveText("Loading map…");
  release();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("$.views[0].canvas.width");
  await expect(alert).toBeVisible();
  await expect(page.locator("#map svg")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual([
    expect.stringMatching(/^INVALID_DEFINITION Invalid map\.json at \$\.views\[0\]\.canvas\.width/),
  ]);
});

test("a valid fetched map replaces the loading state", async ({ page }) => {
  await serve(page, await readFile(fixturePath, "utf8"), Promise.resolve());
  await page.goto(`${ORIGIN}/`);
  await expect(page.locator("#map .clickmap-root svg").first()).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual(["ready"]);
});
