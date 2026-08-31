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

  it("renders rich tooltip content while stripping executable HTML", () => {
    const area = createRectArea(0, 0, 10, 10);
    area.tooltip = {
      enabled: true,
      title: "Details",
      body: '<em onclick="alert(1)">Safe</em><script>alert(2)</script>',
      imageUrl: "https://example.com/thumb.png",
    };
    renderAreas(area);

    areaElement(area.id).dispatchEvent(new Event("pointerover", { bubbles: true }));
    const tooltip = document.querySelector<HTMLElement>(".clickmap-tooltip")!;
    expect(tooltip).toHaveClass("clickmap-tooltip--visible");
    expect(tooltip.querySelector("img")).toHaveAttribute("src", area.tooltip.imageUrl);
    expect(tooltip.querySelector("em")).toHaveTextContent("Safe");
    expect(tooltip.querySelector("em")).not.toHaveAttribute("onclick");
    expect(tooltip.querySelector("script")).toBeNull();
  });

  it("keeps a popover open after its trigger click and closes it outside or with Escape", () => {
    const area = createRectArea(0, 0, 10, 10);
    area.action = { type: "popup", content: { title: "Welcome" } };
    const instance = renderAreas(area);

    areaElement(area.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const popover = document.querySelector<HTMLElement>(".clickmap-popover")!;
    expect(popover).toHaveClass("clickmap-popover--visible");
    expect(popover).toHaveTextContent("Welcome");

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(popover).not.toHaveClass("clickmap-popover--visible");

    areaElement(area.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover).not.toHaveClass("clickmap-popover--visible");
    instance.destroy();
  });

  it("replaces the open popover, sanitises its body, and traps focus", () => {
    const first = createRectArea(0, 0, 10, 10);
    first.action = { type: "popup", content: { title: "First" } };
    const second = createRectArea(20, 0, 10, 10);
    second.action = {
      type: "popup",
      content: {
        title: "Second",
        body: '<b onmouseover="bad()">Body</b>',
        linkHref: "https://example.com",
        linkLabel: "Learn more",
      },
    };
    renderAreas(first, second);

    areaElement(first.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    areaElement(second.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const popover = document.querySelector<HTMLElement>(".clickmap-popover")!;
    expect(document.querySelectorAll(".clickmap-popover--visible")).toHaveLength(1);
    expect(popover).not.toHaveTextContent("First");
    expect(popover).toHaveTextContent("Second");
    expect(popover.querySelector("b")).not.toHaveAttribute("onmouseover");

    const close = popover.querySelector<HTMLButtonElement>("button")!;
    close.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(popover.querySelector("a"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(close);
  });

  it("auto-positions popovers away from the nearest container edge", () => {
    const area = createRectArea(0, 40, 10, 10);
    area.action = { type: "popup", content: { title: "Edge" }, position: "auto" };
    const map = document.querySelector<HTMLElement>("#map")!;
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500,
      width: 1000, height: 500, toJSON: () => ({}),
    });
    renderAreas(area);

    areaElement(area.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".clickmap-popover")).toHaveClass("clickmap-popover--right");
  });
});
