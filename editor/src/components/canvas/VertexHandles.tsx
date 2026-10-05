import type { Point } from "../../lib/vertex-edit";

/**
 * Vertex and edge-midpoint handles for the single selected vertex-editable
 * area (#176). Geometry-agnostic: it draws the points it is given and reports
 * which one was pressed; Canvas owns the gesture and the geometry edit.
 */
interface Props {
  areaId: string;
  vertices: Point[];
  midpoints: Point[];
  activeIndex: number | null;
  zoom: number;
  onVertexPointerDown: (e: React.PointerEvent, areaId: string, index: number) => void;
  onMidpointPointerDown: (e: React.PointerEvent, areaId: string, edgeIndex: number) => void;
}

const STROKE = "rgba(59,130,246,1)";
const VERTEX_R = 5;
const MIDPOINT_R = 3.5;

export function VertexHandles({ areaId, vertices, midpoints, activeIndex, zoom, onVertexPointerDown, onMidpointPointerDown }: Props) {
  return (
    <g data-testid="vertex-handles" data-area-id={areaId}>
      {midpoints.map((point, edgeIndex) => (
        <circle
          key={`mid-${edgeIndex}`}
          data-testid="vertex-insert-handle"
          data-edge-index={edgeIndex}
          cx={point.x}
          cy={point.y}
          r={MIDPOINT_R / zoom}
          fill={STROKE}
          fillOpacity={0.35}
          stroke={STROKE}
          strokeWidth={1 / zoom}
          style={{ cursor: "copy" }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onMidpointPointerDown(e, areaId, edgeIndex);
          }}
        >
          <title>Drag or click to add a point</title>
        </circle>
      ))}
      {vertices.map((point, index) => (
        <circle
          key={`vertex-${index}`}
          data-testid="vertex-handle"
          data-vertex-index={index}
          data-active={index === activeIndex ? "true" : undefined}
          cx={point.x}
          cy={point.y}
          r={VERTEX_R / zoom}
          fill={index === activeIndex ? STROKE : "white"}
          stroke={STROKE}
          strokeWidth={1.5 / zoom}
          style={{ cursor: "grab" }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onVertexPointerDown(e, areaId, index);
          }}
        >
          <title>{`Point ${index + 1}`}</title>
        </circle>
      ))}
    </g>
  );
}
