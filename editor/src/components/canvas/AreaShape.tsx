import { useState } from "react";
import type { Area, CircleGeometry } from "@svg-mapper/shared";
import { geometryToSvgPath, getRectHandles, type RectHandle } from "../../lib/area-utils";
import { alphaMaskToSvgPath } from "../../lib/alpha-mask";
import { useStore } from "../../store";

interface Props {
  area: Area;
  selected: boolean;
  zoom?: number;
  onPointerDown: (e: React.PointerEvent, areaId: string) => void;
  onHandlePointerDown: (e: React.PointerEvent, areaId: string, handle: RectHandle) => void;
  onCircleHandlePointerDown?: (e: React.PointerEvent, areaId: string) => void;
  onHoverChange: (areaId: string | null) => void;
}

const SELECTED_STROKE = "rgba(59,130,246,1)";
const HANDLE_R = 5;

export function AreaShape({
  area,
  selected,
  zoom = 1,
  onPointerDown,
  onHandlePointerDown,
  onCircleHandlePointerDown,
  onHoverChange,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const assets = useStore((state) => state.project.assets);

  const d = geometryToSvgPath(area.geometry);
  if (!d) return null;

  const isRect = area.geometry.type === "rect";
  const isCircle = area.geometry.type === "circle";
  const isDisabled = area.disabled === true;
  const alwaysHL = area.alwaysHighlight === true;

  const activeStyle = isDisabled
    ? (area.style.disabled ?? { ...area.style.default, fill: "#9ca3af", stroke: "#6b7280" })
    : (hovered || alwaysHL) ? area.style.hover : area.style.default;

  function handlePointerEnter() {
    setHovered(true);
    onHoverChange(area.id);
  }
  function handlePointerLeave() {
    setHovered(false);
    onHoverChange(null);
  }

  const hw = 1 / zoom; // handle stroke width
  const imageAsset = area.image ? assets.find((asset) => asset.id === area.image?.assetId) : undefined;
  const rect = area.geometry.type === "rect" ? area.geometry : null;
  const imageFit = area.image?.fit ?? "fill";
  const imageAspect = imageFit === "contain" ? "xMidYMid meet" : imageFit === "cover" ? "xMidYMid slice" : "none";
  const imageRotation = area.image?.rotation ?? 0;

  return (
    <g style={{ opacity: isDisabled ? 0.6 : 1 }}>
      {imageAsset && rect && area.image?.visible !== false && (
        <image href={imageAsset.src} x={rect.x} y={rect.y} width={rect.width} height={rect.height} opacity={area.image?.opacity ?? 1} transform={imageRotation ? `rotate(${imageRotation} ${rect.x + rect.width / 2} ${rect.y + rect.height / 2})` : undefined} preserveAspectRatio={imageAspect} style={{ pointerEvents: "none" }} />
      )}
      {/* Main area shape */}
      <path
        d={d}
        fill={activeStyle.fill}
        stroke={activeStyle.stroke}
        strokeWidth={activeStyle.strokeWidth}
        style={{ cursor: isDisabled ? "not-allowed" : "move" }}
        onPointerDown={(e) => {
          if (isDisabled || area.image?.locked) return;
          e.stopPropagation();
          onPointerDown(e, area.id);
        }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      />

      {area.image?.hitMask?.debug && rect && (
        <path
          d={alphaMaskToSvgPath(area.image.hitMask, rect.x, rect.y, rect.width, rect.height)}
          fill="rgba(236,72,153,0.38)"
          stroke="none"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* alwaysHighlight indicator — dashed outline in editor */}
      {alwaysHL && !selected && (
        <path
          d={d}
          fill="none"
          stroke="rgba(250,204,21,0.8)"
          strokeWidth={1.5 / zoom}
          strokeDasharray={`${4 / zoom},${3 / zoom}`}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Selection overlay */}
      {selected && (
        <path
          d={d}
          fill="none"
          stroke={SELECTED_STROKE}
          strokeWidth={2 / zoom}
          strokeDasharray={`${4 / zoom},${3 / zoom}`}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Rect resize handles */}
      {selected && isRect && (() => {
        const handles = getRectHandles(area.geometry as Parameters<typeof getRectHandles>[0]);
        return (Object.entries(handles) as [RectHandle, { x: number; y: number }][]).map(
          ([handle, pos]) => (
            <circle
              key={handle}
              cx={pos.x}
              cy={pos.y}
              r={HANDLE_R / zoom}
              fill="white"
              stroke={SELECTED_STROKE}
              strokeWidth={hw}
              style={{ cursor: "crosshair" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, area.id, handle);
              }}
            />
          ),
        );
      })()}

      {/* Circle resize handle (east point) */}
      {selected && isCircle && (() => {
        const g = area.geometry as CircleGeometry & { type: "circle" };
        const ex = g.cx + g.r;
        const ey = g.cy;
        return (
          <circle
            cx={ex}
            cy={ey}
            r={HANDLE_R / zoom}
            fill="white"
            stroke={SELECTED_STROKE}
            strokeWidth={hw}
            style={{ cursor: "ew-resize" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onCircleHandlePointerDown?.(e, area.id);
            }}
          />
        );
      })()}
    </g>
  );
}
