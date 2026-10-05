// Export package generation (ASSIGNMENT §8).
// Produces a ZIP with: map.json, renderer JS+CSS, assets/, index.html,
// embed.html, README.txt.

import { zip, zipSync, strToU8, type Zippable } from "fflate";
import type { ClickMapDefinition, Asset, ContainerSizingMode, HostSize } from "@svg-mapper/shared";
import { DEFAULT_HOST_SIZE, hostStyle, resolveSizingMode, sanitizeSvgMarkup } from "@svg-mapper/shared";
import { serializeJsonForScript } from "./script-json";

export interface ExportOptions {
  /** Inline all assets into map.json as data-URIs instead of separate files. */
  inlineAssets: boolean;
  /** Public directory containing the uploaded package. */
  basePath?: string;
  /** Unique host-page element id. */
  containerId?: string;
  /**
   * Host element size for `fill-container` maps. The renderer mode itself comes
   * from `definition.settings` (see resolveSizingMode); fixed and fluid-width
   * maps size themselves and ignore this.
   */
  hostSize?: HostSize;
}

export interface ExportPackage {
  zip: Uint8Array;
  embedSnippet: string;
  mapJson: string;
}

export interface ExportPreview {
  embedSnippet: string;
  mapJson: string;
  readme: string;
  estimatedUncompressedBytes: number;
  assetBytes: number;
  assetFileCount: number;
  externalDependencies: string[];
}

const DEFAULT_EXPORT_OPTIONS = {
  basePath: "/maps/my-map",
  containerId: "clickmap",
  hostSize: DEFAULT_HOST_SIZE,
} as const;

/**
 * The single sizing resolution every artifact is generated from: the renderer
 * mode written into map.json, the host CSS in index.html and the embed
 * snippet, and the README guidance.
 */
function resolvedOptions(options: ExportOptions, definition: ClickMapDefinition) {
  const merged = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  const mode = resolveSizingMode(definition.settings);
  const initialView = definition.views.find((view) => view.id === definition.settings.initialViewId) ?? definition.views[0];
  return {
    ...merged,
    mode,
    hostStyle: hostStyle(mode, merged.hostSize),
    canvas: initialView?.canvas ?? { width: 0, height: 0 },
    hostStrings: hostStrings(definition),
  };
}

/**
 * The visitor text shown before map.json has loaded (#216): the embed passes
 * it to create(), since the renderer cannot read it from the definition yet.
 */
function hostStrings(definition: ClickMapDefinition): string {
  const { loading, error } = definition.settings.strings ?? {};
  const strings = { ...(loading !== undefined ? { loading } : {}), ...(error !== undefined ? { error } : {}) };
  return Object.keys(strings).length ? `\n    strings: ${JSON.stringify(strings).replace(/</g, "\\u003c")},` : "";
}

type ResolvedOptions = ReturnType<typeof resolvedOptions>;

/** Record the resolved mode explicitly so every consumer of map.json agrees. */
function withResolvedSizing(definition: ClickMapDefinition, mode: ContainerSizingMode): ClickMapDefinition {
  return { ...definition, settings: { ...definition.settings, sizingMode: mode } };
}

function hostDiv(options: ResolvedOptions): string {
  const id = escapeHtml(options.containerId);
  return options.hostStyle ? `<div id="${id}" style="${escapeHtml(options.hostStyle)}"></div>` : `<div id="${id}"></div>`;
}

function sizingGuide(options: ResolvedOptions): string {
  const { width, height } = options.canvas;
  if (options.mode === "fixed") {
    return `  Mode: fixed canvas size. The map renders at the canvas size of each view
  (${width} × ${height} CSS px for the initial view) whatever the host's size.
  The host needs no size of its own; leave that much room for it on the page.`;
  }
  if (options.mode === "fluid-width") {
    return `  Mode: fluid width. The map fills the width of <div id="${options.containerId}">
  and sets its own height from each view's shape (${width}:${height} for the
  initial view). Give the host or its parent a nonzero width; do not set a height.`;
  }
  return `  Mode: fill host. The map fills <div id="${options.containerId}">, sized
  ${options.hostSize.width.trim()} × ${options.hostSize.height.trim()} here. The host must have an explicit,
  nonzero width and height. A percentage height only works when every parent
  also has a height. The canvas (${width} × ${height} for the initial view) is
  fitted inside the host; it does not set the host's size.`;
}

function normalizeBasePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed || ".";
}

function serializeJsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The exported map's browser floor. It must match the renderer's esbuild
 * target (renderer/build.mjs) and the platform features the renderer uses
 * without polyfills; a unit test keeps the three in step (#178).
 */
export const SUPPORTED_BROWSERS = `  Chrome and Edge 99+, Firefox 97+, Safari 16+ (macOS and iOS).
  The map relies on CSS aspect-ratio, cascade layers, :focus-visible and
  overscroll-behavior. Older browsers are not polyfilled and are unsupported.`;

const HOOKS_SCAFFOLD = `/* Trusted host-side lifecycle hooks. */
function attachClickMapHooks(map) {
  var subscriptions = {
    ready: function (event) { console.debug("[clickmap] ready", event); },
    error: function (event) { console.error("[clickmap] error", event); },
    "view:leave": function (event) { console.debug("[clickmap] view left", event); },
    "view:enter": function (event) { console.debug("[clickmap] view entered", event); },
    "view:change": function (event) { console.debug("[clickmap] view changed", event); },
    "camera:change": function (event) { console.debug("[clickmap] camera changed", event); },
    "area:hover": function (event) { console.debug("[clickmap] area hovered", event); },
    "area:click": function (event) { console.debug("[clickmap] area clicked", event); },
    "area:select": function (event) { console.debug("[clickmap] selection changed", event.areaId, event); },
    "popup:open": function (event) { console.debug("[clickmap] popup opened", event); },
    "popup:close": function (event) { console.debug("[clickmap] popup closed", event); }
  };
  Object.keys(subscriptions).forEach(function (name) { map.on(name, subscriptions[name]); });
  return function detachClickMapHooks() {
    Object.keys(subscriptions).forEach(function (name) { map.off(name, subscriptions[name]); });
  };
}
`;

function assetExtension(type: string): string {
  const mime = type.toLowerCase().split(";", 1)[0];
  const extensions: Record<string, string> = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
  };
  return extensions[mime] ?? "bin";
}

function assetSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// Allocates one globally unique packaged path per embedded asset. Every emitted
// path is reserved, so a generated suffix ("a-1.svg") can never collide with a
// later original name, and paths that differ only in letter case are treated as
// the same file because case-insensitive filesystems would merge them on extract.
function makeAssetFilenamer() {
  const used = new Set<string>();
  return function assetFilename(asset: Asset): string {
    const ext = assetExtension(asset.type);
    const withoutExtension = asset.name.replace(/\.[a-z0-9]+$/i, "");
    const safeName = assetSlug(withoutExtension) || assetSlug(asset.id) || "asset";
    let candidate = `assets/${safeName}.${ext}`;
    for (let counter = 1; used.has(candidate.toLowerCase()); counter++) {
      candidate = `assets/${safeName}-${counter}.${ext}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

function buildEmbedSnippet(options: ResolvedOptions): string {
  const basePath = normalizeBasePath(options.basePath);
  const htmlBasePath = escapeHtml(basePath);
  const selector = serializeJsString(`#${options.containerId}`);
  return `${hostDiv(options)}

<link rel="stylesheet" href="${htmlBasePath}/clickmap-renderer.css">
<script src="${htmlBasePath}/clickmap-renderer.js"></script>
<script src="${htmlBasePath}/hooks.js"></script>
<script>
  var map = ClickMapRenderer.create({
    container: ${selector},
    definitionUrl: ${serializeJsString(`${basePath}/map.json`)},${options.hostStrings}
    // shadowDom: true, // Optional: isolate the map from host-page CSS.
    // css: ".clickmap-root { /* custom overrides */ }", // Shadow mode only.
  });
  attachClickMapHooks(map); // Optional; edit hooks.js or remove this line.
</script>`;
}

function buildIndexHtml(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
  options: ResolvedOptions,
): string {
  const safeJson = serializeJsonForScript(definition, 2);

  const projectName = definition.project.name;
  const { lang, dir } = definition.settings;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang || "en")}"${dir ? ` dir="${dir}"` : ""}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(projectName)}</title>
  <style>
${rendererCss}
    html, body { margin: 0; padding: 0; height: 100%; }
    body { display: flex; align-items: center; justify-content: center;
           background: #1a1a1a; }
    #clickmap { ${options.mode === "fluid-width" ? "width: 100%; max-width: 1200px;" : options.hostStyle} }
  </style>
</head>
<body>
  <div id="clickmap"></div>
  <script>
${rendererJs}
  </script>
  <script>
${HOOKS_SCAFFOLD}
  </script>
  <script>
    var definition = ${safeJson};
    var map = ClickMapRenderer.create({ container: "#clickmap", definition: definition });
    attachClickMapHooks(map);
  </script>
</body>
</html>`;
}

function buildEmbedHtml(options: ResolvedOptions): string {
  const basePath = normalizeBasePath(options.basePath);
  const htmlBasePath = escapeHtml(basePath);
  const selector = serializeJsString(`#${options.containerId}`);
  return `<!-- Embed snippet: paste into your page's <head> and <body> -->

<!-- In <head>: -->
<link rel="stylesheet" href="${htmlBasePath}/clickmap-renderer.css">

<!-- In <body> where the map should appear: -->
${hostDiv(options)}

<!-- Before </body>: -->
<script src="${htmlBasePath}/clickmap-renderer.js"></script>
<script src="${htmlBasePath}/hooks.js"></script>
<script>
  var map = ClickMapRenderer.create({
    container: ${selector},
    definitionUrl: ${serializeJsString(`${basePath}/map.json`)},${options.hostStrings}
    // shadowDom: true, // Optional: isolate the map from host-page CSS.
    // css: ".clickmap-root { /* custom overrides */ }", // Shadow mode only.
  });
  attachClickMapHooks(map); // Optional; edit hooks.js or remove this line.
</script>`;
}

function buildReadme(projectName: string, options: ResolvedOptions, externalDependencies: string[]): string {
  const dependencyNotice = externalDependencies.length === 0
    ? "  None. Every embedded source is included in this package."
    : `  This package preserves the following external references; they were not\n  downloaded or rewritten. Remote URLs must remain reachable. Relative paths must\n  be deployed relative to map.json (and index.html when opened locally):\n${externalDependencies.map((source) => `  - ${source}`).join("\n")}`;
  return `${projectName} — Clickable Map Package
${"=".repeat((projectName + " — Clickable Map Package").length)}

CONTENTS
--------
  index.html           Standalone demo — open in a browser or serve statically
  embed.html           Copy-paste snippet for your own pages
  map.json             Map definition (do not rename)
  clickmap-renderer.js Renderer script (do not rename)
  clickmap-renderer.css Renderer styles (do not rename)
  hooks.js             Editable trusted lifecycle hook scaffold
  assets/              Image and SVG files referenced by the map

EXTERNAL ASSET DEPENDENCIES
---------------------------
${dependencyNotice}

QUICK START
-----------
1. Upload the entire folder to your web server or CDN.
2. Open embed.html and copy the snippet into your page.
3. Upload it at ${normalizeBasePath(options.basePath)} (the path already used by embed.html).
4. The <div id="${options.containerId}"> can be placed anywhere in your page body.
   See MAP SIZE below for the space it needs.

MAP SIZE
--------
${sizingGuide(options)}

OPENING LOCALLY
---------------
Open index.html directly in a browser (file:// works — assets are embedded).

COMMON ISSUES
-------------
CORS on definitionUrl
  If you load the renderer via <script> but host map.json on a different origin,
  the browser will block the fetch. Upload all files to the same origin, or add
  Access-Control-Allow-Origin: * to the server serving map.json.

Missing assets
  Packaged asset files must be uploaded alongside map.json in the assets/ folder.
  Do not rename or move them. Preserve any external dependencies listed above.

Map is blank or zero-height
  Check MAP SIZE above. A hidden host (display: none) is fine: the map lays
  itself out when the host becomes visible and gains size.

Multiple instances per page
  Call ClickMapRenderer.create() once per container. Each call returns an
  independent instance; they do not share state.

Lifecycle hooks
  Edit hooks.js to integrate analytics or host UI. Hook exceptions are isolated
  by the renderer. Call its returned detach function before removing a long-lived
  integration. Never paste untrusted project content into hooks.js.

SUPPORTED BROWSERS
------------------
${SUPPORTED_BROWSERS}

Generated by svg-mapper editor.
`;
}

// Embedded SVG artwork is published as files a visitor can open directly, so
// its bytes pass the shared SVG profile at export too, whatever path brought
// them into the project (import, pasted JSON, raw markup or data URI) (#167).
function isEmbeddedSvg(asset: Asset): boolean {
  const source = asset.src.trimStart();
  return source.startsWith("<svg") || /^data:image\/svg\+xml[;,]/i.test(source)
    || (asset.type === "image/svg+xml" && source.startsWith("data:"));
}

function sanitizedSvgAsset(asset: Asset): Asset {
  const source = asset.src.trimStart();
  const markup = source.startsWith("data:") ? new TextDecoder().decode(dataUriToBytes(source)) : asset.src;
  let clean: string;
  try {
    clean = sanitizeSvgMarkup(markup);
  } catch (cause) {
    throw new Error(`Asset "${asset.name}": ${cause instanceof Error ? cause.message : "Invalid SVG."}`, { cause });
  }
  return { ...asset, src: source.startsWith("data:") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}` : clean };
}

function embeddedAssetBytes(asset: Asset): Uint8Array | null {
  const source = asset.src.trimStart();
  if (source.startsWith("data:")) return dataUriToBytes(source);
  if (source.startsWith("<svg")) return strToU8(asset.src);
  return null;
}

/**
 * Asset work that depends only on the project's asset list: SVG sanitization,
 * data-URI decoding and packaged path allocation. Deployment text (base path,
 * container ID) never touches it, so it is computed once per assets revision.
 */
export interface PreparedAssets {
  /** Assets after SVG sanitization, as written to an inline map.json. */
  readonly inlined: readonly Asset[];
  /** The same assets with embedded sources rewritten to packaged paths. */
  readonly packaged: readonly Asset[];
  /** Packaged path → decoded bytes, in allocation order. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Total decoded bytes of embedded sources. */
  readonly assetBytes: number;
  /** Remote URLs and relative paths that stay outside the package. */
  readonly externalDependencies: readonly string[];
  /**
   * The first problem that makes the package unpublishable (an SVG that fails
   * sanitization, then malformed embedded data). Previews still render with
   * the source left as-is; packaging throws it.
   */
  readonly error: Error | null;
}

// Keyed by the asset array, so a project edit that leaves assets untouched (or
// an Export-screen option change) reuses the decoded bytes. Each entry also
// records what it was computed from, so an array mutated in place is not
// served stale results; that check is a cheap reference comparison.
type AssetFingerprint = readonly [Asset, string, string, string, string];
const fingerprint = (asset: Asset): AssetFingerprint => [asset, asset.id, asset.name, asset.type, asset.src];
const preparedAssetsCache = new WeakMap<readonly Asset[], { inputs: AssetFingerprint[]; prepared: PreparedAssets }>();

function cacheIsCurrent(assets: readonly Asset[], inputs: readonly AssetFingerprint[]): boolean {
  return assets.length === inputs.length
    && assets.every((asset, index) => fingerprint(asset).every((value, field) => value === inputs[index]![field]));
}

export function prepareExportAssets(assets: readonly Asset[]): PreparedAssets {
  const cached = preparedAssetsCache.get(assets);
  if (cached && cacheIsCurrent(assets, cached.inputs)) return cached.prepared;

  let sanitizeError: Error | null = null;
  let decodeError: Error | null = null;
  const inlined = assets.map((asset) => {
    if (!isEmbeddedSvg(asset)) return asset;
    try {
      return sanitizedSvgAsset(asset);
    } catch (error) {
      sanitizeError ??= error instanceof Error ? error : new Error(String(error));
      return asset;
    }
  });

  // Package only sources whose bytes are present. External references are
  // preserved verbatim so map.json never points at a file the ZIP lacks.
  const assetFilename = makeAssetFilenamer();
  const files = new Map<string, Uint8Array>();
  const dependencies = new Set<string>();
  let assetBytes = 0;
  const packaged = inlined.map((asset) => {
    let bytes: Uint8Array | null;
    try {
      bytes = embeddedAssetBytes(asset);
    } catch (error) {
      decodeError ??= error instanceof Error ? error : new Error(String(error));
      return asset;
    }
    if (!bytes) {
      dependencies.add(asset.src);
      return asset;
    }
    const path = assetFilename(asset);
    files.set(path, bytes);
    assetBytes += bytes.byteLength;
    return { ...asset, src: path, inline: false };
  });

  const prepared: PreparedAssets = {
    inlined,
    packaged,
    files,
    assetBytes,
    externalDependencies: [...dependencies],
    error: sanitizeError ?? decodeError,
  };
  preparedAssetsCache.set(assets, { inputs: assets.map(fingerprint), prepared });
  return prepared;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Data-URI → Uint8Array (strips the header).
function dataUriToBytes(src: string): Uint8Array {
  if (!src.startsWith("data:")) return strToU8(src);
  const comma = src.indexOf(",");
  if (comma === -1) throw new Error("Malformed asset data URI: missing comma separator.");
  const meta = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  if (meta.includes("base64")) {
    let binary: string;
    try {
      binary = atob(payload);
    } catch {
      throw new Error("Malformed base64 asset data URI.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  try {
    return strToU8(decodeURIComponent(payload));
  } catch {
    throw new Error("Malformed percent-encoded asset data URI.");
  }
}

/**
 * Everything one export produces, as the exact bytes of each ZIP entry. The
 * download and the Export screen's size estimate both come from this object,
 * so the estimate is the sum of the entries the ZIP will contain.
 */
export interface ExportManifest {
  /** ZIP entries in package order. Treat as immutable. */
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly embedSnippet: string;
  readonly mapJson: string;
  readonly readme: string;
  /** Sum of every entry's uncompressed bytes (before ZIP compression). */
  readonly uncompressedBytes: number;
  /** Decoded bytes of embedded source assets (inline or as files). */
  readonly assetBytes: number;
  /** Separate files under assets/ (0 when assets stay inline). */
  readonly assetFileCount: number;
  readonly externalDependencies: readonly string[];
  /** Why this manifest cannot be packaged, or null when it can. */
  readonly error: Error | null;
}

interface PackageCore {
  mapJson: string;
  /** map.json, renderer files, hooks.js, index.html and assets/. */
  files: Record<string, Uint8Array>;
  assetFileCount: number;
}

// The deployment-independent part (map.json, index.html, renderer, assets),
// remembered per definition object (treated as immutable, as the editor's
// store produces it): changing the base path or container ID
// reuses it; changing inline or sizing options rebuilds only these text files.
const coreCache = new WeakMap<ClickMapDefinition, { key: string; prepared: PreparedAssets; rendererJs: string; rendererCss: string; core: PackageCore }>();

function packageCore(
  definition: ClickMapDefinition,
  prepared: PreparedAssets,
  rendererJs: string,
  rendererCss: string,
  resolved: ResolvedOptions,
): PackageCore {
  const key = `${resolved.inlineAssets ? "inline" : "files"}|${resolved.mode}|${resolved.hostStyle}`;
  const cached = coreCache.get(definition);
  if (cached && cached.key === key && cached.prepared === prepared && cached.rendererJs === rendererJs && cached.rendererCss === rendererCss) return cached.core;

  // map.json: inline keeps (sanitized) data URIs; otherwise packaged paths.
  const exportedDefinition = withResolvedSizing(
    { ...definition, assets: [...(resolved.inlineAssets ? prepared.inlined : prepared.packaged)] },
    resolved.mode,
  );
  const mapJson = JSON.stringify(exportedDefinition, null, 2);
  const files: Record<string, Uint8Array> = {
    "map.json": strToU8(mapJson),
    "clickmap-renderer.js": strToU8(rendererJs),
    "clickmap-renderer.css": strToU8(rendererCss),
    "hooks.js": strToU8(HOOKS_SCAFFOLD),
    "index.html": strToU8(buildIndexHtml(exportedDefinition, rendererJs, rendererCss, resolved)),
  };
  if (!resolved.inlineAssets) {
    for (const [path, bytes] of prepared.files) files[path] = bytes;
  }
  const core = { mapJson, files, assetFileCount: resolved.inlineAssets ? 0 : prepared.files.size };
  coreCache.set(definition, { key, prepared, rendererJs, rendererCss, core });
  return core;
}

const TEXT_ENTRY_ORDER = ["map.json", "clickmap-renderer.js", "clickmap-renderer.css", "hooks.js", "embed.html", "index.html", "README.txt"];

/**
 * Build the complete package manifest without compressing anything. Never
 * throws for bad project data: a problem that blocks packaging is reported in
 * `error` so the Export screen can still show its preview.
 */
export function buildExportManifest(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
  options: ExportOptions,
): ExportManifest {
  const prepared = prepareExportAssets(definition.assets);
  const resolved = resolvedOptions(options, definition);
  const core = packageCore(definition, prepared, rendererJs, rendererCss, resolved);
  const externalDependencies = [...prepared.externalDependencies];
  const readme = buildReadme(definition.project.name, resolved, externalDependencies);
  const embedSnippet = buildEmbedSnippet(resolved);

  // Deployment-specific entries are cheap text; everything else is reused.
  const deployment: Record<string, Uint8Array> = {
    "embed.html": strToU8(buildEmbedHtml(resolved)),
    "README.txt": strToU8(readme),
  };
  const files: Record<string, Uint8Array> = {};
  for (const name of TEXT_ENTRY_ORDER) files[name] = deployment[name] ?? core.files[name]!;
  for (const [name, bytes] of Object.entries(core.files)) files[name] ??= bytes;

  const uncompressedBytes = Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0);
  return {
    files,
    embedSnippet,
    mapJson: core.mapJson,
    readme,
    uncompressedBytes,
    assetBytes: prepared.assetBytes,
    assetFileCount: core.assetFileCount,
    externalDependencies,
    error: prepared.error,
  };
}

// PNG, JPEG and WebP are already compressed; storing them skips a deflate pass
// that would cost time (and a worker) for almost no size benefit.
const STORED_EXTENSIONS = /\.(png|jpe?g|webp)$/i;

function zipEntries(manifest: ExportManifest): Zippable {
  const entries: Zippable = {};
  for (const [name, bytes] of Object.entries(manifest.files)) {
    entries[name] = STORED_EXTENSIONS.test(name) ? [bytes, { level: 0 }] : bytes;
  }
  return entries;
}

const ZIP_OPTIONS = { level: 6 } as const;

/** Synchronous ZIP of a manifest (tests and non-UI callers). */
export function zipExportManifestSync(manifest: ExportManifest): Uint8Array {
  if (manifest.error) throw manifest.error;
  return zipSync(zipEntries(manifest), ZIP_OPTIONS);
}

export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled.");
    this.name = "ExportCancelledError";
  }
}

/**
 * Compress a manifest with fflate's asynchronous ZIP API: large entries are
 * deflated in fflate's own workers so the page keeps painting and accepting
 * input. Aborting `signal` terminates those workers and rejects with
 * ExportCancelledError. If workers cannot be created at all, it falls back to
 * the synchronous encoder rather than failing the download.
 */
export async function zipExportManifest(manifest: ExportManifest, { signal }: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
  if (manifest.error) throw manifest.error;
  if (signal?.aborted) throw new ExportCancelledError();
  // Yield once so the caller's busy state paints before fflate deflates the
  // small entries inline.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw new ExportCancelledError();

  const entries = zipEntries(manifest);
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    let terminate: (() => void) | null = null;
    const finish = (error: Error | null, data: Uint8Array | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(data!);
    };
    const onAbort = () => {
      terminate?.();
      finish(new ExportCancelledError(), null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      terminate = zip(entries, ZIP_OPTIONS, (error, data) => {
        finish(error ? new Error(`Compression failed: ${error.message}`, { cause: error }) : null, data);
      });
    } catch {
      // Worker construction failed (no Worker support or a restrictive CSP).
      try {
        finish(null, zipSync(entries, ZIP_OPTIONS));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Packaging failed."), null);
      }
    }
  });
}

/** Build and synchronously compress a package. Throws when it cannot be published. */
export function generateExportPackage(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
  options: ExportOptions,
): ExportPackage {
  const manifest = buildExportManifest(definition, rendererJs, rendererCss, options);
  return { zip: zipExportManifestSync(manifest), embedSnippet: manifest.embedSnippet, mapJson: manifest.mapJson };
}

/** Build all text shown by the Export screen without performing ZIP compression. */
export function generateExportPreview(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
  options: ExportOptions,
): ExportPreview {
  const manifest = buildExportManifest(definition, rendererJs, rendererCss, options);
  return {
    embedSnippet: manifest.embedSnippet,
    mapJson: manifest.mapJson,
    readme: manifest.readme,
    estimatedUncompressedBytes: manifest.uncompressedBytes,
    assetBytes: manifest.assetBytes,
    assetFileCount: manifest.assetFileCount,
    externalDependencies: [...manifest.externalDependencies],
  };
}
