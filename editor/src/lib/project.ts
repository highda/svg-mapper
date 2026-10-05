import type { ClickMapDefinition, ProjectFile, View, Settings } from "@svg-mapper/shared";
import { decodeProjectFile } from "@svg-mapper/shared";

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultView(canvas = { width: 1600, height: 900 }): View {
  return {
    id: makeId("view"),
    name: "Main View",
    slug: "main-view",
    canvas: { ...canvas },
    viewport: {
      minZoom: 1,
      maxZoom: 4,
      initialZoom: 1,
      panEnabled: true,
      zoomEnabled: true,
    },
    ui: {
      showBackButton: false,
      showBreadcrumbs: true,
      showTitle: true,
    },
    layers: [],
  };
}

export function createNewProject(name = "Untitled Map"): ProjectFile {
  const id = makeId("project");
  const defaultView = createDefaultView();
  const settings: Settings = {
    initialViewId: defaultView.id,
    responsive: true,
    maintainAspectRatio: true,
    sizingMode: "fluid-width",
    theme: "default",
    enableHistory: true,
    enableKeyboardNavigation: true,
  };

  return {
    schemaVersion: "1.0.0",
    project: {
      id,
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    settings,
    assets: [],
    views: [defaultView],
    popups: [],
    sharedStyles: {},
    customEvents: [],
    editor: {
      zoom: 1,
      pan: { x: 0, y: 0 },
      grid: { enabled: false, size: 10 },
      guides: [],
      history: [],
    },
  };
}

/** Throws a descriptive error unless `value` is a structurally valid project file. */
/**
 * Structural check with the shared schema (#169). Repairable semantic problems,
 * such as actions pointing at missing views, are left to validateProject so
 * the project still opens for repair.
 */
export function assertProjectFile(value: unknown): asserts value is ProjectFile {
  const result = decodeProjectFile(value);
  if (!result.ok) throw new Error(result.message);
}

export function parseProjectFile(json: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid map.json: the file is not valid JSON.");
  }
  assertProjectFile(parsed);
  return parsed;
}

export function serializeProjectFile(project: ProjectFile): string {
  const updated: ProjectFile = {
    ...project,
    project: {
      ...project.project,
      updatedAt: nowIso(),
    },
  };
  return JSON.stringify(updated, null, 2);
}

export function toDefinition(file: ProjectFile): ClickMapDefinition {
  const { editor: _editor, ...definition } = file;
  return definition as ClickMapDefinition;
}

export function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
