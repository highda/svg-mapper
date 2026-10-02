import { test, expect, type Page } from "@playwright/test";

// One drag is one undo entry, and undo never leaves Design without a view (#163).

const CANVAS = 'svg[tabindex="-1"]';

async function box(page: Page) {
  const b = await page.locator(`${CANVAS} path[style*="move"]`).last().boundingBox();
  if (!b) throw new Error("area not rendered");
  return b;
}

test("undo restores a resized rectangle and a deleted view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Rectangle (R)" }).click();
  const canvas = page.locator(CANVAS).first();
  const c = await canvas.boundingBox();
  if (!c) throw new Error("canvas not rendered");
  const x = c.x + c.width / 2 - 75, y = c.y + c.height / 2 - 50;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 100, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Select (V)" }).click();

  const before = await box(page);
  const se = page.locator(`${CANVAS} circle[style*="crosshair"]`).nth(3);
  const h = await se.boundingBox();
  if (!h) throw new Error("handle not rendered");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const resized = await box(page);
  expect(resized.width).toBeGreaterThan(before.width + 20);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => Math.round((await box(page)).width)).toBe(Math.round(before.width));
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => Math.round((await box(page)).width)).toBe(Math.round(resized.width));

  // Escape mid-drag abandons it.
  await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2 + 30);
  await page.mouse.down();
  await page.mouse.move(h.x + 200, h.y + 160, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(Math.round((await box(page)).width)).toBe(Math.round(resized.width));

  // Add View, then Undo: Design still shows a view.
  await page.getByTitle("Add view").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("No view selected")).toHaveCount(0);
  await expect(page.locator(`${CANVAS} path[style*="move"]`)).toHaveCount(1);
});
