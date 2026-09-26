import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  assetDisplaySource,
  fitImageRect,
  geometryBounds,
  markerPathData,
  rectPathData,
} from "@svg-mapper/shared";
import { App } from "../App";
import { createStarterProject, STARTER_PROJECTS } from "../lib/starter-projects";
import { geometryToSvgPath } from "../lib/area-utils";
import { useStore } from "../store";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";

// One scene-geometry implementation for the editor canvas and the renderer (#161).

describe("shared scene geometry", () => {
  it("turns raw SVG markup into a displayable data URI without touching other sources", () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    expect(assetDisplaySource(raw)).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`);
    expect(assetDisplaySource("  <SVG viewBox='0 0 1 1'></SVG>")).toMatch(/^data:image\/svg\+xml/);
    for (const kept of ["data:image/png;base64,AAAA", "https://cdn.example.test/a.png", "//cdn.example.test/a.png", "#local"]) {
      expect(assetDisplaySource(kept, "https://site.test/maps/map.json")).toBe(kept);
    }
    expect(assetDisplaySource("assets/a.png")).toBe("assets/a.png");
    expect(assetDisplaySource("assets/a.png", "https://site.test/maps/map.json")).toBe("https://site.test/maps/assets/a.png");
  });

  it.each([
    ["contain", { x: 100, y: 0, width: 600, height: 600 }],
    ["cover", { x: 0, y: -100, width: 800, height: 800 }],
    ["fill", { x: 0, y: 0, width: 800, height: 600 }],
    ["none", { x: 350, y: 250, width: 100, height: 100 }],
  ] as const)("fits a square asset into an 800x600 frame with %s", (fit, expected) => {
    expect(fitImageRect({ width: 800, height: 600 }, { width: 100, height: 100 }, fit)).toEqual(expected);
  });

  it("aligns fitted artwork by the clamped focal position", () => {
    expect(fitImageRect({ width: 800, height: 600 }, { width: 100, height: 100 }, "contain", { x: 0, y: 2 })).toEqual({ x: 0, y: 0, width: 600, height: 600 });
  });

  it("rounds rectangle corners like SVG rx, clamped to half a side", () => {
    expect(rectPathData(0, 0, 10, 20)).toBe("M0,0 h10 v20 h-10Z");
    expect(rectPathData(0, 0, 10, 20, 3)).toContain("a3,3");
    expect(rectPathData(0, 0, 10, 20, 50)).toContain("a5,5");
    expect(geometryToSvgPath({ type: "rect", x: 0, y: 0, width: 10, height: 20, rx: 3 })).toBe(rectPathData(0, 0, 10, 20, 3));
  });

  it.each([
    ["bottom-center", { x: 88, y: 168 }],
    ["center", { x: 88, y: 184 }],
    ["top-left", { x: 100, y: 200 }],
    ["bottom-right", { x: 76, y: 168 }],
  ] as const)("places a %s marker by its anchor", (anchor, topLeft) => {
    const bounds = geometryBounds({ type: "marker", x: 100, y: 200, anchor });
    expect(bounds).toEqual({ ...topLeft, width: 24, height: 32 });
    expect(markerPathData(100, 200, anchor)).toContain(`M${topLeft.x + 12},${topLeft.y + 32}`);
  });
});

describe("editor and renderer draw the same scene", () => {
  it.each(STARTER_PROJECTS.map((starter) => starter.id))("displays the %s sample background in Design", (id) => {
    const project = createStarterProject(id);
    useStore.setState({ project, activeViewId: project.views[0]!.id, screen: "design", selectedAreaId: null, selectedLayerId: null, past: [], future: [] });
    const { container } = render(<App />);
    const background = container.querySelector("image.clickmap-editor-bg");
    expect(background?.getAttribute("href")).toMatch(/^data:image\/svg\+xml/);
    expect(background?.getAttribute("clip-path")).toBe("url(#clickmap-view-frame)");
    // The persisted asset keeps its original raw markup.
    expect(useStore.getState().project.assets[0]!.src).toMatch(/^\s*<svg/);
  });

  it("places marker label anchors and background rectangles identically", () => {
    // jsdom has no ResizeObserver; the renderer only needs it to exist here.
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    __setInlinedCSS("");
    const project = createStarterProject(STARTER_PROJECTS[0]!.id);
    const view = project.views[0]!;
    view.background = { ...view.background!, fit: "cover", position: { x: 0.2, y: 0.8 } };
    view.layers[0]!.areas.push({
      ...view.layers[0]!.areas[0]!,
      id: "marker-probe",
      name: "Marker probe",
      geometry: { type: "marker", x: 300, y: 200, anchor: "center" },
    });
    project.settings.areaLabels = { enabled: true, hideWhenSmaller: false };

    const host = document.createElement("div");
    document.body.appendChild(host);
    create({ container: host, definition: project });
    const runtimeLabel = host.querySelector('[data-label-area="marker-probe"]')!;
    const runtimeBg = host.querySelector(".clickmap-bg-img")!;

    useStore.setState({ project, activeViewId: view.id, screen: "design", selectedAreaId: null, selectedLayerId: null, past: [], future: [] });
    const { container } = render(<App />);
    const editorBg = container.querySelector("image.clickmap-editor-bg")!;
    const editorLabel = Array.from(container.querySelectorAll(".clickmap-area-labels text")).find((text) => text.textContent === "Marker probe")!;

    for (const attr of ["x", "y", "width", "height"]) expect(editorBg.getAttribute(attr)).toBe(runtimeBg.getAttribute(attr));
    expect(Number(editorLabel.getAttribute("x"))).toBe(Number(runtimeLabel.getAttribute("x")));
    expect(Number(editorLabel.getAttribute("y"))).toBe(Number(runtimeLabel.getAttribute("y")));
    host.remove();
  });
});
