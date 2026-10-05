// SVG path data as first-class area geometry (#218).
//
// `parsePathData` reads the complete SVG path grammar (M/L/H/V/C/S/Q/T/A/Z in
// absolute and relative form) into a canonical subset of absolute segments:
// M, L, C and Z. Quadratics become exact cubics and elliptical arcs become
// cubic approximations (at most a quarter turn per cubic, error < 0.03 % of
// the radius), so every affine transform of the canonical form is exact.
// Bounds use the real cubic extrema, not the control-point hull.
//
// The stored representation stays the `d` string. Editing tools parse it,
// transform the canonical segments, and write canonical `d` back with
// `serializePathData`. Later tools (the Bézier pen and SVG import) build or
// transform the same segment list.
//
// The module is DOM-free and side-effect free. The renderer does not import it
// (it measures rendered paths with getBBox), which keeps its bundle small.
import type { ClickMapDefinition } from "./types.js";

/** One canonical, absolute path segment. */
export type PathSegment =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

/** Axis-aligned bounds in path units. */
export interface PathBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A 2D affine matrix in SVG `matrix(a b c d e f)` order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type AffineMatrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/** Thrown by `parsePathData` for malformed path data. `index` is the 0-based character offset. */
export class PathDataError extends Error {
  readonly index: number;
  constructor(message: string, index: number) {
    super(`${message} at character ${index + 1}`);
    this.name = "PathDataError";
    this.index = index;
  }
}

/** The SVG path command letters, absolute (upper case) and relative. */
const COMMAND = /^[MLHVCSQTAZ]$/i;

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/**
 * Parse SVG path data into canonical absolute M/L/C/Z segments. Follows the
 * SVG 2 grammar: commands may repeat implicitly, numbers may be separated by
 * whitespace, a comma, or nothing when unambiguous (`M1-2`, `M.5.5`), and arc
 * flags are single `0`/`1` characters. Whitespace-only input yields no
 * segments. Anything else that is not a valid path throws `PathDataError`
 * (browsers would silently render only the prefix before the error).
 */
