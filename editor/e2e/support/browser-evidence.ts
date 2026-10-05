import { expect, type Locator, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, sep } from "node:path";

// Shared helpers for behavioural browser evidence (#178): real pixels, real
// layout, and a downloaded package served from its own origin or file://.

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css", ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
};

/** Serves `root` over HTTP on an ephemeral port; `/` maps to `index`. */
export async function staticServer(root: string, index = "index.html") {
  const served: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = join(root, pathname.slice(1), pathname.endsWith("/") ? index : "");
      if (!file.startsWith(root + sep)) throw new Error("Invalid path");
      const body = await readFile(file);
      served.push(pathname);
      response.setHeader("content-type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    served,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Opens a project JSON file through the editor's Open control. */
export async function openProjectFile(page: Page, path: string, expectedName: string | RegExp) {
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("banner").locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('button[title="Click to rename"]')).toContainText(expectedName);
}

/** Downloads the export ZIP (confirming warnings) and extracts it into `target`. */
export async function downloadPackage(page: Page, target: string) {
  const download = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const confirm = page.getByTestId("export-anyway");
  if (await confirm.isVisible()) await confirm.click();
  const path = await (await download).path();
  if (!path) throw new Error("Export download has no local path");
  const archive = unzipSync(new Uint8Array(await readFile(path)));
  for (const [name, bytes] of Object.entries(archive)) {
    const file = join(target, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  return { archive, text: (name: string) => strFromU8(archive[name]!) };
}

/**
 * True when the element visibly paints pixels: a screenshot of its on-screen
 * box changes when only that element is hidden. A broken or blank image
 * (wrong href, undecodable source, zero size) paints nothing and returns false.
 */
export async function paintsPixels(page: Page, element: Locator): Promise<boolean> {
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return false;
  const x = Math.max(0, box.x), y = Math.max(0, box.y);
  const clip = { x, y, width: Math.min(viewport.width, box.x + box.width) - x, height: Math.min(viewport.height, box.y + box.height) - y };
  if (clip.width < 4 || clip.height < 4) return false;
  const shown = await page.screenshot({ clip, animations: "disabled" });
  await element.evaluate((el) => { (el as SVGElement | HTMLElement).style.visibility = "hidden"; });
  const hidden = await page.screenshot({ clip, animations: "disabled" });
  await element.evaluate((el) => { (el as SVGElement | HTMLElement).style.visibility = ""; });
  return !shown.equals(hidden);
}
