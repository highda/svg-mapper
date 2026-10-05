import { describe, expect, it } from "vitest";
import {
  PathDataError,
  arcToCubics,
  decodeProjectFile,
  findMalformedPathData,
  fitPathSegments,
  geometryBounds,
  mapPathAnchors,
  parsePathData,
  pathBounds,
  pathDataError,
  pathSegmentsBounds,
  scalePathData,
  scalePathSegments,
  serializePathData,
  shapeBounds,
  transformPathSegments,
  translatePathData,
  validateProject,
  type PathSegment,
} from "@svg-mapper/shared";
import { createNewProject, parseProjectFile } from "../lib/project";
import { createRectArea } from "../lib/area-utils";

// Shared path geometry (#218): the full SVG path grammar parsed to canonical
// absolute M/L/C/Z, exact bounds, and transforms.

const canonical = (d: string) => serializePathData(parsePathData(d));

function expectBounds(actual: ReturnType<typeof pathBounds>, x: number, y: number, width: number, height: number, digits = 6) {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(x, digits);
  expect(actual!.y).toBeCloseTo(y, digits);
  expect(actual!.width).toBeCloseTo(width, digits);
  expect(actual!.height).toBeCloseTo(height, digits);
}

/** Distance from (cx, cy) of every point sampled along a canonical path's cubics. */
function sampledRadii(segments: PathSegment[], cx: number, cy: number): number[] {
  const radii: number[] = [];
  let px = 0, py = 0;
  for (const seg of segments) {
    if (seg.type === "M" || seg.type === "L") [px, py] = [seg.x, seg.y];
    if (seg.type !== "C") continue;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, mt = 1 - t;
      const x = mt ** 3 * px + 3 * mt * mt * t * seg.x1 + 3 * mt * t * t * seg.x2 + t ** 3 * seg.x;
      const y = mt ** 3 * py + 3 * mt * mt * t * seg.y1 + 3 * mt * t * t * seg.y2 + t ** 3 * seg.y;
      radii.push(Math.hypot(x - cx, y - cy));
    }
    [px, py] = [seg.x, seg.y];
  }
  return radii;
}

