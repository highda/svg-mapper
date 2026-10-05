import { test, expect, type Page } from "@playwright/test";

// The authored Active style is the persistent selected state (#214): the
// Inspector previews it on the canvas and Preview exercises the real renderer.

const ACTIVE_STROKE = "#047857"; // starter-project style.active
const HOVER_STROKE = "#1d4ed8";
const DEFAULT_STROKE = "#2563eb";

async function openCampus(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Campus places/ }).click();
}

test("Inspector previews the Active (selected) state on the canvas", async ({ page }) => {
  await openCampus(page);
  const shape = page.locator(`svg path[stroke="${DEFAULT_STROKE}"]`).first();
  await shape.click();
  const picker = page.getByRole("group", { name: "Canvas style preview" });
  await picker.getByRole("button", { name: "Active" }).click();
  await expect(picker.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`svg path[stroke="${ACTIVE_STROKE}"]`)).toHaveCount(1);
  await picker.getByRole("button", { name: "Default" }).click();
  await expect(page.locator(`svg path[stroke="${ACTIVE_STROKE}"]`)).toHaveCount(0);
});

test("Preview: select, hover another area, Escape, and change views", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openCampus(page);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Last event:")).toContainText("ready");
  const frame = page.frameLocator('iframe[title="Map preview"]');
  const services = frame.locator('[data-area-id="area-campus-0-b"]');
  const reception = frame.locator('[data-area-id="area-campus-0-a"]');
  const selected = page.getByTestId("preview-selected");

  await services.click();
  await expect(selected).toHaveText("Accessible services");
  await expect(services).toHaveAttribute("stroke", ACTIVE_STROKE);
  await expect(services).toHaveAttribute("aria-current", "true");

  // Hovering another area does not move or hide the selection.
  await reception.hover();
  await expect(reception).toHaveAttribute("stroke", HOVER_STROKE);
  await expect(services).toHaveAttribute("stroke", ACTIVE_STROKE);

  // Escape closes the area's popup, which ends its selection.
  await page.keyboard.press("Escape");
  await expect(selected).toHaveText("—");
  await expect(services).not.toHaveAttribute("aria-current", "true");

  // Selecting an area whose action changes view clears the selection on leave.
  await reception.click();
  await expect(page.getByText(/^View:/)).toContainText("Library");
  await expect(selected).toHaveText("—");
  await expect(page.getByText("Last event:")).toContainText("view:change");
  expect(errors).toEqual([]);
});
