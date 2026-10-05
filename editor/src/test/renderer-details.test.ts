import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickMapEvent, DetailsSettings } from "@svg-mapper/shared";
import { decodeDefinition } from "@svg-mapper/shared";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";
import { createRectArea } from "../lib/area-utils";
import { parseDetailsSize } from "../lib/details-size";
import { createNewProject, toDefinition } from "../lib/project";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  __setInlinedCSS(".clickmap-root { position: relative; }");
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.history.replaceState(null, "", window.location.pathname);
  document.body.innerHTML = '<div id="map"></div>';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function setup(details: DetailsSettings | undefined, ...areas: ReturnType<typeof createRectArea>[]) {
  const project = createNewProject();
  project.views[0].name = "Campus";
  if (details) project.settings.details = details;
  project.views[0].layers = [{ id: "layer_1", name: "Layer 1", visible: true, locked: false, opacity: 1, areas }];
  const events: ClickMapEvent[] = [];
  const map = create({ container: "#map", definition: toDefinition(project) });
  for (const type of ["popup:open", "popup:close", "area:select"] as const) map.on(type, (event) => events.push(event));
  return { map, events, project };
}

function popupArea(name: string, x: number, title = name) {
  const area = createRectArea(x, 0, 10, 10);
  area.name = name;
  area.action = { type: "popup", content: { title, body: `<p>About ${name}</p>` } };
  return area;
}

const el = (id: string) => document.querySelector<SVGElement>(`[data-area-id="${id}"]`)!;
const click = (target: Element) => target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const panel = () => document.querySelector<HTMLElement>(".clickmap-details")!;

describe("details panel presentation", () => {
  it("shows default content, swaps on selection, and returns to it when closed", async () => {
    const library = popupArea("Library", 0);
    const gym = popupArea("Gym", 20);
    const { events } = setup({
      presentation: "panel",
      side: "left",
      size: 0.4,
      label: "Building details",
      defaultContent: { title: "Explore", body: "Click a building in {{viewName}}." },
    }, library, gym);
    await Promise.resolve();

    const root = document.querySelector<HTMLElement>(".clickmap-root")!;
    expect(root).toHaveClass("clickmap-root--details", "clickmap-root--details-left");
    expect(root.style.getPropertyValue("--clickmap-details-size")).toBe("40%");
    expect(panel()).toHaveClass("clickmap-details--left", "clickmap-details--idle");
    expect(panel()).toBeVisible();
    expect(panel()).toHaveTextContent("Click a building in Campus.");
    expect(panel()).toHaveAccessibleName("Explore");
    expect(panel().tagName).toBe("SECTION");

    click(el(library.id));
    expect(panel()).not.toHaveClass("clickmap-details--idle");
    expect(panel()).toHaveTextContent("About Library");
    expect(panel()).toHaveAccessibleName("Library");
    expect(el(library.id)).toHaveAttribute("aria-current", "true");
    // Non-modal: no popover, and focus stays where the visitor is.
    expect(document.querySelector(".clickmap-popover--visible")).toBeNull();
    expect(document.querySelector(".clickmap-aria-live")).toHaveTextContent("Library");

    events.length = 0;
    click(el(gym.id));
    expect(panel()).toHaveTextContent("About Gym");
    expect(el(library.id)).not.toHaveAttribute("aria-current");
    expect(events.filter((event) => event.type !== "area:select")).toEqual([
      { type: "popup:close", popupId: library.id, presentation: "panel" },
      { type: "popup:open", popupId: gym.id, presentation: "panel" },
    ]);

    events.length = 0;
    click(panel().querySelector<HTMLButtonElement>(".clickmap-details-close")!);
    expect(panel()).toHaveTextContent("Click a building in Campus.");
    expect(el(gym.id)).not.toHaveAttribute("aria-current");
    expect(events).toContainEqual({ type: "popup:close", popupId: gym.id, presentation: "panel" });
    expect(events).toContainEqual(expect.objectContaining({ type: "area:select", areaId: null }));
  });

  it("follows the selection: API, Escape, and clearSelection", () => {
    const library = popupArea("Library", 0);
    const { map } = setup({ presentation: "panel", defaultContent: { body: "Pick a place" } }, library);

    map.select(library.id);
    expect(panel()).toHaveTextContent("About Library");
    map.clearSelection();
    expect(panel()).toHaveTextContent("Pick a place");
    expect(panel()).toHaveAccessibleName("Details");

    click(el(library.id));
    el(library.id).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel()).toHaveTextContent("Pick a place");
    expect(el(library.id)).not.toHaveAttribute("aria-current");

    // Outside clicks never close the persistent panel.
    click(el(library.id));
    click(document.body);
    expect(panel()).toHaveTextContent("About Library");
  });

  it("hides the panel while idle when asked or when there is no default content", () => {
    const library = popupArea("Library", 0);
    setup({ presentation: "panel", hideWhenIdle: true, defaultContent: { title: "Explore" } }, library);
    expect(panel()).not.toBeVisible();
    click(el(library.id));
    expect(panel()).toBeVisible();
    el(library.id).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel()).not.toBeVisible();
  });

  it("lets the visitor dismiss default content until the next details", () => {
    const library = popupArea("Library", 0);
    setup({ presentation: "panel", defaultContent: { title: "Explore" } }, library);
    click(panel().querySelector<HTMLButtonElement>(".clickmap-details-close")!);
    expect(panel()).not.toBeVisible();
    expect(document.activeElement).toBe(el(library.id));
    click(el(library.id));
    expect(panel()).toBeVisible();
  });

  it("renders area content through the project content template", () => {
    const library = popupArea("Library", 0);
    library.metadata = { hours: "9–17" };
    const project = createNewProject();
    project.settings.details = { presentation: "panel" };
    project.settings.contentTemplate = "<h3>{{name}}</h3><p>Open {{metadata.hours}}</p>";
    project.views[0].layers = [{ id: "l", name: "L", visible: true, locked: false, opacity: 1, areas: [library] }];
    create({ container: "#map", definition: toDefinition(project) });
    click(el(library.id));
    expect(panel().querySelector("h3")).toHaveTextContent("Library");
    expect(panel()).toHaveTextContent("Open 9–17");
  });

  it("is built only when some popup uses it; per-area presentation overrides the default", () => {
    const pop = popupArea("Kiosk", 0);
    const docked = popupArea("Library", 20);
    if (docked.action.type === "popup") docked.action.presentation = "panel";
    setup(undefined, pop, docked);
    expect(panel()).not.toBeNull();
    click(el(pop.id));
    expect(document.querySelector(".clickmap-popover--visible")).not.toBeNull();
    click(el(docked.id));
    expect(document.querySelector(".clickmap-popover--visible")).toBeNull();
    expect(panel()).toHaveTextContent("About Library");

    document.body.innerHTML = '<div id="map"></div>';
    setup(undefined, popupArea("Only", 0));
    expect(document.querySelector(".clickmap-details")).toBeNull();
  });
});

