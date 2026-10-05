import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Untrusted popup HTML cannot style the host page or another map instance (#167).

const ORIGIN = "http://sanitize.test";
const fixturePath = resolve("../examples/qa-gallery/fixtures/fit-and-actions.json");
const rendererJsPath = resolve("../renderer/dist/clickmap-renderer.js");
const rendererCssPath = resolve("../renderer/dist/clickmap-renderer.css");
const PAYLOAD = "<style>body{--review-injected:yes} .clickmap-root{outline:9px solid red}</style><b>Safe text</b>";

test("popup body styles neither the host nor another instance", async ({ page }) => {
  const [js, css, fixture] = await Promise.all([readFile(rendererJsPath, "utf8"), readFile(rendererCssPath, "utf8"), readFile(fixturePath, "utf8")]);
  const definition = JSON.parse(fixture);
  const view = definition.views.find((v: { id: string }) => v.id === definition.settings.initialViewId) ?? definition.views[0];
  const area = view.layers[0].areas[0];
  area.trigger = "click";
  area.action = { type: "popup", content: { title: "Injected", body: PAYLOAD } };

  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>${css}</style></head><body>
      <div id="one" style="width:600px;height:400px"></div><div id="two" style="width:600px;height:400px"></div>
      <script>${js}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((def) => {
    const w = window as unknown as { ClickMapRenderer: { create(o: object): unknown } };
    w.ClickMapRenderer.create({ container: "#one", definition: def });
    w.ClickMapRenderer.create({ container: "#two", definition: def });
  }, definition);

  await page.locator(`#one [data-area-id="${area.id}"]`).click();
  const popover = page.locator("#one .clickmap-popover--visible");
  await expect(popover.locator("b")).toHaveText("Safe text");
  await expect(popover.locator("style")).toHaveCount(0);

  const state = await page.evaluate(() => ({
    hostVar: getComputedStyle(document.body).getPropertyValue("--review-injected").trim(),
    otherOutline: getComputedStyle(document.querySelector("#two .clickmap-root")!).outlineStyle,
  }));
  expect(state).toEqual({ hostVar: "", otherOutline: "none" });
});