describe("parsePathData: commands", () => {
  it("returns no segments for empty or whitespace-only data", () => {
    expect(parsePathData("")).toEqual([]);
    expect(parsePathData(" \n\t ")).toEqual([]);
  });

  it("reads absolute M, L and Z", () => {
    expect(parsePathData("M10 20 L30 40 Z")).toEqual([
      { type: "M", x: 10, y: 20 },
      { type: "L", x: 30, y: 40 },
      { type: "Z" },
    ]);
  });

  it("reads relative m, l and z against the current point", () => {
    expect(parsePathData("m10 20 l5 5 l-10 0 z")).toEqual([
      { type: "M", x: 10, y: 20 },
      { type: "L", x: 15, y: 25 },
      { type: "L", x: 5, y: 25 },
      { type: "Z" },
    ]);
  });

  it("treats extra moveto pairs as implicit linetos (relative after m)", () => {
    expect(canonical("M0 0 10 0 10 10")).toBe("M0 0 L10 0 L10 10");
    expect(canonical("m5 5 10 0 0 10")).toBe("M5 5 L15 5 L15 15");
  });

  it("a leading relative m is absolute", () => {
    expect(parsePathData("m3 4")).toEqual([{ type: "M", x: 3, y: 4 }]);
  });

  it("reads H, V and their relative forms", () => {
    expect(canonical("M1 2 H10 V20 h-5 v-3")).toBe("M1 2 L10 2 L10 20 L5 20 L5 17");
    expect(canonical("M0 0 H1 2 3")).toBe("M0 0 L1 0 L2 0 L3 0");
  });

  it("reads C and c", () => {
    expect(canonical("M0 0 C1 2 3 4 5 6")).toBe("M0 0 C1 2 3 4 5 6");
    expect(canonical("M10 10 c1 2 3 4 5 6")).toBe("M10 10 C11 12 13 14 15 16");
    expect(canonical("M0 0 C1 1 2 2 3 3 4 4 5 5 6 6")).toBe("M0 0 C1 1 2 2 3 3 C4 4 5 5 6 6");
  });

  it("reflects the previous cubic control point for S and s", () => {
    expect(canonical("M0 0 C0 10 10 10 10 0 S20 -10 20 0")).toBe("M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0");
    expect(canonical("M0 0 C0 10 10 10 10 0 s10 -10 10 0")).toBe("M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0");
  });

  it("uses the current point as S's first control without a preceding cubic", () => {
    expect(canonical("M0 0 L10 0 S20 10 30 0")).toBe("M0 0 L10 0 C10 0 20 10 30 0");
    // A quadratic does not count as a preceding cubic.
    expect(canonical("M0 0 Q5 5 10 0 S20 10 30 0")).toMatch(/C10 0 20 10 30 0$/);
  });

  it("elevates Q and q to exact cubics", () => {
    expect(canonical("M0 0 Q30 30 60 0")).toBe("M0 0 C20 20 40 20 60 0");
    expect(canonical("M0 0 q30 30 60 0")).toBe("M0 0 C20 20 40 20 60 0");
  });

  it("reflects the previous quadratic control point for T and t", () => {
    // T after Q reflects (30,30) about (60,0) to (90,-30).
    expect(canonical("M0 0 Q30 30 60 0 T120 0")).toBe("M0 0 C20 20 40 20 60 0 C80 -20 100 -20 120 0");
    expect(canonical("M0 0 Q30 30 60 0 t60 0")).toBe("M0 0 C20 20 40 20 60 0 C80 -20 100 -20 120 0");
    // Chained T keeps reflecting: (90,-30) about (120,0) to (150,30).
    expect(canonical("M0 0 Q30 30 60 0 T120 0 T180 0")).toBe(
      "M0 0 C20 20 40 20 60 0 C80 -20 100 -20 120 0 C140 20 160 20 180 0",
    );
  });

  it("uses the current point as T's control without a preceding quadratic (a straight cubic)", () => {
    expect(canonical("M0 0 L30 0 T60 0")).toBe("M0 0 L30 0 C30 0 40 0 60 0");
    expect(canonical("M0 0 C1 1 2 2 30 0 T60 0")).toMatch(/C30 0 40 0 60 0$/);
  });

  it("makes the moveto after Z explicit and restarts at the subpath start", () => {
    expect(canonical("M10 10 L20 10 Z L30 30")).toBe("M10 10 L20 10 Z M10 10 L30 30");
    expect(canonical("M10 10 L20 10 z l5 5")).toBe("M10 10 L20 10 Z M10 10 L15 15");
    expect(canonical("M10 10 L20 10 Z m5 5 l1 1")).toBe("M10 10 L20 10 Z M15 15 L16 16");
  });

  it("reads every number form and separator the grammar allows", () => {
    expect(canonical("M1-2L.5.5")).toBe("M1 -2 L0.5 0.5");
    expect(canonical("M1e1,2E-1 L+3 -.25")).toBe("M10 0.2 L3 -0.25");
    expect(canonical("M 1 , 2 L 3 ,4")).toBe("M1 2 L3 4");
    expect(canonical("M0,0L10,0,10,10z")).toBe("M0 0 L10 0 L10 10 Z");
    expect(canonical("M1.5.5.5.5")).toBe("M1.5 0.5 L0.5 0.5");
    expect(canonical("\n M0 0\tL1 1\r\n")).toBe("M0 0 L1 1");
  });
});

