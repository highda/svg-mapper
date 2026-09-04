// Pre-export validation pipeline (ASSIGNMENT §9).
// Errors block export; warnings allow export with confirmation.
// Lives in /shared so the editor and the test suite share one implementation.

import type { ClickMapDefinition, Geometry, View } from "./types.js";

export type Severity = "error" | "warning";

// Points back to the offending object so the editor can select / scroll to it.
export interface ValidationRef {
  viewId?: string;
  layerId?: string;
  areaId?: string;
  assetId?: string;
  popupId?: string;
}

export interface ValidationResult {
  severity: Severity;
  code: string;
  message: string;
  ref?: ValidationRef;
}

// Roughly 4 MB — the raster-background warning threshold.
const RASTER_WARN_BYTES = 4 * 1024 * 1024;

const ALLOWED_URL_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

export interface UrlValidation {
  valid: boolean;
  error?: string;
}

// Validate a `url` action's href. Allowed: http, https, mailto, tel, and
// relative URLs. Rejected: javascript:, data:, and any other scheme (§10.2).
export function validateActionUrl(raw: string): UrlValidation {
  const value = raw.trim();
  if (value === "") return { valid: false, error: "URL is required." };

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!schemeMatch) {
    // Relative or protocol-relative URL — allowed.
    return { valid: true };
  }

  const protocol = (schemeMatch[1] ?? "").toLowerCase() + ":";
  if (!ALLOWED_URL_PROTOCOLS.includes(protocol)) {
    return {
      valid: false,
      error: `Protocol "${protocol}" is not allowed. Use http, https, mailto, or tel.`,
    };
  }

  return { valid: true };
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

// Returns an error message if the geometry is invalid, else null.
function geometryError(geometry: Geometry): string | null {
  switch (geometry.type) {
    case "rect":
      if (!isFiniteNumber(geometry.x) || !isFiniteNumber(geometry.y))
        return "rectangle has non-numeric position";
      if (!(geometry.width > 0) || !(geometry.height > 0))
        return "rectangle has non-positive width or height";
      return null;
    case "circle":
      if (!isFiniteNumber(geometry.cx) || !isFiniteNumber(geometry.cy))
        return "circle has non-numeric center";
      if (!(geometry.r > 0)) return "circle has non-positive radius";
      return null;
    case "polygon":
      if (!Array.isArray(geometry.points) || geometry.points.length < 3)
        return "polygon needs at least 3 points";
      if (
        geometry.points.some(
          (p) => !Array.isArray(p) || p.length !== 2 || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1]),
        )
      )
        return "polygon has a malformed point";
      return null;
    case "path":
      if (typeof geometry.d !== "string" || geometry.d.trim() === "")
        return "path has an empty `d`";
      return null;
    case "marker":
      if (!isFiniteNumber(geometry.x) || !isFiniteNumber(geometry.y))
        return "marker has non-numeric position";
      return null;
    default:
      return "unknown geometry type";
  }
}

// Estimate the decoded byte size of a data-URI src (used for the raster
// background warning). Non-data sources return 0 (size unknown).
function estimateDataUriBytes(src: string): number {
  const comma = src.indexOf(",");
  if (!src.startsWith("data:") || comma === -1) return 0;
  const meta = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  if (meta.includes("base64")) {
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.floor((payload.length * 3) / 4) - padding;
  }
  return decodeURIComponent(payload).length;
}

const UNSAFE_SVG_PATTERNS = [
  /<script[\s>]/i,
  /<iframe[\s>]/i,
  /<foreignObject[\s>]/i,
  /\son\w+\s*=/i, // onclick, onload, …
  /javascript:/i,
];

function svgMarkupIsUnsafe(markup: string): boolean {
  return UNSAFE_SVG_PATTERNS.some((re) => re.test(markup));
}

// Build the set of View ids reachable from initialViewId via goToView edges.
function reachableViewIds(views: View[], initialViewId: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const view of views) {
    for (const layer of view.layers) {
      for (const area of layer.areas) {
        if (area.action.type === "goToView" && area.action.targetViewId) {
          const list = adjacency.get(view.id) ?? [];
          list.push(area.action.targetViewId);
          adjacency.set(view.id, list);
        }
      }
    }
  }
  const reachable = new Set<string>();
  if (views.some((v) => v.id === initialViewId)) {
    reachable.add(initialViewId);
    const queue = [initialViewId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of adjacency.get(id) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
  }
  return reachable;
}

