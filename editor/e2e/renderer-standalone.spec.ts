import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { ClickMapDefinition } from "@svg-mapper/shared";
import { EXPECTED_SEMANTIC_ERRORS, REPO_ROOT, exampleMaps } from "../src/test/example-maps";

// Renderer-only conformance (#197): every hand-authored map in examples/ loads
// with nothing but the built renderer (renderer/dist), as a site that never
// touches the builder would use it. No editor code runs in these pages.

const ORIGIN = "http://examples.test";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
// The release ZIP's renderer files, served wherever a page expects them beside it.
const RENDERER_FILES = new Set(["clickmap-renderer.js", "clickmap-renderer.css"]);

interface Probe {
  events: string[];
  map: { getCurrentView(): string };
}

/** Serve the repository's examples/ and renderer/dist/ (read-only) on a fake origin. */
async function serveRepository(page: Page, failed: string[]) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
    const name = path.split("/").pop() ?? "";
    if (path.startsWith("examples/") && RENDERER_FILES.has(name)) path = `renderer/dist/${name}`;
    if (!path.startsWith("examples/") && !path.startsWith("renderer/")) return route.fulfill({ status: 404 });
    try {
      const body = await readFile(join(REPO_ROOT, path));
      await route.fulfill({ body, contentType: TYPES[extname(path)] ?? "application/octet-stream" });
    } catch {
      failed.push(path);
      await route.fulfill({ status: 404 });
    }
  });
}

/** A bare host page: the built renderer plus `create({ definitionUrl, assetBaseUrl })`. */
async function hostPage(page: Page, mapPath: string, assetBase: string) {
  await page.route(`${ORIGIN}/host.html`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head>
      <link rel="stylesheet" href="/renderer/dist/clickmap-renderer.css">
      </head><body style="margin:0"><div id="map" style="width:900px"></div>
      <script src="/renderer/dist/clickmap-renderer.js"></script>
      <script>
        window.events = [];
        window.map = ClickMapRenderer.create({
          container: "#map",
          definitionUrl: ${JSON.stringify(`/${mapPath}`)},
          assetBaseUrl: ${JSON.stringify(`/${assetBase}`)}
        });
        map.on("ready", () => events.push("ready"));
        map.on("error", (e) => events.push(e.code + " " + e.message));
      </script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/host.html`);
}

const events = (page: Page) => page.evaluate(() => (window as unknown as Probe).events);

for (const example of exampleMaps()) {
  const broken = example.path in EXPECTED_SEMANTIC_ERRORS;

  test(`${example.path} renders with only the built renderer`, async ({ page }) => {
    const definition = JSON.parse(example.text) as ClickMapDefinition;
    const failed: string[] = [];
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await serveRepository(page, failed);
    await hostPage(page, example.path, example.assetBase);

    // Ready, on the initial view.
    await expect.poll(() => events(page)).toContain("ready");
    const initial = definition.views.find((view) => view.id === definition.settings.initialViewId)!;
    expect(await page.evaluate(() => (window as unknown as Probe).map.getCurrentView())).toBe(initial.id);
    await expect(page.locator("#map .clickmap-view")).toBeVisible();
    if (initial.background) await expect(page.locator("#map .clickmap-bg-img")).toHaveCount(1);

    // Every area on a visible layer of the initial view is in the DOM.
    const areas = initial.layers.filter((layer) => layer.visible).flatMap((layer) => layer.areas);
    for (const area of areas) {
      await expect(page.locator(`#map [data-area-id="${area.id}"]`).first()).toBeAttached();
    }

    await page.waitForLoadState("networkidle");
    if (broken) return; // Deliberately missing assets: loading must still succeed.
    expect(failed).toEqual([]);
    expect(await events(page)).toEqual(["ready"]);
    expect(consoleErrors).toEqual([]);

    // One authored action works: the first navigation or popup in the initial view.
    const actionable = areas.find((area) =>
      !area.disabled && area.trigger !== "hover" &&
      (area.action.type === "popup" ||
        (area.action.type === "goToView" && definition.views.some((view) => view.id === (area.action as { targetViewId: string }).targetViewId))));
    expect(actionable, "the initial view needs a goToView or popup area").toBeDefined();
    await page.locator(`#map [data-area-id="${actionable!.id}"]`).first().focus();
    await page.keyboard.press("Enter");
    if (actionable!.action.type === "goToView") {
      const target = actionable!.action.targetViewId;
      await expect.poll(() => page.evaluate(() => (window as unknown as Probe).map.getCurrentView())).toBe(target);
    } else if (actionable!.action.type === "popup") {
      const popover = page.locator("#map .clickmap-popover--visible");
      await expect(popover).toBeVisible();
      if (actionable!.action.content.title) await expect(popover).toContainText(actionable!.action.content.title);
    }
    expect(await events(page)).toEqual(["ready"]);
  });
}

test("the guide's minimal page works as written, with the renderer files beside it", async ({ page }) => {
  const failed: string[] = [];
  await serveRepository(page, failed);
  await page.goto(`${ORIGIN}/examples/minimal/index.html`);

  await expect(page.locator("#map-status")).toHaveText("Loaded Minimal office map");
  await page.waitForLoadState("networkidle");
  expect(failed).toEqual([]);
  // The background resolved against map.json's URL and actually loaded.
  const background = page.locator("#office-map .clickmap-bg-img");
  await expect(background).toHaveAttribute("href", `${ORIGIN}/examples/minimal/office.svg`);

  // A real pointer click on the meeting room opens its popup.
  await page.locator('#office-map [data-area-id="area_meeting_room"]').click();
  const popover = page.locator("#office-map .clickmap-popover--visible");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Seats 8. Book it at the front desk.");
  await expect(page.locator("#map-status")).toHaveText("Loaded Minimal office map");
});
