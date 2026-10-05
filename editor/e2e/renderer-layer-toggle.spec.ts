import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Layer toggles keep the visitor's camera and focus; directory reveals follow
// the real navigation lifecycle (#173). Activated areas stay selected and show
// their active style until a documented trigger clears them (#214).

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

const style = (fill: string) => ({
  default: { fill, stroke: "#1d4ed8", strokeWidth: 2 },
  hover: { fill: "#93c5fd", stroke: "#1e3a8a", strokeWidth: 3 },
  active: { fill: "#dc2626", stroke: "#7f1d1d", strokeWidth: 5 },
});

function area(id: string, name: string, x: number, action: object = { type: "none" }) {
  return {
    id, name, geometry: { type: "rect", x, y: 200, width: 80, height: 60 },
    style: style("#bfdbfe"), action, accessibility: { ariaLabel: name, tabIndex: 0 },
  };
}

async function mount(page: Page, shadowDom: boolean) {
  const [js, css, fixture] = await Promise.all([
    readFile(rendererJsPath, "utf8"),
    readFile(rendererCssPath, "utf8"),
    readFile(fixturePath, "utf8"),
  ]);
  const definition = JSON.parse(fixture);
  const base = definition.views.find((v: { id: string }) => v.id === "contain");
  const view = (id: string, layers: object[]) => { const v = { ...structuredClone(base), id, slug: id, name: id, layers }; delete v.background; return v; };
  definition.views = [
    view("main", [
      { id: "base", name: "Base", visible: true, locked: false, opacity: 1, areas: [
        area("toggle-overlay", "Toggle overlay", 40, { type: "toggleLayer", targetLayerId: "overlay" }),
      ] },
      { id: "overlay", name: "Overlay", visible: false, locked: false, opacity: 1, areas: [
        area("hide-self", "Hide overlay", 200, { type: "toggleLayer", targetLayerId: "overlay" }),
      ] },
      { id: "top", name: "Top", visible: true, locked: false, opacity: 1, areas: [area("cafe", "Cafe", 360)] },
    ]),
    view("north", [{ id: "n", name: "N", visible: true, locked: false, opacity: 1, areas: [area("north-gate", "North gate", 600)] }]),
    view("south", [{ id: "s", name: "S", visible: true, locked: false, opacity: 1, areas: [area("south-gate", "South gate", 100)] }]),
  ];
  definition.settings.initialViewId = "main";
  definition.settings.sizingMode = "fixed";
  definition.settings.zoomControls = { enabled: true, position: "top-right" };
  definition.settings.directory = { enabled: true };
  definition.settings.areaLabels = { enabled: true, hideWhenSmaller: false };
  delete definition.settings.sceneSwitcher;
  definition.settings.enableHistory = false;

  await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; }</style></head>
    <body><div id="host"></div></body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ definition, shadowDom }) => {
    const w = window as unknown as { map: object; reveals: string[]; selections: Array<string | null>; ClickMapRenderer: { create(o: object): { on(t: string, cb: (e: { reason: string; viewId: string; areaId: string | null }) => void): void } } };
    w.reveals = [];
    w.selections = [];
    const map = w.ClickMapRenderer.create({ container: "#host", definition, shadowDom });
    map.on("camera:change", (e) => { if (e.reason === "reveal") w.reveals.push(e.viewId); });
    map.on("area:select", (e) => w.selections.push(e.areaId));
    w.map = map;
  }, { definition, shadowDom });
}

const scope = `(document.getElementById("host").shadowRoot ?? document)`;
const viewBox = (page: Page) => page.evaluate(`${scope}.querySelector(".clickmap-areas").getAttribute("viewBox")`);
const focusedArea = (page: Page) => page.evaluate(`${scope}.activeElement?.getAttribute("data-area-id") ?? null`);
const fillOf = (page: Page, id: string) => page.evaluate(`${scope}.querySelector('[data-area-id="${id}"]')?.getAttribute("fill") ?? null`);
const selectedArea = (page: Page) => page.evaluate(`${scope}.querySelector('[aria-current="true"]')?.getAttribute("data-area-id") ?? null`);
const labelIds = (page: Page) => page.evaluate(`Array.from(${scope}.querySelectorAll("[data-label-area]")).map((el) => el.getAttribute("data-label-area"))`);
const directoryText = (page: Page) => page.evaluate(`${scope}.querySelector(".clickmap-directory-results").textContent`);

