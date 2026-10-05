import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { downloadPackage, openProjectFile, staticServer } from "./support/browser-evidence";

// Details panel and modal presentations (#220): container-aware layout,
// selection, keyboard and focus, in light and Shadow DOM, Preview and export.

const ORIGIN = "http://details.test";
const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

type Box = { x: number; y: number; width: number; height: number };

/** The fixture with a details panel default and a second popup on the marker. */
async function detailsFixture(details: Record<string, unknown>) {
  const definition = JSON.parse(await readFile(fixturePath, "utf8"));
  definition.settings.details = details;
  const areas = definition.views[0].layers[0].areas;
  const marker = areas.find((area: { id: string }) => area.id === "marker-none");
  marker.action = { type: "popup", content: { title: "Marker details", body: "<p>A pinned place.</p>" } };
  return definition;
}

async function mount(page: Page, definition: unknown, hostStyle: string, shadowDom: boolean) {
  const [js, css] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8")]);
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>${css} body { margin: 0; padding: 20px; }</style></head>
      <body><button id="before">Host button</button><div id="host" style="${hostStyle}"></div><script>${js}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(({ definition, shadowDom }) => {
    const w = window as unknown as { map: unknown; ClickMapRenderer: { create(o: object): unknown } };
    w.map = w.ClickMapRenderer.create({ container: "#host", definition, shadowDom });
  }, { definition, shadowDom });
}

