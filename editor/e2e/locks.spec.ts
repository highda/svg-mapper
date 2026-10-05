import { test, expect, type Page } from "@playwright/test";

// Layer locks hold for canvas drags, resize handles, the inspector and drawing (#164).

const CANVAS = 'svg[tabindex="-1"]';

async function drawRect(page: Page, dx: number) {
  await page.getByRole("button", { name: "Rectangle (R)" }).click();
  const c = await page.locator(CANVAS).first().boundingBox();
  if (!c) throw new Error("canvas not rendered");
  const x = c.x + c.width / 2 + dx, y = c.y + c.height / 2 - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 60, { steps: 4 });
  await page.mouse.up();
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} not rendered`);
  return b;
}

test("a mixed drag skips the locked layer and undo is one step", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  // Area A in Layer 1; area B in a new Layer 2, which is then locked.
  await drawRect(page, -160);
  await page.getByRole("button", { name: "+ Add Layer" }).click();
  await drawRect(page, 60);
  await page.getByTitle("Lock", { exact: true }).nth(1).click();
  await page.getByRole("button", { name: "Select (V)" }).click();

  const free = `${CANVAS} path[style*="move"]`;
  const locked = `${CANVAS} path[data-locked="true"]`;
  await expect(page.locator(locked)).toHaveCount(1);
  const lockedBefore = await page.locator(locked).getAttribute("d");

  // Select both, then drag the unlocked one.
  await page.locator(free).first().click();
  await page.locator(locked).click({ modifiers: ["Shift"] });
  await expect(page.locator(`${CANVAS} path[stroke-dasharray]`)).toHaveCount(2);
  const freeBefore = await box(page, free);
  await page.mouse.move(freeBefore.x + 20, freeBefore.y + 20);
  await page.mouse.down();
  await page.mouse.move(freeBefore.x + 60, freeBefore.y + 70, { steps: 6 });
  // The locked shape does not move during the preview either.
  expect(await page.locator(locked).getAttribute("d")).toBe(lockedBefore);
  await page.mouse.up();

  const freeAfter = await box(page, free);
  expect(Math.round(freeAfter.x - freeBefore.x)).toBe(40);
  expect(await page.locator(locked).getAttribute("d")).toBe(lockedBefore);
  await expect(page.getByTestId("lock-notice")).toHaveText("Layer “Layer 2” is locked; its geometry was left unchanged.");

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => Math.round((await box(page, free)).x)).toBe(Math.round(freeBefore.x));
  expect(await page.locator(locked).getAttribute("d")).toBe(lockedBefore);

  // The locked area alone: selectable, no resize handles, inspector read-only.
  await page.locator(locked).click();
  await expect(page.locator(`${CANVAS} circle[style*="crosshair"]`)).toHaveCount(0);
  await expect(page.getByText("Unlock it to move or resize this area.")).toBeVisible();
  await expect(page.getByText("Unlock it to move or resize this area.").locator("xpath=ancestor::fieldset").getByRole("spinbutton").first()).toBeDisabled();
  await page.keyboard.press("Delete");
  await expect(page.locator(locked)).toHaveCount(1);
  await expect(page.getByTestId("lock-notice")).toContainText("was not deleted");

  // Drawing into the selected locked layer is refused with an explanation.
  await page.getByText("Layer 2", { exact: true }).click();
  await drawRect(page, 200);
  await expect(page.locator(`${CANVAS} path[style*="cursor"]`)).toHaveCount(2);
  await expect(page.getByTestId("lock-notice")).toContainText("The new area was not added. Layer “Layer 2” is locked.");

  // Unlocking restores normal editing.
  await page.getByTitle("Unlock", { exact: true }).click();
  await page.getByRole("button", { name: "Select (V)" }).click();
  await expect(page.locator(locked)).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss lock notice" }).click();
  await expect(page.getByTestId("lock-notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});
