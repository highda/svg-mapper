// Visitor-facing renderer text, language and direction (#216).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ClickMapDefinition, ProjectFile, VisitorStringKey, VisitorStrings } from "@svg-mapper/shared";
import {
  DEFAULT_VISITOR_STRINGS,
  VISIBLE_STRING_KEYS,
  decodeDefinition,
  decodeProjectFile,
  validateProject,
} from "@svg-mapper/shared";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";
import { createRectArea } from "../lib/area-utils";
import { createDefaultView, createNewProject, toDefinition } from "../lib/project";
import { buildExportManifest } from "../lib/export-package";
import { VISITOR_TEXT_GROUPS } from "../lib/visitor-text";
import { App } from "../App";
import { projectSnapshot, useStore } from "../store";
import { DEFAULT_LAYOUT, useLayoutPrefs } from "../store/layout-prefs";

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

const KEYS = Object.keys(DEFAULT_VISITOR_STRINGS) as VisitorStringKey[];

/** A sentinel per key that keeps the key's placeholders, so filling is still checked. */
function sentinels(): Required<VisitorStrings> {
  const out = {} as Required<VisitorStrings>;
  for (const key of KEYS) {
    const placeholders = DEFAULT_VISITOR_STRINGS[key].match(/\{\w+\}/g) ?? [];
    out[key] = `«${key}${placeholders.map((p) => `:${p}`).join("")}»`;
  }
  return out;
}

/**
 * A map that shows every renderer control: the directory with a filter and a
 * disabled result, Back, zoom controls, a scene switcher, popups, a docked
 * panel with untitled default content, and layer toggles (one broken).
 */
function fullProject(strings: VisitorStrings, overrides: Partial<ClickMapDefinition["settings"]> = {}): ProjectFile {
  const project = createNewProject();
  const main = project.views[0]!;
  main.name = "Alpha";
  const second = createDefaultView();
  second.id = "view_second";
  second.slug = "second";
  second.name = "Beta";
  second.ui.showBackButton = true;
  second.ui.showBreadcrumbs = true;
  project.views.push(second);

  const go = createRectArea(0, 0, 40, 40);
  go.id = "go";
  go.name = "Gate";
  go.metadata = { kind: "door" };
  go.action = { type: "goToView", targetViewId: second.id, transition: "none" };
  const popup = createRectArea(50, 0, 40, 40);
  popup.id = "popup";
  popup.name = "Kiosk";
  popup.action = { type: "popup", content: { title: "Kiosk details" } };
  const toggle = createRectArea(100, 0, 40, 40);
  toggle.id = "toggle";
  toggle.name = "Switch";
  toggle.action = { type: "toggleLayer", targetLayerId: "layer_extra" };
  const broken = createRectArea(150, 0, 40, 40);
  broken.id = "broken";
  broken.name = "Broken";
  broken.action = { type: "toggleLayer", targetLayerId: "layer_missing" };
  const closed = createRectArea(200, 0, 40, 40);
  closed.id = "closed";
  closed.name = "Shut";
  closed.disabled = true;
  const extra = createRectArea(250, 0, 40, 40);
  extra.id = "extra";
  extra.name = "Extra";
  main.layers = [
    { id: "layer_main", name: "Ground", visible: true, locked: false, opacity: 1, areas: [go, popup, toggle, broken, closed] },
    { id: "layer_extra", name: "Upper", visible: true, locked: false, opacity: 1, areas: [extra] },
  ];
  const panelArea = createRectArea(0, 0, 40, 40);
  panelArea.id = "panel_area";
  panelArea.name = "Desk";
  panelArea.action = { type: "popup", presentation: "panel", content: { body: "<p>Desk body</p>" } };
  second.layers = [{ id: "layer_second", name: "Floor", visible: true, locked: false, opacity: 1, areas: [panelArea] }];

  project.settings = {
    ...project.settings,
    enableHistory: false,
    directory: { enabled: true, categoryKey: "kind", categories: [{ value: "door", label: "Doors" }] },
    zoomControls: { enabled: true },
    sceneSwitcher: { enabled: true, position: "bottom-center", style: "buttons" },
    details: { defaultContent: { body: "Pick one" } },
    strings,
    ...overrides,
  };
  return project;
}

