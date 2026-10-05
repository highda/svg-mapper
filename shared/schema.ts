// The structural schema for map.json and editor project files, in one place
// (#169). Decoding checks shape and bounds only; semantic reference checks
// (missing views, assets, layers) stay in validateProject so the editor can
// still open a broken-link project for repair. Decoding never strips or
// rewrites fields: on success the input object itself is returned, so
// metadata, payloads and documented extension fields survive untouched.
import * as v from "valibot";
import type { ClickMapDefinition, ProjectFile } from "./types.js";

/** Largest alpha hit-mask side, in mask pixels. */
export const MAX_ALPHA_MASK_DIMENSION = 128;

const str = v.string();
const bool = v.boolean();
const num = v.pipe(v.number(), v.finite());
const atLeast = (minimum: number) => v.pipe(v.number(), v.finite(), v.minValue(minimum));
const unit = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));
const opt = <T extends v.GenericSchema>(schema: T) => v.exactOptional(schema);
const dict = v.record(v.string(), v.unknown());

const styleState = v.object({ fill: str, stroke: str, strokeWidth: atLeast(0) });
const areaStyle = v.object({ default: styleState, hover: styleState, active: styleState, disabled: opt(styleState) });

const action = v.variant("type", [
  v.object({ type: v.literal("none") }),
  v.object({ type: v.literal("url"), href: str, target: v.picklist(["_blank", "_self"]) }),
  v.object({ type: v.literal("goToView"), targetViewId: str, transition: opt(v.picklist(["fade", "none"])) }),
  v.object({
    type: v.literal("popup"),
    content: v.object({ title: opt(str), body: opt(str), imageUrl: opt(str), linkHref: opt(str), linkLabel: opt(str) }),
    position: opt(v.picklist(["auto", "top", "bottom", "left", "right"])),
  }),
  v.object({ type: v.literal("toggleLayer"), targetLayerId: str }),
  v.object({ type: v.literal("customEvent"), eventName: str, payload: opt(dict) }),
]);

const geometry = v.variant("type", [
  v.object({ type: v.literal("rect"), x: num, y: num, width: atLeast(0), height: atLeast(0), rx: opt(atLeast(0)) }),
  v.object({ type: v.literal("circle"), cx: num, cy: num, r: atLeast(0) }),
  v.object({ type: v.literal("polygon"), points: v.array(v.tuple([num, num])) }),
  v.object({ type: v.literal("path"), d: str }),
  v.object({
    type: v.literal("marker"),
    x: num,
    y: num,
    anchor: v.picklist(["bottom-center", "center", "top-left", "top-center", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]),
  }),
]);

/** Decoded byte length of canonical base64, or -1 when it is not base64. */
function base64Length(data: string): number {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) return -1;
  return (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

const maskSide = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_ALPHA_MASK_DIMENSION));
const hitMask = v.pipe(
  v.object({ mode: v.literal("alpha"), assetId: str, threshold: unit, width: maskSide, height: maskSide, data: str, debug: opt(bool) }),
  v.forward(
    v.check(
      (mask) => base64Length(mask.data) === Math.ceil((mask.width * mask.height) / 8),
      "a base64 bit mask of exactly ceil(width × height / 8) bytes",
    ),
    ["data"],
  ),
);

const area = v.object({
  id: str,
  name: str,
  geometry,
  style: areaStyle,
  sharedStyleId: opt(str),
  action,
  tooltip: opt(v.object({ enabled: bool, title: opt(str), body: opt(str), imageUrl: opt(str) })),
  accessibility: opt(v.object({ ariaLabel: str, tabIndex: num })),
  metadata: opt(dict),
  trigger: opt(v.picklist(["click", "hover", "both"])),
  alwaysHighlight: opt(bool),
  disabled: opt(bool),
  label: opt(v.object({ text: opt(str), visible: opt(bool) })),
  image: opt(v.object({
    assetId: str,
    fit: opt(v.picklist(["fill", "contain", "cover"])),
    opacity: opt(unit),
    rotation: opt(num),
    decorative: opt(bool),
    locked: opt(bool),
    visible: opt(bool),
    hitMask: opt(hitMask),
  })),
});

const layer = v.object({ id: str, name: str, visible: bool, locked: bool, opacity: unit, areas: v.array(area) });

const view = v.object({
  id: str,
  name: str,
  slug: str,
  canvas: v.object({ width: atLeast(1), height: atLeast(1) }),
  background: opt(v.object({
    assetId: str,
    fit: v.picklist(["contain", "cover", "fill", "none"]),
    position: opt(v.object({ x: unit, y: unit })),
  })),
  viewport: v.object({ minZoom: atLeast(0), maxZoom: atLeast(0), initialZoom: atLeast(0), panEnabled: bool, zoomEnabled: bool }),
  ui: v.object({ showBackButton: bool, showBreadcrumbs: bool, showTitle: bool }),
  customCss: opt(str),
  layers: v.array(layer),
});

