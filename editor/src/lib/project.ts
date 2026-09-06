import type { ClickMapDefinition, ProjectFile, View, Settings } from "@svg-mapper/shared";

type JsonObject = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new Error(`Invalid map.json at ${path}: expected ${expected}.`);
}

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "an object");
  return value as JsonObject;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "a string");
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "a boolean");
  return value;
}

function number(value: unknown, path: string, minimum?: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    fail(path, minimum === undefined ? "a finite number" : `a finite number >= ${minimum}`);
  }
  return value;
}

function range(value: unknown, path: string, minimum: number, maximum: number): number {
  const result = number(value, path, minimum);
  if (result > maximum) fail(path, `a finite number from ${minimum} to ${maximum}`);
  return result;
}

function oneOf(value: unknown, path: string, choices: readonly string[]): string {
  if (typeof value !== "string" || !choices.includes(value))
    fail(path, choices.map((choice) => JSON.stringify(choice)).join(" or "));
  return value;
}

function optional<T>(value: unknown, validate: (value: unknown) => T): void {
  if (value !== undefined) validate(value);
}

function record(value: unknown, path: string): JsonObject {
  return object(value, path);
}

function validateStyleState(value: unknown, path: string): void {
  const state = object(value, path);
  string(state.fill, `${path}.fill`);
  string(state.stroke, `${path}.stroke`);
  number(state.strokeWidth, `${path}.strokeWidth`, 0);
}

function validateAction(value: unknown, path: string): void {
  const action = object(value, path);
  const type = oneOf(action.type, `${path}.type`, [
    "none",
    "url",
    "goToView",
    "popup",
    "toggleLayer",
    "customEvent",
  ]);
  if (type === "url") {
    string(action.href, `${path}.href`);
    oneOf(action.target, `${path}.target`, ["_blank", "_self"]);
  } else if (type === "goToView") {
    string(action.targetViewId, `${path}.targetViewId`);
    optional(action.transition, (item) => oneOf(item, `${path}.transition`, ["fade", "none"]));
  } else if (type === "popup") {
    const content = object(action.content, `${path}.content`);
    for (const key of ["title", "body", "imageUrl", "linkHref", "linkLabel"] as const) {
      optional(content[key], (item) => string(item, `${path}.content.${key}`));
    }
    optional(action.position, (item) =>
      oneOf(item, `${path}.position`, ["auto", "top", "bottom", "left", "right"]),
    );
  } else if (type === "toggleLayer") {
    string(action.targetLayerId, `${path}.targetLayerId`);
  } else if (type === "customEvent") {
    string(action.eventName, `${path}.eventName`);
    optional(action.payload, (item) => record(item, `${path}.payload`));
  }
}

function validateGeometry(value: unknown, path: string): void {
  const geometry = object(value, path);
  const type = oneOf(geometry.type, `${path}.type`, [
    "rect",
    "circle",
    "polygon",
    "path",
    "marker",
  ]);
  if (type === "rect") {
    number(geometry.x, `${path}.x`);
    number(geometry.y, `${path}.y`);
    number(geometry.width, `${path}.width`, 0);
    number(geometry.height, `${path}.height`, 0);
    optional(geometry.rx, (item) => number(item, `${path}.rx`, 0));
  } else if (type === "circle") {
    number(geometry.cx, `${path}.cx`);
    number(geometry.cy, `${path}.cy`);
    number(geometry.r, `${path}.r`, 0);
  } else if (type === "polygon") {
    array(geometry.points, `${path}.points`).forEach((point, index) => {
      const pair = array(point, `${path}.points[${index}]`);
      if (pair.length !== 2) fail(`${path}.points[${index}]`, "a two-number coordinate");
      number(pair[0], `${path}.points[${index}][0]`);
      number(pair[1], `${path}.points[${index}][1]`);
    });
  } else if (type === "path") {
    string(geometry.d, `${path}.d`);
  } else {
    number(geometry.x, `${path}.x`);
    number(geometry.y, `${path}.y`);
    oneOf(geometry.anchor, `${path}.anchor`, [
      "bottom-center",
      "center",
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-right",
      "middle-left",
      "middle-right",
    ]);
  }
}