const root = () => document.querySelector<HTMLElement>(".clickmap-root")!;
const area = (id: string) => document.querySelector<SVGElement>(`[data-area-id="${id}"]`)!;
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/** Everything a visitor can see or hear: text, names, placeholders, titles and live messages. */
function snapshot(): string {
  const parts = [root().textContent ?? ""];
  for (const el of Array.from(root().querySelectorAll("*"))) {
    for (const attr of ["aria-label", "placeholder", "title", "alt"]) {
      const value = el.getAttribute(attr);
      if (value) parts.push(value);
    }
  }
  return parts.join("\n");
}

/** Drive every control, collecting what the visitor is shown or told at each step. */
async function exerciseEveryControl(): Promise<string> {
  const seen: string[] = [];
  const record = () => seen.push(snapshot());
  await Promise.resolve();
  record();
  // Directory: no results, then reveal a result in the current view.
  const search = root().querySelector<HTMLInputElement>(".clickmap-directory-search")!;
  search.value = "zzz-nothing";
  search.dispatchEvent(new Event("input"));
  record();
  search.value = "kiosk";
  search.dispatchEvent(new Event("input"));
  record();
  click(root().querySelector(".clickmap-directory-result")!);
  record();
  // Popup and its close button.
  click(area("popup"));
  record();
  // Zoom in so the map becomes pannable (and named).
  click(root().querySelector(".clickmap-zoom-in")!);
  record();
  // Layer toggles: hide, show, and a missing layer.
  click(area("toggle"));
  record();
  click(area("toggle"));
  record();
  click(area("broken"));
  record();
  // Navigate (announcement, Back button, panel default content).
  click(area("go"));
  record();
  return seen.join("\n");
}

