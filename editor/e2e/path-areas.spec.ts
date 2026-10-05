import { test, expect, type Locator, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

// Path areas are first-class geometry (#218): the editor canvas, the Preview
// renderer and the exported renderer agree on their outline, label position
// and popover anchoring, including after a move in the editor.

test.use({ viewport: { width: 1440, height: 900 } });

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const CANVAS = 'svg[tabindex="-1"]';
const EDITOR_AREAS = `${CANVAS} path[style*="move"]`;

const style = {
  default: { fill: "rgba(14,116,144,.25)", stroke: "#0e7490", strokeWidth: 2 },
  hover: { fill: "rgba(14,116,144,.45)", stroke: "#155e75", strokeWidth: 3 },
  active: { fill: "rgba(14,116,144,.6)", stroke: "#164e63", strokeWidth: 3 },
};

// Curves (C, S, Q, T), a relative elliptical arc, and plain lines.
const PATHS = {
  lake: "M200 200 C200 120 360 110 380 190 S460 300 360 320 Q300 340 260 300 T200 260 a40 30 20 0 1 0 -60 Z",
  ridge: "m480 120 l120 -40 h80 v140 l-60 40 z",
};

async function projectFile(testDir: string) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const view = fixture.views[0];
  view.layers = [{
    id: "paths",
    name: "Paths",
    visible: true,
    locked: false,
    opacity: 1,
    areas: [
      {
        id: "lake",
        name: "Lake",
        geometry: { type: "path", d: PATHS.lake },
        style,
        action: { type: "popup", content: { title: "Lake", body: "A curved path area." }, position: "bottom" },
        metadata: { kind: "water" },
      },
      {
        id: "ridge",
        name: "Ridge",
        geometry: { type: "path", d: PATHS.ridge },
        style,
        action: { type: "none" },
      },
    ],
  }];
  fixture.views = [view];
  fixture.settings.initialViewId = view.id;
  fixture.settings.areaLabels = { enabled: true, hideWhenSmaller: false, fontSize: 14 };
  fixture.settings.sceneSwitcher = { enabled: false, position: "top-right", style: "dropdown" };
  fixture.settings.directory = { enabled: true };
  fixture.project.name = "QA paths";
  const path = join(testDir, "paths.json");
  await mkdir(testDir, { recursive: true });
  await writeFile(path, JSON.stringify(fixture));
  return path;
}

interface Geometry {
  d: string;
  box: { x: number; y: number; width: number; height: number };
  label: { x: number; y: number };
}

/** Outline (`d`, getBBox in canvas units) and label anchor of each path area, in order. */
async function readGeometry(shapes: Locator, labels: Locator): Promise<Geometry[]> {
  const outlines = await shapes.evaluateAll((elements) => elements.map((element) => {
    const b = (element as SVGGraphicsElement).getBBox();
    return { d: element.getAttribute("d") ?? "", box: { x: b.x, y: b.y, width: b.width, height: b.height } };
  }));
  const anchors = await labels.evaluateAll((elements) => elements.map((element) => ({
    x: Number(element.getAttribute("x")),
    y: Number(element.getAttribute("y")),
  })));
  return outlines.map((outline, index) => ({ ...outline, label: anchors[index]! }));
}

function expectSameGeometry(actual: Geometry[], expected: Geometry[], surface: string) {
  expect(actual.length, surface).toBe(expected.length);
  actual.forEach((geometry, index) => {
    expect(geometry.d, `${surface} d[${index}]`).toBe(expected[index]!.d);
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(geometry.box[key] - expected[index]!.box[key]), `${surface} box.${key}[${index}]`).toBeLessThan(0.01);
    }
    expect(Math.abs(geometry.label.x - expected[index]!.label.x), `${surface} label.x[${index}]`).toBeLessThan(0.01);
    expect(Math.abs(geometry.label.y - expected[index]!.label.y), `${surface} label.y[${index}]`).toBeLessThan(0.01);
  });
}

/** Labels sit at the centre of the outline's exact bounds. */
function expectCentredLabels(geometry: Geometry[]) {
  for (const { box, label } of geometry) {
    expect(Math.abs(label.x - (box.x + box.width / 2))).toBeLessThan(0.01);
    expect(Math.abs(label.y - (box.y + box.height / 2))).toBeLessThan(0.01);
  }
}

