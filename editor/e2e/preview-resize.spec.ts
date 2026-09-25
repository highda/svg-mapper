import { test, expect, type Page } from "@playwright/test";

// Preview hosts the real renderer in a sandboxed page whose map host can be
// resized independently of the page, without rebuilding the map (#158).

async function openCampusPreview(page: Page, mode?: "fluid-width" | "fill-container" | "fixed") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Campus places/ }).click();
  if (mode) {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByLabel(/Map sizing/).selectOption(mode);
  }
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Last event:")).toContainText("ready");
}

const dims = (page: Page) => page.getByRole("status", { name: "Preview dimensions" });

async function setHost(page: Page, width: string, height: string) {
  await page.getByLabel("Map host width in pixels").fill(width);
  await page.getByLabel("Map host height in pixels").fill(height);
  await page.getByLabel("Map host height in pixels").press("Enter");
}

test("a 360px host in a 1200px page resizes the live map in both dimensions", async ({ page }) => {
  await openCampusPreview(page);
  await page.getByRole("button", { name: "1200", exact: true }).click();
  await setHost(page, "360", "");
  await expect(dims(page)).toContainText("Page 1200 ×");
  await expect(dims(page)).toContainText("Host 360 × 240");
  await expect(dims(page)).toContainText("Map 360 × 240");

  // Navigate, then resize: the running map keeps its view (no rebuild).
  const frame = page.frameLocator('iframe[title="Map preview"]');
  await frame.getByRole("button", { name: "Library", exact: true }).press("Enter");
  await expect(page.getByText(/^View:/)).toContainText("Library");
  await setHost(page, "600", "");
  await expect(dims(page)).toContainText("Map 600 × 400");
  await expect(page.getByText(/^View:/)).toContainText("Library");
  await expect(frame.getByRole("button", { name: "Library", exact: true })).toHaveClass(/clickmap-scene-btn--active/);

  // Height-only change on a fluid map: the host grows, the map keeps its ratio.
  await setHost(page, "600", "500");
  await expect(dims(page)).toContainText("Host 600 × 500");
  await expect(dims(page)).toContainText("Map 600 × 400");

  // A narrow page as well as a narrow element.
  await page.getByRole("button", { name: "375", exact: true }).click();
  await setHost(page, "", "");
  await expect(dims(page)).toContainText("Page 375 ×");
  await expect(dims(page)).toContainText("Map 375 × 250");
});

test("fill host follows width-only and height-only changes; canvas size ignores the host", async ({ page }) => {
  await openCampusPreview(page, "fill-container");
  await expect(dims(page)).toContainText("Sizing: Fill host");
  await setHost(page, "500", "");
  await expect(dims(page)).toContainText(/Map 500 × \d+/);
  await setHost(page, "500", "300");
  await expect(dims(page)).toContainText("Map 500 × 300");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel(/Map sizing/).selectOption("fixed");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await setHost(page, "400", "200");
  await expect(dims(page)).toContainText("Host 400 × 200");
  await expect(dims(page)).toContainText("Map 720 × 480");
});

test("the resize handle works from the keyboard and syncs the host fields", async ({ page }) => {
  await openCampusPreview(page);
  await setHost(page, "400", "300");
  await expect(dims(page)).toContainText("Host 400 × 300");
  const handle = page.frameLocator('iframe[title="Map preview"]').getByRole("slider", { name: /Resize map host/ });
  await handle.focus();
  await handle.press("ArrowRight");
  await handle.press("Shift+ArrowDown");
  await expect(dims(page)).toContainText("Host 410 × 350");
  await expect(page.getByLabel("Map host width in pixels")).toHaveValue("410");
  await expect(page.getByLabel("Map host height in pixels")).toHaveValue("350");
});

test("fit to stage shows a tall fluid map whole, and restart resets navigation", async ({ page }) => {
  await openCampusPreview(page);
  await page.setViewportSize({ width: 1440, height: 600 });
  await expect(dims(page)).toContainText("taller than the page");
  await page.getByRole("button", { name: "Fit to stage" }).click();
  await expect(dims(page)).not.toContainText("taller than the page");

  const frame = page.frameLocator('iframe[title="Map preview"]');
  await frame.getByRole("button", { name: "Library", exact: true }).press("Enter");
  await expect(page.getByText(/^View:/)).toContainText("Library");
  await page.getByRole("button", { name: "Restart preview" }).click();
  await expect(page.getByText(/^View:/)).toContainText("Main building");
});

test("messages from other windows cannot change Preview status", async ({ page }) => {
  await openCampusPreview(page);
  await expect(page.getByText("Last event:")).toContainText("ready");
  await page.evaluate(() => {
    window.postMessage({ source: "clickmap-preview", kind: "event", event: { type: "error", message: "forged" } }, "*");
    window.postMessage({ source: "clickmap-preview", kind: "size", page: { width: 1, height: 1 }, host: { width: 1, height: 1 }, map: { width: 1, height: 1 } }, "*");
  });
  await page.waitForTimeout(200);
  await expect(page.getByText("Last event:")).not.toContainText("forged");
  await expect(dims(page)).not.toContainText("Page 1 × 1");
});
