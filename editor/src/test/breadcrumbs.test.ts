import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeDefinition, definitionSchema } from "@svg-mapper/shared";
import { create, __setInlinedCSS } from "../../../renderer/src/renderer";
import { createNewProject, parseProjectFile, serializeProjectFile, toDefinition } from "../lib/project";
import { decodeDraft } from "../lib/draft-storage";
import { useStore } from "../store";
import type { ProjectFile } from "@svg-mapper/shared";

// view.ui.showBreadcrumbs is implemented; settings.theme and view.ui.showTitle
// are retired (#217).

/** Three views A → B → C, each with breadcrumbs on unless overridden. */
function drillDownProject(): ProjectFile {
  const project = createNewProject("Trail");
  const base = project.views[0];
  project.views = ["A", "B", "C"].map((name) => ({
    ...structuredClone(base),
    id: `view_${name}`,
    name: `View ${name}`,
    slug: name.toLowerCase(),
    ui: { showBackButton: false, showBreadcrumbs: true },
  }));
  project.settings.initialViewId = "view_A";
  return project;
}

/** A file as builds before #217 wrote it. */
function legacyFile() {
  const file = JSON.parse(JSON.stringify(drillDownProject())) as {
    settings: Record<string, unknown>;
    views: { ui: Record<string, unknown> }[];
  };
  file.settings.theme = "default";
  for (const view of file.views) view.ui.showTitle = true;
  return file;
}

describe("retired fields (#217)", () => {
  it("are absent from new projects, the types' schema and the published JSON Schema", () => {
    const project = createNewProject();
    expect(project.settings).not.toHaveProperty("theme");
    expect(project.views[0].ui).toEqual({ showBackButton: false, showBreadcrumbs: false });
    expect(Object.keys(definitionSchema.entries.settings.entries)).not.toContain("theme");
    expect(Object.keys(definitionSchema.entries.views.item.entries.ui.entries)).toEqual(["showBackButton", "showBreadcrumbs"]);
  });

  it("still decode in older 1.x files, and the editor drops them on open, draft restore and save", () => {
    const legacy = legacyFile();
    expect(decodeDefinition(legacy).ok).toBe(true);

    const opened = parseProjectFile(JSON.stringify(legacy));
    expect(opened.schemaVersion).toBe("1.0.0");
    expect(opened.settings).not.toHaveProperty("theme");
    expect(opened.views.every((view) => !("showTitle" in view.ui))).toBe(true);
    expect(opened.views[0].ui.showBreadcrumbs).toBe(true);
    expect(serializeProjectFile(opened)).not.toMatch(/"theme"|"showTitle"/);

    const restored = decodeDraft({ project: legacyFile(), savedAt: "2026-10-05T00:00:00.000Z" }).project;
    expect(JSON.stringify(restored)).not.toMatch(/"theme"|"showTitle"/);
  });

  it("are still not required: a file without them is valid", () => {
    const definition = toDefinition(drillDownProject());
    expect(decodeDefinition(definition).ok).toBe(true);
  });
});

describe("renderer breadcrumb trail", () => {
  beforeEach(() => {
    __setInlinedCSS(".clickmap-root { position: relative; }");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    window.history.replaceState(null, "", window.location.pathname);
    document.body.innerHTML = '<div id="map"></div>';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const trail = (root: ParentNode = document) => Array.from(root.querySelectorAll(".clickmap-breadcrumbs li"))
    .map((item) => `${item.firstElementChild!.tagName}:${item.textContent}`);

  it("lists visited views as buttons ending at the current view", () => {
    const instance = create({ container: "#map", definition: toDefinition(drillDownProject()) });
    expect(document.querySelector(".clickmap-breadcrumbs")).toBeNull();

    instance.goToView("view_B");
    instance.goToView("view_C");

    const nav = document.querySelector(".clickmap-breadcrumbs")!;
    expect(nav.tagName).toBe("NAV");
    expect(nav).toHaveAttribute("aria-label", "Breadcrumb");
    expect(nav.closest(".clickmap-slot--top-left")).not.toBeNull();
    expect(trail()).toEqual(["BUTTON:View A", "BUTTON:View B", "SPAN:View C"]);
    expect(nav.querySelector("[aria-current]")).toHaveTextContent("View C");
    expect(nav.querySelector("[aria-current]")).toHaveAttribute("aria-current", "page");
    instance.destroy();
  });

  it("returns to an earlier view and drops the views after it", () => {
    const instance = create({ container: "#map", definition: toDefinition(drillDownProject()) });
    const changes = vi.fn();
    instance.on("view:change", changes);
    instance.goToView("view_B");
    instance.goToView("view_C");
    changes.mockClear();

    document.querySelectorAll<HTMLButtonElement>(".clickmap-crumb")[1]!.click();
    expect(instance.getCurrentView()).toBe("view_B");
    expect(changes).toHaveBeenCalledWith({ type: "view:change", previousViewId: "view_C", currentViewId: "view_B" });
    expect(trail()).toEqual(["BUTTON:View A", "SPAN:View B"]);

    document.querySelector<HTMLButtonElement>("button.clickmap-crumb")!.click();
    expect(instance.getCurrentView()).toBe("view_A");
    expect(document.querySelector(".clickmap-breadcrumbs")).toBeNull();

    // The stack really was truncated: Back has nowhere left to go.
    instance.goBack();
    expect(instance.getCurrentView()).toBe("view_A");
    instance.destroy();
  });

  it("follows the current view's flag and sits after the back button", () => {
    const project = drillDownProject();
    project.views[1].ui = { showBackButton: true, showBreadcrumbs: true };
    project.views[2].ui.showBreadcrumbs = false;
    const instance = create({ container: "#map", definition: toDefinition(project) });

    instance.goToView("view_B");
    const slot = document.querySelector(".clickmap-slot--top-left")!;
    expect(Array.from(slot.children).map((child) => child.className)).toEqual(["clickmap-back-btn", "clickmap-breadcrumbs"]);

    instance.goToView("view_C");
    expect(document.querySelector(".clickmap-breadcrumbs")).toBeNull();
    instance.goBack();
    expect(trail()).toEqual(["BUTTON:View A", "SPAN:View B"]);
    instance.reset();
    expect(document.querySelector(".clickmap-breadcrumbs")).toBeNull();
    instance.destroy();
  });

  it("works inside Shadow DOM", () => {
    const host = document.querySelector<HTMLElement>("#map")!;
    const instance = create({ container: host, definition: toDefinition(drillDownProject()), shadowDom: true });
    instance.goToView("view_B");
    expect(trail(host.shadowRoot!)).toEqual(["BUTTON:View A", "SPAN:View B"]);
    host.shadowRoot!.querySelector<HTMLButtonElement>("button.clickmap-crumb")!.click();
    expect(instance.getCurrentView()).toBe("view_A");
    instance.destroy();
  });
});

describe("view navigation flags in the store", () => {
  it("edits showBreadcrumbs as one undoable step and ignores no-op edits", () => {
    const project = drillDownProject();
    useStore.setState({ project, activeViewId: "view_A", past: [], future: [] });
    useStore.getState().setViewUi("view_A", { showBreadcrumbs: true });
    expect(useStore.getState().past).toHaveLength(0);

    useStore.getState().setViewUi("view_A", { showBreadcrumbs: false });
    expect(useStore.getState().project.views[0].ui).toEqual({ showBackButton: false, showBreadcrumbs: false });
    useStore.getState().undo();
    expect(useStore.getState().project.views[0].ui.showBreadcrumbs).toBe(true);
  });
});
