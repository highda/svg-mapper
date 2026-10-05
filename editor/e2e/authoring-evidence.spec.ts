import { test, expect, type Page } from "@playwright/test";
import { paintsPixels } from "./support/browser-evidence";

// Behavioural desktop-authoring regressions (#178): rendered pixels for the
// sample artwork (#161) and canvas geometry for shortcuts and undo (#162, #163).

test.use({ viewport: { width: 1440, height: 900 } });

const CANVAS = 'svg[tabindex="-1"]';
const AREAS = `${CANVAS} path[style*="move"]`;

for (const sample of ["Property floors", "Park attractions", "Campus places"]) {
  test(`${sample} background paints in Design and in the Preview renderer`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Samples", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(sample) }).click();

    const editorBackground = page.locator(`${CANVAS} image.clickmap-editor-bg`);
    await expect(editorBackground).toHaveCount(1);
    await expect.poll(() => paintsPixels(page, editorBackground), { message: "Design canvas background" }).toBe(true);

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByText("Last event:")).toContainText("ready");
    const previewBackground = page.frameLocator('iframe[title="Map preview"]').locator("image.clickmap-bg-img").first();
    await expect.poll(() => paintsPixels(page, previewBackground), { message: "Preview renderer background" }).toBe(true);
  });
}

async function boxes(page: Page) {
  return page.locator(AREAS).evaluateAll((paths) => paths.map((path) => {
    const b = path.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  }));
}

test("canvas copy, paste, duplicate and delete are geometric and each undoes in one step", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Rectangle (R)" }).click();
  const c = await page.locator(CANVAS).first().boundingBox();
  if (!c) throw new Error("canvas not rendered");
  const x = c.x + c.width / 2 - 120, y = c.y + c.height / 2 - 80;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 100, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Select (V)" }).click();
  const [original] = await boxes(page);
  expect(original!.width).toBeGreaterThan(100);

  // Copy/paste with the area selected on the canvas: no tool switch, one
  // offset copy of identical size.
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await boxes(page)).length).toBe(2);
  const pasted = (await boxes(page))[1]!;
  expect({ width: pasted.width, height: pasted.height }).toEqual({ width: original!.width, height: original!.height });
  expect(pasted.x - original!.x).toBeGreaterThan(0);
  expect(pasted.x - original!.x).toBe(pasted.y - original!.y);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => boxes(page)).toEqual([original]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await boxes(page)).length).toBe(2);

  // Delete the selected copy, then undo puts it back at the same place.
  const beforeDelete = await boxes(page);
  await page.locator(AREAS).last().click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await boxes(page)).length).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => boxes(page)).toEqual(beforeDelete);

  // Duplicate is one step as well.
  await page.locator(AREAS).first().click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(async () => (await boxes(page)).length).toBe(3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => boxes(page)).toEqual(beforeDelete);
});
