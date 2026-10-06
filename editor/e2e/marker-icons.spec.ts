import { test, expect, type Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { downloadPackage, openProjectFile, paintsPixels, staticServer } from "./support/browser-evidence";

// Waypoint icons, uploads and marker scaling (#219): the editor canvas, the
// Preview renderer and the exported renderer draw the same icon in the same
// box; screen-scaled markers keep their size through zoom and pan.

test.use({ viewport: { width: 1440, height: 900 } });

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");
const CANVAS = 'svg[tabindex="-1"]';
const RED = "#dc2626";

/** Two empty views ("Contain", "Cover") with one unlocked layer each. */
async function projectFile(dir: string) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  fixture.views = fixture.views.slice(0, 2).map((view: { id: string; layers: unknown[] }) => ({
    ...view,
    layers: [{ id: `markers-${view.id}`, name: "Markers", visible: true, locked: false, opacity: 1, areas: [] }],
  }));
  fixture.settings.initialViewId = fixture.views[0].id;
  fixture.settings.sceneSwitcher = { enabled: true, position: "top-right", style: "buttons" };
  fixture.project.name = "QA markers";
  const path = join(dir, "markers.json");
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(fixture));
  return path;
}

/** A solid-colour RGBA PNG. */
function png(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgba).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

async function placeMarker(page: Page, dx = 0, dy = 0) {
  await page.getByRole("button", { name: "Marker (M)" }).click();
  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** The icon group's transform, path data and colours, wherever it is drawn. */
async function drawn(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((g) => ({
    // The editor draws the transform on the marker group, the renderer on its inner group.
    transform: g.getAttribute("transform") ?? g.firstElementChild!.getAttribute("transform"),
    d: g.querySelector("path")?.getAttribute("d") ?? null,
    fill: g.getAttribute("fill"),
    box: [g.querySelector("rect")!.getAttribute("width"), g.querySelector("rect")!.getAttribute("height")],
  }));
}

test("place a marker, pick, resize and recolour a gallery icon; Design, Preview and export match", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openProjectFile(page, await projectFile(testInfo.outputDir), "QA markers");
  await placeMarker(page);
  const marker = page.locator(`${CANVAS} [data-marker-icon]`);
  await expect(marker).toHaveAttribute("data-marker-icon", "pin");

  const section = page.getByTestId("marker-icon-section");
  // A first pick that is replaced later must not be exported.
  await section.getByLabel("Category").selectOption("Food & shopping");
  await section.getByRole("button", { name: "Café", exact: true }).click();
  await expect(marker).toHaveAttribute("data-marker-icon", "maki-cafe");
  await section.getByLabel("Category").selectOption("");
  await section.getByLabel("Search icons").fill("wc");
  await expect(section.getByTestId("marker-icon-gallery").getByRole("button")).toHaveCount(1);
  await section.getByRole("button", { name: "Toilets" }).click();
  await expect(marker).toHaveAttribute("data-marker-icon", "maki-toilet");
  await expect(section.getByTestId("marker-icon-name")).toHaveText("Toilets");

  // Resize by the south-east corner handle: the size grows, the anchor stays.
  const iconBox = marker.locator("rect");
  const before = (await iconBox.boundingBox())!;
  const handle = page.locator(`${CANVAS} circle[style*="crosshair"]`).nth(3);
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 30, h.y + h.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const after = (await iconBox.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width * 1.5);
  // Bottom-centre anchor: the bottom edge and horizontal centre do not move.
  expect(Math.abs(after.y + after.height - (before.y + before.height))).toBeLessThan(0.5);
  expect(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2))).toBeLessThan(0.5);
  expect(Number(await section.getByLabel("Size (width)").inputValue())).toBeGreaterThan(24);
  await section.getByLabel("Size (width)").fill("48");
  await section.getByLabel("Size (width)").press("Enter");

  // Recolour through the Default style; the icon's own path takes it.
  await page.getByLabel("Default fill CSS color").fill(RED);
  await page.getByLabel("Default fill CSS color").press("Enter");
  await expect(marker).toHaveAttribute("fill", RED);
  const design = await drawn(marker);
  expect(design.transform).toBe("translate(376,202) scale(3.2)");
  await page.screenshot({ path: testInfo.outputPath("design.png") });

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Last event:")).toContainText("ready");
  const frame = page.frameLocator('iframe[title="Map preview"]');
  const previewMarker = frame.locator(".clickmap-areas [data-area-id]");
  await expect(previewMarker).toHaveCount(1);
  expect(await drawn(previewMarker)).toEqual(design);
  // Hover, then select: the style states recolour the icon.
  const hoverFill = "rgba(59,130,246,0.25)";
  const activeFill = "rgba(29,78,216,0.45)";
  await previewMarker.hover();
  await expect(previewMarker).toHaveAttribute("fill", hoverFill);
  // The transparent gap between the two figures is inside the hit box.
  const pb = (await previewMarker.boundingBox())!;
  await previewMarker.click({ position: { x: pb.width / 2, y: pb.height * 0.1 } });
  await expect(page.getByTestId("preview-selected")).toHaveText("Marker");
  await expect(previewMarker).toHaveAttribute("fill", activeFill);
  await page.screenshot({ path: testInfo.outputPath("preview.png") });

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const target = testInfo.outputPath("published");
  const { text } = await downloadPackage(page, target);
  const map = JSON.parse(text("map.json"));
  expect(Object.keys(map.icons)).toEqual(["maki-toilet"]);
  expect(map.views[0].layers[0].areas[0].geometry).toMatchObject({ type: "marker", icon: "maki-toilet", size: 48, anchor: "bottom-center" });
  const hosted = await staticServer(target);
  try {
    await page.goto(hosted.url);
    const published = page.locator(".clickmap-areas [data-area-id]");
    await expect(published).toHaveCount(1);
    expect(await drawn(published)).toEqual(design);
    expect(await paintsPixels(page, published.locator("path"))).toBe(true);
    // Keyboard focus outlines the icon box.
    for (let i = 0; i < 8 && !(await published.evaluate((el) => (el.getRootNode() as Document).activeElement === el)); i++) await page.keyboard.press("Tab");
    await expect(published).toBeFocused();
    const outline = await published.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");
    await page.screenshot({ path: testInfo.outputPath("published-focus.png") });
  } finally {
    await hosted.close();
  }
  expect(errors).toEqual([]);
});

