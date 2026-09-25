import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Real-layout checks for the renderer sizing contract (#157). jsdom cannot
// measure layout, which is how a 0px-high fixed view went unnoticed.

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

type Mode = "fixed" | "fluid-width" | "fill-container";

async function mount(page: Page, mode: Mode, hostStyle: string, shadowDom = false) {
  const [js, css, fixture] = await Promise.all([
    readFile(rendererJsPath, "utf8"),
    readFile(rendererCssPath, "utf8"),
    readFile(fixturePath, "utf8"),
  ]);
  const definition = JSON.parse(fixture);
  definition.settings.sizingMode = mode;
  await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; }</style></head>
    <body><div id="host" style="${hostStyle}"></div></body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ definition, shadowDom }) => {
    (window as unknown as { map: unknown }).map = (window as unknown as {
      ClickMapRenderer: { create(options: object): unknown };
    }).ClickMapRenderer.create({ container: "#host", definition, shadowDom });
  }, { definition, shadowDom });
}

function viewBox(page: Page) {
  return page.evaluate(() => {
    const host = document.getElementById("host")!;
    const scope = host.shadowRoot ?? document;
    const view = scope.querySelector(".clickmap-view")!.getBoundingClientRect();
    const svg = scope.querySelector(".clickmap-view svg")!.getBoundingClientRect();
    return { width: Math.round(view.width), height: Math.round(view.height), svgHeight: Math.round(svg.height) };
  });
}

async function settle(page: Page) {
  // ResizeObserver work is debounced by the renderer.
  await page.waitForTimeout(80);
}

for (const shadowDom of [false, true]) {
  const dom = shadowDom ? "Shadow DOM" : "light DOM";

  test(`fixed 800x500 scene lays out at canvas size (${dom})`, async ({ page }) => {
    await mount(page, "fixed", "", shadowDom);
    await settle(page);
    expect(await viewBox(page)).toEqual({ width: 800, height: 500, svgHeight: 500 });
  });

  test(`fluid width follows the host width and view aspect (${dom})`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await mount(page, "fluid-width", "width: 320px;", shadowDom);
    await settle(page);
    expect(await viewBox(page)).toMatchObject({ width: 320, height: 200 });

    // Width-only resize of the host (not the window).
    await page.evaluate(() => { document.getElementById("host")!.style.width = "800px"; });
    await settle(page);
    expect(await viewBox(page)).toMatchObject({ width: 800, height: 500 });

    // A portrait view changes the derived height.
    await page.evaluate(() => (window as unknown as { map: { goToView(id: string): void } }).map.goToView("cover"));
    // The view swap happens after the fade transition.
    await expect.poll(() => viewBox(page)).toMatchObject({ width: 800, height: 1280 });
  });

  test(`fill host tracks width and height changes and recovers from display:none (${dom})`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await mount(page, "fill-container", "width: 800px; height: 300px; display: none;", shadowDom);
    await settle(page);

    await page.evaluate(() => { document.getElementById("host")!.style.display = "block"; });
    await settle(page);
    expect(await viewBox(page)).toMatchObject({ width: 800, height: 300 });

    await page.evaluate(() => { document.getElementById("host")!.style.width = "320px"; });
    await settle(page);
    expect(await viewBox(page)).toMatchObject({ width: 320, height: 300 });

    await page.evaluate(() => { document.getElementById("host")!.style.height = "600px"; });
    await settle(page);
    expect(await viewBox(page)).toMatchObject({ width: 320, height: 600 });
  });
}

test("embedded map follows its parent, not the window", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await mount(page, "fluid-width", "width: 50%;");
  await settle(page);
  expect(await viewBox(page)).toMatchObject({ width: 700, height: 438 });
});
