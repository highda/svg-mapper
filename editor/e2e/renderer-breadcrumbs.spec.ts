import { test, expect, type Locator, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// view.ui.showBreadcrumbs: a keyboard-accessible trail of visited views in the
// visitor-controls grid, authored in the Inspector (#217).

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

async function mount(page: Page, shadowDom: boolean) {
  const [js, css, raw] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8"), readFile(fixturePath, "utf8")]);
  const def = JSON.parse(raw);
  def.settings.sizingMode = "fill-container";
  def.settings.zoomControls = { enabled: true, position: "top-left" };
  for (const view of def.views) view.ui = { showBackButton: true, showBreadcrumbs: true };
  await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; }</style></head>
    <body><div id="map" style="width: 900px; height: 560px;"></div></body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ def, shadowDom }) => {
    const w = window as unknown as { map: unknown; ClickMapRenderer: { create(o: object): unknown } };
    w.map = w.ClickMapRenderer.create({ container: "#map", definition: def, shadowDom });
  }, { def, shadowDom });
  return page.locator("#map");
}

const goTo = (page: Page, id: string) => page.evaluate((viewId) => (window as unknown as { map: { goToView(id: string): void } }).map.goToView(viewId), id);
const currentView = (page: Page) => page.evaluate(() => (window as unknown as { map: { getCurrentView(): string } }).map.getCurrentView());
const crumbs = (trail: Locator) => trail.getByRole("listitem").allInnerTexts();

for (const shadowDom of [false, true]) {
  const mode = shadowDom ? "Shadow DOM" : "light DOM";

  test(`${mode}: the breadcrumb trail lists visited views and returns to them by keyboard`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const map = await mount(page, shadowDom);
    const trail = map.getByRole("navigation", { name: "Breadcrumb" });
    await expect(map.locator(".clickmap-areas")).toBeVisible();
    await expect(trail).toHaveCount(0);

    const [first, second, third] = await page.evaluate(() => {
      const w = window as unknown as { map: { getDefinition(): { views: { id: string }[] } } };
      return w.map.getDefinition().views.slice(0, 3).map((view) => view.id);
    });
    await goTo(page, second!);
    await goTo(page, third!);
    await expect(trail).toBeVisible();
    const names = await crumbs(trail);
    expect(names).toHaveLength(3);
    await expect(trail.locator('[aria-current="page"]')).toHaveText(names[2]!);
    await expect(trail.getByRole("button")).toHaveCount(2);

    // Back, then the trail, both in the top-left slot and not overlapping the zoom controls.
    const slot = map.locator(".clickmap-slot--top-left");
    await expect(slot.locator(":scope > *").first()).toHaveClass("clickmap-back-btn");
    const [trailBox, zoomBox] = await Promise.all([trail.boundingBox(), map.locator(".clickmap-zoom-controls").boundingBox()]);
    expect(trailBox!.y + trailBox!.height).toBeLessThanOrEqual(zoomBox!.y);

    // Tab reaches the crumbs; Enter returns to the middle view and trims the trail.
    await map.getByRole("button", { name: /Back/ }).focus();
    await page.keyboard.press("Tab");
    await expect(trail.getByRole("button", { name: names[0] })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(trail.getByRole("button", { name: names[1] })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => currentView(page)).toBe(second);
    await expect.poll(() => crumbs(trail)).toEqual(names.slice(0, 2));

    // Space on the first crumb returns to the start; the trail disappears.
    await trail.getByRole("button", { name: names[0] }).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => currentView(page)).toBe(first);
    await expect(trail).toHaveCount(0);
    await expect(map.getByRole("button", { name: /Back/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

async function openCampus(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Campus places/ }).click();
}

/** Preview: open Main building → Library through the Reception hotspot. */
async function drillIntoLibrary(page: Page) {
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Last event:")).toContainText("ready");
  const frame = page.frameLocator('iframe[title="Map preview"]');
  await frame.locator('[data-area-id="area-campus-0-a"]').click();
  await expect(page.getByText(/^View:/)).toContainText("Library");
  return frame;
}

test("the Inspector toggle round-trips through Preview and export", async ({ page }) => {
  await openCampus(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await page.getByRole("complementary", { name: "Views and layers" }).getByText("Library", { exact: true }).click();
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("Inspector · View & project");

  const section = inspector.getByRole("button", { name: /^Navigation/ });
  await expect(section).toHaveAttribute("aria-expanded", "false");
  await expect(section).toContainText("Back, Trail");
  await section.click();
  const toggle = inspector.getByRole("checkbox", { name: "Show breadcrumb trail" });
  await expect(toggle).toBeChecked();

  // On (the sample's default): Preview shows Main building › Library.
  let frame = await drillIntoLibrary(page);
  const trail = frame.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail.getByRole("listitem")).toHaveText(["Main building", "Library"]);
  await trail.getByRole("button", { name: "Main building" }).click();
  await expect(page.getByText(/^View:/)).toContainText("Main building");

  // Off: no trail, the back button stays.
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("complementary", { name: "Views and layers" }).getByText("Library", { exact: true }).click();
  await toggle.uncheck();
  await expect(section).toContainText("Back");
  await expect(section).not.toContainText("Trail");
  frame = await drillIntoLibrary(page);
  await expect(frame.getByRole("button", { name: /Back/ })).toBeVisible();
  await expect(frame.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);

  // Undo restores it; export writes the flag and none of the retired fields.
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  // Wait for either the download or the warning dialog.
  const confirm = page.getByTestId("export-anyway");
  const confirmShown = confirm.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (await Promise.race([download.then(() => false), confirmShown])) await confirm.click();
  const archive = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
  const mapJson = strFromU8(archive["map.json"]!);
  const library = (JSON.parse(mapJson) as { views: { name: string; ui: object }[] }).views.find((view) => view.name === "Library");
  expect(library?.ui).toEqual({ showBackButton: true, showBreadcrumbs: true });
  expect(mapJson).not.toMatch(/"theme"|"showTitle"/);
});
