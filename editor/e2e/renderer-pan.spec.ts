import { test, expect, type Page, type FrameLocator } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { downloadPackage, openProjectFile } from "./support/browser-evidence";

// A zoomed map pans by mouse drag, Space-drag and arrow keys, within the
// canvas bounds, and a drag never activates what it started on (#215).

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

type Sizing = "fixed" | "fluid-width" | "fill-container";

async function mount(page: Page, { hostStyle, sizing, shadowDom = false, panEnabled = true }: { hostStyle: string; sizing: Sizing; shadowDom?: boolean; panEnabled?: boolean }) {
  const [js, css, fixture] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8"), readFile(fixturePath, "utf8")]);
  const definition = JSON.parse(fixture);
  definition.settings.sizingMode = sizing;
  definition.settings.zoomControls = { enabled: true, position: "top-right", step: 1 };
  definition.views[0].viewport.panEnabled = panEnabled;
  await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; padding: 40px; }</style></head>
    <body><div id="host" style="${hostStyle}"></div></body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ definition, shadowDom }) => {
    const w = window as unknown as { __events: string[]; ClickMapRenderer: { create(o: object): { on(t: string, f: (e: { reason?: string; areaId?: string }) => void): void } } };
    w.__events = [];
    const map = w.ClickMapRenderer.create({ container: "#host", definition, shadowDom });
    map.on("camera:change", (e) => w.__events.push(`camera:${e.reason}`));
    map.on("area:click", (e) => w.__events.push(`click:${e.areaId}`));
  }, { definition, shadowDom });
  await page.waitForTimeout(250);
}

const scopeOf = () => {
  const host = document.getElementById("host")!;
  return host.shadowRoot ?? document;
};

function camera(page: Page) {
  return page.evaluate((scopeSrc) => {
    const scope = (new Function(`return (${scopeSrc})()`))() as Document | ShadowRoot;
    const svg = scope.querySelector<SVGSVGElement>(".clickmap-areas")!;
    const root = scope.querySelector(".clickmap-root")!;
    const ctm = svg.getScreenCTM()!;
    // The canvas (800x500, no padding) on screen, against the renderer box.
    const a = new DOMPoint(0, 0).matrixTransform(ctm);
    const b = new DOMPoint(800, 500).matrixTransform(ctm);
    const box = scope.querySelector(".clickmap-view")!.getBoundingClientRect();
    return {
      viewBox: svg.getAttribute("viewBox")!,
      canvas: { left: a.x, top: a.y, right: b.x, bottom: b.y },
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      pannable: root.classList.contains("clickmap-root--pannable"),
      cursor: getComputedStyle(svg).cursor,
    };
  }, scopeOf.toString());
}

const events = (page: Page) => page.evaluate(() => (window as unknown as { __events: string[] }).__events.splice(0));

