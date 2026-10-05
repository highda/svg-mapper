import { describe, expect, it } from "vitest";
import type { Geometry } from "@svg-mapper/shared";
import {
  canRemoveVertex,
  edgeMidpoints,
  editableVertices,
  insertVertex,
  MIN_POLYGON_VERTICES,
  moveVertex,
  removeVertex,
  snapPoint,
} from "../lib/vertex-edit";

// Pure vertex-editing helpers behind the canvas handles and the point list (#176).

const triangle: Geometry = { type: "polygon", points: [[0, 0], [100, 0], [50, 80]] };
const square: Geometry = { type: "polygon", points: [[0, 0], [100, 0], [100, 100], [0, 100]] };

describe("vertex editing helpers", () => {
  it("lists polygon vertices and refuses other geometry", () => {
    expect(editableVertices(triangle)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]);
    expect(editableVertices({ type: "rect", x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(moveVertex({ type: "circle", cx: 0, cy: 0, r: 1 }, 0, { x: 1, y: 1 })).toBeNull();
  });

  it("moves one vertex without touching the others or the input", () => {
    const moved = moveVertex(square, 2, { x: 120, y: 130 });
    expect(moved).toEqual({ type: "polygon", points: [[0, 0], [100, 0], [120, 130], [0, 100]] });
    expect(square).toEqual({ type: "polygon", points: [[0, 0], [100, 0], [100, 100], [0, 100]] });
    expect(moveVertex(square, 9, { x: 1, y: 1 })).toBeNull();
  });

  it("puts edge midpoints on every edge, including the closing one", () => {
    expect(edgeMidpoints(square)).toEqual([{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }]);
  });

  it("inserts a vertex after the edge start, at the midpoint by default", () => {
    expect(insertVertex(square, 3)).toEqual({ type: "polygon", points: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 50]] });
    expect(insertVertex(square, 0, { x: 40, y: -10 })).toEqual({ type: "polygon", points: [[0, 0], [40, -10], [100, 0], [100, 100], [0, 100]] });
  });

  it("removes a vertex but never below the polygon minimum", () => {
    expect(MIN_POLYGON_VERTICES).toBe(3);
    expect(removeVertex(square, 1)).toEqual({ type: "polygon", points: [[0, 0], [100, 100], [0, 100]] });
    expect(canRemoveVertex(triangle)).toBe(false);
    expect(removeVertex(triangle, 0)).toBeNull();
  });

  it("snaps points only while grid snapping is on", () => {
    expect(snapPoint({ x: 13, y: 27 }, { enabled: true, size: 10 })).toEqual({ x: 10, y: 30 });
    expect(snapPoint({ x: 13, y: 27 }, { enabled: false, size: 10 })).toEqual({ x: 13, y: 27 });
    expect(snapPoint({ x: 13, y: 27 }, undefined)).toEqual({ x: 13, y: 27 });
  });
});
