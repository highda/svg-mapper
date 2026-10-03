import { test, expect } from "@playwright/test";

// Committing an inspector field keeps keyboard focus moving forward (#165).

test("Tab from a committed color moves to the next field", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();
  const row = page.getByRole("treeitem", { name: /Available suite/ }).first();
  await row.getByText("Available suite", { exact: true }).click();

  const fill = page.getByLabel("Default fill CSS color");
  await fill.fill("#ff0000");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Default fill opacity")).toBeFocused();
  await expect(fill).toHaveValue("#ff0000");

  // Undo shows the restored value.
  await page.getByRole("button", { name: "Undo" }).click();
  await row.getByText("Available suite", { exact: true }).click();
  await expect(page.getByLabel("Default fill CSS color")).not.toHaveValue("#ff0000");
});