function validateArea(value: unknown, path: string): void {
  const area = object(value, path);
  string(area.id, `${path}.id`);
  string(area.name, `${path}.name`);
  validateGeometry(area.geometry, `${path}.geometry`);
  const style = object(area.style, `${path}.style`);
  validateStyleState(style.default, `${path}.style.default`);
  validateStyleState(style.hover, `${path}.style.hover`);
  validateStyleState(style.active, `${path}.style.active`);
  optional(style.disabled, (item) => validateStyleState(item, `${path}.style.disabled`));
  optional(area.sharedStyleId, (item) => string(item, `${path}.sharedStyleId`));
  validateAction(area.action, `${path}.action`);
  optional(area.tooltip, (item) => {
    const tooltip = object(item, `${path}.tooltip`);
    boolean(tooltip.enabled, `${path}.tooltip.enabled`);
    for (const key of ["title", "body", "imageUrl"] as const)
      optional(tooltip[key], (entry) => string(entry, `${path}.tooltip.${key}`));
  });
  optional(area.accessibility, (item) => {
    const a = object(item, `${path}.accessibility`);
    string(a.ariaLabel, `${path}.accessibility.ariaLabel`);
    number(a.tabIndex, `${path}.accessibility.tabIndex`);
  });
  optional(area.metadata, (item) => record(item, `${path}.metadata`));
  optional(area.trigger, (item) => oneOf(item, `${path}.trigger`, ["click", "hover", "both"]));
  for (const key of ["alwaysHighlight", "disabled"] as const)
    optional(area[key], (item) => boolean(item, `${path}.${key}`));
  optional(area.label, (item) => {
    const label = object(item, `${path}.label`);
    optional(label.text, (entry) => string(entry, `${path}.label.text`));
    optional(label.visible, (entry) => boolean(entry, `${path}.label.visible`));
  });
  optional(area.image, (item) => {
    const image = object(item, `${path}.image`);
    string(image.assetId, `${path}.image.assetId`);
    optional(image.fit, (entry) => oneOf(entry, `${path}.image.fit`, ["fill", "contain", "cover"]));
    optional(image.opacity, (entry) => range(entry, `${path}.image.opacity`, 0, 1));
    optional(image.rotation, (entry) => number(entry, `${path}.image.rotation`));
    for (const key of ["decorative", "locked", "visible"] as const)
      optional(image[key], (entry) => boolean(entry, `${path}.image.${key}`));
    optional(image.hitMask, (entry) => {
      const mask = object(entry, `${path}.image.hitMask`);
      oneOf(mask.mode, `${path}.image.hitMask.mode`, ["alpha"]);
      string(mask.assetId, `${path}.image.hitMask.assetId`);
      range(mask.threshold, `${path}.image.hitMask.threshold`, 0, 1);
      number(mask.width, `${path}.image.hitMask.width`, 1);
      number(mask.height, `${path}.image.hitMask.height`, 1);
      string(mask.data, `${path}.image.hitMask.data`);
      optional(mask.debug, (flag) => boolean(flag, `${path}.image.hitMask.debug`));
    });
  });
}

function validateView(value: unknown, path: string): void {
  const view = object(value, path);
  string(view.id, `${path}.id`);
  string(view.name, `${path}.name`);
  string(view.slug, `${path}.slug`);
  const canvas = object(view.canvas, `${path}.canvas`);
  number(canvas.width, `${path}.canvas.width`, 1);
  number(canvas.height, `${path}.canvas.height`, 1);
  optional(view.background, (item) => {
    const bg = object(item, `${path}.background`);
    string(bg.assetId, `${path}.background.assetId`);
    oneOf(bg.fit, `${path}.background.fit`, ["contain", "cover", "fill", "none"]);
    optional(bg.position, (position) => {
      const p = object(position, `${path}.background.position`);
      range(p.x, `${path}.background.position.x`, 0, 1);
      range(p.y, `${path}.background.position.y`, 0, 1);
    });
  });
  const viewport = object(view.viewport, `${path}.viewport`);
  for (const key of ["minZoom", "maxZoom", "initialZoom"] as const)
    number(viewport[key], `${path}.viewport.${key}`, 0);
  boolean(viewport.panEnabled, `${path}.viewport.panEnabled`);
  boolean(viewport.zoomEnabled, `${path}.viewport.zoomEnabled`);
  const ui = object(view.ui, `${path}.ui`);
  for (const key of ["showBackButton", "showBreadcrumbs", "showTitle"] as const)
    boolean(ui[key], `${path}.ui.${key}`);
  optional(view.customCss, (item) => string(item, `${path}.customCss`));
  array(view.layers, `${path}.layers`).forEach((item, layerIndex) => {
    const layerPath = `${path}.layers[${layerIndex}]`;
    const layer = object(item, layerPath);
    string(layer.id, `${layerPath}.id`);
    string(layer.name, `${layerPath}.name`);
    boolean(layer.visible, `${layerPath}.visible`);
    boolean(layer.locked, `${layerPath}.locked`);
    range(layer.opacity, `${layerPath}.opacity`, 0, 1);
    array(layer.areas, `${layerPath}.areas`).forEach((area, areaIndex) =>
      validateArea(area, `${layerPath}.areas[${areaIndex}]`),
    );
  });
}