export function parsePathData(d: string): PathSegment[] {
  const out: PathSegment[] = [];
  let i = 0;
  const n = d.length;

  const isWsp = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
  const skipWsp = () => {
    while (i < n && isWsp(d[i]!)) i++;
  };
  /** Optional comma-wsp between arguments. */
  const skipSeparator = () => {
    skipWsp();
    if (d[i] === ",") {
      i++;
      skipWsp();
    }
  };
  const readNumber = (command: string): number => {
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(d);
    if (!match) throw new PathDataError(`Expected a number for "${command}"`, i);
    i = NUMBER.lastIndex;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new PathDataError(`Number out of range for "${command}"`, match.index);
    return value;
  };
  const readFlag = (command: string): boolean => {
    const ch = d[i];
    if (ch !== "0" && ch !== "1") throw new PathDataError(`Expected an arc flag (0 or 1) for "${command}"`, i);
    i++;
    return ch === "1";
  };

  // Current point, subpath start, and the reflection state for S/T.
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCubic: [number, number] | null = null; // second control point of a preceding C/S
  let lastQuad: [number, number] | null = null; // control point of a preceding Q/T
  let afterClose = false;

  const lineTo = (x: number, y: number) => {
    out.push({ type: "L", x, y });
    cx = x;
    cy = y;
  };
  const cubicTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    out.push({ type: "C", x1, y1, x2, y2, x, y });
    cx = x;
    cy = y;
  };

  skipWsp();
  if (i >= n) return out;
  if (d[i] !== "M" && d[i] !== "m") throw new PathDataError('Path data must start with "M" or "m"', i);

  while (i < n) {
    const letter = d[i]!;
    const upper = letter.toUpperCase();
    if (!COMMAND.test(letter)) {
      throw new PathDataError(`Unexpected "${letter}"; expected a path command`, i);
    }
    i++;
    const relative = letter !== upper;
    skipWsp();

    if (upper === "Z") {
      out.push({ type: "Z" });
      cx = sx;
      cy = sy;
      lastCubic = lastQuad = null;
      afterClose = true;
      continue;
    }

    // A drawing command right after Z starts a new subpath at the closed
    // subpath's start; the canonical form makes that moveto explicit.
    if (afterClose && upper !== "M") out.push({ type: "M", x: cx, y: cy });
    afterClose = false;

    let first = true;
    do {
      if (!first) skipSeparator();
      const ox = relative ? cx : 0;
      const oy = relative ? cy : 0;
      switch (upper) {
        case "M": {
          const x = readNumber(letter) + ox;
          skipSeparator();
          const y = readNumber(letter) + oy;
          if (first) {
            out.push({ type: "M", x, y });
            cx = sx = x;
            cy = sy = y;
          } else {
            lineTo(x, y); // implicit lineto after a moveto pair
          }
          lastCubic = lastQuad = null;
          break;
        }
        case "L": {
          const x = readNumber(letter) + ox;
          skipSeparator();
          lineTo(x, readNumber(letter) + oy);
          lastCubic = lastQuad = null;
          break;
        }
        case "H":
          lineTo(readNumber(letter) + ox, cy);
          lastCubic = lastQuad = null;
          break;
        case "V":
          lineTo(cx, readNumber(letter) + oy);
          lastCubic = lastQuad = null;
          break;
        case "C": {
          const a = readArgs(6, letter, ox, oy);
          cubicTo(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!);
          lastCubic = [a[2]!, a[3]!];
          lastQuad = null;
          break;
        }
        case "S": {
          const a = readArgs(4, letter, ox, oy);
          const x1 = lastCubic ? 2 * cx - lastCubic[0] : cx;
          const y1 = lastCubic ? 2 * cy - lastCubic[1] : cy;
          cubicTo(x1, y1, a[0]!, a[1]!, a[2]!, a[3]!);
          lastCubic = [a[0]!, a[1]!];
          lastQuad = null;
          break;
        }
        case "Q": {
          const a = readArgs(4, letter, ox, oy);
          quadTo(a[0]!, a[1]!, a[2]!, a[3]!);
          lastQuad = [a[0]!, a[1]!];
          lastCubic = null;
          break;
        }
        case "T": {
          const a = readArgs(2, letter, ox, oy);
          const qx: number = lastQuad ? 2 * cx - lastQuad[0] : cx;
          const qy: number = lastQuad ? 2 * cy - lastQuad[1] : cy;
          quadTo(qx, qy, a[0]!, a[1]!);
          lastQuad = [qx, qy];
          lastCubic = null;
          break;
        }
        case "A": {
          const rx = readNumber(letter);
          skipSeparator();
          const ry = readNumber(letter);
          skipSeparator();
          const rotation = readNumber(letter);
          skipSeparator();
          const largeArc = readFlag(letter);
          skipSeparator();
          const sweep = readFlag(letter);
          skipSeparator();
          const x = readNumber(letter) + ox;
          skipSeparator();
          const y = readNumber(letter) + oy;
          for (const seg of arcToCubics(cx, cy, rx, ry, rotation, largeArc, sweep, x, y)) out.push(seg);
          cx = x;
          cy = y;
          lastCubic = lastQuad = null;
          break;
        }
      }
      first = false;
      skipWsp();
      // Another argument group (anything but a command letter) repeats the
      // command; the separator before it is consumed at the top of the loop.
    } while (i < n && !/[a-zA-Z]/.test(d[i]!));
  }
  return out;

  function readArgs(count: number, command: string, ox: number, oy: number): number[] {
    const args: number[] = [];
    for (let k = 0; k < count; k++) {
      if (k > 0) skipSeparator();
      args.push(readNumber(command) + (k % 2 === 0 ? ox : oy));
    }
    return args;
  }

  function quadTo(qx: number, qy: number, x: number, y: number) {
    // Degree elevation is exact: each cubic control lies 2/3 of the way to the quadratic one.
    cubicTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
  }
}

/**
 * Convert an SVG elliptical arc (endpoint parameterization) to cubics, per the
 * SVG implementation notes: identical endpoints draw nothing, a zero radius
 * draws a straight line, and radii too small to span the endpoints are scaled
 * up uniformly.
 */