describe("parsePathData: arcs", () => {
  it("reads an arc and ends exactly on its endpoint", () => {
    const segments = parsePathData("M0 50 A50 50 0 0 1 100 50");
    const last = segments.at(-1)!;
    expect(last).toMatchObject({ type: "C", x: 100, y: 50 });
    // A semicircle above the chord (sweep=1 from the left goes clockwise, through y=0).
    expectBounds(pathSegmentsBounds(segments), 0, 0, 100, 50, 2);
  });

  it("splits arcs into cubics of at most a quarter turn that stay on the circle", () => {
    const segments = parsePathData("M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z");
    expect(segments.filter((seg) => seg.type === "C")).toHaveLength(4);
    for (const r of sampledRadii(segments, 50, 50)) expect(Math.abs(r - 50)).toBeLessThan(0.02);
    expectBounds(pathBounds("M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z"), 0, 0, 100, 100, 1);
  });

  it("honours the sweep flag", () => {
    expectBounds(pathBounds("M0 0 A10 10 0 0 0 20 0"), 0, 0, 20, 10, 2);
    expectBounds(pathBounds("M0 0 A10 10 0 0 1 20 0"), 0, -10, 20, 10, 2);
  });

  it("honours the large-arc flag", () => {
    // Radius 10 between points 10 apart: the large arc goes the long way round.
    const small = pathBounds("M0 0 A10 10 0 0 1 10 0")!;
    const large = pathBounds("M0 0 A10 10 0 1 1 10 0")!;
    expect(large.height).toBeGreaterThan(small.height * 5);
    expect(large.height).toBeCloseTo(10 + 10 * Math.cos(Math.PI / 6), 1);
  });

  it("reads relative arcs and compact flags", () => {
    expect(canonical("M10 10 a5 5 0 1010 0")).toBe(canonical("M10 10 A5 5 0 1 0 20 10"));
    expect(canonical("M10 10 a5,5,0,0,1,10,0")).toBe(canonical("M10 10 A5 5 0 0 1 20 10"));
  });

  it("scales radii that are too small to span the endpoints", () => {
    // rx=ry=1 cannot reach 100 units: it becomes a semicircle of radius 50.
    expectBounds(pathBounds("M0 0 A1 1 0 0 0 100 0"), 0, 0, 100, 50, 2);
  });

  it("rotates elliptical arcs by the x-axis rotation", () => {
    // A half ellipse rx=20, ry=10 rotated 90°: its bulge spans 20 along x.
    const rotated = pathBounds("M0 0 A20 10 90 0 0 0 40")!;
    expect(rotated.width).toBeCloseTo(10, 1);
    expect(rotated.height).toBeCloseTo(40, 4);
  });

  it("draws a zero-radius arc as a straight line", () => {
    expect(canonical("M0 0 A0 10 0 0 1 10 10")).toBe("M0 0 L10 10");
    expect(canonical("M0 0 A10 0 0 0 1 10 10")).toBe("M0 0 L10 10");
  });

  it("omits an arc whose endpoints coincide", () => {
    expect(canonical("M5 5 A10 10 0 0 1 5 5")).toBe("M5 5");
    expect(arcToCubics(1, 1, 5, 5, 0, false, true, 1, 1)).toEqual([]);
  });

  it("uses the absolute value of negative radii", () => {
    expect(canonical("M0 0 A-10 -10 0 0 1 20 0")).toBe(canonical("M0 0 A10 10 0 0 1 20 0"));
  });
});

describe("parsePathData: malformed data", () => {
  it.each([
    ["L10 10", /must start with "M" or "m" at character 1/],
    ["  10 10", /must start with "M" or "m" at character 3/],
    ["M10", /Expected a number for "M" at character 4/],
    ["M10 10 L", /Expected a number for "L" at character 9/],
    ["M10 10 L5", /Expected a number for "L"/],
    ["M10,10,", /Expected a number for "M" at character 8/],
    ["M10 10 ,L5 5", /Expected a number/],
    ["M10 10 X5 5", /Unexpected "X"; expected a path command at character 8/],
    ["M10 10 Z 5", /Unexpected "5"/],
    ["M10 10 L5 5 #", /Expected a number for "L" at character 13/],
    ["M0 0 A10 10 0 2 1 5 5", /Expected an arc flag \(0 or 1\) for "A"/],
    ["M0 0 A10 10 0 1", /Expected an arc flag/],
    ["M0 0 L1e999 0", /Number out of range for "L"/],
    ["M0 0 L1e 0", /Expected a number for "L" at character 8/],
    ["M0 0 L1 2e", /Unexpected "e"/],
    ["M0 0 C1 2 3 4 5", /Expected a number for "C"/],
  ])("rejects %j", (d, message) => {
    expect(() => parsePathData(d)).toThrow(PathDataError);
    expect(() => parsePathData(d)).toThrow(message);
    expect(pathDataError(d)).toMatch(message);
  });

  it("reports the 0-based index of the problem", () => {
    try {
      parsePathData("M0 0 L5 x");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PathDataError);
      expect((error as PathDataError).index).toBe(8);
    }
  });

  it("accepts valid data", () => {
    expect(pathDataError("M0 0 L10 0 L10 10 Z")).toBeNull();
    expect(pathDataError("")).toBeNull();
  });
});

