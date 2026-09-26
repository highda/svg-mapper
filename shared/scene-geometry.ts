// Small DOM-independent helpers shared by the editor canvas and the renderer,
// so both draw the same scene: asset display sources, fitted background
// rectangles, marker geometry, area bounds and rounded rectangles.
import type { BackgroundFit, Geometry, MarkerAnchor } from "./types.js";

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

/** Markers are a fixed 24x32 pin in canvas units, placed by their anchor point. */
export const MARKER_WIDTH = 24;
export const MARKER_HEIGHT = 32;

export function markerTopLeft(x: number, y: number, anchor: MarkerAnchor): { x: number; y: number } {
  const horizontal = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? MARKER_WIDTH : MARKER_WIDTH / 2;
  const vertical = anchor.startsWith("top") ? 0 : anchor.startsWith("middle") || anchor === "center" ? MARKER_HEIGHT / 2 : MARKER_HEIGHT;
  return { x: x - horizontal, y: y - vertical };
}

/** SVG path data for the marker pin. */
export function markerPathData(x: number, y: number, anchor: MarkerAnchor): string {
  const t = markerTopLeft(x, y, anchor);
  return `M${t.x + 12},${t.y + 32} C${t.x + 10},${t.y + 27} ${t.x + 2},${t.y + 20} ${t.x + 2},${t.y + 12} A10,10 0 1,1 ${t.x + 22},${t.y + 12} C${t.x + 22},${t.y + 20} ${t.x + 14},${t.y + 27} ${t.x + 12},${t.y + 32} Z`;
}

/** Path data for a rectangle, with corners rounded like SVG <rect rx> (clamped to half the side). */
export function rectPathData(x: number, y: number, width: number, height: number, rx = 0): string {
  const r = Math.max(0, Math.min(rx, width / 2, height / 2));
  if (r === 0) return `M${x},${y} h${width} v${height} h${-width}Z`;
  return `M${x + r},${y} h${width - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 ${-r},${r} ` +
    `h${-(width - 2 * r)} a${r},${r} 0 0 1 ${-r},${-r} v${-(height - 2 * r)} a${r},${r} 0 0 1 ${r},${-r}Z`;
}

/**
 * Axis-aligned bounds in canvas units. Free-form paths return null: their
 * bounds need the rendered element (SVG getBBox()).
 */
export function geometryBounds(geo: Geometry): Rect | null {
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
      return { ...markerTopLeft(geo.x, geo.y, geo.anchor), width: MARKER_WIDTH, height: MARKER_HEIGHT };
    default:
      return null;
  }
}
