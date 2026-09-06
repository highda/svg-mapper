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