describe("serializePathData", () => {
  it("bounds precision and avoids -0 and trailing zeros", () => {
    expect(serializePathData([{ type: "M", x: 1.23456789, y: -0.0001 }, { type: "L", x: 2.5, y: 3 }])).toBe("M1.235 0 L2.5 3");
    expect(serializePathData([{ type: "M", x: 1.23456789, y: 2 }], 1)).toBe("M1.2 2");
    expect(serializePathData([{ type: "M", x: -0, y: 1e-9 }])).toBe("M0 0");
  });

  it("round-trips canonical data", () => {
    const d = "M0 0 C1 2 3 4 5 6 L7 8 Z M1 1 L2 2";
    expect(canonical(d)).toBe(d);
    expect(canonical(canonical("m1 2 q3 4 5 6 t1 1 a2 2 0 0 1 3 3 z"))).toBe(canonical("m1 2 q3 4 5 6 t1 1 a2 2 0 0 1 3 3 z"));
  });
});

describe("bounds", () => {
  it("uses real cubic extrema, not the control-point hull", () => {
    // Control points reach y=100, the curve only 75.
    expectBounds(pathBounds("M0 0 C0 100 100 100 100 0"), 0, 0, 100, 75);
    // A bulge to the right: controls reach x=100, the curve x=75 at t=0.5.
    expectBounds(pathBounds("M0 0 C100 0 100 100 0 100"), 0, 0, 75, 100);
    // An S-curve has two x extrema, both strictly inside the control hull.
    const s = pathBounds("M0 0 C100 0 -100 100 0 100")!;
    expect(s.x).toBeCloseTo(-28.868, 3);
    expect(s.x + s.width).toBeCloseTo(28.868, 3);
  });

  it("handles cubics whose derivative is linear or constant", () => {
    // Evenly spaced collinear controls: the derivative is constant.
    expectBounds(pathBounds("M0 0 C10 10 20 20 30 30"), 0, 0, 30, 30);
    // A degree-elevated quadratic: a = 0, derivative linear.
    expectBounds(pathBounds("M0 0 Q50 100 100 0"), 0, 0, 100, 50);
    // A fully degenerate cubic.
    expectBounds(pathBounds("M5 5 C5 5 5 5 5 5"), 5, 5, 0, 0);
  });

  it("covers lines and multiple subpaths", () => {
    expectBounds(pathBounds("M10 10 L30 10 L30 40 Z M-5 0 L0 0"), -5, 0, 35, 40);
  });

  it("gives a lone moveto zero-size bounds", () => {
    expectBounds(pathBounds("M7 8"), 7, 8, 0, 0);
  });

  it("returns null for empty or malformed data", () => {
    expect(pathBounds("")).toBeNull();
    expect(pathBounds("L1 1")).toBeNull();
    expect(pathSegmentsBounds([])).toBeNull();
  });

  it("geometryBounds handles paths; shapeBounds leaves them to the DOM", () => {
    const path = { type: "path" as const, d: "M10 20 L110 20 L110 70 Z" };
    expectBounds(geometryBounds(path), 10, 20, 100, 50);
    expect(shapeBounds(path)).toBeNull();
    const rect = { type: "rect" as const, x: 1, y: 2, width: 3, height: 4 };
    expect(geometryBounds(rect)).toEqual(shapeBounds(rect));
  });
});