/** Boxes of the renderer parts, piercing the shadow root when there is one. */
function layout(page: Page) {
  return page.evaluate(() => {
    const host = document.getElementById("host")!;
    const scope: Document | ShadowRoot = host.shadowRoot ?? document;
    const box = (selector: string) => {
      const el = scope.querySelector(selector);
      if (!el || (el as HTMLElement).hidden) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      root: box(".clickmap-root")!,
      view: box(".clickmap-view")!,
      panel: box(".clickmap-details"),
      controls: box(".clickmap-controls")!,
      sheet: scope.querySelector(".clickmap-root")!.classList.contains("clickmap-root--sheet"),
    };
  });
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function focusedLabel(page: Page) {
  return page.evaluate(() => {
    const host = document.getElementById("host")!;
    const active = (host.shadowRoot ?? document).activeElement;
    return active?.getAttribute("aria-label") ?? active?.className.toString() ?? null;
  });
}

for (const shadowDom of [false, true]) {
  const dom = shadowDom ? "Shadow DOM" : "light DOM";

  test(`a wide host docks the panel; a 360px host turns it into a bottom sheet (${dom})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const definition = await detailsFixture({
      presentation: "panel",
      side: "right",
      size: "320px",
      defaultContent: { title: "Explore the gallery", body: "<p>Choose a shape in {{viewName}}.</p>" },
    });
    definition.settings.sizingMode = "fill-container";
    await mount(page, definition, "width: 960px; height: 480px", shadowDom);

    const region = page.getByRole("region", { name: "Explore the gallery" });
    await expect(region).toContainText("Choose a shape in Contain / all interactions.");
    let boxes = await layout(page);
    expect(boxes.sheet).toBe(false);
    expect(boxes.panel).toEqual({ x: boxes.root.x + 640, y: boxes.root.y, width: 320, height: 480 });
    expect(boxes.view.width).toBe(640);
    expect(overlaps(boxes.controls, boxes.panel!)).toBe(false);

    // Keyboard: Enter shows the area's details in the panel; focus stays on the map.
    const trigger = page.getByRole("button", { name: "Open test popup" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("region", { name: "Sanitised popup" });
    await expect(details).toContainText("Escape closes this.");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Selecting another area swaps the content without closing the panel.
    await page.getByRole("button", { name: "Inert marker" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Marker details" })).toContainText("A pinned place.");
    await expect(trigger).not.toHaveAttribute("aria-current");

    // Escape clears the selection and brings the default content back.
    await page.keyboard.press("Escape");
    await expect(region).toBeVisible();
    await expect(page.getByRole("button", { name: "Inert marker" })).not.toHaveAttribute("aria-current");

    // Narrow host on the same wide page: a bottom sheet over the map.
    await page.evaluate(() => { document.getElementById("host")!.style.width = "360px"; });
    await expect.poll(async () => (await layout(page)).sheet).toBe(true);
    await trigger.click();
    await expect(details).toBeVisible();
    boxes = await layout(page);
    expect(boxes.panel!.width).toBe(360);
    expect(boxes.panel!.y + boxes.panel!.height).toBe(boxes.root.y + boxes.root.height);
    expect(boxes.panel!.height).toBeLessThanOrEqual(240);
    expect(boxes.controls.y + boxes.controls.height).toBeLessThanOrEqual(boxes.panel!.y);

    // Close returns focus to the trigger and clears its selection.
    await details.getByRole("button", { name: "Close" }).click();
    await expect(trigger).toBeFocused();
    await expect(trigger).not.toHaveAttribute("aria-current");
    await expect(region).toBeVisible();
  });

  test(`a fluid-width map keeps its height beside the panel and stacks the sheet below (${dom})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const definition = await detailsFixture({ presentation: "panel", side: "left", size: 0.25, defaultContent: { title: "Explore" } });
    definition.settings.sizingMode = "fluid-width";
    await mount(page, definition, "width: 1000px", shadowDom);

    await expect(page.getByRole("region", { name: "Explore" })).toBeVisible();
    let boxes = await layout(page);
    expect(boxes.panel).toMatchObject({ x: boxes.root.x, width: 250, height: boxes.root.height });
    expect(boxes.view).toMatchObject({ x: boxes.root.x + 250, width: 750, height: Math.round(750 * 500 / 800) });
    expect(boxes.root.height).toBe(boxes.view.height);

    await page.evaluate(() => { document.getElementById("host")!.style.width = "360px"; });
    await expect.poll(async () => (await layout(page)).sheet).toBe(true);
    boxes = await layout(page);
    expect(boxes.view.height).toBe(225);
    expect(boxes.panel!.y).toBeGreaterThanOrEqual(boxes.view.y + boxes.view.height);
    expect(boxes.root.height).toBe(boxes.view.height + boxes.panel!.height);
  });

  test(`a modal traps focus, makes the page inert and restores its trigger (${dom})`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    const definition = await detailsFixture({ presentation: "modal" });
    definition.settings.sizingMode = "fill-container";
    await mount(page, definition, "width: 640px; height: 400px", shadowDom);

    const trigger = page.getByRole("button", { name: "Open test popup" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Sanitised popup" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => focusedLabel(page)).toBe("Close");
    await expect(dialog).toHaveJSProperty("open", true);

    // Everything outside the dialog is inert, the host page included.
    await page.evaluate(() => document.getElementById("before")!.focus());
    await expect.poll(() => focusedLabel(page)).toBe("Close");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("#before")).not.toBeFocused();
    await expect(trigger).not.toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).not.toHaveAttribute("aria-current");

    // A click on the backdrop closes it too.
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
  });
}