for (const shadowDom of [false, true]) {
  test.describe(shadowDom ? "shadow DOM" : "light DOM", () => {
    test("layer toggle keeps camera, focus, labels and directory in step", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page, shadowDom);
      await page.locator(".clickmap-zoom-in").click();
      await page.locator(".clickmap-zoom-in").click();
      const zoomed = await viewBox(page);
      expect(zoomed).not.toBe("0 0 800 500");

      await page.locator('[data-area-id="toggle-overlay"]').focus();
      await page.keyboard.press("Enter");
      expect(await viewBox(page)).toBe(zoomed);
      expect(await focusedArea(page)).toBe("toggle-overlay");
      expect(await labelIds(page)).toEqual(["toggle-overlay", "hide-self", "cafe"]);
      expect(await directoryText(page)).toContain("Hide overlay");

      // The focused trigger hides its own layer: focus moves to the next area.
      await page.locator('[data-area-id="hide-self"]').focus();
      await page.keyboard.press("Enter");
      expect(await viewBox(page)).toBe(zoomed);
      expect(await focusedArea(page)).toBe("cafe");
      expect(await labelIds(page)).toEqual(["toggle-overlay", "cafe"]);
      expect(await directoryText(page)).not.toContain("Hide overlay");
      expect(errors).toEqual([]);
    });

    test("activated areas stay selected until Escape, empty space or a view change", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page, shadowDom);
      const cafe = page.locator('[data-area-id="cafe"]');
      const box = (await cafe.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      expect(await fillOf(page, "cafe")).toBe("#93c5fd");
      await page.mouse.down();
      // No transient pressed state: selection happens on activation.
      expect(await fillOf(page, "cafe")).toBe("#93c5fd");
      await page.mouse.up();
      expect(await fillOf(page, "cafe")).toBe("#dc2626");
      expect(await selectedArea(page)).toBe("cafe");

      // Hovering another area keeps the selection painted; hover over it keeps active.
      await page.locator('[data-area-id="toggle-overlay"]').hover();
      expect(await fillOf(page, "toggle-overlay")).toBe("#93c5fd");
      expect(await fillOf(page, "cafe")).toBe("#dc2626");
      await page.mouse.move(0, 0);
      expect(await fillOf(page, "cafe")).toBe("#dc2626");

      // Escape clears; the still-focused area falls back to its focus (hover) style.
      await page.keyboard.press("Escape");
      expect(await selectedArea(page)).toBeNull();
      expect(await fillOf(page, "cafe")).toBe("#93c5fd");

      // Keyboard activation selects and survives focus moving on.
      await cafe.focus();
      await page.keyboard.press("Enter");
      expect(await fillOf(page, "cafe")).toBe("#dc2626");
      await page.keyboard.press("Tab");
      expect(await selectedArea(page)).toBe("cafe");
      expect(await fillOf(page, "cafe")).toBe("#dc2626");

      // Activating empty map space clears.
      const svg = (await page.locator(".clickmap-areas").boundingBox())!;
      await page.mouse.click(svg.x + svg.width * 0.95, svg.y + svg.height * 0.9);
      expect(await selectedArea(page)).toBeNull();
      expect(await fillOf(page, "cafe")).toBe("#bfdbfe");

      // Leaving the view clears; coming back via Back does not restore it.
      await page.evaluate(`window.map.select("cafe")`);
      expect(await fillOf(page, "cafe")).toBe("#dc2626");
      await page.evaluate(`window.map.goToView("north")`);
      await expect.poll(() => page.evaluate("window.map.getCurrentView()")).toBe("north");
      await page.evaluate(`window.map.goBack()`);
      await expect.poll(() => fillOf(page, "cafe")).toBe("#bfdbfe");
      expect(await selectedArea(page)).toBeNull();
      expect(await page.evaluate("window.selections")).toEqual(["cafe", null, "cafe", null, "cafe", null]);
      expect(errors).toEqual([]);
    });

    test("rapid cross-view directory choices reveal only the final result", async ({ page }) => {
      await mount(page, shadowDom);
      // Both choices land within one task, inside the 150 ms fade: two
      // separate Playwright clicks can straddle it and legitimately reveal north.
      await page.evaluate(`(() => {
        const results = Array.from(${scope}.querySelectorAll(".clickmap-directory-result"));
        for (const name of ["North gate", "South gate"]) results.find((el) => el.textContent.includes(name)).click();
      })()`);
      await expect.poll(() => focusedArea(page)).toBe("south-gate");
      await page.waitForTimeout(400);
      expect(await page.evaluate("window.reveals")).toEqual(["south"]);
      expect(await page.evaluate("window.map.getCurrentView()")).toBe("south");
      expect(await selectedArea(page)).toBe("south-gate");
      expect(await fillOf(page, "south-gate")).toBe("#dc2626");
    });
  });
}