test("uploaded SVG and PNG icons are sanitised, reusable across markers and views, and exported", async ({ page }, testInfo) => {
  await page.goto("/");
  await openProjectFile(page, await projectFile(testInfo.outputDir), "QA markers");
  const section = page.getByTestId("marker-icon-section");
  const upload = section.getByTestId("marker-icon-upload");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" onload="window.__pwned=1"><script>window.__pwned=2</script>' +
    '<g fill="#000" transform="translate(10 10)"><circle r="8" onclick="window.__pwned=3"/></g></svg>';

  await placeMarker(page, -120, 0);
  await upload.setInputFiles({ name: "round-sign.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(section.getByTestId("marker-icon-name")).toHaveText("round-sign");
  const vector = page.locator(`${CANVAS} [data-marker-icon^="icon_"]`);
  await expect(vector).toHaveCount(1);
  await expect(vector.locator("path")).toHaveCount(1);

  await placeMarker(page, 120, 0);
  await upload.setInputFiles({ name: "photo-badge.png", mimeType: "image/png", buffer: png(32, 16, [16, 185, 129, 255]) });
  await expect(section.getByTestId("marker-icon-name")).toHaveText("photo-badge");
  await expect(section.getByText("Image icons keep their own colours")).toBeVisible();
  const raster = page.locator(`${CANVAS} [data-marker-icon]`).nth(1);
  await expect(raster.locator("image")).toHaveCount(1);
  await expect(raster.locator("rect")).toHaveAttribute("width", "32");

  // Another view reuses the uploaded vector icon from the project library.
  await page.locator('span[title="Cover / tall artwork"]').click();
  await placeMarker(page);
  await section.getByLabel("Category").selectOption("Uploaded");
  await section.getByRole("button", { name: "round-sign" }).click();
  await expect(page.locator(`${CANVAS} [data-marker-icon^="icon_"]`)).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("uploads-design.png") });

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const target = testInfo.outputPath("published");
  const { text } = await downloadPackage(page, target);
  const map = JSON.parse(text("map.json"));
  const icons = Object.values(map.icons) as Array<{ name: string; d?: string; assetId?: string }>;
  expect(icons.map((icon) => icon.name).sort()).toEqual(["photo-badge", "round-sign"]);
  expect(icons.find((icon) => icon.name === "round-sign")!.d).toBeTruthy();
  expect(text("map.json")).not.toMatch(/pwned|script|onload|onclick/);
  const keys = map.views.flatMap((view: { layers: Array<{ areas: Array<{ geometry: { icon: string } }> }> }) => view.layers[0]!.areas.map((area) => area.geometry.icon));
  expect(keys[0]).toBe(keys[2]);
  const hosted = await staticServer(target);
  try {
    await page.goto(hosted.url);
    const markers = page.locator(".clickmap-areas [data-area-id]");
    await expect(markers).toHaveCount(2);
    expect(await paintsPixels(page, markers.nth(0).locator("path"))).toBe(true);
    expect(await paintsPixels(page, markers.nth(1).locator("image"))).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath("uploads-published.png") });
  } finally {
    await hosted.close();
  }
});

