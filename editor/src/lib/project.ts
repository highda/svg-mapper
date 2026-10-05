import type { ClickMapDefinition, ProjectFile, View, Settings } from "@svg-mapper/shared";
import { CURRENT_SCHEMA_VERSION, SUPPORTED_SCHEMA_MAJOR, decodeProjectFile } from "@svg-mapper/shared";

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
      showBreadcrumbs: false,
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
    enableHistory: true,
    enableKeyboardNavigation: true,
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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

/**
 * Throws a descriptive error unless `value` is a structurally valid project
 * file, using the shared schema (#169). Repairable semantic problems, such as
 * actions pointing at missing views, are left to validateProject so the
 * project still opens for repair. A file with another schemaVersion major is
 * refused outright (#196): it may mean something this editor cannot preserve.
 */
export function assertProjectFile(value: unknown): asserts value is ProjectFile {
  const result = decodeProjectFile(value);
  if (result.ok) return;
  if (result.code === "UNSUPPORTED_SCHEMA_VERSION") {
    const version = (value as { schemaVersion: string }).schemaVersion;
    const newer = Number(version.split(".")[0]) > SUPPORTED_SCHEMA_MAJOR;
    throw new Error(
      newer
        ? `This map uses schemaVersion ${version}, which is newer than this editor supports ` +
            `(${SUPPORTED_SCHEMA_MAJOR}.x). Open it with a newer version of svg-mapper.`
        : `This map uses schemaVersion ${version}, an older format this editor cannot open ` +
            `(it reads ${SUPPORTED_SCHEMA_MAJOR}.x).`,
    );
  }
  throw new Error(result.message);
}

/**
 * Removes fields an earlier 1.x build wrote but nothing ever read (#217):
 * `settings.theme` and `views[].ui.showTitle`. The decoder tolerates them, so
 * older files still open; dropping them here keeps them out of saves and
 * exports. Mutates and returns the decoded file.
 */
export function dropRetiredFields(file: ProjectFile): ProjectFile {
  delete (file.settings as Partial<Record<"theme", unknown>>).theme;
  for (const view of file.views) delete (view.ui as Partial<Record<"showTitle", unknown>>).showTitle;
  return file;
}

export function parseProjectFile(json: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid map.json: the file is not valid JSON.");
  }
  assertProjectFile(parsed);
  return dropRetiredFields(parsed);
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
