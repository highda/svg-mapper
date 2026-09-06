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

  const packageDownload = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const warningConfirmation = page.getByTestId("export-anyway");
  if (await warningConfirmation.isVisible()) await warningConfirmation.click();
  const downloadedPackage = await packageDownload;
  const downloadedPath = await downloadedPackage.path();
  if (!downloadedPath) throw new Error("Export download has no local path");
  const archive = unzipSync(new Uint8Array(await readFile(downloadedPath)));

  const hostRoot = testInfo.outputPath("host-root");
  await mkdir(join(hostRoot, "published"), { recursive: true });
  for (const [name, bytes] of Object.entries(archive)) {
    const target = join(hostRoot, "published", name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const embed = strFromU8(archive["embed.html"]);
  await writeFile(join(hostRoot, "host.html"), `<!doctype html><html><body>${embed}</body></html>`);
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

test("production editor remains operable with touch emulation", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page.getByRole("button", { name: "Project", exact: true }).tap();
  await expect(page.getByRole("region", { name: "Project operations" })).toBeVisible();
  await page.getByRole("button", { name: "Project", exact: true }).tap();
  await page.getByRole("button", { name: "Preview", exact: true }).tap();
  await expect(page.getByTestId("preview-screen")).toBeVisible();
  await context.close();
});
