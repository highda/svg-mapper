import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Real-layout checks for overlay anchoring and containment (#159).

const ORIGIN = "http://overlay.test";
const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

const LONG_BODY = Array.from({ length: 30 }, (_, i) => `<p>Detail line ${i + 1} about this place.</p>`).join("");

interface MountOptions {
  hostStyle: string;
  shadowDom?: boolean;
  imageDelayMs?: number;
}

async function mount(page: Page, { hostStyle, shadowDom = false, imageDelayMs }: MountOptions) {
  const [js, css, fixture] = await Promise.all([
    readFile(rendererJsPath, "utf8"),
    readFile(rendererCssPath, "utf8"),
    readFile(fixturePath, "utf8"),
  ]);
  const definition = JSON.parse(fixture);
  definition.settings.sizingMode = "fill-container";
  definition.settings.sceneSwitcher = { enabled: false };
  definition.settings.areaLabels = { enabled: false };
  // Wheel zoom leaves the popover open (a button click counts as an outside click).
  definition.settings.zoomControls = { ...definition.settings.zoomControls, enabled: true, wheelMode: "always" };
  const view = definition.views.find((v: { id: string }) => v.id === "contain");
  view.layers[0].areas.push(
    ...[[0, 0], [760, 0], [0, 460], [760, 460]].map(([x, y], i) => ({
      id: `corner-${i}`, name: `Corner ${i}`,
      geometry: { type: "rect", x, y, width: 40, height: 40 },
      style: view.layers[0].areas[0].style,
      action: { type: "none" },
    })),
  );
  for (const layer of view.layers) {
    for (const area of layer.areas) {
      area.trigger = "click";
      area.action = {
        type: "popup",
        position: "auto",
        content: { title: area.name, body: LONG_BODY, ...(imageDelayMs ? { imageUrl: `${ORIGIN}/slow.svg` } : {}) },
      };
    }
  }

  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/slow.svg") {
      await new Promise((done) => setTimeout(done, imageDelayMs ?? 0));
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="600"><rect width="200" height="600" fill="teal"/></svg>' });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><style>${css} body { margin: 0; padding: 40px; }</style></head>
        <body><div id="host" style="${hostStyle}"></div><script>
        // Count window listeners so tests can prove overlay tracking is removed on close.
        window.__listeners = 0;
        const add = window.addEventListener, remove = window.removeEventListener;
        window.addEventListener = function (type, ...rest) { if (type === "resize" || type === "scroll") window.__listeners++; return add.call(this, type, ...rest); };
        window.removeEventListener = function (type, ...rest) { if (type === "resize" || type === "scroll") window.__listeners--; return remove.call(this, type, ...rest); };
        </script><script>${js}</script></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(({ definition, shadowDom }) => {
    const w = window as unknown as { map: unknown; ClickMapRenderer: { create(o: object): unknown } };
    w.map = w.ClickMapRenderer.create({ container: "#host", definition, shadowDom });
  }, { definition, shadowDom });
  return view.layers.flatMap((layer: { areas: { id: string }[] }) => layer.areas.map((area) => area.id)) as string[];
}

/** Geometry of the open popover relative to the map root and its area. */
function overlayState(page: Page, areaId: string) {
  return page.evaluate((id) => {
    const host = document.getElementById("host")!;
    const scope: Document | ShadowRoot = host.shadowRoot ?? document;
    const root = scope.querySelector(".clickmap-root")!.getBoundingClientRect();
    const popover = scope.querySelector(".clickmap-popover--visible");
    if (!popover) return null;
    const box = popover.getBoundingClientRect();
    const area = scope.querySelector(`[data-area-id="${id}"]`)!.getBoundingClientRect();
    const close = popover.querySelector(".clickmap-popover-close")!;
    const c = close.getBoundingClientRect();
    const hit = scope.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    const gapX = Math.max(0, area.left - box.right, box.left - area.right);
    const gapY = Math.max(0, area.top - box.bottom, box.top - area.bottom);
    return {
      inside: box.left >= root.left - 1 && box.top >= root.top - 1 && box.right <= root.right + 1 && box.bottom <= root.bottom + 1,
      closeReachable: hit === close,
      gap: Math.round(Math.max(gapX, gapY)),
    };
  }, areaId);
}

async function openPopover(page: Page, areaId: string) {
  await page.evaluate((id) => {
    const host = document.getElementById("host")!;
    const scope: Document | ShadowRoot = host.shadowRoot ?? document;
    scope.querySelector(`[data-area-id="${id}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  }, areaId);
  await expect.poll(async () => (await overlayState(page, areaId)) !== null).toBe(true);
}

async function closePopover(page: Page) {
  await page.evaluate(() => {
    const host = document.getElementById("host")!;
    const scope: Document | ShadowRoot = host.shadowRoot ?? document;
    scope.querySelector<HTMLElement>(".clickmap-popover-close")!.click();
  });
}

for (const shadowDom of [false, true]) {
  test(`every shape's popover stays attached and closable at all edges of a 320x240 embed (${shadowDom ? "Shadow" : "light"} DOM)`, async ({ page }) => {
    const ids = await mount(page, { hostStyle: "width: 320px; height: 240px;", shadowDom });
    expect(ids).toEqual(expect.arrayContaining(["circle-popup", "polygon-event", "path-url", "marker-none", "corner-0", "corner-3"]));
    for (const id of ids) {
      await openPopover(page, id);
      await expect.poll(() => overlayState(page, id), { message: id }).toEqual({ inside: true, closeReachable: true, gap: expect.any(Number) });
      expect((await overlayState(page, id))!.gap, `${id} stays attached`).toBeLessThanOrEqual(10);
      await closePopover(page);
    }
  });
}

test("an open popover follows zoom, pan and host-only resize", async ({ page }) => {
  await mount(page, { hostStyle: "width: 800px; height: 500px;" });
  await openPopover(page, "circle-popup");
  const attached = async () => {
    const state = await overlayState(page, "circle-popup");
    return state && state.inside && state.gap <= 10;
  };
  await expect.poll(attached).toBe(true);

  // Zoom about a point away from the circle, which also pans it across the map.
  await page.mouse.move(40 + 600, 40 + 300);
  for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -120);
  await expect.poll(attached).toBe(true);
  const moved = await page.evaluate(() => document.querySelector('[data-area-id="circle-popup"]')!.getBoundingClientRect().left);
  expect(moved).toBeLessThan(40 + 300 - 58);

  await page.evaluate(() => { document.getElementById("host")!.style.width = "420px"; });
  await expect.poll(attached).toBe(true);
  await page.evaluate(() => { document.getElementById("host")!.style.height = "260px"; });
  await expect.poll(attached).toBe(true);
});

test("a late-loading image does not misplace or clip the popover", async ({ page }) => {
  await mount(page, { hostStyle: "width: 360px; height: 300px;", imageDelayMs: 400 });
  await openPopover(page, "corner-3");
  await page.waitForTimeout(700);
  await expect.poll(() => overlayState(page, "corner-3")).toMatchObject({ inside: true, closeReachable: true });
});

test("overlay tracking listeners exist only while a popover is open", async ({ page }) => {
  await mount(page, { hostStyle: "width: 800px; height: 500px;" });
  const baseline = await page.evaluate(() => (window as unknown as { __listeners: number }).__listeners);
  await openPopover(page, "circle-popup");
  expect(await page.evaluate(() => (window as unknown as { __listeners: number }).__listeners)).toBeGreaterThan(baseline);
  await closePopover(page);
  expect(await page.evaluate(() => (window as unknown as { __listeners: number }).__listeners)).toBe(baseline);

  await openPopover(page, "circle-popup");
  await page.evaluate(() => (window as unknown as { map: { destroy(): void } }).map.destroy());
  expect(await page.evaluate(() => (window as unknown as { __listeners: number }).__listeners)).toBeLessThanOrEqual(baseline);
});
