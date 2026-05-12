import type { Area } from "@svg-mapper/shared";
import { geometryToSvgPath, getRectHandles, type RectHandle } from "../../lib/area-utils";

interface Props {
  area: Area;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, areaId: string) => void;
  onHandlePointerDown: (e: React.PointerEvent, areaId: string, handle: RectHandle) => void;
}

// Editor-mode fill/stroke overrides so areas are always visible while authoring.
const EDITOR_FILL = "rgba(59,130,246,0.08)";
const EDITOR_STROKE = "rgba(59,130,246,0.6)";
const SELECTED_STROKE = "rgba(59,130,246,1)";
const HANDLE_R = 5;

export function AreaShape({ area, selected, onPointerDown, onHandlePointerDown }: Props) {
  const d = geometryToSvgPath(area.geometry);
  if (!d) return null;

  const isRect = area.geometry.type === "rect";

  return (
    <g>
      <path
        d={d}
        fill={EDITOR_FILL}
        stroke={selected ? SELECTED_STROKE : EDITOR_STROKE}
        strokeWidth={selected ? 2 : 1.5}
        strokeDasharray={selected ? undefined : "4,3"}
        style={{ cursor: "move" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, area.id);
        }}
      />
      {selected && isRect && (() => {
        const handles = getRectHandles(area.geometry as Parameters<typeof getRectHandles>[0]);
        return (Object.entries(handles) as [RectHandle, { x: number; y: number }][]).map(
          ([handle, pos]) => (
            <circle
              key={handle}
              cx={pos.x}
              cy={pos.y}
              r={HANDLE_R}
              fill="white"
              stroke={SELECTED_STROKE}
              strokeWidth={1.5}
              style={{ cursor: "crosshair" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, area.id, handle);
              }}
            />
          ),
        );
      })()}
    </g>
  );
}
