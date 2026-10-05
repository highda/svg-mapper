import type { Geometry } from "@svg-mapper/shared";
import { snapValue } from "./area-utils";

/**
 * Vertex editing for geometry made of an ordered, closed ring of points
 * (#176). The canvas handles, drag gesture and inspector list only talk to
 * these helpers, never to `geometry.points` directly, so another vertex-based
 * geometry (for example path anchors with Bézier controls, #221) can plug in
 * by teaching these functions its shape without touching the interaction code.
 *
 * Every helper is pure: it returns a new geometry, or `null` when the edit does
 * not apply (wrong geometry type, index out of range, minimum vertex count).
 */

export type Point = { x: number; y: number };

/** A polygon needs three vertices to enclose an area. */
export const MIN_POLYGON_VERTICES = 3;

/** The editable vertices of a geometry, or null when it has no vertex editing. */
export function editableVertices(geo: Geometry): Point[] | null {
  if (geo.type !== "polygon") return null;
  return geo.points.map(([x, y]) => ({ x, y }));
}

/** Fewest vertices the geometry may keep; removal below this is refused. */
export function minVertexCount(geo: Geometry): number {
  return geo.type === "polygon" ? MIN_POLYGON_VERTICES : Infinity;
}

export function canRemoveVertex(geo: Geometry): boolean {
  const vertices = editableVertices(geo);
  return vertices !== null && vertices.length > minVertexCount(geo);
}

/** Snap a point to the grid when snapping is on. */
export function snapPoint(point: Point, grid: { enabled: boolean; size: number } | undefined): Point {
  if (!grid?.enabled) return point;
  return { x: snapValue(point.x, grid.size), y: snapValue(point.y, grid.size) };
}

/** Move vertex `index` to `point`. */
export function moveVertex(geo: Geometry, index: number, point: Point): Geometry | null {
  if (geo.type !== "polygon" || !geo.points[index]) return null;
  const points = geo.points.map((p, i) => (i === index ? [point.x, point.y] : p) as [number, number]);
  return { ...geo, points };
}

/**
 * Edges of the closed ring: edge `i` runs from vertex `i` to vertex `i + 1`
 * (the last edge closes back to vertex 0). Midpoints are the insert handles.
 */
export function edgeMidpoints(geo: Geometry): Point[] {
  const vertices = editableVertices(geo);
  if (!vertices || vertices.length < 2) return [];
  return vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length]!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
}

/**
 * Split edge `edgeIndex` by inserting a vertex (its midpoint by default).
 * The new vertex lands at index `edgeIndex + 1`.
 */
export function insertVertex(geo: Geometry, edgeIndex: number, point?: Point): Geometry | null {
  if (geo.type !== "polygon" || !geo.points[edgeIndex]) return null;
  const at = point ?? edgeMidpoints(geo)[edgeIndex]!;
  const points = [...geo.points];
  points.splice(edgeIndex + 1, 0, [at.x, at.y]);
  return { ...geo, points };
}

/** Remove vertex `index`, refusing to go below the minimum vertex count. */
export function removeVertex(geo: Geometry, index: number): Geometry | null {
  if (geo.type !== "polygon" || !geo.points[index] || !canRemoveVertex(geo)) return null;
  return { ...geo, points: geo.points.filter((_, i) => i !== index) };
}
