import { test, expect } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`first-time author reaches Preview and Export on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    if (viewport.name === "mobile") {
      await page.getByRole("button", { name: "Project" }).click();
    }
    await page.getByRole("button", { name: "Samples", exact: true }).click();
    await page.getByRole("button", { name: /Property floors/ }).click();

    await expect(page.locator('button[title="Click to rename"]')).toContainText("Property floors");
    await expect(page.getByLabel("First map checklist")).toContainText("3/5 steps");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByTitle("Map preview")).toBeVisible();
    await expect(page.getByLabel("First map checklist")).toContainText("4/5 steps");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByTestId("export-button")).toBeVisible();
    await expect(page.getByLabel("First map checklist")).toContainText("5/5 steps");
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-first-use.png`), fullPage: true });
  });
}

test("tree supports pointer ranges and keyboard selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();
  await page.getByRole("button", { name: "Tree", exact: true }).click();

  const first = page.getByRole("treeitem", { name: /Available suite/ }).first();
  const second = page.getByRole("treeitem", { name: /Meeting room/ }).first();
  await first.click();
  await second.click({ modifiers: ["Shift"] });
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText("2 areas");

  await second.press("ArrowUp");
  await expect(first).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "false");
});

test("multi-selection exposes mixed values and batches style changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();
  await page.getByRole("button", { name: "Tree", exact: true }).click();

  const first = page.getByRole("treeitem", { name: /Available suite/ }).first();
  const second = page.getByRole("treeitem", { name: /Meeting room/ }).first();
  await first.click();
  const fill = page.getByLabel("Default fill CSS color");
  await fill.fill("#ff0000");
  await fill.press("Enter");
  await second.click({ modifiers: ["Shift"] });

  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("Mixed styles");
  await page.getByRole("button", { name: "Apply primary style to 2 areas" }).click();
  await expect(inspector).toContainText("All selected areas share this style");

  await page.getByLabel("New style preset name").fill("Availability");
  await inspector.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByLabel("Named style preset").selectOption({ label: "Availability" });
  await expect(page.getByLabel("Named style preset")).toHaveValue(/style_/);
  await page.getByRole("button", { name: "Apply linked" }).click();
  await expect(inspector).toContainText("Linked to Availability");
  await page.getByRole("button", { name: "Update preset" }).click();
});
