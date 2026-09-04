import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";
import { createRectArea } from "../lib/area-utils";
import { createNewProject, toDefinition } from "../lib/project";

class ResizeObserverStub {
  static callback: ResizeObserverCallback | undefined;
  constructor(callback: ResizeObserverCallback) { ResizeObserverStub.callback = callback; }
  observe() {}
  disconnect() {}
  static resize(target: Element, width: number, height: number) {
    this.callback?.([{ target, contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
  }
}

beforeEach(() => {
  __setInlinedCSS(".clickmap-root { position: relative; }");
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.history.replaceState(null, "", window.location.pathname);
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
  it.each([
    ["fixed", "1600px", "900px", ""],
    ["fluid-width", "100%", "auto", "1600 / 900"],
    ["fill-container", "100%", "100%", ""],
  ] as const)("applies the %s container sizing contract", (mode, width, height, ratio) => {
    const project = createNewProject();
    project.settings.sizingMode = mode;
    create({ container: "#map", definition: toDefinition(project) });

    const root = document.querySelector<HTMLElement>(".clickmap-root")!;
    const view = document.querySelector<HTMLElement>(".clickmap-view")!;
    expect(root.dataset.sizing).toBe(mode);
    expect(root.style.width).toBe(width);
    expect(root.style.height).toBe(height);
    expect(view.style.aspectRatio).toBe(ratio);
  });

  it.each([
    [0, 0, "zero-size"],
    [1440, 560, "wide"],
    [560, 1440, "tall"],
    [375, 667, "mobile"],
  ])("remains mounted after a %s x %s (%s) ResizeObserver update", async (width, height) => {
    const project = createNewProject();
    project.settings.sizingMode = "fill-container";
    const host = document.querySelector<HTMLElement>("#map")!;
    create({ container: host, definition: toDefinition(project) });

    ResizeObserverStub.resize(host, width, height);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(host.querySelector(".clickmap-root")).not.toBeNull();
    expect(host.querySelector<HTMLElement>(".clickmap-root")?.style.height).toBe("100%");
    expect(host.querySelector(".clickmap-areas")).not.toBeNull();
  });

  it("maps legacy responsive flags to the explicit sizing modes", () => {
    const project = createNewProject();
    delete project.settings.sizingMode;
    project.settings.responsive = false;
    create({ container: "#map", definition: toDefinition(project) });
    expect(document.querySelector<HTMLElement>(".clickmap-root")!.dataset.sizing).toBe("fixed");
  });

  it("reserves touch gestures only when map panning is enabled", () => {
    const project = createNewProject();
    project.views[0].viewport.panEnabled = true;
    create({ container: "#map", definition: toDefinition(project) });
    expect(document.querySelector<SVGSVGElement>(".clickmap-areas")?.style.touchAction).toBe("none");

    document.body.innerHTML = '<div id="map"></div>';
    project.views[0].viewport.panEnabled = false;
    create({ container: "#map", definition: toDefinition(project) });
    expect(document.querySelector<SVGSVGElement>(".clickmap-areas")?.style.touchAction).toBe("auto");
  });

  it("switches views without a fade when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const project = createNewProject();
    project.views.push({ ...project.views[0], id: "view_second", name: "Second", slug: "second" });
    const instance = create({ container: "#map", definition: toDefinition(project) });

    instance.goToView("view_second");

    expect(instance.getCurrentView()).toBe("view_second");
    expect(document.querySelector<HTMLElement>(".clickmap-view")?.style.opacity).toBe("");
  });

  it("switches sizing and map coordinates with each view", async () => {
    const project = createNewProject();
    project.settings.sizingMode = "fixed";
    project.views.push({
      ...project.views[0],
      id: "view_portrait",
      name: "Portrait",
      slug: "portrait",
      canvas: { width: 400, height: 900 },
      layers: [],
    });
    const instance = create({ container: "#map", definition: toDefinition(project) });

    expect(document.querySelector<HTMLElement>(".clickmap-root")?.style.width).toBe("1600px");
    instance.goToView("view_portrait");
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(document.querySelector<HTMLElement>(".clickmap-root")?.style.width).toBe("400px");
    expect(document.querySelector<HTMLElement>(".clickmap-root")?.style.height).toBe("900px");
    expect(document.querySelector<SVGSVGElement>(".clickmap-areas")?.getAttribute("viewBox")).toBe("0 0 400 900");
  });

  it("isolates renderer DOM and styles in an optional shadow root", () => {
    const project = createNewProject();
    const host = document.querySelector<HTMLElement>("#map")!;
    const instance = create({
      container: host,
      definition: toDefinition(project),
      shadowDom: true,
      css: ".clickmap-root { color: rebeccapurple; }",
    });

    expect(host.shadowRoot).not.toBeNull();
    expect(document.querySelector(".clickmap-root")).toBeNull();
    expect(host.shadowRoot!.querySelector(".clickmap-root")).not.toBeNull();
    expect(host.shadowRoot!.querySelector("style")).toHaveTextContent(
      ".clickmap-root { position: relative; }",
    );
    expect(host.shadowRoot!.querySelector("style")).toHaveTextContent(
      ".clickmap-root { color: rebeccapurple; }",
    );

    instance.destroy();
    expect(host.shadowRoot!.childNodes).toHaveLength(0);

    const replacement = create({
      container: host,
      definition: toDefinition(project),
      shadowDom: true,
    });
    expect(host.shadowRoot!.querySelector(".clickmap-root")).not.toBeNull();
    replacement.destroy();
  });

  it("keeps the default renderer in the light DOM", () => {
    const project = createNewProject();
    const host = document.querySelector<HTMLElement>("#map")!;
    const instance = create({ container: host, definition: toDefinition(project) });

    expect(host.shadowRoot).toBeNull();
    expect(host.querySelector(".clickmap-root")).not.toBeNull();
    instance.destroy();
    expect(host.querySelector(".clickmap-root")).toBeNull();
  });

  it("renders zoom controls, applies padding, and resets the viewBox", () => {
    const project = createNewProject();
    project.settings.zoomControls = { enabled: true, position: "bottom-left" };
    project.settings.padding = { top: 10, right: 20, bottom: 30, left: 40 };
    create({ container: "#map", definition: toDefinition(project) });

    const svg = document.querySelector<SVGSVGElement>(".clickmap-areas")!;
    expect(svg).toHaveAttribute("viewBox", "-40 -10 1660 940");
    expect(document.querySelector(".clickmap-zoom-controls--bottom-left")).not.toBeNull();
    document.querySelector<HTMLButtonElement>(".clickmap-zoom-in")!.click();
    expect(svg.getAttribute("viewBox")).not.toBe("-40 -10 1660 940");
    document.querySelector<HTMLButtonElement>(".clickmap-zoom-reset")!.click();
    expect(svg).toHaveAttribute("viewBox", "-40 -10 1660 940");
  });

  it("maps the configured background fit mode to SVG image geometry", () => {
    const project = createNewProject();
    project.assets = [{ id: "asset_1", name: "Plan", type: "image/png", src: "plan.png", inline: false, width: 1600, height: 900 }];
    project.views[0].background = { assetId: "asset_1", fit: "cover" };
    create({ container: "#map", definition: toDefinition(project) });

    const background = document.querySelector<SVGImageElement>(".clickmap-bg-img");
    expect(background?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(background).toHaveAttribute("width", "1600");
  });

  it("renders imported inline SVG data URIs as fitted images", () => {
    const project = createNewProject();
    project.assets = [{
      id: "asset_1",
      name: "Plan",
      type: "image/svg+xml",
      src: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
      inline: true,
      width: 1600,
      height: 900,
    }];
    project.views[0].background = { assetId: "asset_1", fit: "cover" };
    create({ container: "#map", definition: toDefinition(project) });

    const background = document.querySelector<SVGImageElement>(".clickmap-bg-img");
    expect(background?.tagName.toLowerCase()).toBe("image");
    expect(background?.getAttribute("href")).toContain("data:image/svg+xml");
    expect(background?.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("keeps the background and areas on the same viewBox while zooming", () => {
    const project = createNewProject();
    project.settings.zoomControls = { enabled: true };
    project.assets = [{ id: "asset_1", name: "Plan", type: "image/png", src: "plan.png", inline: false, width: 1600, height: 900 }];
    project.views[0].background = { assetId: "asset_1", fit: "contain" };
    create({ container: "#map", definition: toDefinition(project) });

    const areas = document.querySelector<SVGSVGElement>(".clickmap-areas")!;
    const background = document.querySelector<SVGSVGElement>(".clickmap-bg-svg")!;
    expect(background.getAttribute("viewBox")).toBe(areas.getAttribute("viewBox"));
    document.querySelector<HTMLButtonElement>(".clickmap-zoom-in")!.click();
    expect(background.getAttribute("viewBox")).toBe(areas.getAttribute("viewBox"));
  });

  it("renders background fit none at intrinsic size and centered", () => {
    const project = createNewProject();
    project.assets = [{ id: "asset_1", name: "Stamp", type: "image/png", src: "stamp.png", inline: false, width: 400, height: 300 }];
    project.views[0].background = { assetId: "asset_1", fit: "none" };
    create({ container: "#map", definition: toDefinition(project) });

    const background = document.querySelector<SVGImageElement>(".clickmap-bg-img")!;
    expect(background).toHaveAttribute("x", "600");
    expect(background).toHaveAttribute("y", "300");
    expect(background).toHaveAttribute("width", "400");
    expect(background).toHaveAttribute("height", "300");
  });

  it("uses background position as contain alignment and cover focal point", () => {
    const project = createNewProject();
    project.views[0]!.canvas = { width: 1000, height: 500 };
    project.assets = [{ id: "asset_1", name: "Portrait", type: "image/png", src: "portrait.png", inline: false, width: 500, height: 1000 }];
    project.views[0].background = { assetId: "asset_1", fit: "cover", position: { x: 0, y: 1 } };
    create({ container: "#map", definition: toDefinition(project) });

    const background = document.querySelector<SVGImageElement>(".clickmap-bg-img")!;
    expect(background).toHaveAttribute("x", "0");
    expect(background).toHaveAttribute("y", "-1500");
    expect(background).toHaveAttribute("width", "1000");
    expect(background).toHaveAttribute("height", "2000");
  });

  it("renders centered, styled area labels with per-area overrides", () => {
    const named = createRectArea(10, 20, 100, 40);
    named.name = "Default name";
    const overridden = createRectArea(120, 20, 80, 40);
    overridden.label = { text: "Override" };
    const hidden = createRectArea(210, 20, 80, 40);
    hidden.label = { visible: false };
    const project = createNewProject();
    project.settings.areaLabels = {
      enabled: true,
      fontSize: 18,
      color: "#123456",
      fontWeight: "700",
      hideWhenSmaller: false,
    };
    project.views[0].layers = [{
      id: "layer_1", name: "Layer 1", visible: true, locked: false, opacity: 1,
      areas: [named, overridden, hidden],
    }];

    create({ container: "#map", definition: toDefinition(project) });

    const labels = document.querySelectorAll<SVGTextElement>(".clickmap-area-label");
    expect(labels).toHaveLength(2);
    expect(labels[0]).toHaveTextContent("Default name");
    expect(labels[0]).toHaveAttribute("x", "60");
    expect(labels[0]).toHaveAttribute("y", "40");
    expect(labels[0]).toHaveAttribute("fill", "#123456");
    expect(labels[0]).toHaveAttribute("font-size", "18");
    expect(labels[0]).toHaveAttribute("pointer-events", "none");
    expect(labels[1]).toHaveTextContent("Override");
  });

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

  it("renders escaped area data through the project content template", () => {
    const area = createRectArea(0, 0, 10, 10);
    area.name = "Cafe & Shop";
    area.metadata = { price: '<img src=x onerror="bad()">' };
    area.tooltip = { enabled: true, title: "Fallback", body: "Fallback body" };
    const project = createNewProject();
    project.settings.contentTemplate =
      "<h3>{{name}}</h3><p>{{id}} / {{viewName}} / {{metadata.price}}</p>";
    project.views[0].name = "Ground Floor";
    project.views[0].layers = [{
      id: "layer_1", name: "Layer 1", visible: true, locked: false, opacity: 1, areas: [area],
    }];
    create({ container: "#map", definition: toDefinition(project) });

    areaElement(area.id).dispatchEvent(new Event("pointerover", { bubbles: true }));
    const tooltip = document.querySelector<HTMLElement>(".clickmap-tooltip")!;
    expect(tooltip.querySelector("h3")).toHaveTextContent("Cafe & Shop");
    expect(tooltip).toHaveTextContent(`${area.id} / Ground Floor / <img src=x onerror="bad()">`);
    expect(tooltip.querySelector("img")).toBeNull();
    expect(tooltip).not.toHaveTextContent("Fallback body");
  });

  it("includes metadata in hover and click events", () => {
    const area = createRectArea(0, 0, 10, 10);
    area.metadata = { price: 42 };
    const instance = renderAreas(area);
    const onHover = vi.fn();
    const onClick = vi.fn();
    instance.on("area:hover", onHover);
    instance.on("area:click", onClick);

    areaElement(area.id).dispatchEvent(new Event("pointerover", { bubbles: true }));
    areaElement(area.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onHover).toHaveBeenCalledWith(expect.objectContaining({ metadata: { price: 42 } }));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ metadata: { price: 42 } }));
  });

  it("applies and live-updates choropleth colors and its optional legend", () => {
    const low = createRectArea(0, 0, 10, 10);
    const high = createRectArea(20, 0, 10, 10);
    const missing = createRectArea(40, 0, 10, 10);
    const project = createNewProject();
    project.views[0].layers = [{
      id: "layer_1", name: "Layer 1", visible: true, locked: false, opacity: 1,
      areas: [low, high, missing],
    }];
    const instance = create({
      container: "#map",
      definition: toDefinition(project),
      choropleth: {
        data: [{ id: low.id, value: 0 }, { id: high.id, value: 100 }],
        colorLow: "#000000",
        colorHigh: "#ffffff",
        noDataColor: "#ff00ff",
        legend: true,
      },
    });

    expect(areaElement(low.id)).toHaveAttribute("fill", "rgb(0,0,0)");
    expect(areaElement(high.id)).toHaveAttribute("fill", "rgb(255,255,255)");
    expect(areaElement(missing.id)).toHaveAttribute("fill", "#ff00ff");
    expect(document.querySelector(".clickmap-legend")).toHaveTextContent("0.0");

    areaElement(low.id).dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(areaElement(low.id)).toHaveAttribute("fill", low.style.hover.fill);
    areaElement(low.id).dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    expect(areaElement(low.id)).toHaveAttribute("fill", "rgb(0,0,0)");

    instance.setChoroplethData([{ id: low.id, value: 50 }, { id: high.id, value: 50 }]);
    expect(areaElement(low.id)).toHaveAttribute("fill", "rgb(0,0,0)");
    expect(document.querySelector(".clickmap-legend")).toHaveTextContent("50.0");

    instance.setChoroplethData([]);
    expect(areaElement(low.id)).toHaveAttribute("fill", low.style.default.fill);
    expect(document.querySelector(".clickmap-legend")).toBeNull();
  });

  it("uses the content template for popup actions", () => {
    const area = createRectArea(0, 0, 10, 10);
    area.name = "Room 12";
    area.metadata = { capacity: 8 };
    area.action = { type: "popup", content: { title: "Fallback", body: "Old body" } };
    const project = createNewProject();
    project.settings.contentTemplate = "<b>{{name}}</b>: {{metadata.capacity}} seats";
    project.views[0].layers = [{
      id: "layer_1", name: "Layer 1", visible: true, locked: false, opacity: 1, areas: [area],
    }];
    create({ container: "#map", definition: toDefinition(project) });

    areaElement(area.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const popover = document.querySelector<HTMLElement>(".clickmap-popover")!;
    expect(popover).toHaveTextContent("Room 12: 8 seats");
    expect(popover).not.toHaveTextContent("Fallback");
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

  it("restores slug deep links and writes view and clicked-area hashes", () => {
    vi.useFakeTimers();
    const project = createNewProject();
    const first = project.views[0];
    first.slug = "ground-floor";
    const area = createRectArea(0, 0, 10, 10);
    area.action = { type: "none" };
    first.layers = [{
      id: "layer_1", name: "Layer 1", visible: true, locked: false, opacity: 1, areas: [area],
    }];
    const second = {
      ...first,
      id: "view_upper",
      name: "Upper Floor",
      slug: "upper-floor",
      layers: [],
    };
    project.views.push(second);
    window.history.replaceState(null, "", "#upper-floor");

    const instance = create({
      container: "#map",
      definition: toDefinition(project),
      deepLink: { enabled: true },
    });
    expect(instance.getCurrentView()).toBe(second.id);

    instance.goToView(first.id);
    expect(window.location.hash).toBe("#ground-floor");
    vi.runAllTimers();
    areaElement(area.id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(window.location.hash).toBe(`#ground-floor/${area.id}`);
    vi.useRealTimers();
  });

  it("renders an accessible scene switcher and keeps its active view in sync", () => {
    vi.useFakeTimers();
    const project = createNewProject();
    const first = project.views[0];
    first.name = "Ground Floor";
    const second = { ...first, id: "view_upper", name: "Upper Floor", slug: "upper", layers: [] };
    project.views.push(second);
    project.settings.sceneSwitcher = { enabled: true, position: "top-right", style: "tabs" };
    const instance = create({ container: "#map", definition: toDefinition(project) });

    const switcher = document.querySelector(".clickmap-scene-switcher")!;
    const tabs = Array.from(switcher.querySelectorAll<HTMLButtonElement>("button"));
    expect(switcher).toHaveClass("clickmap-scene-switcher--top-right");
    expect(switcher).toHaveAttribute("role", "tablist");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Ground Floor", "Upper Floor"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    tabs[1].click();
    expect(instance.getCurrentView()).toBe(second.id);
    vi.runAllTimers();
    const active = document.querySelector<HTMLButtonElement>('[data-view-id="view_upper"]')!;
    expect(active).toHaveClass("clickmap-scene-btn--active");
    expect(active).toHaveAttribute("aria-selected", "true");
    vi.useRealTimers();
  });
});