export function arcToCubics(
  x0: number, y0: number,
  rx: number, ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x: number, y: number,
): PathSegment[] {
  if (x0 === x && y0 === y) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [{ type: "L", x, y }];

  const phi = ((rotationDeg % 360) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const ecx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const ecy = sin * cxp + cos * cyp + (y0 + y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): [number, number] => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return [cos * ex - sin * ey + ecx, sin * ex + cos * ey + ecy];
  };
  const tangent = (t: number): [number, number] => {
    const ex = -rx * Math.sin(t);
    const ey = ry * Math.cos(t);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };

  const segments: PathSegment[] = [];
  let t = theta1;
  let [px, py] = [x0, y0];
  for (let s = 0; s < count; s++) {
    const t2 = t + step;
    const [d1x, d1y] = tangent(t);
    const [d2x, d2y] = tangent(t2);
    // The last cubic ends exactly on the requested endpoint.
    const [qx, qy] = s === count - 1 ? [x, y] : point(t2);
    segments.push({ type: "C", x1: px + k * d1x, y1: py + k * d1y, x2: qx - k * d2x, y2: qy - k * d2y, x: qx, y: qy });
    [px, py] = [qx, qy];
    t = t2;
  }
  return segments;
}

/** The parse error message for `d`, or null when it is valid path data. */
export function pathDataError(d: string): string | null {
  try {
    parsePathData(d);
    return null;
  } catch (error) {
    if (error instanceof PathDataError) return error.message;
    throw error;
  }
}

/**
 * The first area whose path `d` is not valid SVG path data, with its JSON
 * path, or null. The editor applies this after the structural decode when it
 * opens a project file (#218); the renderer does not bundle the parser and
 * draws path data the way the browser does. Blank `d` is left to
 * validateProject, which reports it as an export error.
 */
export function findMalformedPathData(definition: Pick<ClickMapDefinition, "views">): { path: string; message: string } | null {
  for (const [vi, view] of definition.views.entries()) {
    for (const [li, layer] of view.layers.entries()) {
      for (const [ai, area] of layer.areas.entries()) {
        if (area.geometry.type !== "path") continue;
        const error = pathDataError(area.geometry.d);
        if (!error) continue;
        const path = `$.views[${vi}].layers[${li}].areas[${ai}].geometry.d`;
        return { path, message: `Invalid map.json at ${path}: expected SVG path data (${error}).` };
      }
    }
  }
  return null;
}

/** Render a coordinate with at most `precision` decimals, without "-0" or trailing zeros. */
function formatNumber(value: number, precision: number): string {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  return String(rounded);
}

/**
 * Serialize canonical segments to compact absolute path data. Coordinates are
 * rounded to `precision` decimals (default 3, i.e. 1/1000 canvas unit).
 */
export function serializePathData(segments: readonly PathSegment[], precision = 3): string {
  const f = (v: number) => formatNumber(v, precision);
  return segments.map((seg) => {
    switch (seg.type) {
      case "M":
      case "L":
        return `${seg.type}${f(seg.x)} ${f(seg.y)}`;
      case "C":
        return `C${f(seg.x1)} ${f(seg.y1)} ${f(seg.x2)} ${f(seg.y2)} ${f(seg.x)} ${f(seg.y)}`;
      case "Z":
        return "Z";
    }
  }).join(" ");
}

/** Real extrema of one cubic coordinate track on (0, 1). */
function cubicExtremaParams(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t)/3 = a·t² + b·t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) return roots;
  if (Math.abs(a) <= 1e-12 * scale) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * Exact bounds of canonical segments (cubic extrema, not the control hull).
 * A moveto contributes its point, so a lone "M x y" has zero-size bounds.
 * Returns null when there are no segments.
 */