for (const shadowDom of [false, true]) {
  test(`a screen-scaled marker keeps its on-screen size and anchor through zoom and pan (${shadowDom ? "Shadow DOM" : "light DOM"})`, async ({ page }, testInfo) => {
    const [js, css, fixture] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8"), readFile(fixturePath, "utf8")]);
    const definition = JSON.parse(fixture);
    const style = {
      default: { fill: "#1d4ed8", stroke: "none", strokeWidth: 0 },
      hover: { fill: "#1e3a8a", stroke: "none", strokeWidth: 0 },
      active: { fill: "#047857", stroke: "none", strokeWidth: 0 },
    };
    const toilet = (await import("../src/lib/icons/gallery")).GALLERY_ICONS.find((icon) => icon.id === "maki-toilet")!;
    definition.icons = { wc: { name: "Toilets", width: 15, height: 15, d: toilet.d } };
    definition.views = [{
      ...definition.views[0],
      layers: [{
        id: "markers", name: "Markers", visible: true, locked: false, opacity: 1,
        areas: [
          { id: "screen", name: "Screen", style, action: { type: "none" }, geometry: { type: "marker", x: 400, y: 250, anchor: "bottom-center", icon: "wc", size: 40, scaleMode: "screen" } },
          { id: "map", name: "Map", style, action: { type: "none" }, geometry: { type: "marker", x: 200, y: 250, anchor: "center", icon: "wc", size: 40 } },
        ],
      }],
    }];
    definition.settings.initialViewId = definition.views[0].id;
    definition.settings.sizingMode = "fixed";
    definition.settings.zoomControls = { enabled: true, position: "top-right", step: 1 };
    await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; padding: 40px; }</style></head>
      <body><div id="host"></div></body></html>`);
    await page.addScriptTag({ content: js });
    await page.evaluate(({ definition, shadowDom }) => {
      const w = window as unknown as { __clicks: string[]; ClickMapRenderer: { create(o: object): { on(t: string, f: (e: { areaId: string }) => void): void } } };
      w.__clicks = [];
      w.ClickMapRenderer.create({ container: "#host", definition, shadowDom }).on("area:click", (e) => w.__clicks.push(e.areaId));
    }, { definition, shadowDom });
    await page.waitForTimeout(200);

    // On-screen box of each marker and the anchor point (400, 250) on screen.
    const measure = () => page.evaluate(() => {
      const host = document.getElementById("host")!;
      const scope = host.shadowRoot ?? document;
      const svg = scope.querySelector<SVGSVGElement>(".clickmap-areas")!;
      const anchor = new DOMPoint(400, 250).matrixTransform(svg.getScreenCTM()!);
      const rect = (id: string) => {
        const r = scope.querySelector(`[data-area-id="${id}"] rect`)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { viewBox: svg.getAttribute("viewBox"), anchor: { x: anchor.x, y: anchor.y }, screen: rect("screen"), map: rect("map") };
    });
    const scope = shadowDom ? page.locator("#host") : page;
    const start = await measure();
    expect(start.screen.width).toBeCloseTo(40, 0);
    await scope.locator(".clickmap-zoom-in").click();
    await scope.locator(".clickmap-zoom-in").click();
    // Pan with a drag on empty map space.
    const svgBox = (await scope.locator(".clickmap-areas").boundingBox())!;
    await page.mouse.move(svgBox.x + 60, svgBox.y + svgBox.height - 40);
    await page.mouse.down();
    await page.mouse.move(svgBox.x + 160, svgBox.y + svgBox.height - 120, { steps: 6 });
    await page.mouse.up();
    const zoomed = await measure();
    expect(zoomed.viewBox).not.toBe(start.viewBox);
    for (const state of [start, zoomed]) {
      // Same on-screen size; bottom-centre stays on the anchor point.
      expect(Math.abs(state.screen.width - start.screen.width)).toBeLessThan(0.5);
      expect(Math.abs(state.screen.height - start.screen.height)).toBeLessThan(0.5);
      expect(Math.abs(state.screen.x + state.screen.width / 2 - state.anchor.x)).toBeLessThan(0.5);
      expect(Math.abs(state.screen.y + state.screen.height - state.anchor.y)).toBeLessThan(0.5);
    }
    // The map-scaled marker grew with the map.
    expect(zoomed.map.width).toBeGreaterThan(start.map.width * 2.5);
    // The whole icon box is hit, transparent parts included.
    await page.mouse.click(zoomed.screen.x + zoomed.screen.width / 2, zoomed.screen.y + zoomed.screen.height * 0.1);
    expect(await page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks)).toEqual(["screen"]);
    await page.screenshot({ path: testInfo.outputPath(`screen-scale-${shadowDom ? "shadow" : "light"}.png`) });
  });
}
