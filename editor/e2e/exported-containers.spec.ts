import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { downloadPackage, openProjectFile, paintsPixels, staticServer } from "./support/browser-evidence";

// A downloaded, extracted export behaves by its host element, not the window
// (#157, #159, #161, #178): both asset modes over HTTP and file://, the
// generated snippet on a nested page path, two more instances (one in Shadow
// DOM) on the same page, a hidden host revealed later, and a long popup.

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const LONG_BODY = Array.from({ length: 40 }, (_, i) => `<p>Opening hours line ${i + 1}.</p>`).join("");

async function exportPackage(page: Page, outputDir: string, inlineAssets: boolean) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const circle = fixture.views[0].layers[0].areas.find((area: { id: string }) => area.id === "circle-popup");
  circle.action.content.body = LONG_BODY;
  const upload = join(outputDir, "long-popup.json");
  await mkdir(outputDir, { recursive: true });
  await writeFile(upload, JSON.stringify(fixture));

  await page.goto("/");
  await openProjectFile(page, upload, "QA");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel(/Map sizing/).selectOption("fluid-width");
  await page.getByLabel("Upload base path").fill("/maps/qa");
  const keep = page.getByLabel(/Keep embedded assets/);
  if (inlineAssets) await keep.check(); else await keep.uncheck();
  return downloadPackage(page, join(outputDir, "maps", "qa"));
}

type Scope = "#clickmap" | "#shadow" | "#late";

/** Rendered size of one instance's map root, piercing its shadow root if any. */
function mapSize(page: Page, host: Scope) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)!;
    const root = (element.shadowRoot ?? element).querySelector(".clickmap-root");
    if (!root) return null;
    const box = root.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  }, host);
}

function viewBoxOf(page: Page, host: Scope) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)!;
    return (element.shadowRoot ?? element).querySelector(".clickmap-areas")?.getAttribute("viewBox") ?? null;
  }, host);
}

for (const inlineAssets of [true, false]) {
  const mode = inlineAssets ? "inline assets" : "packaged assets";

  test(`exported index.html paints its artwork over file:// (${mode})`, async ({ page }, testInfo) => {
    const outputDir = testInfo.outputPath("export");
    await exportPackage(page, outputDir, inlineAssets);
    const failures: string[] = [];
    page.on("console", (message) => { if (message.type() === "error" && !/favicon/.test(message.location().url)) failures.push(message.text()); });
    page.on("requestfailed", (request) => failures.push(request.url()));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(pathToFileURL(join(outputDir, "maps", "qa", "index.html")).href);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect.poll(() => mapSize(page, "#clickmap")).toEqual({ width: 1200, height: 750 });
    await expect.poll(() => paintsPixels(page, page.locator("image.clickmap-bg-img").first())).toBe(true);
    expect(failures).toEqual([]);
  });

  test(`snippet on a nested page, a Shadow DOM twin and a late-revealed host size by their hosts (${mode})`, async ({ page }, testInfo) => {
    const outputDir = testInfo.outputPath("export");
    const { text } = await exportPackage(page, outputDir, inlineAssets);
    const snippet = text("embed.html");
    expect(snippet).toContain('"/maps/qa/map.json"');

    // The generated snippet sits in a 360px column of a wide page; two more
    // instances load the same package from that page.
    await mkdir(join(outputDir, "site", "guides", "visit"), { recursive: true });
    await writeFile(join(outputDir, "site", "guides", "visit", "index.html"), `<!doctype html><html><head><meta charset="utf-8">
      <style>body { margin: 0; font: 16px serif; } .column { width: 360px; } .wide { width: 900px; } p { margin: 0 }</style></head>
      <body><div class="column">${snippet}</div>
      <div class="wide"><div id="shadow"></div></div>
      <div id="late" style="width: 600px; display: none"></div>
      <script>
        window.twin = ClickMapRenderer.create({ container: "#shadow", definitionUrl: "/maps/qa/map.json", shadowDom: true });
        window.late = ClickMapRenderer.create({ container: "#late", definitionUrl: "/maps/qa/map.json" });
      </script></body></html>`);

    const hosted = await staticServer(outputDir);
    const failures: string[] = [];
    page.on("console", (message) => { if (message.type() === "error" && !/favicon/.test(message.location().url)) failures.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) failures.push(`${response.status()} ${response.url()}`); });
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.goto(`${hosted.url}/site/guides/visit/`);

      // Widths follow each host, not the 1400px window; heights follow 800:500.
      await expect.poll(() => mapSize(page, "#clickmap")).toEqual({ width: 360, height: 225 });
      await expect.poll(() => mapSize(page, "#shadow")).toEqual({ width: 900, height: 563 });
      await expect.poll(() => mapSize(page, "#late")).toEqual({ width: 0, height: 0 });
      await page.evaluate(() => { document.getElementById("late")!.style.display = "block"; });
      await expect.poll(() => mapSize(page, "#late")).toEqual({ width: 600, height: 375 });

      for (const host of ["#clickmap", "#shadow", "#late"] as const) {
        await expect.poll(() => paintsPixels(page, page.locator(`${host} image.clickmap-bg-img`).first()), { message: host }).toBe(true);
      }
      if (!inlineAssets) expect(hosted.served.filter((path) => path.startsWith("/maps/qa/assets/")).length).toBeGreaterThan(0);

      // Instances are independent: zooming the narrow map leaves the twin's camera.
      const twinCamera = await viewBoxOf(page, "#shadow");
      const narrowCamera = await viewBoxOf(page, "#clickmap");
      await page.locator("#clickmap").getByRole("button", { name: "Zoom in" }).click();
      await expect.poll(() => viewBoxOf(page, "#clickmap")).not.toBe(narrowCamera);
      expect(await viewBoxOf(page, "#shadow")).toBe(twinCamera);

      // A long popup in the 360px host stays inside the map and scrolls inside
      // itself, without widening the page.
      await page.locator("#clickmap").getByRole("button", { name: "Open test popup" }).focus();
      await page.keyboard.press("Enter");
      const popup = page.locator("#clickmap .clickmap-popover--visible");
      await expect(popup).toContainText("Opening hours line 40");
      const contained = await page.evaluate(() => {
        const host = document.getElementById("clickmap")!;
        const root = host.querySelector(".clickmap-root")!.getBoundingClientRect();
        const box = host.querySelector(".clickmap-popover--visible")!.getBoundingClientRect();
        const scroller = [...host.querySelectorAll<HTMLElement>(".clickmap-popover--visible, .clickmap-popover--visible *")]
          .find((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY));
        return {
          inside: box.left >= root.left - 1 && box.top >= root.top - 1 && box.right <= root.right + 1 && box.bottom <= root.bottom + 1,
          scrollsInside: Boolean(scroller),
          pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(contained).toEqual({ inside: true, scrollsInside: true, pageOverflowX: 0 });
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      expect(failures).toEqual([]);
    } finally {
      await hosted.close();
    }
  });
}
