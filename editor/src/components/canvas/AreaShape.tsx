import { useState } from "react";
import type { Area, CircleGeometry } from "@svg-mapper/shared";
import { alphaMaskWorldPath, areaImagePlacement, assetDisplaySource, geometryBounds, imagePreserveAspectRatio, imageRotationTransform, isAreaHidden, markerBox, markerIcon, markerTransform, rectPathData } from "@svg-mapper/shared";
import { geometryToSvgPath, getRectHandles, type RectHandle } from "../../lib/area-utils";
import { useStore } from "../../store";
import { useStylePreview } from "../../store/style-preview";

interface Props {
  area: Area;
  selected: boolean;
  /** Locked layer or position-locked image: selectable, but never moved or resized (#164). */
  geometryLocked?: boolean;
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
  geometryLocked = false,
  zoom = 1,
  onPointerDown,
  onHandlePointerDown,
  onCircleHandlePointerDown,
  onHoverChange,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const assets = useStore((state) => state.project.assets);
  const icons = useStore((state) => state.project.icons);
  const previewState = useStylePreview((state) => state.state);

  // A marker draws its icon in a box at map scale (#219); the box is its hit
  // area, selection outline and resize frame, as in the renderer.
  const marker = area.geometry.type === "marker" ? area.geometry : null;
  const icon = marker ? markerIcon(marker, icons) : null;
  const iconBox = marker && icon ? markerBox(marker, icon) : null;
  const d = iconBox ? rectPathData(iconBox.x, iconBox.y, iconBox.width, iconBox.height) : geometryToSvgPath(area.geometry);
  if (!d) return null;

  const isRect = area.geometry.type === "rect";
  // A selected path resizes by its bounding box, with the rectangle's corner handles (#218).
  const pathBox = selected && !geometryLocked && area.geometry.type === "path" ? geometryBounds(area.geometry) : null;
  const handleBox = isRect ? (area.geometry as Parameters<typeof getRectHandles>[0]) : pathBox ?? (selected && !geometryLocked ? iconBox : null);
  const isCircle = area.geometry.type === "circle";
  const isDisabled = area.disabled === true;
  const alwaysHL = area.alwaysHighlight === true;

  // Mirrors the renderer's precedence: disabled > active (previewed) > hover >
  // always-highlight > default. The Inspector's preview applies to selected areas.
  const shownStyle = isDisabled
    ? (area.style.disabled ?? { ...area.style.default, fill: "#9ca3af", stroke: "#6b7280" })
    : selected && previewState === "active" ? area.style.active
      : (hovered || alwaysHL || (selected && previewState === "hover")) ? area.style.hover : area.style.default;

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
  // The same placement the renderer hit-tests against (fit, crop, rotation).
  const placement = area.image && rect ? areaImagePlacement(rect, area.image, imageAsset) : null;
  // A hidden image element is absent from the published map; the editor keeps
  // it faint so it can still be selected and shown again.
  const hidden = isAreaHidden(area);

  return (
    <g style={{ opacity: hidden ? 0.3 : isDisabled ? 0.6 : 1 }} data-hidden={hidden ? "true" : undefined}>
      {imageAsset && rect && placement && (
        <image href={assetDisplaySource(imageAsset.src)} x={rect.x} y={rect.y} width={rect.width} height={rect.height} opacity={area.image?.opacity ?? 1} transform={imageRotationTransform(placement)} preserveAspectRatio={imagePreserveAspectRatio(area.image?.fit)} style={{ pointerEvents: "none" }} />
      )}
      {/* Main area shape */}
      {marker && icon && iconBox ? (() => {
        const iconAsset = icon.assetId !== undefined ? assets.find((asset) => asset.id === icon.assetId) : undefined;
        // Strokes stay in canvas units whatever the icon's own scale.
        const strokeWidth = shownStyle.strokeWidth / (iconBox.width / icon.width);
        return (
          <g
            transform={markerTransform(marker, icon)}
            fill={shownStyle.fill}
            stroke={shownStyle.stroke}
            strokeWidth={strokeWidth}
            style={{ cursor: geometryLocked ? "pointer" : "move" }}
            data-locked={geometryLocked ? "true" : undefined}
            data-marker-icon={marker.icon ?? "pin"}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, area.id);
            }}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
          >
            {iconAsset && <image href={assetDisplaySource(iconAsset.src)} width={icon.width} height={icon.height} preserveAspectRatio="none" />}
            {/* Image icons cannot be recoloured: the style's stroke outlines the box instead. */}
            <rect width={icon.width} height={icon.height} fill="transparent" stroke={iconAsset ? undefined : "none"} />
            {!iconAsset && icon.d && <path d={icon.d} />}
          </g>
        );
      })() : (
        <path
          d={d}
          fill={shownStyle.fill}
          stroke={shownStyle.stroke}
          strokeWidth={shownStyle.strokeWidth}
          style={{ cursor: geometryLocked ? "pointer" : "move" }}
          data-locked={geometryLocked ? "true" : undefined}
          onPointerDown={(e) => {
            // Disabled hotspots and locked content stay selectable so they can
            // be inspected and unlocked; Canvas excludes locked geometry from moves.
            e.stopPropagation();
            onPointerDown(e, area.id);
          }}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        />
      )}

      {area.image?.hitMask?.debug && placement && (
        <path
          data-testid="alpha-mask-overlay"
          d={alphaMaskWorldPath(placement, area.image.hitMask)}
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

      {pathBox && (
        <rect
          data-testid="path-bounds"
          x={pathBox.x}
          y={pathBox.y}
          width={pathBox.width}
          height={pathBox.height}
          fill="none"
          stroke={SELECTED_STROKE}
          strokeWidth={hw}
          opacity={0.6}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Rect (and path bounding-box) resize handles */}
      {selected && handleBox && !geometryLocked && (() => {
        const handles = getRectHandles(handleBox);
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
      {selected && isCircle && !geometryLocked && (() => {
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
