import type { Area, AreaStyle, Geometry, RectGeometry } from "@svg-mapper/shared";

export const DEFAULT_AREA_STYLE: AreaStyle = {
  default: { fill: "rgba(0,120,255,0)", stroke: "rgba(0,120,255,0)", strokeWidth: 2 },
  hover: { fill: "rgba(0,120,255,0.25)", stroke: "rgba(0,120,255,0.9)", strokeWidth: 2 },
  active: { fill: "rgba(0,120,255,0.35)", stroke: "rgba(0,120,255,1)", strokeWidth: 3 },
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
      return `M${geo.x},${geo.y} h${geo.width} v${geo.height} h${-geo.width}Z`;
    case "polygon":
      if (geo.points.length < 2) return "";
      return geo.points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join(" ") + "Z";
    case "circle":
      return `M${geo.cx - geo.r},${geo.cy} a${geo.r},${geo.r} 0 1,0 ${geo.r * 2},0 a${geo.r},${geo.r} 0 1,0 ${-geo.r * 2},0`;
    case "path":
      return geo.d;
    case "marker":
      return `M${geo.x - 6},${geo.y - 12} l6,12 l6,-12 Z`;
  }
}

export function getGeometryBbox(geo: Geometry): { x: number; y: number; width: number; height: number } | null {
  switch (geo.type) {
    case "rect":
      return { x: geo.x, y: geo.y, width: geo.width, height: geo.height };
    case "polygon": {
      if (!geo.points.length) return null;
      const xs = geo.points.map(([px]) => px);
      const ys = geo.points.map(([, py]) => py);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case "circle":
      return { x: geo.cx - geo.r, y: geo.cy - geo.r, width: geo.r * 2, height: geo.r * 2 };
    default:
      return null;
  }
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