test("Preview reflects the Inspector's panel and modal choices and the map host size", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Campus places/ }).click();

  await page.getByLabel("Show popups as").selectOption("panel");
  await page.getByLabel("Default title").fill("Explore the campus");
  await page.getByLabel("Default title").press("Tab");

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Last event:")).toContainText("ready");
  const frame = page.frameLocator('iframe[title="Map preview"]');
  const rootClass = () => frame.locator(".clickmap-root").getAttribute("class");
  await page.getByRole("button", { name: "1200", exact: true }).click();
  await page.getByLabel("Map host width in pixels").fill("900");
  await page.getByLabel("Map host width in pixels").press("Enter");
  await expect(frame.getByRole("region", { name: "Explore the campus" })).toBeVisible();
  await expect.poll(rootClass).not.toContain("clickmap-root--sheet");
  const services = frame.locator('[data-area-id="area-campus-0-b"]');
  await services.click();
  await expect(frame.getByRole("region", { name: "Visitor details" })).toContainText("Wheelchair accessible");
  await expect(page.getByText("Last event:")).toContainText("popup:open");

  // A 360px host on the same page: the open details move into the sheet.
  await page.getByLabel("Map host width in pixels").fill("360");
  await page.getByLabel("Map host width in pixels").press("Enter");
  await expect.poll(rootClass).toContain("clickmap-root--sheet");
  await expect(frame.getByRole("region", { name: "Visitor details" })).toBeVisible();

  // A per-area choice overrides the project default.
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const row = page.getByRole("treeitem", { name: /Accessible services/ }).first();
  await row.getByText("Accessible services", { exact: true }).click();
  await page.getByLabel("Show as").selectOption("modal");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await services.click();
  await expect(frame.getByRole("dialog", { name: "Visitor details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(frame.getByRole("dialog")).toHaveCount(0);
});

test("an exported page docks the panel in a wide host and shows a sheet in a 360px host", async ({ page }, testInfo) => {
  const outputDir = testInfo.outputPath("export");
  await mkdir(outputDir, { recursive: true });
  const upload = join(outputDir, "details.json");
  const definition = await detailsFixture({ presentation: "panel", defaultContent: { title: "Explore the gallery" } });
  await writeFile(upload, JSON.stringify(definition));
  await page.goto("/");
  await openProjectFile(page, upload, "QA");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel(/Map sizing/).selectOption("fluid-width");
  await page.getByLabel("Upload base path").fill("/maps/qa");
  const { text } = await downloadPackage(page, join(outputDir, "maps", "qa"));
  const snippet = text("embed.html");

  await mkdir(join(outputDir, "site"), { recursive: true });
  await writeFile(join(outputDir, "site", "index.html"), `<!doctype html><html><head><meta charset="utf-8">
    <style>body { margin: 0; } .column { width: 360px; } .wide { width: 1000px; }</style></head>
    <body><div class="column">${snippet}</div><div class="wide"><div id="wide"></div></div>
    <script>window.wide = ClickMapRenderer.create({ container: "#wide", definitionUrl: "/maps/qa/map.json", shadowDom: true });</script>
    </body></html>`);
  const hosted = await staticServer(outputDir);
  const failures: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && !/favicon/.test(message.location().url)) failures.push(message.text()); });
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`${hosted.url}/site/`);
    const narrow = page.locator("#clickmap");
    const wide = page.locator("#wide");
    await expect(narrow.getByRole("region", { name: "Explore the gallery" })).toBeVisible();
    await expect(wide.getByRole("region", { name: "Explore the gallery" })).toBeVisible();
    await expect(narrow.locator(".clickmap-root")).toHaveClass(/clickmap-root--sheet/);
    await expect(wide.locator(".clickmap-root")).not.toHaveClass(/clickmap-root--sheet/);

    for (const map of [narrow, wide]) {
      await map.getByRole("button", { name: "Open test popup" }).click();
      await expect(map.getByRole("region", { name: "Sanitised popup" })).toContainText("Escape closes this.");
    }
    const geometry = await page.evaluate(() => {
      const boxOf = (scope: ParentNode, selector: string) => scope.querySelector(selector)!.getBoundingClientRect();
      const shadow = document.getElementById("wide")!.shadowRoot!;
      const narrowHost = document.getElementById("clickmap")!;
      return {
        widePanelBeside: boxOf(shadow, ".clickmap-details").left >= boxOf(shadow, ".clickmap-view").right - 1,
        narrowSheetBelow: boxOf(narrowHost, ".clickmap-details").top >= boxOf(narrowHost, ".clickmap-view").bottom - 1,
        pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry).toEqual({ widePanelBeside: true, narrowSheetBelow: true, pageOverflowX: 0 });
    expect(failures).toEqual([]);
  } finally {
    await hosted.close();
  }
});
