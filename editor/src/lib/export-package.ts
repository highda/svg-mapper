// Export package generation (ASSIGNMENT §8).
// Produces a ZIP with: map.json, renderer JS+CSS, assets/, index.html,
// embed.html, README.txt.

import { zipSync, strToU8 } from "fflate";
import type { ClickMapDefinition, Asset, ContainerSizingMode, HostSize } from "@svg-mapper/shared";
import { DEFAULT_HOST_SIZE, hostStyle, resolveSizingMode } from "@svg-mapper/shared";
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
  };
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
    "popup:open": function (event) { console.debug("[clickmap] popup opened", event); },
    "popup:close": function (event) { console.debug("[clickmap] popup closed", event); }
  };
  Object.keys(subscriptions).forEach(function (name) { map.on(name, subscriptions[name]); });
  return function detachClickMapHooks() {
    Object.keys(subscriptions).forEach(function (name) { map.off(name, subscriptions[name]); });
  };
}
`;

// Derive a safe filename slug from an asset name, deduplicating with a counter map.
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

function makeAssetFilenamer() {
  const seen = new Map<string, number>();
  return function assetFilename(asset: Asset): string {
    const ext = assetExtension(asset.type);
    const withoutExtension = asset.name.replace(/\.[a-z0-9]+$/i, "");
    const safeName = withoutExtension.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || asset.id;
    const base = `assets/${safeName}.${ext}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `assets/${safeName}-${count}.${ext}`;
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
    definitionUrl: ${serializeJsString(`${basePath}/map.json`)},
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

  return `<!DOCTYPE html>
<html lang="en">
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
    definitionUrl: ${serializeJsString(`${basePath}/map.json`)},
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
  Chrome 90+, Firefox 90+, Safari 14+, Edge 90+

Generated by svg-mapper editor.
`;
}

function embeddedAssetBytes(asset: Asset): Uint8Array | null {
  const source = asset.src.trimStart();
  if (source.startsWith("data:")) return dataUriToBytes(source);
  if (source.startsWith("<svg")) return strToU8(asset.src);
  return null;
}

function externalDependencies(definition: ClickMapDefinition): string[] {
  return [...new Set(definition.assets.filter((asset) => embeddedAssetBytes(asset) === null).map((asset) => asset.src))];
}

// Package only sources whose bytes are present. External references are preserved
// verbatim so map.json never points at a file that the ZIP does not contain.
function definitionWithAssetPaths(definition: ClickMapDefinition): { definition: ClickMapDefinition; embeddedAssets: Map<string, Uint8Array> } {
  const assetFilename = makeAssetFilenamer();
  const embeddedAssets = new Map<string, Uint8Array>();
  const assets = definition.assets.map((a) => {
    const bytes = embeddedAssetBytes(a);
    if (!bytes) return a;
    const path = assetFilename(a);
    embeddedAssets.set(path, bytes);
    return { ...a, src: path, inline: false };
  });

  return { definition: { ...definition, assets }, embeddedAssets };
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

export function generateExportPackage(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
  options: ExportOptions,
): ExportPackage {
  const resolved = resolvedOptions(options, definition);
  const { inlineAssets } = resolved;

  // For the ZIP's map.json: inline keeps data-URIs; external rewrites to paths.
  let exportedDefinition: ClickMapDefinition;
  let embeddedAssets: Map<string, Uint8Array> | null = null;
  if (inlineAssets) {
    exportedDefinition = definition;
  } else {
    ({ definition: exportedDefinition, embeddedAssets } = definitionWithAssetPaths(definition));
  }
  exportedDefinition = withResolvedSizing(exportedDefinition, resolved.mode);

  const mapJson = JSON.stringify(exportedDefinition, null, 2);
  const embedSnippet = buildEmbedSnippet(resolved);

  const files: Record<string, Uint8Array> = {};

  files["map.json"] = strToU8(mapJson);
  files["clickmap-renderer.js"] = strToU8(rendererJs);
  files["clickmap-renderer.css"] = strToU8(rendererCss);
  files["hooks.js"] = strToU8(HOOKS_SCAFFOLD);
  files["embed.html"] = strToU8(buildEmbedHtml(resolved));
  files["index.html"] = strToU8(
    buildIndexHtml(exportedDefinition, rendererJs, rendererCss, resolved),
  );
  files["README.txt"] = strToU8(buildReadme(definition.project.name, resolved, externalDependencies(definition)));

  // Asset files (only when not inlining).
  if (!inlineAssets && embeddedAssets) {
    for (const [path, bytes] of embeddedAssets) files[path] = bytes;
  }

  const zip = zipSync(files, { level: 6 });
  return { zip, embedSnippet, mapJson };
}

/** Build all text shown by the Export screen without performing ZIP compression. */
export function generateExportPreview(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
  options: ExportOptions,
): ExportPreview {
  const resolved = resolvedOptions(options, definition);
  const exportedDefinition = withResolvedSizing(options.inlineAssets
    ? definition
    : definitionWithAssetPaths(definition).definition, resolved.mode);
  const mapJson = JSON.stringify(exportedDefinition, null, 2);
  const embedSnippet = buildEmbedSnippet(resolved);
  const dependencies = externalDependencies(definition);
  const readme = buildReadme(definition.project.name, resolved, dependencies);
  const embedded = definition.assets.map(embeddedAssetBytes).filter((bytes): bytes is Uint8Array => bytes !== null);
  const assetBytes = embedded.reduce((total, bytes) => total + bytes.byteLength, 0);
  const assetFileCount = options.inlineAssets ? 0 : embedded.length;
  const textBytes = new TextEncoder().encode(mapJson + embedSnippet + readme + rendererJs + rendererCss).byteLength;
  return {
    embedSnippet,
    mapJson,
    readme,
    estimatedUncompressedBytes: textBytes + (options.inlineAssets ? 0 : assetBytes),
    assetBytes,
    assetFileCount,
    externalDependencies: dependencies,
  };
}
