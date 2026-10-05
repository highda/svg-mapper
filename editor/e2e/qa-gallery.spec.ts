import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { staticServer } from "./support/browser-evidence";

// The canonical QA gallery must be trustworthy evidence itself (#178): a
// shadow root cannot be detached, so switching back to light DOM needs a
// fresh host or the light-DOM map is never rendered.

async function mapBox(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector("#frame")!.firstElementChild!;
    const root = (host.shadowRoot ?? host).querySelector(".clickmap-root");
    const box = root?.getBoundingClientRect();
    return { shadow: Boolean(host.shadowRoot), width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
  });
}

test("the gallery toggles light → Shadow → light DOM and the map stays rendered", async ({ page }) => {
  const hosted = await staticServer(resolve(".."));
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${hosted.url}/examples/qa-gallery/index.html`);
    await expect.poll(() => mapBox(page)).toMatchObject({ shadow: false, width: expect.any(Number) });
    const initial = await mapBox(page);
    expect(initial.width).toBeGreaterThan(300);
    expect(initial.height).toBeGreaterThan(100);

    await page.getByLabel("Shadow DOM").check();
    await expect.poll(() => mapBox(page)).toEqual({ ...initial, shadow: true });

    await page.getByLabel("Shadow DOM").uncheck();
    await expect.poll(() => mapBox(page)).toEqual(initial);
    await expect(page.locator("#frame .clickmap-root")).toBeVisible();
  } finally {
    await hosted.close();
  }
});