describe("visitor text", () => {
  it("covers every key in the schema, the editor inspector and the visible/name split", () => {
    const edited = VISITOR_TEXT_GROUPS.flatMap(([, keys]) => keys.map(([key]) => key));
    expect([...edited].sort()).toEqual([...KEYS].sort());
    expect(VISIBLE_STRING_KEYS.every((key) => KEYS.includes(key))).toBe(true);
    const definition = toDefinition(fullProject(sentinels()));
    expect(decodeDefinition(definition).ok).toBe(true);
    expect(decodeDefinition({ ...definition, settings: { ...definition.settings, strings: { back: 3 } } }).ok).toBe(false);
    expect(decodeDefinition({ ...definition, settings: { ...definition.settings, dir: "up" } }).ok).toBe(false);
  });

  it("renders no hard-coded English: every string comes from settings.strings", async () => {
    const strings = sentinels();
    create({ container: "#map", definition: toDefinition(fullProject(strings)), strings });
    const seen = await exerciseEveryControl();

    document.body.innerHTML = '<div id="map"></div>';
    // A second map shows the dropdown switcher, and Back named by its label
    // because its content is hidden.
    create({ container: "#map", definition: toDefinition(fullProject({ ...strings, back: "" }, { sceneSwitcher: { enabled: true, position: "top-left", style: "dropdown" } })) });
    click(area("go"));
    const dropdown = snapshot();

    // Host states before a map is mounted.
    document.body.innerHTML = '<div id="map"></div>';
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    create({ container: "#map", definitionUrl: "map.json", strings });
    const loading = document.querySelector("#map")!.textContent ?? "";
    document.body.innerHTML = '<div id="map"></div>';
    create({ container: "#map", definition: { broken: true } as unknown as ClickMapDefinition, strings });
    const error = document.querySelector("#map")!.textContent ?? "";

    const corpus = [seen, dropdown, loading, error].join("\n");
    const outsideSentinels = corpus.replace(/«[^»]*»/g, "");
    // Every key was used...
    for (const key of KEYS) expect(corpus, key).toContain(`«${key}`);
    // ...with its placeholders filled.
    expect(corpus).toContain("«placeCountOne:1»");
    expect(corpus).toContain("«placeCount:0»");
    expect(corpus).toContain("«result:Gate:Alpha»");
    expect(corpus).toContain("«resultUnavailable:Shut:Alpha»");
    expect(corpus).toContain("«revealAnnounce:Kiosk:Alpha»");
    expect(corpus).toContain("«layerHidden:Upper»");
    expect(corpus).toContain("«layerShown:Upper»");
    expect(corpus).toContain("«viewAnnounce:Beta»");
    expect(error).toMatch(/^«error:Invalid map\.json/);
    // ...and no default text or glyph remains.
    for (const key of KEYS) {
      for (const fragment of DEFAULT_VISITOR_STRINGS[key].split(/\{\w+\}/)) {
        const text = fragment.trim();
        if (/[A-Za-z]{3}/.test(text) || /^[+−⊙×←]/.test(text)) expect(outsideSentinels, `${key}: "${text}"`).not.toContain(text);
      }
    }
  });

  it("keeps the English defaults when no strings are set", async () => {
    create({ container: "#map", definition: toDefinition(fullProject({})) });
    const corpus = await exerciseEveryControl();
    for (const text of ["Find a place", "Search places", "Zoom in", "Reset zoom", "Kiosk, Alpha", "Upper hidden.", "Upper shown.", "Layer could not be changed.", "Beta view.", "← Back", "Map, arrow keys pan", "Gate — Alpha", "Shut — Alpha (unavailable)"]) {
      expect(corpus).toContain(text);
    }
    expect(root().querySelector(".clickmap-zoom-in")).toHaveTextContent("+");
    expect(root().querySelector(".clickmap-zoom-in")).toHaveAttribute("aria-label", "Zoom in");
    // Text buttons are named by their text, not a separate label.
    expect(root().querySelector(".clickmap-back-btn")).not.toHaveAttribute("aria-label");
    expect(root().querySelector(".clickmap-directory-toggle")).not.toHaveAttribute("aria-label");
    expect(root()).not.toHaveAttribute("lang");
  });

  it("renders a textless map that stays operable by keyboard and screen reader", async () => {
    const hidden: VisitorStrings = {};
    for (const key of VISIBLE_STRING_KEYS) hidden[key] = "";
    const project = fullProject(hidden, { areaLabels: { enabled: false }, directory: { enabled: true } });
    // No switcher (view names) or default panel content (author text).
    delete project.settings.sceneSwitcher;
    delete project.settings.details;
    project.views[0]!.ui.showBackButton = true;
    create({ container: "#map", definition: toDefinition(project) });
    await Promise.resolve();

    const visibleText = () => {
      const walker = document.createTreeWalker(root(), NodeFilter.SHOW_TEXT);
      const texts: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement!;
        if (parent.closest("[hidden], .clickmap-aria-live, [aria-hidden='true']")) continue;
        if (node.textContent?.trim()) texts.push(node.textContent.trim());
      }
      return texts;
    };
    // The only text is the directory's result list, which shows author data (area names).
    expect(visibleText().filter((text) => !root().querySelector(".clickmap-directory-results")!.textContent!.includes(text))).toEqual([]);
    expect(root().querySelector(".clickmap-directory h2")).toHaveAttribute("hidden");
    expect(root().querySelector<HTMLInputElement>(".clickmap-directory-search")!.placeholder).toBe("");

    // Every control still has an accessible name.
    const named = (el: Element) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
    for (const control of Array.from(root().querySelectorAll("button, input, select, [role='button']"))) {
      expect(named(control), control.outerHTML).not.toBe("");
    }
    expect(root().querySelector(".clickmap-directory-toggle")).toHaveAttribute("aria-label", "Place directory");
    expect(root().querySelector(".clickmap-zoom-in")).toHaveAttribute("aria-label", "Zoom in");
    expect(root().querySelector(".clickmap-zoom-in")!.textContent).toBe("");

    // Keyboard: Enter on a focused area opens its named popup with a named Close.
    area("popup").focus();
    area("popup").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const popover = root().querySelector(".clickmap-popover")!;
    expect(popover).toHaveAttribute("aria-hidden", "false");
    expect(popover).toHaveAttribute("aria-labelledby");
    const close = popover.querySelector("button")!;
    expect(close).toHaveAttribute("aria-label", "Close");
    expect(close.textContent).toBe("");
    // Navigation announces the destination and shows a named, empty Back.
    area("go").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(root().querySelector(".clickmap-aria-live")).toHaveTextContent("Beta view.");
    expect(root().querySelector(".clickmap-back-btn")).toHaveAttribute("aria-label", "Back");
    expect(root().querySelector(".clickmap-back-btn")!.textContent).toBe("");
    expect(visibleText().filter((text) => !root().querySelector(".clickmap-directory-results")!.textContent!.includes(text))).toEqual([]);
  });

  it("draws path-data control content as an icon and names the control", async () => {
    const project = fullProject({ zoomIn: "M11 5h2v14h-2zM5 11h14v2H5z", back: "M15 5l-7 7 7 7", zoomInLabel: "Přiblížit", backLabel: "Zpět", closeLabel: "Zavřít", close: "Zavřít ✕" });
    project.views[0]!.ui.showBackButton = true;
    create({ container: "#map", definition: toDefinition(project) });
    const zoomIn = root().querySelector(".clickmap-zoom-in")!;
    expect(zoomIn.querySelector("svg path")).toHaveAttribute("d", "M11 5h2v14h-2zM5 11h14v2H5z");
    expect(zoomIn.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(zoomIn).toHaveAttribute("aria-label", "Přiblížit");
    // Text that is not path data is never parsed as markup.
    click(area("popup"));
    const close = root().querySelector(".clickmap-popover button")!;
    expect(close.querySelector("svg")).toBeNull();
    expect(close).toHaveTextContent("Zavřít ✕");
    expect(close).toHaveAttribute("aria-label", "Zavřít");
    click(area("go"));
    const back = root().querySelector(".clickmap-back-btn")!;
    expect(back.querySelector("path")).toHaveAttribute("d", "M15 5l-7 7 7 7");
    expect(back).toHaveAttribute("aria-label", "Zpět");
  });

  it("falls back to the default for a blank accessible name", () => {
    create({ container: "#map", definition: toDefinition(fullProject({ zoomInLabel: "  ", directoryLabel: "" })) });
    expect(root().querySelector(".clickmap-zoom-in")).toHaveAttribute("aria-label", "Zoom in");
    expect(root().querySelector(".clickmap-directory")).toHaveAttribute("aria-label", "Place directory");
  });

  it("applies lang and dir to the renderer root and formats the legend for the language", () => {
    const choropleth = { data: [{ id: "go", value: 1.5 }, { id: "popup", value: 12345.25 }], colorLow: "#fff", colorHigh: "#000", legend: true };
    create({ container: "#map", definition: toDefinition(fullProject({}, { lang: "cs", dir: "rtl" })), choropleth });
    expect(root()).toHaveAttribute("lang", "cs");
    expect(root()).toHaveAttribute("dir", "rtl");
    const legend = () => Array.from(root().querySelectorAll(".clickmap-legend span")).map((span) => span.textContent);
    const cs = new Intl.NumberFormat("cs", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    expect(legend()).toEqual([cs.format(1.5), cs.format(12345.25)]);
    expect(legend()[0]).toBe("1,5");

    document.body.innerHTML = '<div id="map"></div>';
    create({ container: "#map", definition: toDefinition(fullProject({})), choropleth });
    expect(root()).not.toHaveAttribute("dir");
    expect(legend()).toEqual(["1.5", "12,345.3"]);

    // An unusable tag never breaks the map: numbers fall back to English.
    document.body.innerHTML = '<div id="map"></div>';
    create({ container: "#map", definition: toDefinition(fullProject({}, { lang: "not a tag!" })), choropleth });
    expect(legend()).toEqual(["1.5", "12,345.3"]);
  });
});

describe("visitor text validation", () => {
  const codes = (project: ProjectFile) => validateProject(toDefinition(project)).map((result) => result.code);

  it("warns about blank names, unknown keys and invalid languages, never about hidden visible text", () => {
    const hidden: VisitorStrings = {};
    for (const key of VISIBLE_STRING_KEYS) hidden[key] = "";
    expect(codes(fullProject(hidden))).not.toContain("BLANK_ACCESSIBLE_NAME");

    const results = validateProject(toDefinition(fullProject({ closeLabel: " ", zoomIn: "" }, { lang: "en_US!" })));
    expect(results.filter((r) => r.code === "BLANK_ACCESSIBLE_NAME")).toEqual([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining('"closeLabel"') }),
    ]);
    expect(results.map((r) => r.code)).toContain("INVALID_LANG");
    expect(codes(fullProject({}, { lang: "pt-BR" }))).not.toContain("INVALID_LANG");
    expect(codes(fullProject({ ["nope" as VisitorStringKey]: "x" }))).toContain("UNKNOWN_VISITOR_TEXT");
  });

  it("warns when an area or a switcher view would have no accessible name", () => {
    const project = fullProject({});
    const unnamed = project.views[0]!.layers[0]!.areas[1]!;
    unnamed.name = " ";
    expect(validateProject(toDefinition(project))).toContainEqual(expect.objectContaining({ code: "MISSING_ACCESSIBLE_NAME", ref: expect.objectContaining({ areaId: unnamed.id }) }));
    unnamed.accessibility = { ariaLabel: "Kiosk", tabIndex: 0 };
    project.views[1]!.name = "";
    const results = validateProject(toDefinition(project)).filter((r) => r.code === "MISSING_ACCESSIBLE_NAME");
    expect(results).toEqual([expect.objectContaining({ ref: { viewId: project.views[1]!.id } })]);
  });
});

