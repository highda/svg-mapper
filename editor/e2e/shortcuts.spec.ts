import { test, expect } from "@playwright/test";

// Ctrl/Cmd shortcuts run before tool letters; dialogs own the keyboard (#162).

test("copy and paste an area from the tree without switching tools", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();

  const rows = page.getByRole("treeitem");
  const before = await rows.count();
  const row = page.getByRole("treeitem", { name: /Available suite/ }).first();
  // Click the name: the row centre holds its reorder buttons in a narrow panel.
  await row.getByText("Available suite", { exact: true }).click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(rows).toHaveCount(before + 1);
  await expect(page.getByRole("treeitem", { name: /Available suite copy/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Select (V)" })).toHaveAttribute("aria-pressed", "true");

  // A plain letter still switches tools.
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Rectangle (R)" })).toHaveAttribute("aria-pressed", "true");

  // The help dialog blocks editing shortcuts.
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("v");
  await expect(page.getByRole("button", { name: "Rectangle (R)" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
});
