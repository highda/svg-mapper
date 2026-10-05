import { test, expect, type Page } from "@playwright/test";

// Drawn polygons stay editable point by point: canvas drag, edge-midpoint
// insert, keyboard nudge/remove, exact Inspector values, one undo step per
// edit, layer locks, and the same coordinates in Preview (#176).

const CANVAS = 'svg[tabindex="-1"]';
const VERTEX = `${CANVAS} [data-testid="vertex-handle"]`;
const MIDPOINT = `${CANVAS} [data-testid="vertex-insert-handle"]`;

async function center(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} not rendered`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The polygon's points as the Inspector lists them. */
async function inspectorPoints(page: Page) {
  const rows = await page.getByTestId("polygon-point-row").count();
  const points: string[] = [];
  for (let i = 1; i <= rows; i++) {
    points.push(`${await page.getByLabel(`Point ${i} X`).inputValue()},${await page.getByLabel(`Point ${i} Y`).inputValue()}`);
  }
  return points;
}

async function drawSnappedPolygon(page: Page) {
  await page.goto("/");
  // Snap to the grid so every coordinate is a whole, comparable number.
  await page.keyboard.press("g");
  await page.getByRole("button", { name: "Polygon (P)" }).click();
  const c = await page.locator(CANVAS).first().boundingBox();
  if (!c) throw new Error("canvas not rendered");
  const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
  for (const [dx, dy] of [[-100, -70], [100, -70], [100, 70], [-100, 70]]) await page.mouse.click(cx + dx!, cy + dy!);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Select (V)" }).click();
  await expect(page.locator(VERTEX)).toHaveCount(4);
}

test("polygon vertices move, insert and delete with one undo step each", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await drawSnappedPolygon(page);
  await expect(page.locator(MIDPOINT)).toHaveCount(4);
  const original = await inspectorPoints(page);
  const shape = page.locator(`${CANVAS} path[style*="move"]`);
  const originalPath = await shape.getAttribute("d");

  // Drag the third vertex; the Inspector shows its new snapped position.
  const v = await center(page, `${VERTEX}[data-vertex-index="2"]`);
  await page.mouse.move(v.x, v.y);
  await page.mouse.down();
  await page.mouse.move(v.x + 40, v.y + 30, { steps: 6 });
  await page.mouse.up();
  const dragged = await inspectorPoints(page);
  expect(dragged).not.toEqual(original);
  expect(dragged.filter((point, i) => point !== original[i])).toHaveLength(1);
  expect(await shape.getAttribute("d")).not.toBe(originalPath);

  // One undo restores the drag; redo reapplies it. Undo clears the
  // selection, so the polygon is picked again to show its points.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => shape.getAttribute("d")).toBe(originalPath);
  await shape.click();
  await expect.poll(() => inspectorPoints(page)).toEqual(original);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await shape.click();
  await expect.poll(() => inspectorPoints(page)).toEqual(dragged);

  // Clicking an edge midpoint adds a point there, as one undo step.
  const m = await center(page, `${MIDPOINT}[data-edge-index="0"]`);
  await page.mouse.click(m.x, m.y);
  await expect(page.locator(VERTEX)).toHaveCount(5);
  await expect(page.locator(`${VERTEX}[data-active="true"]`)).toHaveAttribute("data-vertex-index", "1");
  await page.keyboard.press("ControlOrMeta+z");
  await shape.click();
  await expect(page.locator(VERTEX)).toHaveCount(4);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await shape.click();
  await expect(page.locator(VERTEX)).toHaveCount(5);

  // Keyboard: the picked point nudges by one grid step, then Delete removes it.
  await page.mouse.click(m.x, m.y); // the new point sits on the old midpoint
  const [before] = (await inspectorPoints(page)).slice(1, 2);
  await page.keyboard.press("ArrowUp");
  const [nudged] = (await inspectorPoints(page)).slice(1, 2);
  const [bx, by] = before!.split(",").map(Number);
  expect(nudged).toBe(`${bx},${by! - 10}`);
  await page.keyboard.press("Delete");
  await expect(page.locator(VERTEX)).toHaveCount(4);
  await expect.poll(() => inspectorPoints(page)).toEqual(dragged);
  await expect(page.locator(`${CANVAS} path[style*="move"]`)).toHaveCount(1);

  // Inspector: exact coordinates and the remove button.
  await page.getByLabel("Point 1 X").fill("40");
  await page.getByLabel("Point 1 X").press("Enter");
  await expect.poll(() => inspectorPoints(page).then((p) => p[0]!.split(",")[0])).toBe("40");
  await page.getByRole("button", { name: "Remove point 4" }).click();
  await expect(page.locator(VERTEX)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Remove point 1" })).toBeDisabled();
  await expect(page.getByText("A polygon keeps at least 3 points.")).toBeVisible();

  // At the minimum, Delete on a picked point keeps the area and explains why.
  const first = await center(page, `${VERTEX}[data-vertex-index="0"]`);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("vertex-notice")).toContainText("at least 3 points");
  await expect(page.locator(VERTEX)).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("locked polygons show no vertex handles and Preview draws the edited points", async ({ page }) => {
  await drawSnappedPolygon(page);
  const v = await center(page, `${VERTEX}[data-vertex-index="0"]`);
  await page.mouse.move(v.x, v.y);
  await page.mouse.down();
  await page.mouse.move(v.x - 50, v.y - 20, { steps: 5 });
  await page.mouse.up();
  const edited = await inspectorPoints(page);

  // Locking the layer removes the handles and freezes the point list.
  await page.getByTitle("Lock", { exact: true }).first().click();
  await expect(page.locator(VERTEX)).toHaveCount(0);
  await expect(page.locator(MIDPOINT)).toHaveCount(0);
  await expect(page.getByText("Unlock it to move or resize this area.")).toBeVisible();
  await expect(page.getByLabel("Point 1 X")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add a point after point 1" })).toBeDisabled();

  // Preview runs the real renderer on the same coordinates.
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const polygon = page.frameLocator('iframe[title="Map preview"]').locator("polygon").first();
  await expect(polygon).toHaveAttribute("points", edited.join(" "));
});
