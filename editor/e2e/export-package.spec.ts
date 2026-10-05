import { test, expect, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");

async function loadFixture(page: Page, path: string) {
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("banner").locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('button[title="Click to rename"]')).toContainText("QA");
}

async function staticServer(root: string) {
  const contentTypes: Record<string, string> = {
    ".css": "text/css", ".html": "text/html", ".js": "text/javascript",
    ".json": "application/json", ".svg": "image/svg+xml",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const relative = pathname === "/" ? "host.html" : pathname.slice(1);
      const file = join(root, relative);
      if (!file.startsWith(root)) throw new Error("Invalid path");
      response.setHeader("content-type", contentTypes[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server did not bind");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((done) => server.close(() => done())) };
}

// Downloads the export ZIP, extracts it under hostRoot/published and writes a
// host page around the generated embed snippet.
async function downloadAndHostPackage(page: Page, hostRoot: string) {
  const packageDownload = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const warningConfirmation = page.getByTestId("export-anyway");
  if (await warningConfirmation.isVisible()) await warningConfirmation.click();
  const downloadedPackage = await packageDownload;
  const downloadedPath = await downloadedPackage.path();
  if (!downloadedPath) throw new Error("Export download has no local path");
  const archive = unzipSync(new Uint8Array(await readFile(downloadedPath)));

  await mkdir(join(hostRoot, "published"), { recursive: true });
  for (const [name, bytes] of Object.entries(archive)) {
    const target = join(hostRoot, "published", name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const embed = strFromU8(archive["embed.html"]);
  await writeFile(join(hostRoot, "host.html"), `<!doctype html><html><body>${embed}</body></html>`);
  return archive;
}

test("authors save/open and publish an inert, externally packaged map", async ({ page }, testInfo) => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  fixture.project.name = "QA </script><script>window.__injected = 1</script>";
  const upload = testInfo.outputPath("script-context.json");
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(upload, JSON.stringify(fixture));

  await page.goto("/");
  await loadFixture(page, upload);

  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await save;
  const savedPath = testInfo.outputPath("saved-project.json");
  await saved.saveAs(savedPath);
  expect(JSON.parse(await readFile(savedPath, "utf8")).project.name).toContain("window.__injected");

  await loadFixture(page, savedPath);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Upload base path").fill("/published");
  await page.getByLabel(/Keep embedded assets/).uncheck();

  const hostRoot = testInfo.outputPath("host-root");
  const archive = await downloadAndHostPackage(page, hostRoot);
  expect(Object.keys(archive).some((name) => name.startsWith("assets/"))).toBe(true);

  const hosted = await staticServer(hostRoot);
  try {
    await page.goto(`${hosted.url}/published/index.html`);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { __injected?: number }).__injected)).toBeUndefined();

    await page.goto(hosted.url);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { __injected?: number }).__injected)).toBeUndefined();

    const svg = page.locator(".clickmap-areas");
    const initial = await svg.getAttribute("viewBox");
    for (let i = 0; i < 20; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    const maximum = await svg.getAttribute("viewBox");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(svg).toHaveAttribute("viewBox", maximum ?? "");
    expect(maximum).not.toBe(initial);

    await page.getByRole("button", { name: "Open test popup" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByText("Sanitised popup")).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await hosted.close();
  }
});

const COLLIDING_ASSETS = [
  { id: "collide-red", name: "a.svg", fill: "#ff0000", rgb: [255, 0, 0] },
  { id: "collide-green", name: "a.svg", fill: "#00ff00", rgb: [0, 255, 0] },
  { id: "collide-blue", name: "a-1.svg", fill: "#0000ff", rgb: [0, 0, 255] },
];

test("colliding asset names export to distinct files that all display (#170)", async ({ page }, testInfo) => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  for (const asset of COLLIDING_ASSETS) {
    const markup = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='${asset.fill}'/></svg>`;
    fixture.assets.push({ id: asset.id, type: "image/svg+xml", name: asset.name, src: `data:image/svg+xml,${encodeURIComponent(markup)}`, width: 40, height: 40, inline: true });
  }
  const contain = fixture.views[0];
  contain.background.assetId = "collide-red";
  const template = contain.layers[0].areas[0];
  contain.layers.push({
    id: "collision-images", name: "Collision images", visible: true, locked: false, opacity: 1,
    areas: COLLIDING_ASSETS.slice(1).map((asset, index) => ({
      ...template,
      id: `image-${asset.id}`,
      name: `Image ${asset.id}`,
      geometry: { type: "rect", x: 600 + index * 80, y: 400, width: 60, height: 60 },
      action: { type: "none" },
      tooltip: undefined,
      accessibility: undefined,
      image: { assetId: asset.id, fit: "fill", decorative: true },
    })),
  });
  const upload = testInfo.outputPath("colliding-assets.json");
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(upload, JSON.stringify(fixture));

  await page.goto("/");
  await loadFixture(page, upload);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Upload base path").fill("/published");
  await page.getByLabel(/Keep embedded assets/).uncheck();

  const hostRoot = testInfo.outputPath("collision-host-root");
  const archive = await downloadAndHostPackage(page, hostRoot);
  const mapJson = JSON.parse(strFromU8(archive["map.json"])) as { assets: Array<{ id: string; src: string }> };
  const paths = COLLIDING_ASSETS.map((asset) => mapJson.assets.find((candidate) => candidate.id === asset.id)?.src);
  expect(paths).toEqual(["assets/a.svg", "assets/a-1.svg", "assets/a-1-1.svg"]);
  COLLIDING_ASSETS.forEach((asset, index) => expect(strFromU8(archive[paths[index]!])).toContain(asset.fill));

  const hosted = await staticServer(hostRoot);
  const failures: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && /could not be loaded/i.test(message.text())) failures.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400 && response.url().includes("/published/")) failures.push(response.url()); });
  try {
    for (const entry of [`${hosted.url}/published/index.html`, hosted.url]) {
      await page.goto(entry);
      await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
      await expect(page.locator("image.clickmap-bg-img")).toHaveCount(1);
      await expect(page.locator("image.clickmap-area-image")).toHaveCount(2);

      // Decode every displayed image href and sample its colour.
      const sampled = await page.evaluate(async () => {
        const images = [...document.querySelectorAll<SVGImageElement>("image.clickmap-bg-img, image.clickmap-area-image")];
        return Promise.all(images.map(async (element) => {
          const href = new URL(element.getAttribute("href") ?? "", document.baseURI).href;
          const image = new Image();
          image.src = href;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 4;
          canvas.height = 4;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0, 4, 4);
          return { href, rgb: [...context.getImageData(2, 2, 1, 1).data.slice(0, 3)] };
        }));
      });
      expect(sampled.map((entry) => new URL(entry.href).pathname)).toEqual(paths.map((path) => `/published/${path}`));
      expect(sampled.map((entry) => entry.rgb)).toEqual(COLLIDING_ASSETS.map((asset) => asset.rgb));
    }
    expect(failures).toEqual([]);
  } finally {
    await hosted.close();
  }
});

test("production editor remains operable with touch emulation", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Project", exact: true }).tap();
  await expect(page.getByRole("region", { name: "Project operations" })).toBeVisible();
  await page.getByRole("button", { name: "Project", exact: true }).tap();
  await page.getByRole("button", { name: "Preview", exact: true }).tap();
  await expect(page.getByTestId("preview-screen")).toBeVisible();
  await context.close();
});
