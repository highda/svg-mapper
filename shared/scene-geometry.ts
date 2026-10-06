// Small DOM-independent helpers shared by the editor canvas and the renderer,
// so both draw the same scene: asset display sources, fitted background
// rectangles, marker geometry, area bounds and rounded rectangles.
import { pathBounds } from "./path-geometry.js";
import type { BackgroundFit, Geometry, MarkerAnchor, MarkerGeometry, MarkerIcon } from "./types.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The URL an <image> should display for an asset `src`, without changing the
 * persisted value. Raw SVG markup becomes a data URI. Data, absolute,
 * protocol-relative and fragment sources are kept byte-for-byte. Relative
 * paths resolve against `baseUrl` when one is known; otherwise they stay
 * relative to the current document.
 */
export function assetDisplaySource(src: string, baseUrl?: string): string {
  if (/^\s*<svg\b/i.test(src)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src) || !baseUrl) return src;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}

/**
 * Where a background of `intrinsic` size is drawn inside a `frame` for the
 * given fit, aligned by the normalized `position` (0..1 on each axis).
 * Coordinates are in the frame's units; the caller clips to the frame.
 */
export function fitImageRect(
  frame: { width: number; height: number },
  intrinsic: { width: number; height: number },
  fit: BackgroundFit = "contain",
  position: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Rect {
  let width = frame.width;
  let height = frame.height;
  if (fit === "none") {
    width = intrinsic.width;
    height = intrinsic.height;
  } else if (fit !== "fill" && intrinsic.width > 0 && intrinsic.height > 0) {
    const scale = fit === "cover"
      ? Math.max(frame.width / intrinsic.width, frame.height / intrinsic.height)
      : Math.min(frame.width / intrinsic.width, frame.height / intrinsic.height);
    width = intrinsic.width * scale;
    height = intrinsic.height * scale;
  }
  const px = Math.max(0, Math.min(1, position.x));
  const py = Math.max(0, Math.min(1, position.y));
  return { x: (frame.width - width) * px, y: (frame.height - height) * py, width, height };
}

/** The default marker is a 24 × 32 pin in canvas units, placed by its anchor point. */
export const MARKER_WIDTH = 24;
export const MARKER_HEIGHT = 32;

/** The default pin as an icon: what a marker draws without a known `icon`. */
export const MARKER_PIN: MarkerIcon = {
  name: "Pin",
  width: MARKER_WIDTH,
  height: MARKER_HEIGHT,
  d: "M12,32C10,27 2,20 2,12A10,10 0 1,1 22,12C22,20 14,27 12,32Z",
};

/** Top-left corner of a `width` × `height` box whose `anchor` point is at x,y. */
export function markerTopLeft(
  x: number,
  y: number,
  anchor: MarkerAnchor,
  width = MARKER_WIDTH,
  height = MARKER_HEIGHT,
): { x: number; y: number } {
  const horizontal = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? width : width / 2;
  const vertical = anchor.startsWith("top") ? 0 : anchor.startsWith("middle") || anchor === "center" ? height / 2 : height;
  return { x: x - horizontal, y: y - vertical };
}

/** SVG path data for the default marker pin. */
export function markerPathData(x: number, y: number, anchor: MarkerAnchor): string {
  const t = markerTopLeft(x, y, anchor);
  return `M${t.x + 12},${t.y + 32} C${t.x + 10},${t.y + 27} ${t.x + 2},${t.y + 20} ${t.x + 2},${t.y + 12} A10,10 0 1,1 ${t.x + 22},${t.y + 12} C${t.x + 22},${t.y + 20} ${t.x + 14},${t.y + 27} ${t.x + 12},${t.y + 32} Z`;
}

/** The icon a marker draws (#219): its `icon` entry when that exists, otherwise the pin. */
export function markerIcon(geo: Pick<MarkerGeometry, "icon">, icons?: Record<string, MarkerIcon>): MarkerIcon {
  const icon = geo.icon !== undefined && icons && Object.prototype.hasOwnProperty.call(icons, geo.icon) ? icons[geo.icon] : undefined;
  return icon && icon.width > 0 && icon.height > 0 ? icon : MARKER_PIN;
}

/**
 * A marker's box in canvas units at map scale: `size` wide (default 24), the
 * icon's aspect ratio preserved, placed so its anchor point is at x,y.
 */
export function markerBox(geo: MarkerGeometry, icon: Pick<MarkerIcon, "width" | "height">): Rect {
  const width = geo.size !== undefined && geo.size > 0 ? geo.size : MARKER_WIDTH;
  const height = (width * icon.height) / icon.width;
  return { ...markerTopLeft(geo.x, geo.y, geo.anchor, width, height), width, height };
}

/**
 * The SVG transform from icon units to canvas units. `cameraScale` is the
 * shown viewBox width over the view's full width (1 at zoom 1, 0.5 at zoom
 * 2): a `screen` marker is scaled by it about its anchor point, so its
 * on-screen size stays the size it has at zoom 1. `map` markers ignore it.
 */
export function markerTransform(geo: MarkerGeometry, icon: Pick<MarkerIcon, "width" | "height">, cameraScale = 1): string {
  const box = markerBox(geo, icon);
  const s = geo.scaleMode === "screen" && cameraScale > 0 ? cameraScale : 1;
  return `translate(${geo.x + (box.x - geo.x) * s},${geo.y + (box.y - geo.y) * s}) scale(${(box.width / icon.width) * s})`;
}

/** Path data for a rectangle, with corners rounded like SVG <rect rx> (clamped to half the side). */
export function rectPathData(x: number, y: number, width: number, height: number, rx = 0): string {
  const r = Math.max(0, Math.min(rx, width / 2, height / 2));
  if (r === 0) return `M${x},${y} h${width} v${height} h${-width}Z`;
  return `M${x + r},${y} h${width - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 ${-r},${r} ` +
    `h${-(width - 2 * r)} a${r},${r} 0 0 1 ${-r},${-r} v${-(height - 2 * r)} a${r},${r} 0 0 1 ${r},${-r}Z`;
}

/**
 * Axis-aligned bounds of the analytic shapes (rect, circle, polygon, marker)
 * in canvas units; null for paths. The renderer uses this and measures
 * rendered paths with getBBox(), so it never bundles the path parser. A
 * marker's bounds are its icon box at map scale; pass the definition's
 * `icons` so an icon's aspect ratio is known.
 */
export function shapeBounds(geo: Geometry, icons?: Record<string, MarkerIcon>): Rect | null {
  switch (geo.type) {
    case "rect":
      return { x: geo.x, y: geo.y, width: geo.width, height: geo.height };
    case "circle":
      return { x: geo.cx - geo.r, y: geo.cy - geo.r, width: geo.r * 2, height: geo.r * 2 };
    case "polygon": {
      if (!geo.points.length) return null;
      const xs = geo.points.map(([px]) => px);
      const ys = geo.points.map(([, py]) => py);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
    }
    case "marker":
      return markerBox(geo, markerIcon(geo, icons));
    default:
      return null;
  }
}

/**
 * Axis-aligned bounds of any geometry in canvas units. Paths get their exact
 * bounds (real cubic extrema, see path-geometry.ts); empty or malformed path
 * data returns null.
 */
export function geometryBounds(geo: Geometry, icons?: Record<string, MarkerIcon>): Rect | null {
  return geo.type === "path" ? pathBounds(geo.d) : shapeBounds(geo, icons);
}