describe("visitor text in the editor", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutPrefs.setState({ ...structuredClone(DEFAULT_LAYOUT), sections: {}, layoutRequest: 0 });
    const project = fullProject({});
    useStore.setState({
      project,
      activeViewId: project.views[0]!.id,
      selectedAreaId: null,
      selectedAreaIds: [],
      selectedLayerId: null,
      screen: "design",
      past: [],
      future: [],
      savedSnapshot: projectSnapshot(project),
    });
  });

  it("edits every key, hides visible text, and round-trips through save and export", () => {
    render(<App />);
    const section = screen.getByRole("button", { name: /^Visitor text/ });
    expect(section).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(section);
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    for (const key of KEYS) {
      const field = inspector.querySelector<HTMLInputElement>(`[data-visitor-text="${key}"]`)!;
      expect(field, key).not.toBeNull();
      expect(field.placeholder).toBe(DEFAULT_VISITOR_STRINGS[key]);
    }

    const heading = within(inspector).getByLabelText("Heading");
    fireEvent.change(heading, { target: { value: "Najít místo" } });
    fireEvent.blur(heading);
    fireEvent.click(within(inspector).getByRole("checkbox", { name: "Hide zoom in button" }));
    const zoomName = within(inspector).getByLabelText("Zoom in name");
    fireEvent.change(zoomName, { target: { value: "Přiblížit" } });
    fireEvent.blur(zoomName);
    // Blank means default: an accessible name cannot be emptied.
    fireEvent.change(zoomName, { target: { value: "  " } });
    fireEvent.blur(zoomName);
    fireEvent.change(zoomName, { target: { value: "Přiblížit" } });
    fireEvent.blur(zoomName);
    const loading = within(inspector).getByLabelText("Loading");
    fireEvent.change(loading, { target: { value: "Načítání…" } });
    fireEvent.blur(loading);
    const lang = within(inspector).getByLabelText("Language");
    fireEvent.change(lang, { target: { value: "cs" } });
    fireEvent.blur(lang);
    fireEvent.change(within(inspector).getByLabelText("Direction"), { target: { value: "rtl" } });

    const settings = useStore.getState().project.settings;
    expect(settings.strings).toEqual({ directoryTitle: "Najít místo", zoomIn: "", zoomInLabel: "Přiblížit", loading: "Načítání…" });
    expect(settings.lang).toBe("cs");
    expect(settings.dir).toBe("rtl");
    expect(section).toHaveTextContent("cs · 4 custom");
    expect(within(inspector).getByLabelText("Zoom in button")).toBeDisabled();

    // Save: the project file decodes with the strings intact.
    const saved = JSON.parse(JSON.stringify(useStore.getState().project));
    const reopened = decodeProjectFile(saved);
    expect(reopened.ok && reopened.value.settings.strings).toEqual(settings.strings);

    // Export: map.json keeps them, index.html declares the language, and the
    // embed passes the pre-load text to create().
    const manifest = buildExportManifest(toDefinition(useStore.getState().project), "/*js*/", "/*css*/", { inlineAssets: true });
    const mapJson = JSON.parse(new TextDecoder().decode(manifest.files["map.json"]));
    expect(mapJson.settings).toMatchObject({ lang: "cs", dir: "rtl", strings: settings.strings });
    expect(new TextDecoder().decode(manifest.files["index.html"])).toContain('<html lang="cs" dir="rtl">');
    expect(manifest.embedSnippet).toContain('strings: {"loading":"Načítání…"},');

    // Preview and export run the renderer on that definition.
    document.body.insertAdjacentHTML("beforeend", '<div id="preview"></div>');
    create({ container: "#preview", definition: mapJson });
    const preview = document.querySelector("#preview .clickmap-root")!;
    expect(preview).toHaveAttribute("lang", "cs");
    expect(preview.querySelector(".clickmap-directory h2")).toHaveTextContent("Najít místo");
    expect(preview.querySelector(".clickmap-zoom-in")).toHaveAttribute("aria-label", "Přiblížit");
    expect(preview.querySelector(".clickmap-zoom-in")!.textContent).toBe("");

    // Clearing a hidden field's checkbox restores the default.
    fireEvent.click(within(inspector).getByRole("checkbox", { name: "Hide zoom in button" }));
    expect(useStore.getState().project.settings.strings).not.toHaveProperty("zoomIn");
  }, 30_000);
});