describe("transforms", () => {
  const d = "M0 0 C0 100 100 100 100 0 Z";

  it("translates every point, so bounds move by the same offset", () => {
    expect(translatePathData(d, 10, -5)).toBe("M10 -5 C10 95 110 95 110 -5 Z");
    expectBounds(pathBounds(translatePathData(d, 10, -5)), 10, -5, 100, 75);
  });

  it("scales about an origin", () => {
    expect(scalePathData("M10 10 L20 20", 2, 3, 10, 10)).toBe("M10 10 L30 40");
    expect(serializePathData(scalePathSegments(parsePathData("M1 1 L2 2"), 2, 2))).toBe("M2 2 L4 4");
  });

  it("fits bounds onto a target box exactly, curves included", () => {
    const fitted = fitPathSegments(parsePathData(d), pathBounds(d)!, { x: 50, y: 50, width: 200, height: 150 });
    expectBounds(pathSegmentsBounds(fitted), 50, 50, 200, 150);
  });

  it("only translates a zero-size axis", () => {
    const line = parsePathData("M0 10 L100 10");
    const fitted = fitPathSegments(line, pathSegmentsBounds(line)!, { x: 0, y: 30, width: 50, height: 20 });
    expect(serializePathData(fitted)).toBe("M0 30 L50 30");
  });

  it("applies affine matrices exactly to canonical arcs", () => {
    // Rotating a circle by 90° about its centre keeps its bounds.
    const circle = parsePathData("M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z");
    const rotated = transformPathSegments(circle, [0, 1, -1, 0, 100, 0]);
    for (const r of sampledRadii(rotated, 50, 50)) expect(Math.abs(r - 50)).toBeLessThan(0.02);
  });

  it("moves curve handles with their anchor when snapping anchors", () => {
    const snapped = mapPathAnchors(parsePathData("M1 1 C1 10 9 10 9 1 Z L4 4"), (x, y) => [Math.round(x / 10) * 10, Math.round(y / 10) * 10]);
    expect(serializePathData(snapped)).toBe("M0 0 C0 9 10 9 10 0 Z M0 0 L0 0");
  });
});

describe("path data in decoding and validation", () => {
  function projectWithPath(d: string) {
    const project = createNewProject();
    const area = { ...createRectArea(0, 0, 10, 10), id: "area_path", name: "Lake" };
    area.geometry = { type: "path", d };
    project.views[0]!.layers.push({ id: "layer_main", name: "Places", visible: true, locked: false, opacity: 1, areas: [area] });
    return project;
  }

  it("finds malformed path data by JSON path", () => {
    expect(findMalformedPathData(projectWithPath("M0 0 L10"))).toEqual({
      path: "$.views[0].layers[0].areas[0].geometry.d",
      message: 'Invalid map.json at $.views[0].layers[0].areas[0].geometry.d: expected SVG path data (Expected a number for "L" at character 9).',
    });
    expect(findMalformedPathData(projectWithPath("M0 0 L10 0 L5 5 Z"))).toBeNull();
  });

  it("opening a project refuses malformed path data and names where it is", () => {
    // Structurally the file is fine; the editor still refuses to open it.
    expect(decodeProjectFile(projectWithPath("M0 0 L10")).ok).toBe(true);
    expect(() => parseProjectFile(JSON.stringify(projectWithPath("M0 0 L10")))).toThrow(
      /Invalid map\.json at \$\.views\[0\]\.layers\[0\]\.areas\[0\]\.geometry\.d: expected SVG path data \(Expected a number for "L" at character 9\)/,
    );
  });

  it("opening a project accepts valid and blank path data (blank is an Export error)", () => {
    expect(() => parseProjectFile(JSON.stringify(projectWithPath("M0 0 L10 0 L5 5 Z")))).not.toThrow();
    expect(() => parseProjectFile(JSON.stringify(projectWithPath("")))).not.toThrow();
    expect(validateProject(projectWithPath("")).find((result) => result.code === "INVALID_GEOMETRY")?.message).toMatch(/empty `d`/);
  });

  it("export validation reports malformed path data on the area", () => {
    const results = validateProject(projectWithPath("M0 0 Q1"));
    const error = results.find((result) => result.code === "INVALID_GEOMETRY");
    expect(error?.severity).toBe("error");
    expect(error?.message).toMatch(/Area "Lake" has invalid geometry: path `d` is malformed: Expected a number for "Q"/);
    expect(error?.ref?.areaId).toBe("area_path");
    expect(validateProject(projectWithPath("M0 0 L10 0 L5 5 Z")).some((result) => result.code === "INVALID_GEOMETRY")).toBe(false);
  });
});
