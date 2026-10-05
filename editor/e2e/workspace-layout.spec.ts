import { test, expect, type Page } from "@playwright/test";

// Resizable desktop workspace and inspector hierarchy (#156).

async function openSample(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("button", { name: /Property floors/ }).click();
}

async function width(page: Page, name: "Views and layers" | "Inspector") {
  const box = await page.locator(`[data-panel-content="${name === "Inspector" ? "inspector" : "tree"}"]`).boundingBox();
  return Math.round(box?.width ?? 0);
}

async function canvasWidth(page: Page) {
  return Math.round((await page.locator("#workspace-main").boundingBox())?.width ?? 0);
}

test("keyboard resizes, collapses and resets the side panels without touching the project", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await openSample(page);
  const row = page.getByRole("treeitem", { name: /Available suite/ }).first();
  await row.click();
  await expect(page.getByText("Downloaded version")).toBeVisible();
  expect(await width(page, "Views and layers")).toBe(240);
  expect(await width(page, "Inspector")).toBe(304);

  // Tree separator: arrows resize, Enter collapses and restores.
  const treeEdge = page.getByRole("separator", { name: "Resize views and layers panel" });
  await treeEdge.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const widened = await width(page, "Views and layers");
  expect(widened).toBeGreaterThan(260);
  await expect(treeEdge).toBeFocused();
  await expect(row).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, "Views and layers")).toBe(0);
  await expect(page.locator('[data-panel-content="tree"]')).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Tree panel", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, "Views and layers")).toBe(widened);
  await expect(row).toHaveAttribute("aria-selected", "true");

  // Inspector separator: the panel is after the edge, so ArrowLeft widens it.
  const inspectorEdge = page.getByRole("separator", { name: "Resize inspector panel" });
  await inspectorEdge.focus();
  await page.keyboard.press("ArrowLeft");
  const inspectorWide = await width(page, "Inspector");
  expect(inspectorWide).toBeGreaterThan(320);
  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, "Inspector")).toBe(0);
  await expect(inspectorEdge).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, "Inspector")).toBe(inspectorWide);

  // The panel's own hide button hands focus to its edge; the status bar restores it.
  await page.getByRole("button", { name: "Hide inspector panel" }).click();
  await expect.poll(() => width(page, "Inspector")).toBe(0);
  const inspectorToggle = page.getByRole("button", { name: "Inspector panel", exact: true });
  await expect(inspectorToggle).toHaveAttribute("aria-pressed", "false");
  await inspectorToggle.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, "Inspector")).toBe(inspectorWide);

  // Preferences survive a reload; they are browser settings, not project changes.
  await expect(page.getByText("Downloaded version")).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem("svg-mapper.editor.layout.v1"));
  expect(JSON.parse(stored ?? "{}")).toMatchObject({ tree: { size: widened, collapsed: false }, inspector: { size: inspectorWide, collapsed: false } });
  await page.reload();
  await expect.poll(() => width(page, "Views and layers")).toBe(widened);
  expect(await width(page, "Inspector")).toBe(inspectorWide);

  const reset = page.getByRole("button", { name: "Reset layout" });
  await reset.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, "Views and layers")).toBe(240);
  expect(await width(page, "Inspector")).toBe(304);
  expect(errors).toEqual([]);
});

