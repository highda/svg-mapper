import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";

// Real-browser checks that alpha-masked image regions are hit exactly where
// their opaque pixels are displayed (fit, crop, rotation, host size, zoom),
// that transparent pixels reach the area beneath, and that hidden images
// leave nothing behind (#172).

const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

const SIZE = 40;
/** Opaque red except a transparent top-right quadrant and a hole in the bottom-left quadrant. */
function alphaAt(x: number, y: number): number {
  if (x >= 20 && y < 20) return 0;
  if (x >= 6 && x < 14 && y >= 26 && y < 34) return 0;
  return 255;
}

function pngDataUri(): string {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 4 + 1);
    for (let x = 0; x < SIZE; x++) raw.set([255, 0, 0, alphaAt(x, y)], row + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** The mask the editor would generate: one bit per pixel, row-major, LSB first. */
function maskData(): string {
  const bytes = new Uint8Array(Math.ceil((SIZE * SIZE) / 8));
  for (let i = 0; i < SIZE * SIZE; i++) if (alphaAt(i % SIZE, Math.floor(i / SIZE)) >= 128) bytes[i >> 3] |= 1 << (i & 7);
  return Buffer.from(bytes).toString("base64");
}

const CLEAR = { fill: "rgba(0,0,0,0)", stroke: "none", strokeWidth: 0 };
const style = { default: CLEAR, hover: CLEAR, active: CLEAR };

interface Scene {
  fit: "fill" | "contain" | "cover";
  rotation: number;
  rect: { x: number; y: number; width: number; height: number };
  visible?: boolean;
}

function definition(scene: Scene) {
  return {
    schemaVersion: "1.0.0",
    project: { id: "image-hits", name: "Image hits", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" },
    settings: {
      initialViewId: "main",
      responsive: true, maintainAspectRatio: true, theme: "default",
      enableHistory: false, enableKeyboardNavigation: true,
      sizingMode: "fill-container",
      areaLabels: { enabled: false },
      zoomControls: { enabled: true, position: "bottom-right" },
    },
    assets: [{ id: "statue-png", type: "image/png", name: "statue.png", src: pngDataUri(), width: SIZE, height: SIZE, inline: true }],
    views: [{
      id: "main", name: "Main", slug: "main", canvas: { width: 400, height: 300 },
      viewport: { minZoom: 1, maxZoom: 4, initialZoom: 1, panEnabled: true, zoomEnabled: true },
      ui: { showBackButton: false, showBreadcrumbs: false, showTitle: false },
      layers: [
        { id: "ground", name: "Ground", visible: true, locked: false, opacity: 1, areas: [
          { id: "under", name: "Under", geometry: { type: "rect", x: 20, y: 20, width: 360, height: 260 }, style, action: { type: "customEvent", eventName: "under" } },
        ] },
        { id: "objects", name: "Objects", visible: true, locked: false, opacity: 1, areas: [
          {
            id: "statue", name: "Statue", geometry: { type: "rect", ...scene.rect }, style,
            action: { type: "customEvent", eventName: "statue" },
            image: {
              assetId: "statue-png", fit: scene.fit, rotation: scene.rotation, visible: scene.visible ?? true,
              hitMask: { mode: "alpha", assetId: "statue-png", threshold: 0.5, width: SIZE, height: SIZE, data: maskData() },
            },
          },
        ] },
      ],
    }],
    popups: [], sharedStyles: {}, customEvents: ["under", "statue"],
  };
}

async function mount(page: Page, scene: Scene, hostStyle: string, shadowDom = false) {
  const [js, css] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8")]);
  await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; padding: 20px; background: #fff; }</style></head>
    <body><div id="host" style="${hostStyle}"></div></body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ definition, shadowDom }) => {
    const w = window as unknown as {
      map: { on(type: string, cb: (e: { areaId: string }) => void): void };
      ClickMapRenderer: { create(o: object): unknown };
      __last: string | null; __clicks: (string | null)[]; __hovers: string[];
    };
    w.__last = null;
    w.__clicks = [];
    w.__hovers = [];
    w.map = w.ClickMapRenderer.create({ container: "#host", definition, shadowDom }) as typeof w.map;
    w.map.on("area:click", (e) => { w.__last = e.areaId; });
    w.map.on("area:hover", (e) => { w.__hovers.push(e.areaId); });
    // The renderer's SVG listener runs first, so this records one result per click.
    document.addEventListener("click", () => { w.__clicks.push(w.__last); w.__last = null; });
  }, { definition: definition(scene), shadowDom });
  await page.waitForFunction(() => {
    const host = document.getElementById("host")!;
    const image = (host.shadowRoot ?? document).querySelector<SVGImageElement>(".clickmap-area-image");
    return !image || image.getBoundingClientRect().width > 0;
  });
  await page.waitForTimeout(150);
}

