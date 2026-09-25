import { test, expect, type Page } from "@playwright/test";

// The editor shell is bounded to the viewport; only its panels scroll (#155).
// These checks assert real layout (no descendant overflows the document) and
// document offsets after wheel, keyboard, and focus interactions.

async function documentMetrics(page: Page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement as HTMLElement;
    const shifted: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      if (!el.scrollTop && !el.scrollLeft) continue;
      const style = getComputedStyle(el);
      if (!/auto|scroll/.test(style.overflowX + style.overflowY)) shifted.push(el.tagName);
    }
    const shell = document.getElementById("root")?.firstElementChild?.getBoundingClientRect();
    return {
      shellOutsideViewport: !shell || shell.bottom > innerHeight || shell.right > innerWidth,
      scrollTop: doc.scrollTop,
      scrollLeft: doc.scrollLeft,
      overflowY: doc.scrollHeight - doc.clientHeight,
      overflowX: doc.scrollWidth - doc.clientWidth,
      clippedContainersScrolled: shifted,
    };
  });
}

const stationary = { shellOutsideViewport: false, scrollTop: 0, scrollLeft: 0, overflowY: 0, overflowX: 0, clippedContainersScrolled: [] };

for (const viewport of [
  { width: 1024, height: 600 },
  { width: 1440, height: 900 },
]) {
  test(`outer document stays stationary at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Samples", exact: true }).click();
    await page.getByRole("button", { name: /Property floors/ }).click();

    for (const screen of ["Design", "Tree", "Flow", "Preview", "Export"]) {
      await page.getByRole("button", { name: screen, exact: true }).click();
      for (const [x, y] of [[viewport.width - 80, viewport.height / 2], [80, viewport.height / 2], [viewport.width / 2, 12]]) {
        await page.mouse.move(x, y);
        for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 800);
        for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -800);
      }
      await page.keyboard.press("PageDown");
      await page.keyboard.press("End");
      for (let i = 0; i < 40; i += 1) await page.keyboard.press("Tab");
      expect(await documentMetrics(page), `${screen} after wheel, keyboard, and focus`).toEqual(stationary);
    }

    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator("body").press("?");
    const help = page.getByRole("heading", { name: "Keyboard Shortcuts" });
    await expect(help).toBeInViewport();
    expect(await documentMetrics(page)).toEqual(stationary);
  });
}

test("panel scroll regions remain operable while the document is fixed", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();
  await page.getByRole("treeitem", { name: /Available suite/ }).first().click();

  const inspector = page.locator("aside").last().locator(".overflow-y-auto").first();
  const box = await inspector.boundingBox();
  if (!box) throw new Error("Inspector scroll region is not rendered");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => inspector.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await documentMetrics(page)).toEqual(stationary);
});