test("window resizing keeps selection, focus, inspector scroll and a usable canvas", async ({ page }) => {
  await openSample(page);
  await page.getByRole("treeitem", { name: /Available suite/ }).first().click();
  const scroller = page.getByRole("complementary", { name: "Inspector" }).locator(".overflow-y-auto");
  await scroller.evaluate((element) => { element.scrollTop = 180; });
  const name = page.getByRole("textbox", { name: "Title", exact: true });
  await name.focus();
  const scrollBefore = await scroller.evaluate((element) => element.scrollTop);

  for (const size of [{ width: 1180, height: 760 }, { width: 1024, height: 600 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(name).toBeFocused();
    await expect(page.getByRole("treeitem", { name: /Available suite/ }).first()).toHaveAttribute("aria-selected", "true");
    expect(await canvasWidth(page)).toBeGreaterThanOrEqual(360);
    expect(await width(page, "Views and layers")).toBe(240);
    expect(await width(page, "Inspector")).toBe(304);
  }
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
});

test("the 1024×600 floor keeps project operations and selected properties reachable", async ({ page }) => {
  await openSample(page, 1024, 600);
  await page.getByRole("treeitem", { name: /Available suite/ }).first().click();
  for (const label of ["New", "Samples", "Open", "Save", "Design", "Tree", "Flow", "Preview", "Export"]) {
    await expect(page.getByRole("banner").getByRole("button", { name: label, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByText("Downloaded version")).toBeInViewport();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByRole("textbox", { name: "Name", exact: true })).toBeInViewport({ ratio: 1 });
  const action = inspector.getByRole("combobox", { name: "Type", exact: true });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 1 });
  expect(await canvasWidth(page)).toBeGreaterThanOrEqual(360);

  // Widest panels still leave the canvas its minimum.
  for (const edge of ["Resize views and layers panel", "Resize inspector panel"]) {
    await page.getByRole("separator", { name: edge }).focus();
    await page.keyboard.press(edge.includes("inspector") ? "Home" : "End");
  }
  expect(await canvasWidth(page)).toBeGreaterThanOrEqual(355);
  await expect(page.getByRole("banner").getByRole("button", { name: "Export", exact: true })).toBeInViewport({ ratio: 1 });
});

test("tree rows keep names readable and move areas from selected-row controls or the keyboard", async ({ page }) => {
  await openSample(page);
  const view = page.getByRole("tree", { name: "Map hierarchy" });
  const suite = view.getByRole("treeitem", { name: /Available suite/ }).first();
  await expect(suite.locator("button, select")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /to layer$/ })).toHaveCount(0);

  await suite.click();
  const controls = page.getByRole("region", { name: "Arrange Available suite" });
  await expect(controls.getByRole("combobox", { name: "Move Available suite to layer" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Move backward" })).toBeDisabled();

  const firstRows = () => view.getByRole("treeitem").evaluateAll((rows) => rows.slice(0, 2).map((row) => row.textContent?.trim()));
  expect(await firstRows()).toEqual(["Available suite", "Meeting room"]);
  await suite.press("Alt+ArrowDown");
  await expect.poll(firstRows).toEqual(["Meeting room", "Available suite"]);
  await expect(view.getByRole("treeitem", { name: /Available suite/ }).first()).toBeFocused();
  await controls.getByRole("button", { name: "Move backward" }).click();
  await expect.poll(firstRows).toEqual(["Available suite", "Meeting room"]);
});

test("inspector leads with basics and action; advanced and less-used sections open on demand", async ({ page }) => {
  await openSample(page);
  await page.getByRole("treeitem", { name: /Available suite/ }).first().click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const headings = await inspector.locator("h3 button").evaluateAll((buttons) => buttons.map((button) => button.textContent?.replace(/^▶/, "")));
  const order = ["Basics", "Action", "Details", "Geometry", "Style", "Hover, active, disabled", "Interaction", "Label", "Accessibility", "Image region", "Metadata"];
  expect(headings.map((text) => order.find((title) => text?.startsWith(title)))).toEqual(order);

  // Action is visible without scrolling past style or advanced controls.
  await expect(inspector.getByRole("combobox", { name: "Type", exact: true })).toBeInViewport();

  const states = inspector.getByRole("button", { name: /^Hover, active, disabled/ });
  await expect(states).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Hover fill CSS color")).toBeHidden();
  await states.focus();
  await page.keyboard.press("Enter");
  await expect(states).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Hover fill CSS color")).toBeVisible();

  const metadata = inspector.getByRole("button", { name: /^Metadata.*Advanced/ });
  await expect(metadata).toHaveAttribute("aria-expanded", "false");
  await metadata.click();
  await expect(page.getByLabel("New metadata key")).toBeVisible();

  // View settings keep custom CSS and templates behind explicit Advanced sections.
  await page.getByRole("treeitem", { name: /Available suite/ }).first().click({ modifiers: ["ControlOrMeta"] });
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("Inspector · View & project");
  const css = inspector.getByRole("button", { name: /^Custom CSS.*Advanced/ });
  await expect(css).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("View CSS")).toBeHidden();
  await css.click();
  await expect(page.getByLabel("View CSS")).toBeVisible();
  await expect(inspector.getByRole("button", { name: /^HTML template.*Advanced/ })).toHaveAttribute("aria-expanded", "false");
});

test("Export is a focused publication workspace", async ({ page }) => {
  await openSample(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByTestId("export-button")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Views and layers" })).toHaveCount(0);
  await expect(page.getByRole("separator")).toHaveCount(0);
});
