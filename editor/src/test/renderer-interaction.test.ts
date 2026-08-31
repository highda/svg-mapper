import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "../../../renderer/src/renderer";
import { createRectArea } from "../lib/area-utils";
import { createNewProject, toDefinition } from "../lib/project";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  document.body.innerHTML = '<div id="map"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function renderAreas(...areas: ReturnType<typeof createRectArea>[]) {
  const project = createNewProject();
  project.views[0].layers = [{
    id: "layer_1",
    name: "Layer 1",
    visible: true,
    locked: false,
    opacity: 1,
    areas,
  }];
  return create({ container: "#map", definition: toDefinition(project) });
}

function areaElement(id: string): SVGElement {
  const el = document.querySelector<SVGElement>(`[data-area-id="${id}"]`);
  if (!el) throw new Error(`Area ${id} was not rendered`);
  return el;
}

describe("renderer interaction model", () => {
  it("applies trigger mode to hover and click events", () => {
    const hoverOnly = createRectArea(0, 0, 10, 10);
    hoverOnly.trigger = "hover";
    const clickOnly = createRectArea(20, 0, 10, 10);
    clickOnly.trigger = "click";
    const instance = renderAreas(hoverOnly, clickOnly);
    const onHover = vi.fn();
    const onClick = vi.fn();
    instance.on("area:hover", onHover);
    instance.on("area:click", onClick);

    const hoverEl = areaElement(hoverOnly.id);
    hoverEl.dispatchEvent(new Event("pointerover", { bubbles: true }));
    hoverEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onHover).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();

    const clickEl = areaElement(clickOnly.id);
    clickEl.dispatchEvent(new Event("pointerover", { bubbles: true }));
    clickEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onHover).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps always-highlighted areas in hover style", () => {
    const area = createRectArea(0, 0, 10, 10);
    area.alwaysHighlight = true;
    renderAreas(area);

    const el = areaElement(area.id);
    expect(el.getAttribute("fill")).toBe(area.style.hover.fill);
    expect(el.getAttribute("stroke")).toBe(area.style.hover.stroke);
  });

  it("renders disabled areas as non-interactive with their disabled style", () => {
    const area = createRectArea(0, 0, 10, 10);
    area.disabled = true;
    area.action = { type: "customEvent", eventName: "area-action" };
    area.style.disabled = { fill: "#aaaaaa", stroke: "#333333", strokeWidth: 4 };
    const instance = renderAreas(area);
    const onHover = vi.fn();
    const onClick = vi.fn();
    instance.on("area:hover", onHover);
    instance.on("area:click", onClick);

    const el = areaElement(area.id);
    el.dispatchEvent(new Event("pointerover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(el).toHaveAttribute("aria-disabled", "true");
    expect(el).toHaveAttribute("tabindex", "-1");
    expect(el.style.cursor).toBe("not-allowed");
    expect(el.getAttribute("fill")).toBe("#aaaaaa");
    expect(onHover).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
