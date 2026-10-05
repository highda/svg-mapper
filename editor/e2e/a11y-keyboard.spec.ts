import { test, expect, type Page } from "@playwright/test";

// Dialog focus containment, Escape, focus return, and labelled inspector
// fields, driven from the keyboard (#174).

async function focusInsideDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
}

async function expectTabStaysInside(page: Page, presses = 12) {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page)).toBe(true);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInsideDialog(page)).toBe(true);
  }
}

async function openSample(page: Page) {
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();
  const row = page.getByRole("treeitem", { name: /Available suite/ }).first();
  await row.getByText("Available suite", { exact: true }).click();
}

test("Samples, help and replace dialogs trap focus, close with Escape and return focus", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(message.text()); });
  await page.goto("/");

  // Samples from the keyboard.
  const samples = page.getByRole("button", { name: "Samples", exact: true });
  await samples.focus();
  await page.keyboard.press("Enter");
  const starter = page.getByRole("dialog", { name: "Start a map" });
  await expect(starter).toBeVisible();
  await expect(starter).toHaveAttribute("aria-modal", "true");
  expect(await focusInsideDialog(page)).toBe(true);
  await expectTabStaysInside(page);
  await page.keyboard.press("Escape");
  await expect(starter).toHaveCount(0);
  await expect(samples).toBeFocused();

  // Help opens with "?", keeps focus, closes with Escape.
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expectTabStaysInside(page, 3);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(samples).toBeFocused();

  // Make unsaved work, then ask to replace it.
  await openSample(page);
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Renamed suite");
  await name.press("Enter");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  const before = await page.getByRole("treeitem").count();

  const newButton = page.getByRole("button", { name: "New", exact: true });
  await newButton.focus();
  await page.keyboard.press("Enter");
  const replace = page.getByRole("dialog", { name: "Save changes first?" });
  await expect(replace).toBeVisible();
  await expect(replace.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectTabStaysInside(page, 5);
  // Destructive shortcuts stay off behind the dialog.
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Escape");
  await expect(replace).toHaveCount(0);
  await expect(newButton).toBeFocused();
  await expect(page.getByRole("treeitem")).toHaveCount(before);
  await expect(page.getByRole("treeitem", { name: /Renamed suite/ })).toHaveCount(1);

  // Samples → replace: focus returns to Samples once both dialogs close.
  await samples.click();
  await page.getByRole("button", { name: /Blank map/ }).click();
  await expect(replace).toBeVisible();
  await expect(replace.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(replace).toHaveCount(0);
  await expect(samples).toBeFocused();
  await expect(page.getByRole("treeitem", { name: /Renamed suite/ })).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("export warning confirmation is keyboard operable", async ({ page }) => {
  await page.goto("/");
  await openSample(page);
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("none");
  await page.getByRole("button", { name: "Export", exact: true }).click();

  const download = page.getByTestId("export-button");
  await download.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "Export with warnings?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectTabStaysInside(page, 4);
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(download).toBeFocused();
});

test("inspector fields are labelled and the accessible name reaches Preview", async ({ page }) => {
  await page.goto("/");
  await openSample(page);

  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const unnamed = await inspector.locator("input, select, textarea").evaluateAll((fields) =>
    fields.filter((field) => {
      const labelled = field.getAttribute("aria-label")
        || (field.getAttribute("aria-labelledby") ?? "").trim()
        || (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`))
        || field.closest("label");
      return !labelled;
    }).map((field) => field.outerHTML.slice(0, 100)));
  expect(unnamed).toEqual([]);

  // Row labels name their fields; errors are described.
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("url");
  const url = page.getByRole("textbox", { name: "URL", exact: true });
  await url.fill("javascript:alert(1)");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(url).toHaveAccessibleDescription(/./);
  await url.fill("https://example.com/suite");
  await url.press("Enter");

  const accessibleName = page.getByRole("textbox", { name: "Accessible name" });
  await accessibleName.fill("Suite 4B, available to rent");
  await accessibleName.press("Enter");
  await expect(accessibleName).toHaveAccessibleDescription(/announce “Suite 4B, available to rent”/);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Map preview"]');
  await expect(frame.getByRole("button", { name: "Suite 4B, available to rent" })).toHaveCount(1);
});