/** The popover opens next to the activated path, horizontally overlapping it. */
async function expectPopoverAnchored(page: Page, area: Locator, popover: Locator) {
  await area.click({ position: await insidePoint(area) });
  await expect(popover).toBeVisible();
  const target = (await area.boundingBox())!;
  const box = (await popover.boundingBox())!;
  // Below the outline, or flipped above it when the map has no room below.
  const gapBelow = box.y - (target.y + target.height);
  const gapAbove = target.y - (box.y + box.height);
  // The popover's arrow may overlap the outline by a few pixels.
  const adjacent = (gap: number) => gap >= -12 && gap <= 40;
  expect(adjacent(gapBelow) || adjacent(gapAbove), `popover ${JSON.stringify(box)} next to ${JSON.stringify(target)}`).toBe(true);
  expect(box.x).toBeLessThan(target.x + target.width);
  expect(box.x + box.width).toBeGreaterThan(target.x);
  await page.keyboard.press("Escape");
}

/** A point inside the lake outline, relative to its client box (its bounds centre is filled). */
async function insidePoint(area: Locator) {
  const box = (await area.boundingBox())!;
  return { x: box.width / 2, y: box.height / 2 };
}

async function staticServer(root: string) {
  const contentTypes: Record<string, string> = {
    ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const file = join(root, pathname === "/" ? "index.html" : pathname.slice(1));
      if (!file.startsWith(root)) throw new Error("Invalid path");
      response.setHeader("content-type", contentTypes[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server did not bind");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((done) => server.close(() => done())) };
}

test("editor, Preview and the exported renderer agree on path geometry", async ({ page }, testInfo) => {
  const upload = await projectFile(testInfo.outputDir);
  await page.goto("/");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("banner").locator('input[type="file"]').setInputFiles(upload);
  await expect(page.locator('button[title="Click to rename"]')).toContainText("QA paths");

  const editorShapes = page.locator(EDITOR_AREAS);
  const editorLabels = page.locator(`${CANVAS} text.clickmap-area-label`);
  await expect(editorShapes).toHaveCount(2);
  await expect(editorLabels).toHaveCount(2);

  // Labels use the exact bounds, which match the browser's own path measurement.
  const opened = await readGeometry(editorShapes, editorLabels);
  expect(opened.map((geometry) => geometry.d)).toEqual([PATHS.lake, PATHS.ridge]);
  expectCentredLabels(opened);

  // Move the lake on the canvas; the outline keeps its size and one undo restores it.
  const lake = editorShapes.first();
  const start = (await lake.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 60, start.y + start.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  // The selected path shows its exact bounds with resize handles.
  const bounds = page.getByTestId("path-bounds");
  await expect(bounds).toHaveCount(1);
  const moved = await readGeometry(editorShapes, editorLabels);
  const shown = await bounds.evaluate((rect) => ["x", "y", "width", "height"].map((key) => Number(rect.getAttribute(key))));
  shown.forEach((value, index) => expect(Math.abs(value - Object.values(moved[0]!.box)[index]!)).toBeLessThan(0.01));
  expect(moved[0]!.d).not.toBe(PATHS.lake);
  expect(moved[0]!.box.x).toBeGreaterThan(opened[0]!.box.x + 10);
  expect(Math.abs(moved[0]!.box.width - opened[0]!.box.width)).toBeLessThan(0.01);
  expect(Math.abs(moved[0]!.box.height - opened[0]!.box.height)).toBeLessThan(0.01);
  expect(moved[1]).toEqual(opened[1]);
  expectCentredLabels(moved);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await readGeometry(editorShapes, editorLabels))[0]!.d).toBe(PATHS.lake);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await readGeometry(editorShapes, editorLabels))[0]!.d).toBe(moved[0]!.d);

  // Preview runs the real renderer on the same definition.
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Last event:")).toContainText("ready");
  const frame = page.frameLocator('iframe[title="Map preview"]');
  const previewShapes = frame.locator(".clickmap-areas [data-area-id]");
  await expect(previewShapes).toHaveCount(2);
  await expect(frame.locator(".clickmap-area-label")).toHaveCount(2);
  const preview = await readGeometry(previewShapes, frame.locator(".clickmap-area-label"));
  expectSameGeometry(preview, moved, "Preview");
  await expectPopoverAnchored(page, previewShapes.first(), frame.locator(".clickmap-popover"));

  // Export, host the package, and compare the published renderer.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const warning = page.getByTestId("export-anyway");
  const warned = warning.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (await Promise.race([download.then(() => false), warned])) await warning.click();
  const archivePath = await (await download).path();
  if (!archivePath) throw new Error("Export download has no local path");
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  const exported = JSON.parse(strFromU8(archive["map.json"]!));
  const exportedPaths = exported.views[0].layers[0].areas.map((area: { geometry: { d: string } }) => area.geometry.d);
  expect(exportedPaths).toEqual(moved.map((geometry) => geometry.d));

  const hostRoot = testInfo.outputPath("published");
  for (const [name, bytes] of Object.entries(archive)) {
    const target = join(hostRoot, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const hosted = await staticServer(hostRoot);
  try {
    await page.goto(hosted.url);
    const publishedShapes = page.locator(".clickmap-areas [data-area-id]");
    await expect(publishedShapes).toHaveCount(2);
    await expect(page.locator(".clickmap-area-label")).toHaveCount(2);
    const published = await readGeometry(publishedShapes, page.locator(".clickmap-area-label"));
    expectSameGeometry(published, moved, "Exported renderer");
    await expectPopoverAnchored(page, publishedShapes.first(), page.locator(".clickmap-popover"));

    // The place directory reveals a path by its bounds: the camera centres the
    // ridge (x 480–680) horizontally.
    await page.locator(".clickmap-directory-result", { hasText: "Ridge" }).click();
    await expect.poll(async () => {
      const [x, , width] = ((await page.locator(".clickmap-areas").getAttribute("viewBox")) ?? "").split(" ").map(Number);
      return Math.round(x! + width! / 2);
    }).toBe(580);
    await expect(publishedShapes.nth(1)).toBeFocused();
  } finally {
    await hosted.close();
  }
});

test("a path resizes by its bounding-box handles and the Inspector edits its bounds", async ({ page }, testInfo) => {
  const upload = await projectFile(testInfo.outputDir);
  await page.goto("/");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("banner").locator('input[type="file"]').setInputFiles(upload);
  await expect(page.locator('button[title="Click to rename"]')).toContainText("QA paths");

  const ridge = page.locator(EDITOR_AREAS).nth(1);
  const box = async () => ridge.evaluate((path) => {
    const b = (path as SVGGraphicsElement).getBBox();
    return [b.x, b.y, b.width, b.height].map((value) => Math.round(value * 100) / 100);
  });
  expect(await box()).toEqual([480, 80, 200, 180]);
  await ridge.click({ position: { x: 150, y: 60 } });
  await expect(page.getByTestId("path-bounds")).toHaveCount(1);

  // Drag the south-east handle: at 100 % zoom one screen pixel is one canvas unit.
  await expect(page.getByText("Zoom: 100%")).toBeVisible();
  const handle = page.locator(`${CANVAS} circle[cx="680"][cy="260"]`);
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 100, start.y + start.height / 2 - 90, { steps: 5 });
  await page.mouse.up();
  const resized = await box();
  expect(resized.slice(0, 2)).toEqual([480, 80]);
  expect(Math.abs(resized[2]! - 100)).toBeLessThan(1.5);
  expect(Math.abs(resized[3]! - 90)).toBeLessThan(1.5);

  // The Inspector shows and edits the exact bounds.
  const x = page.getByLabel("X", { exact: true });
  await expect(x).toHaveValue("480");
  await x.fill("100");
  await x.press("Tab");
  await expect.poll(box).toEqual([100, 80, resized[2], resized[3]]);
  const width = page.getByLabel("W", { exact: true });
  await width.fill("300");
  await width.press("Tab");
  await expect.poll(box).toEqual([100, 80, 300, resized[3]]);

  // Each edit is one undo step.
  await page.locator(CANVAS).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(box).toEqual([100, 80, resized[2], resized[3]]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(box).toEqual(resized);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(box).toEqual([480, 80, 200, 180]);
});
