import type { Area, AreaStyle, Geometry, MarkerAnchor, RectGeometry } from "@svg-mapper/shared";
import { geometryBounds, markerPathData, rectPathData } from "@svg-mapper/shared";

export const DEFAULT_AREA_STYLE: AreaStyle = {
  default: { fill: "rgba(59,130,246,0.08)", stroke: "rgba(59,130,246,0.6)", strokeWidth: 2 },
  hover:   { fill: "rgba(59,130,246,0.25)", stroke: "rgba(59,130,246,0.9)", strokeWidth: 2 },
  active:  { fill: "rgba(59,130,246,0.35)", stroke: "rgba(59,130,246,1)",   strokeWidth: 3 },
};

function makeAreaId(): string {
  return `area_${Math.random().toString(36).slice(2, 10)}`;
}

export function createRectArea(x: number, y: number, width: number, height: number): Area {
  return {
    id: makeAreaId(),
    name: "Area",
    geometry: { type: "rect", x, y, width, height },
    style: DEFAULT_AREA_STYLE,
    action: { type: "none" },
  };
}

export function createPolygonArea(points: [number, number][]): Area {
  return {
    id: makeAreaId(),
    name: "Area",
    geometry: { type: "polygon", points },
    style: DEFAULT_AREA_STYLE,
    action: { type: "none" },
  };
}

export function createCircleArea(cx: number, cy: number, r: number): Area {
  return {
    id: makeAreaId(),
    name: "Area",
    geometry: { type: "circle", cx, cy, r },
    style: DEFAULT_AREA_STYLE,
    action: { type: "none" },
  };
}

export function createMarkerArea(x: number, y: number, anchor: MarkerAnchor = "bottom-center"): Area {
  return {
    id: makeAreaId(),
    name: "Marker",
    geometry: { type: "marker", x, y, anchor },
    style: DEFAULT_AREA_STYLE,
    action: { type: "none" },
  };
}


export function moveGeometry(geo: Geometry, dx: number, dy: number): Geometry {
  switch (geo.type) {
    case "rect":
      return { ...geo, x: geo.x + dx, y: geo.y + dy };
    case "polygon":
      return { ...geo, points: geo.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) };
    case "circle":
      return { ...geo, cx: geo.cx + dx, cy: geo.cy + dy };
    case "marker":
      return { ...geo, x: geo.x + dx, y: geo.y + dy };
    case "path":
      return geo;
  }
}

export function snapValue(value: number, gridSize: number): number {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/** Snap all editable geometry coordinates to the nearest grid point. */
export function snapGeometryToGrid(geo: Geometry, gridSize: number): Geometry {
  switch (geo.type) {
    case "rect": {
      const left = snapValue(geo.x, gridSize);
      const top = snapValue(geo.y, gridSize);
      const right = snapValue(geo.x + geo.width, gridSize);
      const bottom = snapValue(geo.y + geo.height, gridSize);
      return { ...geo, x: left, y: top, width: Math.max(gridSize, right - left), height: Math.max(gridSize, bottom - top) };
    }
    case "polygon":
      return { ...geo, points: geo.points.map(([x, y]) => [snapValue(x, gridSize), snapValue(y, gridSize)] as [number, number]) };
    case "circle":
      return { ...geo, cx: snapValue(geo.cx, gridSize), cy: snapValue(geo.cy, gridSize), r: Math.max(gridSize, snapValue(geo.r, gridSize)) };
    case "marker":
      return { ...geo, x: snapValue(geo.x, gridSize), y: snapValue(geo.y, gridSize) };
    case "path":
      return geo;
  }
}

export type RectHandle = "nw" | "ne" | "sw" | "se";

export function resizeRect(
  geo: { type: "rect" } & RectGeometry,
  handle: RectHandle,
  dx: number,
  dy: number,
): { type: "rect" } & RectGeometry {
  let { x, y, width, height } = geo;
  switch (handle) {
    case "nw":
      x += dx; y += dy; width -= dx; height -= dy; break;
    case "ne":
      y += dy; width += dx; height -= dy; break;
    case "sw":
      x += dx; width -= dx; height += dy; break;
    case "se":
      width += dx; height += dy; break;
  }
  return { ...geo, x, y, width: Math.max(4, width), height: Math.max(4, height) };
}

export function getRectHandles(geo: RectGeometry): Record<RectHandle, { x: number; y: number }> {
  return {
    nw: { x: geo.x, y: geo.y },
    ne: { x: geo.x + geo.width, y: geo.y },
    sw: { x: geo.x, y: geo.y + geo.height },
    se: { x: geo.x + geo.width, y: geo.y + geo.height },
  };
}

export function geometryToSvgPath(geo: Geometry): string {
  switch (geo.type) {
    case "rect":
      // Same corners as the renderer's <rect rx>.
      return rectPathData(geo.x, geo.y, geo.width, geo.height, geo.rx);
    case "polygon":
      if (geo.points.length < 2) return "";
      return geo.points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ") + "Z";
    case "circle":
      return `M${geo.cx - geo.r},${geo.cy} a${geo.r},${geo.r} 0 1,0 ${geo.r * 2},0 a${geo.r},${geo.r} 0 1,0 ${-geo.r * 2},0`;
    case "path":
      return geo.d;
    case "marker":
      return markerPathData(geo.x, geo.y, geo.anchor);
  }
}

export function getGeometryBbox(geo: Geometry): { x: number; y: number; width: number; height: number } | null {
  return geometryBounds(geo);
}

export function calculateZoomToFit(
  bounds: { x: number; y: number; width: number; height: number },
  canvasSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  margin = 0.8,
): { zoom: number; pan: { x: number; y: number } } {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const zoom = Math.max(0.1, Math.min(8, Math.min(
    (viewportSize.width * margin) / width,
    (viewportSize.height * margin) / height,
  )));
  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;
  return {
    zoom,
    pan: {
      x: zoom * (canvasSize.width / 2 - boundsCenterX),
      y: zoom * (canvasSize.height / 2 - boundsCenterY),
    },
  };
}

export function polygonPointsToString(points: [number, number][]): string {
  return points.map(([px, py]) => `${px},${py}`).join(" ");
}

/** Find the area and its layer by area ID, searching all layers in a view. */
export function findAreaLocation(
  views: import("@svg-mapper/shared").View[],
  areaId: string,
): { viewIdx: number; layerIdx: number; areaIdx: number } | null {
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    for (let li = 0; li < view.layers.length; li++) {
      const layer = view.layers[li];
      const ai = layer.areas.findIndex((a) => a.id === areaId);
      if (ai !== -1) return { viewIdx: vi, layerIdx: li, areaIdx: ai };
    }
  }
  return null;
}
