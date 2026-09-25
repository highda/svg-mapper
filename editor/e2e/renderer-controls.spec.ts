import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Visitor controls adapt to the renderer's own size and never cover each other (#160).

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

async function mount(page: Page, hostStyle: string, { shadowDom = false } = {}) {
  const [js, css, fixture] = await Promise.all([
    readFile(rendererJsPath, "utf8"),
    readFile(rendererCssPath, "utf8"),
    readFile(fixturePath, "utf8"),
  ]);
  const definition = JSON.parse(fixture);
  const base = definition.views.find((v: { id: string }) => v.id === "contain");
  // 20 views with long names, every one with Back enabled.
  definition.views = Array.from({ length: 20 }, (_, i) => ({
    ...structuredClone(base),
    id: i === 0 ? "contain" : `view-${i}`,
    slug: i === 0 ? "contain" : `view-${i}`,
    name: `Building ${i + 1} — North Campus Research and Teaching Complex`,
    ui: { ...base.ui, showBackButton: true },
  }));
  definition.settings.initialViewId = "contain";
  definition.settings.sizingMode = "fill-container";
  definition.settings.sceneSwitcher = { enabled: true, position: "bottom-center", style: "buttons" };
  definition.settings.zoomControls = { enabled: true, position: "top-right" };
  definition.settings.directory = { enabled: true };
  definition.settings.areaLabels = { enabled: false };

  await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; }</style></head>
    <body><div id="host" style="${hostStyle}"></div></body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ definition, shadowDom }) => {
    const w = window as unknown as { map: { goToView(id: string): void }; ClickMapRenderer: { create(o: object): { goToView(id: string): void } } };
    w.map = w.ClickMapRenderer.create({
      container: "#host",
      definition,
      shadowDom,
      choropleth: { data: [{ id: "circle-popup", value: 1 }, { id: "rect-view", value: 9 }], colorLow: "#dbeafe", colorHigh: "#1d4ed8", legend: true },
    });
    // Navigate once so the Back button is present.
    w.map.goToView("view-1");
  }, { definition, shadowDom });
  await page.waitForTimeout(400);
}

/** Boxes of every visible visitor control, relative to the renderer root. */
function controlBoxes(page: Page) {
  return page.evaluate(() => {
    const host = document.getElementById("host")!;
    const scope: Document | ShadowRoot = host.shadowRoot ?? document;
    const root = scope.querySelector(".clickmap-root")!.getBoundingClientRect();
    const selectors = [".clickmap-back-btn", ".clickmap-directory", ".clickmap-directory-toggle", ".clickmap-scene-switcher", ".clickmap-zoom-controls", ".clickmap-legend"];
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const selector of selectors) {
      const el = scope.querySelector<HTMLElement>(selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).display === "none") continue;
      boxes[selector] = { x: Math.round(r.left - root.left), y: Math.round(r.top - root.top), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return { root: { w: Math.round(root.width), h: Math.round(root.height) }, boxes, compact: scope.querySelector(".clickmap-root")!.classList.contains("clickmap-root--compact") };
  });
}

function expectNoOverlap(result: Awaited<ReturnType<typeof controlBoxes>>) {
  const entries = Object.entries(result.boxes);
  for (const [name, b] of entries) {
    expect(b.x, `${name} inside left`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${name} inside top`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `${name} inside right`).toBeLessThanOrEqual(result.root.w);
    expect(b.y + b.h, `${name} inside bottom`).toBeLessThanOrEqual(result.root.h);
  }
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [an, a] = entries[i]!;
      const [bn, b] = entries[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${an} overlaps ${bn}`).toBe(false);
    }
  }
}

for (const [width, height] of [[320, 240], [360, 640], [900, 600]] as const) {
  for (const shadowDom of [false, true]) {
    test(`controls coexist without covering each other at ${width}x${height} (${shadowDom ? "Shadow" : "light"} DOM)`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mount(page, `width: ${width}px; height: ${height}px;`, { shadowDom });
      const result = await controlBoxes(page);
      expect(result.compact).toBe(width < 560 || height < 360);
      const expected = [".clickmap-back-btn", ".clickmap-scene-switcher", ".clickmap-zoom-controls", ".clickmap-legend", result.compact ? ".clickmap-directory-toggle" : ".clickmap-directory"];
      expect(Object.keys(result.boxes).sort()).toEqual(expected.sort());
      expectNoOverlap(result);
      if (!result.compact) {
        // The active view's button is scrolled into sight within the switcher.
        const visible = await page.evaluate(() => {
          const host = document.getElementById("host")!;
          const scope: Document | ShadowRoot = host.shadowRoot ?? document;
          const bar = scope.querySelector(".clickmap-scene-switcher")!.getBoundingClientRect();
          const active = scope.querySelector(".clickmap-scene-btn--active")!.getBoundingClientRect();
          return active.left >= bar.left - 1 && active.right <= bar.right + 1;
        });
        expect(visible).toBe(true);
      }
    });
  }
}

test("a 400px embed on a wide page lays out like a 400px embed on a narrow page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, "width: 400px; height: 600px;");
  const wide = await controlBoxes(page);
  await page.setViewportSize({ width: 400, height: 900 });
  await mount(page, "width: 400px; height: 600px;");
  const narrow = await controlBoxes(page);
  expect(wide.compact).toBe(true);
  expect(narrow).toEqual(wide);
});

test("the compact directory opens and closes by pointer and keyboard and returns focus", async ({ page }) => {
  await mount(page, "width: 360px; height: 640px;");
  const toggle = page.getByRole("button", { name: "Find a place" });
  const search = page.getByRole("searchbox", { name: "Search places" });

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(search).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await expect(search).toBeVisible();
  await page.getByRole("button", { name: "Close place directory" }).click();
  await expect(search).toBeHidden();
  await expect(toggle).toBeFocused();

  // Choosing a result closes the panel and shows the place; the map stays usable.
  await toggle.click();
  await search.fill("Circle");
  await page.locator(".clickmap-directory-result").first().click();
  await expect(search).toBeHidden();
  await expect(page.locator('.clickmap-area[data-area-id="circle-popup"]')).toBeVisible();
  await page.locator('[data-area-id="circle-popup"]').dispatchEvent("click");
  await expect(page.locator(".clickmap-popover--visible")).toBeVisible();
});