/** Per axis the canvas either covers the box (zoomed in) or sits centred inside it (letterbox). */
function expectInBounds(state: Awaited<ReturnType<typeof camera>>) {
  const { canvas, box } = state;
  for (const [lo, hi] of [["left", "right"], ["top", "bottom"]] as const) {
    const covers = canvas[lo] <= box[lo] + 0.5 && canvas[hi] >= box[hi] - 0.5;
    const centred = canvas[lo] >= box[lo] - 0.5 && canvas[hi] <= box[hi] + 0.5 &&
      Math.abs((canvas[lo] - box[lo]) - (box[hi] - canvas[hi])) < 1;
    expect(covers || centred, `${lo}/${hi} ${JSON.stringify(state)}`).toBe(true);
  }
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

async function areaCentre(page: Page, id: string) {
  return page.evaluate(({ id, scopeSrc }) => {
    const scope = (new Function(`return (${scopeSrc})()`))() as Document | ShadowRoot;
    const r = scope.querySelector(`[data-area-id="${id}"]`)!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { id, scopeSrc: scopeOf.toString() });
}

const hosts: Array<[string, Sizing, string]> = [
  ["fixed", "fixed", ""],
  ["fluid-width", "fluid-width", "width: 640px;"],
  ["fill-container", "fill-container", "width: 640px; height: 400px;"],
  ["letterboxed tall fill host", "fill-container", "width: 400px; height: 600px;"],
  ["letterboxed wide fill host", "fill-container", "width: 900px; height: 300px;"],
];

for (const shadowDom of [false, true]) {
  const dom = shadowDom ? "Shadow DOM" : "light DOM";
  for (const [name, sizing, hostStyle] of hosts) {
    test(`${dom}, ${name}: drag pans 1:1 within the canvas bounds`, async ({ page }) => {
      await mount(page, { hostStyle, sizing, shadowDom });
      const zoomIn = page.getByRole("button", { name: "Zoom in" });
      await zoomIn.click();
      await events(page);
      const start = await camera(page);
      expect(start.pannable).toBe(true);
      expect(start.cursor).toBe("grab");
      const mid = { x: (start.box.left + start.box.right) / 2, y: (start.box.top + start.box.bottom) / 2 };

      // A small drag tracks the pointer exactly through the real screen transform.
      await drag(page, mid, 30, 20);
      const moved = await camera(page);
      expect(moved.viewBox).not.toBe(start.viewBox);
      const shift = { x: moved.canvas.left - start.canvas.left, y: moved.canvas.top - start.canvas.top };
      for (const axis of ["x", "y"] as const) {
        expect(Math.abs(shift[axis]) < 0.5 || Math.abs(shift[axis] - (axis === "x" ? 30 : 20)) < 0.5, `${axis} shift ${shift[axis]}`).toBe(true);
      }
      expect(Math.abs(shift.x) + Math.abs(shift.y)).toBeGreaterThan(19);
      expect(await events(page)).toContain("camera:pan");
      expectInBounds(moved);

      // Huge drags in every direction stop at the canvas edges.
      for (const [dx, dy] of [[2000, 2000], [-2000, -2000], [2000, -2000], [-2000, 2000]]) {
        await drag(page, mid, dx, dy);
        expectInBounds(await camera(page));
      }
    });
  }

  test(`${dom}: a drag never activates its area, a click still does, and Space and arrows pan`, async ({ page }) => {
    await mount(page, { hostStyle: "", sizing: "fixed", shadowDom });
    await page.getByRole("button", { name: "Zoom in" }).click();
    const popup = page.getByRole("dialog");

    // Drag starting on the popup circle: pans, no click, no popup.
    const circle = await areaCentre(page, "circle-popup");
    await drag(page, circle, 60, 80);
    expect((await events(page)).filter((e) => e.startsWith("click:"))).toEqual([]);
    await expect(popup).toBeHidden();

    // A press that wobbles under the threshold is a click.
    const moved = await areaCentre(page, "circle-popup");
    await page.mouse.move(moved.x, moved.y);
    await page.mouse.down();
    await page.mouse.move(moved.x + 2, moved.y + 1);
    await page.mouse.up();
    expect(await events(page)).toContain("click:circle-popup");
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();

    // Arrow keys pan the focused map; a focused area keeps them.
    const svg = page.locator(".clickmap-areas");
    await page.locator('[data-area-id="circle-popup"]').focus();
    await events(page);
    const focused = (await camera(page)).viewBox;
    await page.keyboard.press("ArrowLeft");
    expect((await camera(page)).viewBox).toBe(focused);
    await svg.focus();
    await page.keyboard.press("ArrowLeft");
    expect((await camera(page)).viewBox).not.toBe(focused);
    expect(await events(page)).toEqual(["camera:pan"]);

    // Space plus drag still pans (focus stays on the map, not an area).
    const before = (await camera(page)).viewBox;
    await page.mouse.move(moved.x, moved.y);
    await page.keyboard.down("Space");
    await drag(page, moved, 0, 40);
    await page.keyboard.up("Space");
    expect((await camera(page)).viewBox).not.toBe(before);
    expect((await events(page)).filter((e) => e.startsWith("click:"))).toEqual([]);
  });

  test(`${dom}: without zoom or with panning disabled, a drag does nothing`, async ({ page }) => {
    for (const [panEnabled, zoom] of [[true, false], [false, true]] as const) {
      await mount(page, { hostStyle: "", sizing: "fixed", shadowDom, panEnabled });
      if (zoom) await page.getByRole("button", { name: "Zoom in" }).click();
      await events(page);
      const start = await camera(page);
      expect(start.pannable).toBe(false);
      expect(start.cursor).not.toBe("grab");
      await expect(page.locator(".clickmap-areas")).not.toHaveAttribute("tabindex", /.*/);
      await drag(page, { x: 200, y: 200 }, 120, 80);
      expect((await camera(page)).viewBox).toBe(start.viewBox);
      expect(await events(page)).toEqual([]);
    }
  });
}

async function dragIn(page: Page, frame: FrameLocator, dx: number, dy: number) {
  const box = (await frame.locator(".clickmap-areas").boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy);
}

test("Preview: a zoomed map pans by dragging", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Campus places/ }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Last event:")).toContainText("ready");
  const frame = page.frameLocator('iframe[title="Map preview"]');
  const svg = frame.locator(".clickmap-areas");
  await frame.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await svg.getAttribute("viewBox");
  await dragIn(page, frame, 80, 50);
  await expect(svg).not.toHaveAttribute("viewBox", zoomed!);
  await expect(page.getByText("Last event:")).toContainText("camera:change");
});

test("exported index.html: a zoomed map pans by dragging without opening what it started on", async ({ page }, testInfo) => {
  const outputDir = testInfo.outputPath("export");
  await mkdir(outputDir, { recursive: true });
  await page.goto("/");
  await openProjectFile(page, fixturePath, /.+/);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel(/Map sizing/).selectOption("fluid-width");
  await downloadPackage(page, outputDir);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(pathToFileURL(join(outputDir, "index.html")).href);
  const svg = page.locator(".clickmap-areas");
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await svg.getAttribute("viewBox");
  const circle = (await page.locator('[data-area-id="circle-popup"]').boundingBox())!;
  await drag(page, { x: circle.x + circle.width / 2, y: circle.y + circle.height / 2 }, 90, 60);
  await expect(svg).not.toHaveAttribute("viewBox", zoomed!);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.locator('[data-area-id="circle-popup"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