function wellFormedDataUri(src: string): boolean {
  if (!src.startsWith("data:")) return true;
  const match = /^data:[^,]*,(.*)$/s.exec(src);
  if (!match) return false;
  if (/;base64,/i.test(src)) return /^[A-Za-z0-9+/]*={0,2}$/.test(match[1]!) && match[1]!.length % 4 !== 1;
  try {
    decodeURIComponent(match[1]!);
    return true;
  } catch {
    return false;
  }
}

const asset = v.object({
  id: str,
  type: v.picklist(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
  name: str,
  src: v.pipe(v.string(), v.check(wellFormedDataUri, "a well-formed data URI")),
  width: atLeast(1),
  height: atLeast(1),
  inline: bool,
});

const corner = v.picklist(["top-left", "top-right", "bottom-left", "bottom-right"]);

const settings = v.object({
  initialViewId: str,
  responsive: bool,
  maintainAspectRatio: bool,
  theme: str,
  enableHistory: bool,
  enableKeyboardNavigation: bool,
  sizingMode: opt(v.picklist(["fixed", "fluid-width", "fill-container"])),
  contentTemplate: opt(str),
  areaLabels: opt(v.object({ enabled: bool, fontSize: opt(atLeast(0)), color: opt(str), fontWeight: opt(str), hideWhenSmaller: opt(bool) })),
  sceneSwitcher: opt(v.object({
    enabled: bool,
    position: v.picklist(["top-left", "top-right", "bottom-left", "bottom-right", "top-center", "bottom-center"]),
    style: opt(v.picklist(["tabs", "buttons", "dropdown"])),
  })),
  zoomControls: opt(v.object({
    enabled: bool,
    position: opt(corner),
    step: opt(atLeast(0)),
    resetBehavior: opt(v.picklist(["initial", "fit"])),
    wheelMode: opt(v.picklist(["off", "ctrl", "meta", "alt", "shift", "always"])),
  })),
  directory: opt(v.object({
    enabled: bool,
    metadataKeys: opt(v.array(str)),
    categoryKey: opt(str),
    categories: opt(v.array(v.object({ value: str, label: str }))),
  })),
  padding: opt(v.object({ top: atLeast(0), right: atLeast(0), bottom: atLeast(0), left: atLeast(0) })),
});

const definitionEntries = {
  schemaVersion: v.literal("1.0.0"),
  project: v.object({ id: str, name: str, createdAt: str, updatedAt: str }),
  settings,
  assets: v.array(asset),
  views: v.array(view),
  popups: v.array(v.object({ id: str, name: str, title: opt(str), body: opt(str), allowHtml: opt(bool) })),
  sharedStyles: v.record(v.string(), v.object({ name: str, style: areaStyle })),
  customEvents: v.array(str),
};

export const definitionSchema = v.object(definitionEntries);

export const projectFileSchema = v.object({
  ...definitionEntries,
  editor: opt(v.object({
    zoom: atLeast(0),
    pan: v.object({ x: num, y: num }),
    grid: v.object({ enabled: bool, size: atLeast(1) }),
    guides: v.array(v.unknown()),
    history: v.array(v.unknown()),
    selectedAreaId: opt(str),
    selectedLayerId: opt(str),
    selectedViewId: opt(str),
  })),
});

// The schema must describe the published types: a decoded value is usable as one.
type Assignable<From, To> = [From] extends [To] ? true : never;
const definitionTypeCheck: Assignable<v.InferOutput<typeof definitionSchema>, ClickMapDefinition> = true;
const projectTypeCheck: Assignable<v.InferOutput<typeof projectFileSchema>, ProjectFile> = true;
void definitionTypeCheck;
void projectTypeCheck;

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; path: string; message: string };

function pathOf(issue: v.BaseIssue<unknown>): string {
  let path = "$";
  for (const item of issue.path ?? []) {
    path += typeof item.key === "number" ? `[${item.key}]` : `.${String(item.key)}`;
  }
  return path;
}

function decode<T>(schema: v.GenericSchema, value: unknown): DecodeResult<T> {
  const result = v.safeParse(schema, value, { abortEarly: true });
  if (result.success) return { ok: true, value: value as T };
  const issue = result.issues[0];
  const path = pathOf(issue);
  const expected = issue.kind === "validation" && issue.type === "check"
    ? issue.message
    : issue.received === "undefined"
      ? "a required field (missing)"
      : `${issue.expected ?? "a valid value"}, received ${issue.received}`;
  return { ok: false, path, message: `Invalid map.json at ${path}: expected ${expected}.` };
}

/** Structural decode of a map definition (map.json). Returns the input object unchanged on success. */
export function decodeDefinition(value: unknown): DecodeResult<ClickMapDefinition> {
  return decode<ClickMapDefinition>(definitionSchema, value);
}

/** Structural decode of an editor project file (map.json plus optional editor state). */
export function decodeProjectFile(value: unknown): DecodeResult<ProjectFile> {
  return decode<ProjectFile>(projectFileSchema, value);
}
