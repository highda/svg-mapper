import { useState } from "react";
import type { Area } from "@svg-mapper/shared";
import { geometryToSvgPath, getRectHandles, type RectHandle } from "../../lib/area-utils";

interface Props {
  area: Area;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, areaId: string) => void;
  onHandlePointerDown: (e: React.PointerEvent, areaId: string, handle: RectHandle) => void;
  onHoverChange: (areaId: string | null) => void;
}

const SELECTED_STROKE = "rgba(59,130,246,1)";
const HANDLE_R = 5;

export function AreaShape({ area, selected, onPointerDown, onHandlePointerDown, onHoverChange }: Props) {
  const [hovered, setHovered] = useState(false);

  const d = geometryToSvgPath(area.geometry);
  if (!d) return null;

  const isRect = area.geometry.type === "rect";
  const activeStyle = hovered ? area.style.hover : area.style.default;

  function handlePointerEnter() {
    setHovered(true);
    onHoverChange(area.id);
  }
  function handlePointerLeave() {
    setHovered(false);
    onHoverChange(null);
  }

  return (
    <g>
      {/* Main area shape — renders actual user-configured style */}
      <path
        d={d}
        fill={activeStyle.fill}
        stroke={activeStyle.stroke}
        strokeWidth={activeStyle.strokeWidth}
        style={{ cursor: "move" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, area.id);
        }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      />

      {/* Selection overlay — always-visible dashed blue border, no fill */}
      {selected && (
        <path
          d={d}
          fill="none"
          stroke={SELECTED_STROKE}
          strokeWidth={2}
          strokeDasharray="4,3"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Resize handles (rects only) */}
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
