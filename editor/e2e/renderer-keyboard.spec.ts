import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Keyboard handling stays scoped to the map that owns focus, in light and
// Shadow DOM, and popups are named, non-modal dialogs (#175).

const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");

async function definition() {
  const def = JSON.parse(await readFile(fixturePath, "utf8"));
  def.settings.sizingMode = "fill-container";
  def.settings.areaLabels = { enabled: false };
  def.settings.sceneSwitcher = { enabled: true, position: "bottom-center", style: "tabs" };
  def.settings.directory = { enabled: true };
  const view = def.views.find((v: { id: string }) => v.id === "contain");
  const style = view.layers[0].areas[0].style;
  view.layers[0].areas.push(
    { id: "closed", name: "Closed kiosk", disabled: true, geometry: { type: "rect", x: 470, y: 205, width: 50, height: 50 }, style, action: { type: "popup", content: { title: "Never shown" } } },
    { id: "hover-only", name: "Hover only", trigger: "hover", tooltip: { enabled: true, title: "Hover details" }, geometry: { type: "rect", x: 560, y: 205, width: 50, height: 50 }, style, action: { type: "popup", content: { title: "Never shown" } } },
  );
  return def;
}

/** Mount one map per `[containerId, shadowDom]`, with a host text field between them. */
async function mount(page: Page, maps: [string, boolean][]) {
  const [js, css, def] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8"), definition()]);
  const hosts = maps.map(([id]) => `<div id="${id}" style="width: 900px; height: 560px;"></div>`);
  await page.setContent(`<!doctype html><html><head><style>${css} body { margin: 0; }</style></head>
    <body>${hosts[0]}<label>Host notes <input id="host-field"></label>${hosts.slice(1).join("")}</body></html>`);
  await page.addScriptTag({ content: js });
  await page.evaluate(({ def, maps }) => {
    const w = window as unknown as { ClickMapRenderer: { create(o: object): unknown } };
    for (const [id, shadowDom] of maps) w.ClickMapRenderer.create({ container: `#${id}`, definition: def, shadowDom });
  }, { def, maps });
  await page.waitForTimeout(300);
}

for (const shadowDom of [false, true]) {
  const mode = shadowDom ? "Shadow DOM" : "light DOM";

  test(`${mode}: Space types in search, arrows move between views, popups are named and return focus`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, [["map", shadowDom]]);
    const map = page.locator("#map");

    const search = map.getByRole("searchbox", { name: "Search places" });
    await search.focus();
    await page.keyboard.type("Closed kiosk");
    await expect(search).toHaveValue("Closed kiosk");
    await expect(map.locator(".clickmap-directory-status")).toHaveText("1 place");

    const tablist = map.getByRole("tablist", { name: "Views" });
    const tabs = tablist.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.last()).toBeFocused();

    const trigger = map.getByRole("button", { name: "Open test popup" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = map.getByRole("dialog", { name: "Sanitised popup" });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("aria-modal", /.*/);
    await expect(dialog).toHaveAccessibleDescription(/Escape closes this/);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Pointer: Close returns focus too; Space on a focused area still activates it.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");

    // Disabled areas are inert to pointer and keyboard.
    const closed = map.locator('[data-area-id="closed"]');
    await expect(closed).toHaveAttribute("aria-disabled", "true");
    await closed.click({ force: true });
    await expect(map.locator(".clickmap-popover--visible")).toHaveCount(0);

    // Hover-only areas reveal details on hover and Enter but never open a popup.
    const hoverOnly = map.getByRole("button", { name: "Hover only" });
    await hoverOnly.hover();
    await expect(map.locator(".clickmap-tooltip--visible")).toContainText("Hover details");
    await hoverOnly.focus();
    await page.keyboard.press("Enter");
    await expect(hoverOnly).toHaveAttribute("aria-current", "true");
    await expect(map.locator(".clickmap-popover--visible")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("two maps with open details leave Tab, Escape and Space to whoever owns focus", async ({ page }) => {
  await mount(page, [["light", false], ["shadow", true]]);
  const light = page.locator("#light");
  const shadow = page.locator("#shadow");
  const field = page.locator("#host-field");

  for (const map of [light, shadow]) {
    await map.getByRole("button", { name: "Open test popup" }).focus();
    await page.keyboard.press("Enter");
    await expect(map.getByRole("dialog", { name: "Sanitised popup" })).toBeVisible();
  }

  // Non-modal: Tab walks out of the shadow map's popup instead of cycling in it.
  const shadowClose = shadow.getByRole("dialog").getByRole("button", { name: "Close" });
  await expect(shadowClose).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(shadowClose).not.toBeFocused();
  await expect(shadow.getByRole("dialog")).toBeVisible();

  // The host field keeps Escape, Space and Tab while both popups stay open.
  await light.hover();
  await field.focus();
  await page.keyboard.type("a b");
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("a b");
  await expect(light.getByRole("dialog")).toBeVisible();
  await expect(shadow.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(field).not.toBeFocused();

  // Escape inside one map closes only that map's popup and restores its trigger.
  await light.getByRole("dialog").getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Escape");
  await expect(light.getByRole("dialog")).toBeHidden();
  await expect(light.getByRole("button", { name: "Open test popup" })).toBeFocused();
  await expect(shadow.getByRole("dialog")).toBeVisible();
  await shadow.getByRole("dialog").getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Escape");
  await expect(shadow.getByRole("dialog")).toBeHidden();
  await expect(shadow.getByRole("button", { name: "Open test popup" })).toBeFocused();
});
