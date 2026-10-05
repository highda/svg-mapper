import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Authored visitor text, language and textless maps in a real browser (#216).

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

const VISIBLE = ["directoryToggle", "directoryTitle", "searchPlaceholder", "placeCount", "placeCountOne", "noResults", "back", "zoomIn", "zoomOut", "zoomReset", "close", "loading"];

async function mount(page: Page, settings: Record<string, unknown>, shadowDom: boolean) {
  const [js, css, raw] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8"), readFile(fixturePath, "utf8")]);
  const def = JSON.parse(raw);
  def.settings = { ...def.settings, sizingMode: "fill-container", ...settings };
  for (const view of def.views) view.viewport = { ...view.viewport, zoomEnabled: true, panEnabled: true, maxZoom: 4 };
  await page.setContent(`<!doctype html><html lang="en"><head><style>${css} body { margin: 0; }</style></head>
    <body><div id="map" style="width: 900px; height: 560px;"></div></body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ def, shadowDom }) => {
    const w = window as unknown as { ClickMapRenderer: { create(o: object): unknown } };
    w.ClickMapRenderer.create({ container: "#map", definition: def, shadowDom });
  }, { def, shadowDom });
  await page.waitForTimeout(300);
  return def;
}

for (const shadowDom of [false, true]) {
  const mode = shadowDom ? "Shadow DOM" : "light DOM";

  test(`${mode}: a textless map shows no text and stays operable by keyboard`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const strings = Object.fromEntries(VISIBLE.map((key) => [key, ""]));
    // No switcher: it shows the authored view names.
    await mount(page, { strings, lang: "cs", areaLabels: { enabled: false }, sceneSwitcher: { enabled: false, position: "bottom-center" }, zoomControls: { enabled: true, position: "top-right" } }, shadowDom);
    const map = page.locator("#map");
    const root = map.locator(".clickmap-root");

    await expect(root).toHaveAttribute("lang", "cs");
    expect((await root.innerText()).trim()).toBe("");

    // Controls are icon-free and textless, but every one is named.
    const zoomIn = map.getByRole("button", { name: "Zoom in" });
    await expect(zoomIn).toHaveText("");
    const box = await zoomIn.boundingBox();
    expect(box!.width).toBeGreaterThan(10);

    // Keyboard: Tab reaches an area, Enter opens its details with a named Close.
    await zoomIn.focus();
    await page.keyboard.press("Enter");
    const pannable = map.getByRole("group", { name: "Map, arrow keys pan" });
    await expect(pannable).toHaveCount(1);
    const area = map.getByRole("button", { name: "Open test popup" });
    await area.focus();
    await page.keyboard.press("Enter");
    const close = map.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeFocused();
    await expect(close).toHaveText("");
    await page.keyboard.press("Escape");
    await expect(area).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("authored strings and icons replace the English controls", async ({ page }) => {
  await mount(page, {
    lang: "cs",
    zoomControls: { enabled: true, position: "top-right" },
    directory: { enabled: true },
    strings: { zoomIn: "M11 5h2v14h-2zM5 11h14v2H5z", zoomInLabel: "Přiblížit", directoryToggle: "Najít", directoryTitle: "Najít místo", searchLabel: "Hledat", searchPlaceholder: "Hledat místa", placeCount: "{count} míst" },
  }, false);
  const map = page.locator("#map");
  const zoomIn = map.getByRole("button", { name: "Přiblížit" });
  await expect(zoomIn.locator("svg path")).toHaveCount(1);
  const icon = await zoomIn.locator("svg").boundingBox();
  expect(icon!.width).toBeGreaterThan(8);
  await expect(map.getByRole("heading", { name: "Najít místo" })).toBeVisible();
  await expect(map.getByRole("searchbox", { name: "Hledat" })).toHaveAttribute("placeholder", "Hledat místa");
  await expect(map.locator(".clickmap-directory-status")).toHaveText(/^\d+ míst$/);
  await expect(map.getByText("Find a place")).toHaveCount(0);
});

test("Visitor text edits reach Preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("Inspector · View & project");

  await inspector.getByRole("button", { name: /^Visitor controls/ }).click();
  const zoom = inspector.getByRole("checkbox", { name: "Show zoom controls" });
  if (!(await zoom.isChecked())) await zoom.check();

  await inspector.getByRole("button", { name: /^Visitor text/ }).click();
  const lang = inspector.getByRole("textbox", { name: "Language" });
  await lang.fill("cs");
  await lang.press("Enter");
  const zoomName = inspector.getByRole("textbox", { name: "Zoom in name" });
  await expect(zoomName).toHaveAttribute("placeholder", "Zoom in");
  await zoomName.fill("Přiblížit");
  await zoomName.press("Enter");
  await inspector.getByRole("checkbox", { name: "Hide zoom out button" }).check();
  await expect(inspector.getByRole("button", { name: /^Visitor text/ })).toContainText("cs · 2 custom");

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Map preview"]');
  await expect(frame.locator(".clickmap-root")).toHaveAttribute("lang", "cs");
  await expect(frame.getByRole("button", { name: "Přiblížit" })).toHaveText("+");
  await expect(frame.getByRole("button", { name: "Zoom out" })).toHaveText("");
});