export function validateProject(project: ClickMapDefinition): ValidationResult[] {
  const results: ValidationResult[] = [];
  const add = (severity: Severity, code: string, message: string, ref?: ValidationRef) =>
    results.push(ref ? { severity, code, message, ref } : { severity, code, message });
  const err = (code: string, message: string, ref?: ValidationRef) =>
    add("error", code, message, ref);
  const warn = (code: string, message: string, ref?: ValidationRef) =>
    add("warning", code, message, ref);

  const views = project.views ?? [];
  const assetsById = new Map(project.assets.map((a) => [a.id, a]));
  const viewIds = new Set(views.map((v) => v.id));
  const layerIds = new Set<string>();
  for (const v of views) for (const l of v.layers) layerIds.add(l.id);

  // ── Errors ────────────────────────────────────────────────────────────────

  if (views.length === 0) {
    err("NO_VIEWS", "Project has no Views.");
  }

  if (views.length > 0 && !viewIds.has(project.settings.initialViewId)) {
    err(
      "BAD_INITIAL_VIEW",
      `Initial View "${project.settings.initialViewId}" does not exist.`,
    );
  }

  // Duplicate IDs anywhere in the project.
  const seen = new Map<string, number>();
  const bump = (id: string) => seen.set(id, (seen.get(id) ?? 0) + 1);
  project.assets.forEach((a) => bump(a.id));
  (project.popups ?? []).forEach((p) => bump(p.id));
  views.forEach((v) => {
    bump(v.id);
    v.layers.forEach((l) => {
      bump(l.id);
      l.areas.forEach((a) => bump(a.id));
    });
  });
  for (const [id, count] of seen) {
    if (count > 1) err("DUPLICATE_ID", `Duplicate id "${id}" used ${count} times.`);
  }

  for (const view of views) {
    if (!(view.canvas?.width > 0) || !(view.canvas?.height > 0)) {
      err("INVALID_CANVAS_SIZE", `View "${view.name}" must have a positive canvas width and height.`, { viewId: view.id });
    }
    // Background asset missing.
    if (view.background && !assetsById.has(view.background.assetId)) {
      err(
        "MISSING_ASSET",
        `View "${view.name}" references a missing asset "${view.background.assetId}".`,
        { viewId: view.id, assetId: view.background.assetId },
      );
    }

    for (const layer of view.layers) {
      for (const area of layer.areas) {
        const ref: ValidationRef = { viewId: view.id, layerId: layer.id, areaId: area.id };

        const geoErr = geometryError(area.geometry);
        if (geoErr) {
          err("INVALID_GEOMETRY", `Area "${area.name}" has invalid geometry: ${geoErr}.`, ref);
        }
        if (area.image) {
          const asset = assetsById.get(area.image.assetId);
          if (!asset) err("MISSING_AREA_ASSET", `Area "${area.name}" references a missing image asset.`, { ...ref, assetId: area.image.assetId });
          if (area.geometry.type !== "rect") err("INVALID_IMAGE_REGION", `Area "${area.name}" must be rectangular to display an image.`, ref);
          if (area.image.opacity !== undefined && (area.image.opacity < 0 || area.image.opacity > 1)) err("INVALID_IMAGE_OPACITY", `Image "${area.name}" opacity must be between 0 and 1.`, ref);
          if (area.action.type !== "none" && area.image.decorative && !area.accessibility?.ariaLabel?.trim()) err("MISSING_IMAGE_ACCESSIBLE_NAME", `Interactive image "${area.name}" needs an accessible name when marked decorative.`, ref);
          const mask = area.image.hitMask;
          if (mask && (mask.assetId !== area.image.assetId || mask.width < 1 || mask.height < 1 || mask.width > 128 || mask.height > 128 || mask.threshold < 0 || mask.threshold > 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(mask.data))) {
            err("INVALID_ALPHA_MASK", `Area "${area.name}" has an invalid alpha hit mask.`, ref);
          }
        }

        switch (area.action.type) {
          case "goToView":
            if (!viewIds.has(area.action.targetViewId)) {
              err(
                "BROKEN_GOTOVIEW",
                `Area "${area.name}" links to missing View "${area.action.targetViewId}".`,
                ref,
              );
            }
            break;
          case "popup":
            // Inline popup content — no external popup reference needed.
            break;
          case "toggleLayer":
            if (!layerIds.has(area.action.targetLayerId)) {
              err(
                "BROKEN_TOGGLELAYER",
                `Area "${area.name}" toggles missing Layer "${area.action.targetLayerId}".`,
                ref,
              );
            }
            break;
          case "url": {
            const v = validateActionUrl(area.action.href);
            if (!v.valid) {
              err("INVALID_URL", `Area "${area.name}" has an invalid URL: ${v.error}`, ref);
            }
            break;
          }
        }

        // Warning: Area present but no action.
        if (area.action.type === "none") {
          warn("AREA_NO_ACTION", `Area "${area.name}" has no action.`, ref);
        }

        // Disabled areas deliberately ignore their action at runtime. Keeping an
        // action configured is usually an authoring mistake and can be confusing
        // when the area is re-enabled later.
        if (area.disabled && area.action.type !== "none") {
          warn(
            "DISABLED_AREA_HAS_ACTION",
            `Disabled area "${area.name}" has an action that will not run.`,
            ref,
          );
        }
      }
    }
  }

  // ── Warnings ────────────────────────────────────────────────────────────────

  // Unreachable Views.
  if (views.length > 0 && viewIds.has(project.settings.initialViewId)) {
    const reachable = reachableViewIds(views, project.settings.initialViewId);
    for (const view of views) {
      if (!reachable.has(view.id)) {
        warn(
          "UNREACHABLE_VIEW",
          `View "${view.name}" is not reachable from the initial View.`,
          { viewId: view.id },
        );
      }
    }
  }

  // Raster background too large; unsafe SVG content.
  for (const view of views) {
    if (!view.background) continue;
    const asset = assetsById.get(view.background.assetId);
    if (!asset) continue;
    if (asset.type === "image/svg+xml") {
      if (asset.inline && svgMarkupIsUnsafe(asset.src)) {
        warn(
          "UNSAFE_SVG",
          `Background "${asset.name}" contains scripts or unsafe attributes (stripped on export).`,
          { viewId: view.id, assetId: asset.id },
        );
      }
    } else {
      const bytes = estimateDataUriBytes(asset.src);
      if (bytes > RASTER_WARN_BYTES) {
        warn(
          "LARGE_RASTER",
          `Background "${asset.name}" is ${(bytes / (1024 * 1024)).toFixed(1)} MB (over 4 MB).`,
          { viewId: view.id, assetId: asset.id },
        );
      }
    }
  }

  return results;
}

export function hasBlockingErrors(results: ValidationResult[]): boolean {
  return results.some((r) => r.severity === "error");
}