function validateProjectFile(value: unknown): asserts value is ProjectFile {
  const root = object(value, "$");
  if (root.schemaVersion !== "1.0.0") fail("$.schemaVersion", 'supported version "1.0.0"');
  const project = object(root.project, "$.project");
  for (const key of ["id", "name", "createdAt", "updatedAt"] as const)
    string(project[key], `$.project.${key}`);
  const settings = object(root.settings, "$.settings");
  string(settings.initialViewId, "$.settings.initialViewId");
  boolean(settings.responsive, "$.settings.responsive");
  boolean(settings.maintainAspectRatio, "$.settings.maintainAspectRatio");
  string(settings.theme, "$.settings.theme");
  boolean(settings.enableHistory, "$.settings.enableHistory");
  boolean(settings.enableKeyboardNavigation, "$.settings.enableKeyboardNavigation");
  optional(settings.sizingMode, (item) =>
    oneOf(item, "$.settings.sizingMode", ["fixed", "fluid-width", "fill-container"]),
  );
  optional(settings.contentTemplate, (item) => string(item, "$.settings.contentTemplate"));
  optional(settings.areaLabels, (item) => {
    const labels = object(item, "$.settings.areaLabels");
    boolean(labels.enabled, "$.settings.areaLabels.enabled");
    optional(labels.fontSize, (entry) => number(entry, "$.settings.areaLabels.fontSize", 0));
    optional(labels.color, (entry) => string(entry, "$.settings.areaLabels.color"));
    optional(labels.fontWeight, (entry) => string(entry, "$.settings.areaLabels.fontWeight"));
    optional(labels.hideWhenSmaller, (entry) =>
      boolean(entry, "$.settings.areaLabels.hideWhenSmaller"),
    );
  });
  optional(settings.sceneSwitcher, (item) => {
    const switcher = object(item, "$.settings.sceneSwitcher");
    boolean(switcher.enabled, "$.settings.sceneSwitcher.enabled");
    oneOf(switcher.position, "$.settings.sceneSwitcher.position", [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "top-center",
      "bottom-center",
    ]);
    optional(switcher.style, (entry) =>
      oneOf(entry, "$.settings.sceneSwitcher.style", ["tabs", "buttons", "dropdown"]),
    );
  });
  optional(settings.zoomControls, (item) => {
    const controls = object(item, "$.settings.zoomControls");
    boolean(controls.enabled, "$.settings.zoomControls.enabled");
    optional(controls.position, (entry) =>
      oneOf(entry, "$.settings.zoomControls.position", [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ]),
    );
    optional(controls.step, (entry) => number(entry, "$.settings.zoomControls.step", 0));
    optional(controls.resetBehavior, (entry) =>
      oneOf(entry, "$.settings.zoomControls.resetBehavior", ["initial", "fit"]),
    );
    optional(controls.wheelMode, (entry) =>
      oneOf(entry, "$.settings.zoomControls.wheelMode", [
        "off",
        "ctrl",
        "meta",
        "alt",
        "shift",
        "always",
      ]),
    );
  });
  optional(settings.directory, (item) => {
    const directory = object(item, "$.settings.directory");
    boolean(directory.enabled, "$.settings.directory.enabled");
    optional(directory.metadataKeys, (entries) =>
      array(entries, "$.settings.directory.metadataKeys").forEach((entry, index) =>
        string(entry, `$.settings.directory.metadataKeys[${index}]`),
      ),
    );
    optional(directory.categoryKey, (entry) => string(entry, "$.settings.directory.categoryKey"));
    optional(directory.categories, (entries) =>
      array(entries, "$.settings.directory.categories").forEach((entry, index) => {
        const path = `$.settings.directory.categories[${index}]`;
        const category = object(entry, path);
        string(category.value, `${path}.value`);
        string(category.label, `${path}.label`);
      }),
    );
  });
  optional(settings.padding, (item) => {
    const padding = object(item, "$.settings.padding");
    for (const key of ["top", "right", "bottom", "left"] as const)
      number(padding[key], `$.settings.padding.${key}`, 0);
  });
  array(root.assets, "$.assets").forEach((item, index) => {
    const path = `$.assets[${index}]`;
    const asset = object(item, path);
    string(asset.id, `${path}.id`);
    oneOf(asset.type, `${path}.type`, ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
    string(asset.name, `${path}.name`);
    const src = string(asset.src, `${path}.src`);
    number(asset.width, `${path}.width`, 1);
    number(asset.height, `${path}.height`, 1);
    boolean(asset.inline, `${path}.inline`);
    if (src.startsWith("data:")) {
      const match = /^data:[^,]*,(.*)$/s.exec(src);
      if (!match) fail(`${path}.src`, "a well-formed data URI");
      try {
        if (/;base64,/i.test(src)) {
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(match[1]) || match[1].length % 4 === 1)
            throw new Error();
        } else decodeURIComponent(match[1]);
      } catch {
        fail(`${path}.src`, "a well-formed data URI");
      }
    }
  });
  array(root.views, "$.views").forEach((item, index) => validateView(item, `$.views[${index}]`));
  array(root.popups, "$.popups").forEach((item, index) => {
    const path = `$.popups[${index}]`;
    const popup = object(item, path);
    string(popup.id, `${path}.id`);
    string(popup.name, `${path}.name`);
    optional(popup.title, (entry) => string(entry, `${path}.title`));
    optional(popup.body, (entry) => string(entry, `${path}.body`));
    optional(popup.allowHtml, (entry) => boolean(entry, `${path}.allowHtml`));
  });
  const sharedStyles = record(root.sharedStyles, "$.sharedStyles");
  for (const [id, value] of Object.entries(sharedStyles)) {
    const path = `$.sharedStyles.${id}`;
    const preset = object(value, path);
    string(preset.name, `${path}.name`);
    const style = object(preset.style, `${path}.style`);
    validateStyleState(style.default, `${path}.style.default`);
    validateStyleState(style.hover, `${path}.style.hover`);
    validateStyleState(style.active, `${path}.style.active`);
    optional(style.disabled, (item) => validateStyleState(item, `${path}.style.disabled`));
  }
  array(root.customEvents, "$.customEvents").forEach((item, index) =>
    string(item, `$.customEvents[${index}]`),
  );
  optional(root.editor, (item) => {
    const editor = object(item, "$.editor");
    number(editor.zoom, "$.editor.zoom", 0);
    const pan = object(editor.pan, "$.editor.pan");
    number(pan.x, "$.editor.pan.x");
    number(pan.y, "$.editor.pan.y");
    const grid = object(editor.grid, "$.editor.grid");
    boolean(grid.enabled, "$.editor.grid.enabled");
    number(grid.size, "$.editor.grid.size", 1);
    array(editor.guides, "$.editor.guides");
    array(editor.history, "$.editor.history");
    optional(editor.selectedAreaId, (entry) => string(entry, "$.editor.selectedAreaId"));
    optional(editor.selectedLayerId, (entry) => string(entry, "$.editor.selectedLayerId"));
    optional(editor.selectedViewId, (entry) => string(entry, "$.editor.selectedViewId"));
  });
}

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

export function parseProjectFile(json: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid map.json: the file is not valid JSON.");
  }
  validateProjectFile(parsed);
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