type Klass = "opaque" | "clear" | "edge";

/** Classify displayed pixels from a real screenshot, skipping anti-aliased edges. */
async function sampleGrid(page: Page, steps = 11) {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async ({ shot, steps }) => {
    const host = document.getElementById("host")!;
    const scope = host.shadowRoot ?? document;
    const image = scope.querySelector(".clickmap-area-image")!.getBoundingClientRect();
    const under = scope.querySelector('[data-area-id="under"]')!.getBoundingClientRect();
    const svg = scope.querySelector(".clickmap-view svg")!;
    const view = svg.getBoundingClientRect();
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${shot}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const kind = (x: number, y: number): "opaque" | "clear" | "edge" => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      if (r! > 200 && g! < 90 && b! < 90) return "opaque";
      if (r! > 235 && g! > 235 && b! > 235) return "clear";
      return "edge";
    };
    const points: { x: number; y: number; klass: "opaque" | "clear" | "edge"; inUnder: boolean }[] = [];
    const left = Math.max(view.left + 2, image.left - 8);
    const right = Math.min(view.right - 2, image.right + 8);
    const top = Math.max(view.top + 2, image.top - 8);
    const bottom = Math.min(view.bottom - 2, image.bottom + 8);
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const x = Math.round(left + ((right - left) * (i + 0.5)) / steps);
        const y = Math.round(top + ((bottom - top) * (j + 0.5)) / steps);
        let klass = kind(x, y);
        // Mask cells are coarser than screen pixels near edges; only judge uniform neighbourhoods.
        for (let dx = -4; dx <= 4 && klass !== "edge"; dx += 2) {
          for (let dy = -4; dy <= 4 && klass !== "edge"; dy += 2) if (kind(x + dx, y + dy) !== klass) klass = "edge";
        }
        // Map controls overlay the scene; points on them are not scene hits.
        if (!svg.contains(scope.elementFromPoint(x, y))) continue;
        const inUnder = x > under.left + 2 && x < under.right - 2 && y > under.top + 2 && y < under.bottom - 2;
        points.push({ x, y, klass, inUnder });
      }
    }
    return points;
  }, { shot, steps }) as Promise<{ x: number; y: number; klass: Klass; inUnder: boolean }[]>;
}

async function expectHitsMatchPixels(page: Page) {
  const points = (await sampleGrid(page)).filter((point) => point.klass !== "edge");
  expect(points.filter((p) => p.klass === "opaque").length).toBeGreaterThan(8);
  expect(points.filter((p) => p.klass === "clear" && p.inUnder).length).toBeGreaterThan(8);
  await page.evaluate(() => { (window as unknown as { __clicks: unknown[] }).__clicks = []; });
  for (const point of points) await page.mouse.click(point.x, point.y);
  const clicks = await page.evaluate(() => (window as unknown as { __clicks: (string | null)[] }).__clicks.splice(0));
  const mismatches = points
    .map((point, i) => ({ ...point, expected: point.klass === "opaque" ? "statue" : point.inUnder ? "under" : null, actual: clicks[i] }))
    .filter((point) => point.expected !== point.actual);
  expect(mismatches).toEqual([]);
}

