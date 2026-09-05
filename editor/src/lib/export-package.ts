// Export package generation (ASSIGNMENT §8).
// Produces a ZIP with: map.json, renderer JS+CSS, assets/, index.html,
// embed.html, README.txt.

import { zipSync, strToU8 } from "fflate";
import type { ClickMapDefinition, Asset } from "@svg-mapper/shared";
import { serializeJsonForScript } from "./script-json";

export interface ExportOptions {
  /** Inline all assets into map.json as data-URIs instead of separate files. */
  inlineAssets: boolean;
  /** Public directory containing the uploaded package. */
  basePath?: string;
  /** Unique host-page element id. */
  containerId?: string;
  /** CSS width and height applied to the host element. */
  containerWidth?: string;
  containerHeight?: string;
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
}

const DEFAULT_EXPORT_OPTIONS = {
  basePath: "/maps/my-map",
  containerId: "clickmap",
  containerWidth: "100%",
  containerHeight: "auto",
} as const;

function resolvedOptions(options: ExportOptions) {
  return { ...DEFAULT_EXPORT_OPTIONS, ...options };
}

function normalizeBasePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed || ".";
}

function serializeJsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Derive a safe filename slug from an asset name, deduplicating with a counter map.
function makeAssetFilenamer() {
  const seen = new Map<string, number>();
  return function assetFilename(asset: Asset): string {
    const ext = asset.type.split("/")[1] ?? "bin";
    const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || asset.id;
    const base = `assets/${safeName}.${ext}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `assets/${safeName}-${count}.${ext}`;
  };
}

function buildEmbedSnippet(options: ReturnType<typeof resolvedOptions>): string {
  const basePath = normalizeBasePath(options.basePath);
  const htmlBasePath = escapeHtml(basePath);
  const id = escapeHtml(options.containerId);
  const selector = serializeJsString(`#${options.containerId}`);
  return `<div id="${id}" style="width: ${escapeHtml(options.containerWidth)}; height: ${escapeHtml(options.containerHeight)};"></div>

<link rel="stylesheet" href="${htmlBasePath}/clickmap-renderer.css">
<script src="${htmlBasePath}/clickmap-renderer.js"></script>
<script>
  ClickMapRenderer.create({
    container: ${selector},
    definitionUrl: ${serializeJsString(`${basePath}/map.json`)},
    // shadowDom: true, // Optional: isolate the map from host-page CSS.
    // css: ".clickmap-root { /* custom overrides */ }", // Shadow mode only.
  });
</script>`;
}

function buildIndexHtml(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
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
    #clickmap { width: 100%; max-width: 1200px; }
  </style>
</head>
<body>
  <div id="clickmap"></div>
  <script>
${rendererJs}
  </script>
  <script>
    var definition = ${safeJson};
    ClickMapRenderer.create({ container: "#clickmap", definition: definition });
  </script>
</body>
</html>`;
}

function buildEmbedHtml(options: ReturnType<typeof resolvedOptions>): string {
  const basePath = normalizeBasePath(options.basePath);
  const htmlBasePath = escapeHtml(basePath);
  const id = escapeHtml(options.containerId);
  const selector = serializeJsString(`#${options.containerId}`);
  return `<!-- Embed snippet: paste into your page's <head> and <body> -->

<!-- In <head>: -->
<link rel="stylesheet" href="${htmlBasePath}/clickmap-renderer.css">

<!-- In <body> where the map should appear: -->
<div id="${id}" style="width: ${escapeHtml(options.containerWidth)}; height: ${escapeHtml(options.containerHeight)};"></div>

<!-- Before </body>: -->
<script src="${htmlBasePath}/clickmap-renderer.js"></script>
<script>
  ClickMapRenderer.create({
    container: ${selector},
    definitionUrl: ${serializeJsString(`${basePath}/map.json`)},
    // shadowDom: true, // Optional: isolate the map from host-page CSS.
    // css: ".clickmap-root { /* custom overrides */ }", // Shadow mode only.
  });
</script>`;
}

function buildReadme(projectName: string, options: ReturnType<typeof resolvedOptions>): string {
  return `${projectName} — Clickable Map Package
${"=".repeat((projectName + " — Clickable Map Package").length)}

CONTENTS
--------
  index.html           Standalone demo — open in a browser or serve statically
  embed.html           Copy-paste snippet for your own pages
  map.json             Map definition (do not rename)
  clickmap-renderer.js Renderer script (do not rename)
  clickmap-renderer.css Renderer styles (do not rename)
  assets/              Image and SVG files referenced by the map

QUICK START
-----------
1. Upload the entire folder to your web server or CDN.
2. Open embed.html and copy the snippet into your page.
3. Upload it at ${normalizeBasePath(options.basePath)} (the path already used by embed.html).
4. The <div id="${options.containerId}"> can be placed anywhere in your page body.
   Its configured size is ${options.containerWidth} × ${options.containerHeight}.

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
  All asset files must be uploaded alongside map.json in the assets/ folder.
  Do not rename or move the files.

Container has no height
  Make sure the element with id="clickmap" has an explicit height set in CSS,
  or its parent has a defined height. The renderer fills 100% of the container.

Multiple instances per page
  Call ClickMapRenderer.create() once per container. Each call returns an
  independent instance; they do not share state.

SUPPORTED BROWSERS
------------------
  Chrome 90+, Firefox 90+, Safari 14+, Edge 90+

Generated by svg-mapper editor.
`;
}

// Replace data-URI srcs with relative asset paths (for non-inline export).
// Returns both the patched definition and a Map<assetId, path> for ZIP file writing.
function definitionWithAssetPaths(definition: ClickMapDefinition): { definition: ClickMapDefinition; pathMap: Map<string, string> } {
  const assetFilename = makeAssetFilenamer();
  const pathMap = new Map<string, string>();
  const assets = definition.assets.map((a) => {
    const path = assetFilename(a);
    pathMap.set(a.id, path);
    return { ...a, src: path, inline: false };
  });

  return { definition: { ...definition, assets }, pathMap };
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
  const comma = src.indexOf(",");
  if (comma === -1) return strToU8(src);
  const meta = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  if (meta.includes("base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return strToU8(decodeURIComponent(payload));
}

export function generateExportPackage(
  definition: ClickMapDefinition,
  rendererJs: string,
  rendererCss: string,
  options: ExportOptions,
): ExportPackage {
  const resolved = resolvedOptions(options);
  const { inlineAssets } = resolved;

  // For the ZIP's map.json: inline keeps data-URIs; external rewrites to paths.
  let exportedDefinition: ClickMapDefinition;
  let pathMap: Map<string, string> | null = null;
  if (inlineAssets) {
    exportedDefinition = definition;
  } else {
    ({ definition: exportedDefinition, pathMap } = definitionWithAssetPaths(definition));
  }

  const mapJson = JSON.stringify(exportedDefinition, null, 2);
  const embedSnippet = buildEmbedSnippet(resolved);

  const files: Record<string, Uint8Array> = {};

  files["map.json"] = strToU8(mapJson);
  files["clickmap-renderer.js"] = strToU8(rendererJs);
  files["clickmap-renderer.css"] = strToU8(rendererCss);
  files["embed.html"] = strToU8(buildEmbedHtml(resolved));
  files["index.html"] = strToU8(
    buildIndexHtml(exportedDefinition, rendererJs, rendererCss),
  );
  files["README.txt"] = strToU8(buildReadme(definition.project.name, resolved));

  // Asset files (only when not inlining).
  if (!inlineAssets && pathMap) {
    for (const asset of definition.assets) {
      if (asset.src.startsWith("data:") || asset.src.startsWith("<svg")) {
        const path = pathMap.get(asset.id);
        if (path) files[path] = dataUriToBytes(asset.src);
      }
    }
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
  const resolved = resolvedOptions(options);
  const exportedDefinition = options.inlineAssets
    ? definition
    : definitionWithAssetPaths(definition).definition;
  const mapJson = JSON.stringify(exportedDefinition, null, 2);
  const embedSnippet = buildEmbedSnippet(resolved);
  const readme = buildReadme(definition.project.name, resolved);
  const assetBytes = definition.assets.reduce((total, asset) => total + dataUriToBytes(asset.src).byteLength, 0);
  const assetFileCount = options.inlineAssets ? 0 : definition.assets.length;
  const textBytes = new TextEncoder().encode(mapJson + embedSnippet + readme + rendererJs + rendererCss).byteLength;
  return {
    embedSnippet,
    mapJson,
    readme,
    estimatedUncompressedBytes: textBytes + (options.inlineAssets ? 0 : assetBytes),
    assetBytes,
    assetFileCount,
  };
}
