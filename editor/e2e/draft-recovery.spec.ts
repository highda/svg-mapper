import { test, expect, type Page } from "@playwright/test";

// Recovery status follows the exact revision stored in IndexedDB (#166).

test.use({ viewport: { width: 1400, height: 900 } });

async function rename(page: Page, name: string) {
  await page.locator('button[title="Click to rename"]').click();
  const input = page.locator("header input").first();
  await input.fill(name);
  await input.press("Enter");
}

const unloadPrevented = (page: Page) => page.evaluate(() => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});

test("a second edit is protected until its own draft is stored, and the draft restores", async ({ page }) => {
  await page.goto("/");
  await rename(page, "First draft");
  await expect(page.getByText("Unsaved changes · local draft saved")).toBeVisible();
  expect(await unloadPrevented(page)).toBe(false);

  await rename(page, "Second draft");
  expect(await unloadPrevented(page)).toBe(true);
  await expect(page.getByText("Unsaved changes · local draft saved")).toBeVisible();
  expect(await unloadPrevented(page)).toBe(false);

  await page.reload();
  await page.getByRole("button", { name: "Restore draft" }).click();
  await expect(page.locator('button[title="Click to rename"]')).toContainText("Second draft");
});