export function pathSegmentsBounds(segments: readonly PathSegment[]): PathBounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const seg of segments) {
    switch (seg.type) {
      case "M":
        add(seg.x, seg.y);
        cx = sx = seg.x;
        cy = sy = seg.y;
        break;
      case "L":
        add(seg.x, seg.y);
        cx = seg.x;
        cy = seg.y;
        break;
      case "C":
        add(seg.x, seg.y);
        for (const t of cubicExtremaParams(cx, seg.x1, seg.x2, seg.x)) add(cubicAt(cx, seg.x1, seg.x2, seg.x, t), cy);
        for (const t of cubicExtremaParams(cy, seg.y1, seg.y2, seg.y)) add(cx, cubicAt(cy, seg.y1, seg.y2, seg.y, t));
        cx = seg.x;
        cy = seg.y;
        break;
      case "Z":
        cx = sx;
        cy = sy;
        break;
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Exact bounds of path data, or null when it is empty or malformed. */
export function pathBounds(d: string): PathBounds | null {
  try {
    return pathSegmentsBounds(parsePathData(d));
  } catch (error) {
    if (error instanceof PathDataError) return null;
    throw error;
  }
}

/** Map every point (anchors and control points) through `fn`. Exact for affine maps. */
export function mapPathPoints(
  segments: readonly PathSegment[],
  fn: (x: number, y: number) => readonly [number, number],
): PathSegment[] {
  return segments.map((seg) => {
    switch (seg.type) {
      case "M":
      case "L": {
        const [x, y] = fn(seg.x, seg.y);
        return { type: seg.type, x, y };
      }
      case "C": {
        const [x1, y1] = fn(seg.x1, seg.y1);
        const [x2, y2] = fn(seg.x2, seg.y2);
        const [x, y] = fn(seg.x, seg.y);
        return { type: "C", x1, y1, x2, y2, x, y };
      }
      case "Z":
        return seg;
    }
  });
}

/** Apply an affine matrix (SVG `matrix()` order) to every point. */
export function transformPathSegments(segments: readonly PathSegment[], m: AffineMatrix): PathSegment[] {
  const [a, b, c, d, e, f] = m;
  return mapPathPoints(segments, (x, y) => [a * x + c * y + e, b * x + d * y + f]);
}

/** Translate canonical segments. */
export function translatePathSegments(segments: readonly PathSegment[], dx: number, dy: number): PathSegment[] {
  return transformPathSegments(segments, [1, 0, 0, 1, dx, dy]);
}

/** Scale canonical segments by (sx, sy) about the origin point (ox, oy). */
export function scalePathSegments(
  segments: readonly PathSegment[],
  sx: number,
  sy: number,
  ox = 0,
  oy = 0,
): PathSegment[] {
  return transformPathSegments(segments, [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy]);
}

/**
 * Map `segments` so their bounds `from` land on `to`. A zero-size axis is only
 * translated (it cannot be stretched).
 */
export function fitPathSegments(segments: readonly PathSegment[], from: PathBounds, to: PathBounds): PathSegment[] {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return transformPathSegments(segments, [sx, 0, 0, sy, to.x - sx * from.x, to.y - sy * from.y]);
}

/**
 * Move on-curve points through `fn` (for example grid snapping). Each cubic
 * control point follows the anchor it belongs to (the first the segment's
 * start, the second its end), so curves keep their local shape the way
 * polygon vertices snap individually.
 */
export function mapPathAnchors(
  segments: readonly PathSegment[],
  fn: (x: number, y: number) => readonly [number, number],
): PathSegment[] {
  const out: PathSegment[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0; // original current point and subpath start
  let ncx = 0, ncy = 0, nsx = 0, nsy = 0; // their mapped positions
  for (const seg of segments) {
    switch (seg.type) {
      case "M": {
        const [x, y] = fn(seg.x, seg.y);
        out.push({ type: "M", x, y });
        cx = sx = seg.x;
        cy = sy = seg.y;
        ncx = nsx = x;
        ncy = nsy = y;
        break;
      }
      case "L": {
        const [x, y] = fn(seg.x, seg.y);
        out.push({ type: "L", x, y });
        cx = seg.x;
        cy = seg.y;
        ncx = x;
        ncy = y;
        break;
      }
      case "C": {
        const [x, y] = fn(seg.x, seg.y);
        out.push({
          type: "C",
          x1: seg.x1 + (ncx - cx), y1: seg.y1 + (ncy - cy),
          x2: seg.x2 + (x - seg.x), y2: seg.y2 + (y - seg.y),
          x, y,
        });
        cx = seg.x;
        cy = seg.y;
        ncx = x;
        ncy = y;
        break;
      }
      case "Z":
        out.push(seg);
        cx = sx;
        cy = sy;
        ncx = nsx;
        ncy = nsy;
        break;
    }
  }
  return out;
}

/** Canonical `d` of `d` translated by (dx, dy). Throws `PathDataError` when malformed. */
export function translatePathData(d: string, dx: number, dy: number, precision?: number): string {
  return serializePathData(translatePathSegments(parsePathData(d), dx, dy), precision);
}

/** Canonical `d` of `d` scaled by (sx, sy) about (ox, oy). Throws `PathDataError` when malformed. */
export function scalePathData(d: string, sx: number, sy: number, ox = 0, oy = 0, precision?: number): string {
  return serializePathData(scalePathSegments(parsePathData(d), sx, sy, ox, oy), precision);
}