describe("modal presentation", () => {
  // jsdom has no top layer: stand in for showModal/close with the open attribute.
  beforeEach(() => {
    Object.assign(HTMLDialogElement.prototype, {
      showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); },
      close(this: HTMLDialogElement) { this.removeAttribute("open"); },
    });
  });
  afterEach(() => {
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    delete proto.showModal;
    delete proto.close;
  });

  it("opens a dialog, moves focus in, and Escape restores the trigger", () => {
    vi.useFakeTimers();
    const library = popupArea("Library", 0);
    if (library.action.type === "popup") library.action.presentation = "modal";
    const { events } = setup(undefined, library);
    const trigger = el(library.id);
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    vi.runAllTimers();

    const modal = document.querySelector<HTMLDialogElement>("dialog.clickmap-modal")!;
    expect(modal).toHaveAttribute("open");
    expect(modal).toHaveAccessibleName("Library");
    expect(modal).toHaveAccessibleDescription("About Library");
    expect(document.activeElement).toBe(modal.querySelector(".clickmap-modal-close"));
    expect(events).toContainEqual({ type: "popup:open", popupId: library.id, presentation: "modal" });

    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(modal).not.toHaveAttribute("open");
    expect(document.activeElement).toBe(trigger);
    expect(events).toContainEqual({ type: "popup:close", popupId: library.id, presentation: "modal" });
  });

  it("closes from the backdrop and its cancel event", () => {
    const library = popupArea("Library", 0);
    setup({ presentation: "modal" }, library);
    click(el(library.id));
    const modal = document.querySelector<HTMLDialogElement>("dialog.clickmap-modal")!;
    click(modal.querySelector(".clickmap-modal-body")!);
    expect(modal).toHaveAttribute("open");
    click(modal);
    expect(modal).not.toHaveAttribute("open");

    click(el(library.id));
    const cancel = new Event("cancel", { cancelable: true });
    modal.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(modal).not.toHaveAttribute("open");
    expect(el(library.id)).not.toHaveAttribute("aria-current");
  });
});

describe("modal fallback", () => {
  it("shows a modal popup as a popover where <dialog> is unsupported", () => {
    const library = popupArea("Library", 0);
    const { events } = setup({ presentation: "modal" }, library);
    click(el(library.id));
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.querySelector(".clickmap-popover--visible")).toHaveTextContent("About Library");
    expect(events).toContainEqual({ type: "popup:open", popupId: library.id, presentation: "popover" });
  });
});

describe("details settings contract", () => {
  it("decodes details settings and rejects window-relative sizes", () => {
    const project = createNewProject();
    project.settings.details = { presentation: "panel", side: "bottom", size: "320px", sheetBelow: 480, defaultContent: { title: "Hi" } };
    expect(decodeDefinition(toDefinition(project)).ok).toBe(true);
    project.settings.details = { size: "30vw" };
    const bad = decodeDefinition(toDefinition(project));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.path).toBe("$.settings.details.size");
    project.settings.details = { size: 1.5 };
    expect(decodeDefinition(toDefinition(project)).ok).toBe(false);
  });

  it("parses the Inspector size field", () => {
    expect(parseDetailsSize("")).toEqual({ ok: true, value: undefined });
    expect(parseDetailsSize("0.35")).toEqual({ ok: true, value: 0.35 });
    expect(parseDetailsSize("1")).toEqual({ ok: true, value: 1 });
    expect(parseDetailsSize(" 320px ")).toEqual({ ok: true, value: "320px" });
    expect(parseDetailsSize("35%")).toEqual({ ok: true, value: "35%" });
    expect(parseDetailsSize("0")).toEqual({ ok: false });
    expect(parseDetailsSize("40vw")).toEqual({ ok: false });
    expect(parseDetailsSize("2")).toEqual({ ok: false });
  });
});