const scenes: { name: string; scene: Scene; host: string; zoom?: number; shadowDom?: boolean }[] = [
  { name: "fill", scene: { fit: "fill", rotation: 0, rect: { x: 120, y: 80, width: 160, height: 120 } }, host: "width: 800px; height: 600px;" },
  { name: "contain (letterboxed)", scene: { fit: "contain", rotation: 0, rect: { x: 80, y: 100, width: 240, height: 100 } }, host: "width: 800px; height: 600px;" },
  { name: "cover (cropped)", scene: { fit: "cover", rotation: 0, rect: { x: 80, y: 100, width: 240, height: 100 } }, host: "width: 560px; height: 420px;" },
  { name: "fill rotated 90°", scene: { fit: "fill", rotation: 90, rect: { x: 100, y: 110, width: 200, height: 80 } }, host: "width: 800px; height: 600px;" },
  { name: "contain rotated 30° and zoomed", scene: { fit: "contain", rotation: 30, rect: { x: 110, y: 90, width: 180, height: 120 } }, host: "width: 640px; height: 480px;", zoom: 1 },
  { name: "cover rotated -45° in Shadow DOM, small host", scene: { fit: "cover", rotation: -45, rect: { x: 130, y: 100, width: 140, height: 100 } }, host: "width: 420px; height: 315px;", shadowDom: true },
];

for (const { name, scene, host, zoom, shadowDom } of scenes) {
  test(`masked image hits match displayed opaque pixels: ${name}`, async ({ page }) => {
    await mount(page, scene, host, shadowDom);
    for (let i = 0; i < (zoom ?? 0); i++) {
      await page.locator("#host").locator(".clickmap-zoom-in").click();
      await page.waitForTimeout(400);
    }
    await page.mouse.move(0, 0);
    await expectHitsMatchPixels(page);
  });
}

test("moving from a transparent hole into opaque pixels updates hover", async ({ page }) => {
  await mount(page, { fit: "fill", rotation: 0, rect: { x: 120, y: 80, width: 160, height: 160 } }, "width: 800px; height: 600px;");
  const box = await page.evaluate(() => {
    const r = document.querySelector(".clickmap-area-image")!.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const at = (px: number, py: number) => ({ x: box.x + (px / SIZE) * box.w, y: box.y + (py / SIZE) * box.h });
  // Start in the hole (image pixel 10, 30), still inside the statue's rectangle.
  const hole = at(10, 30);
  const opaque = at(3, 30);
  await page.mouse.move(hole.x, hole.y);
  await page.mouse.move(opaque.x, opaque.y, { steps: 6 });
  await page.mouse.move(hole.x, hole.y, { steps: 6 });
  const hovers = await page.evaluate(() => (window as unknown as { __hovers: string[] }).__hovers);
  expect(hovers).toEqual(["under", "statue", "under"]);
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('[data-area-id="statue"]')!).cursor);
  expect(cursor).toBe("pointer");
});

test("hidden images leave no hotspot, keyboard stop or hit region", async ({ page }) => {
  await mount(page, { fit: "fill", rotation: 0, rect: { x: 120, y: 80, width: 160, height: 120 }, visible: false }, "width: 800px; height: 600px;");
  await expect(page.locator('[data-area-id="statue"]')).toHaveCount(0);
  await expect(page.locator(".clickmap-area-image")).toHaveCount(0);
  const center = await page.evaluate(() => {
    const r = document.querySelector('[data-area-id="under"]')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(center.x, center.y);
  expect(await page.evaluate(() => (window as unknown as { __clicks: (string | null)[] }).__clicks)).toEqual(["under"]);
  const stops: string[] = [];
  await page.locator("#host").click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => document.activeElement?.getAttribute("data-area-id") ?? document.activeElement?.className ?? ""));
  }
  expect(stops).toContain("under");
  expect(stops).not.toContain("statue");
});

test("keyboard focus on a masked image shows a visible ring on its hotspot, without pixel tests", async ({ page }) => {
  await mount(page, { fit: "contain", rotation: 30, rect: { x: 120, y: 80, width: 160, height: 120 } }, "width: 800px; height: 600px;");
  const statue = page.locator('[data-area-id="statue"]');
  await statue.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(statue).toBeFocused();
  const ring = await statue.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { width: r.width, height: r.height, outline: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth) };
  });
  expect(ring.width).toBeGreaterThan(50);
  expect(ring.height).toBeGreaterThan(30);
  expect(ring.outline).not.toBe("none");
  expect(ring.outlineWidth).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { __last: string | null }).__last)).toBe("statue");
});
