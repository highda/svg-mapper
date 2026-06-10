import { useCallback, useEffect, useRef, useState } from "react";
import type { Area } from "@svg-mapper/shared";
import { useStore } from "../../store";
import { AreaShape } from "./AreaShape";
import {
  createRectArea,
  createPolygonArea,
  polygonPointsToString,
  resizeRect,
  moveGeometry,
  type RectHandle,
} from "../../lib/area-utils";

// ── Coordinate helpers ──────────────────────────────────────────────────────

function svgPoint(
  e: React.PointerEvent | React.MouseEvent | { clientX: number; clientY: number },
  svgEl: SVGSVGElement,
): { x: number; y: number } {
  const rect = svgEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function contentPoint(
  svgPt: { x: number; y: number },
  svgEl: SVGSVGElement,
  panX: number,
  panY: number,
  zoom: number,
): { x: number; y: number } {
  const { width, height } = svgEl.getBoundingClientRect();
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: (svgPt.x - (cx + panX)) / zoom,
    y: (svgPt.y - (cy + panY)) / zoom,
  };
}

// ── Canvas ───────────────────────────────────────────────────────────────────

export function Canvas() {
  const {
    project,
    activeViewId,
    activeTool,
    selectedAreaId,
    setActiveTool,
    setSelectedAreaId,
    addArea,
    deleteArea,
    duplicateArea,
    undo,
    redo,
    setEditorState,
  } = useStore();

  const editorState = project.editor;
  const panX = editorState?.pan.x ?? 0;
  const panY = editorState?.pan.y ?? 0;
  const zoom = editorState?.zoom ?? 1;

  const svgRef = useRef<SVGSVGElement>(null);

  // Polygon in-progress vertices (local state — transient)
  const [polyPts, setPolyPts] = useState<[number, number][]>([]);
  const [polyPreview, setPolyPreview] = useState<[number, number] | null>(null);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // Tooltip hover state
  const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Last pointer position for space-hold panning (no click required)
  const lastSpacePanPos = useRef<{ x: number; y: number } | null>(null);

  // Drag state (refs to avoid re-renders during drag)
  const drag = useRef<{
    type: "pan" | "move" | "draw-rect" | "resize";
    startSvg: { x: number; y: number };
    startContent: { x: number; y: number };
    areaId?: string;
    handle?: RectHandle;
    areaGeoBefore?: Area["geometry"];
    panBefore?: { x: number; y: number };
    previewRect?: { x: number; y: number; width: number; height: number } | null;
  } | null>(null);

  const spaceHeld = useRef(false);

  const view = project.views.find((v) => v.id === activeViewId);
  const backgroundAsset = view?.background
    ? project.assets.find((a) => a.id === view.background!.assetId)
    : undefined;

  // ── Non-passive wheel listener (fixes passive event listener console error) ──

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const { width, height } = rect;
      const cx = width / 2;
      const cy = height / 2;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(0.1, Math.min(8, zoom * factor));
      const scale = newZoom / zoom;
      const mx = sp.x - cx;
      const my = sp.y - cy;
      const newPanX = mx * (1 - scale) + panX * scale;
      const newPanY = my * (1 - scale) + panY * scale;
      setEditorState({ zoom: newZoom, pan: { x: newPanX, y: newPanY } });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoom, panX, panY, setEditorState]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === " ") {
        spaceHeld.current = true;
        setIsSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (e.key === "v" || e.key === "V") { setActiveTool("select"); return; }
      if (e.key === "r" || e.key === "R") { setActiveTool("rect"); return; }
      if (e.key === "p" || e.key === "P") { setActiveTool("polygon"); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedAreaId) {
        deleteArea(selectedAreaId);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "d" && selectedAreaId) {
        e.preventDefault();
        duplicateArea(selectedAreaId);
        return;
      }
      // Redo: Cmd/Ctrl+Shift+Z (e.key is "Z" when Shift is held on most platforms)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        redo();
        return;
      }
      // Undo: Cmd/Ctrl+Z (must come after redo check to avoid stealing Shift+Z)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === "Escape") {
        if (activeTool === "polygon" && polyPts.length > 0) {
          setPolyPts([]);
          setPolyPreview(null);
        } else {
          setSelectedAreaId(null);
        }
        return;
      }
      if (e.key === "Enter" && activeTool === "polygon" && polyPts.length >= 3) {
        addArea(createPolygonArea(polyPts));
        setPolyPts([]);
        setPolyPreview(null);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        setEditorState({ zoom: Math.min(8, zoom * 1.2) });
        return;
      }
      if (e.key === "-" || e.key === "_") {
        setEditorState({ zoom: Math.max(0.1, zoom / 1.2) });
        return;
      }
      if (e.key === "0") {
        setEditorState({ zoom: 1, pan: { x: 0, y: 0 } });
        return;
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === " ") {
        spaceHeld.current = false;
        setIsSpaceDown(false);
        lastSpacePanPos.current = null;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    activeTool,
    selectedAreaId,
    polyPts,
    zoom,
    setActiveTool,
    setSelectedAreaId,
    setIsSpaceDown,
    addArea,
    deleteArea,
    duplicateArea,
    undo,
    redo,
    setEditorState,
  ]);

  // ── Pointer events ────────────────────────────────────────────────────────

  const [previewRect, setPreviewRect] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);

  const toContent = useCallback(
    (svgPt: { x: number; y: number }) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      return contentPoint(svgPt, svg, panX, panY, zoom);
    },
    [panX, panY, zoom],
  );

  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Give the SVG keyboard focus so shortcuts work even after clicking inspector inputs.
    svgRef.current?.focus();

    if (!svgRef.current) return;
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
    const cp = toContent(sp);

    // Space or middle-button always pans
    if (spaceHeld.current || e.button === 1) {
      svg.setPointerCapture(e.pointerId);
      drag.current = { type: "pan", startSvg: sp, startContent: cp, panBefore: { x: panX, y: panY } };
      setIsPanning(true);
      return;
    }

    if (activeTool === "select") {
      // Background drag = pan; short tap = deselect (disambiguated in onSvgPointerUp)
      svg.setPointerCapture(e.pointerId);
      drag.current = { type: "pan", startSvg: sp, startContent: cp, panBefore: { x: panX, y: panY } };
      setIsPanning(true);
    } else if (activeTool === "rect") {
      svg.setPointerCapture(e.pointerId);
      drag.current = {
        type: "draw-rect",
        startSvg: sp,
        startContent: cp,
      };
      setPreviewRect({ x: cp.x, y: cp.y, width: 0, height: 0 });
    } else if (activeTool === "polygon") {
      setPolyPts((pts) => [...pts, [cp.x, cp.y]]);
    }
  }

  function onAreaPointerDown(e: React.PointerEvent, areaId: string) {
    if (activeTool !== "select" || spaceHeld.current) return;
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
    const cp = toContent(sp);

    setSelectedAreaId(areaId);

    // Find the area geometry for drag baseline
    let geoSnapshot: Area["geometry"] | undefined;
    for (const view of project.views) {
      for (const layer of view.layers) {
        const a = layer.areas.find((ar) => ar.id === areaId);
        if (a) { geoSnapshot = a.geometry; break; }
      }
    }

    svg.setPointerCapture(e.pointerId);
    drag.current = {
      type: "move",
      startSvg: sp,
      startContent: cp,
      areaId,
      areaGeoBefore: geoSnapshot,
    };
  }

  function onHandlePointerDown(e: React.PointerEvent, areaId: string, handle: RectHandle) {
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
    const cp = toContent(sp);

    let geoSnapshot: Area["geometry"] | undefined;
    for (const view of project.views) {
      for (const layer of view.layers) {
        const a = layer.areas.find((ar) => ar.id === areaId);
        if (a) { geoSnapshot = a.geometry; break; }
      }
    }

    svg.setPointerCapture(e.pointerId);
    drag.current = {
      type: "resize",
      startSvg: sp,
      startContent: cp,
      areaId,
      handle,
      areaGeoBefore: geoSnapshot,
    };
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    // Track cursor for tooltip positioning
    if (!svgRef.current) return;
    const svgEl = svgRef.current;
    const sp = svgPoint(e, svgEl);
    setHoverPos(sp);

    // Space-hold pan: no mouse button required — pan by pointer delta
    if (spaceHeld.current && !drag.current) {
      if (lastSpacePanPos.current) {
        const dx = sp.x - lastSpacePanPos.current.x;
        const dy = sp.y - lastSpacePanPos.current.y;
        const cur = useStore.getState().project.editor?.pan ?? { x: 0, y: 0 };
        useStore.getState().setEditorState({ pan: { x: cur.x + dx, y: cur.y + dy } });
      }
      lastSpacePanPos.current = sp;
      return;
    }
    lastSpacePanPos.current = null;

    if (!drag.current) {
      // Update polygon cursor preview
      if (activeTool === "polygon") {
        const cp = toContent(sp);
        setPolyPreview([cp.x, cp.y]);
      }
      return;
    }
    const cp = toContent(sp);
    const d = drag.current;

    if (d.type === "pan" && d.panBefore) {
      const dsvgX = sp.x - d.startSvg.x;
      const dsvgY = sp.y - d.startSvg.y;
      setEditorState({ pan: { x: d.panBefore.x + dsvgX, y: d.panBefore.y + dsvgY } });
    } else if (d.type === "draw-rect") {
      const rx = Math.min(d.startContent.x, cp.x);
      const ry = Math.min(d.startContent.y, cp.y);
      const rw = Math.abs(cp.x - d.startContent.x);
      const rh = Math.abs(cp.y - d.startContent.y);
      setPreviewRect({ x: rx, y: ry, width: rw, height: rh });
    } else if (d.type === "move" && d.areaId) {
      const dx = cp.x - d.startContent.x;
      const dy = cp.y - d.startContent.y;
      // Live-update via updateAreaGeometry using the snapshot + delta
      if (d.areaGeoBefore) {
        const newGeo = moveGeometry(d.areaGeoBefore, dx, dy);
        // Directly mutate store for smooth dragging (no undo entry mid-drag)
        useStore.setState((s) => {
          for (const v of s.project.views) {
            for (const layer of v.layers) {
              const a = layer.areas.find((ar) => ar.id === d.areaId);
              if (a) {
                (a as Area).geometry = newGeo as (typeof a)["geometry"];
                return;
              }
            }
          }
        });
      }
    } else if (d.type === "resize" && d.areaId && d.handle && d.areaGeoBefore) {
      if (d.areaGeoBefore.type !== "rect") return;
      const dx = cp.x - d.startContent.x;
      const dy = cp.y - d.startContent.y;
      const newGeo = resizeRect(d.areaGeoBefore, d.handle, dx, dy);
      useStore.setState((s) => {
        for (const v of s.project.views) {
          for (const layer of v.layers) {
            const a = layer.areas.find((ar) => ar.id === d.areaId);
            if (a) {
              (a as Area).geometry = newGeo as (typeof a)["geometry"];
              return;
            }
          }
        }
      });
    }
  }

  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current || !drag.current) { drag.current = null; return; }
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
    const cp = toContent(sp);
    const d = drag.current;
    drag.current = null;

    setIsPanning(false);

    if (d.type === "pan") {
      // If barely moved in select mode, treat as a background click → deselect
      if (activeTool === "select") {
        const dx = sp.x - d.startSvg.x;
        const dy = sp.y - d.startSvg.y;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) setSelectedAreaId(null);
      }
    } else if (d.type === "draw-rect") {
      const rx = Math.min(d.startContent.x, cp.x);
      const ry = Math.min(d.startContent.y, cp.y);
      const rw = Math.abs(cp.x - d.startContent.x);
      const rh = Math.abs(cp.y - d.startContent.y);
      setPreviewRect(null);
      if (rw > 4 && rh > 4) {
        addArea(createRectArea(rx, ry, rw, rh));
      }
    } else if (d.type === "move" && d.areaId && d.areaGeoBefore) {
      const dx = cp.x - d.startContent.x;
      const dy = cp.y - d.startContent.y;
      const finalGeo = moveGeometry(d.areaGeoBefore, dx, dy);
      useStore.getState().updateAreaGeometry(d.areaId, finalGeo);
    } else if (d.type === "resize" && d.areaId && d.handle && d.areaGeoBefore) {
      if (d.areaGeoBefore.type !== "rect") return;
      const dx = cp.x - d.startContent.x;
      const dy = cp.y - d.startContent.y;
      const finalGeo = resizeRect(d.areaGeoBefore, d.handle, dx, dy);
      useStore.getState().updateAreaGeometry(d.areaId, finalGeo);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!view) {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-500 text-sm">
        No view selected
      </div>
    );
  }

  const cursorClass =
    isPanning ? "cursor-grabbing" :
    isSpaceDown ? "cursor-grab" :
    activeTool === "rect" ? "cursor-crosshair" :
    activeTool === "polygon" ? "cursor-crosshair" :
    "cursor-default";

  // Find hovered area's tooltip for overlay
  const hoveredArea = hoveredAreaId
    ? view.layers.flatMap((l) => l.areas).find((a) => a.id === hoveredAreaId)
    : undefined;
  const showTooltip =
    hoveredArea?.tooltip?.enabled && hoveredArea.tooltip.title && hoverPos;

  return (
    <div className="relative flex-1">
      <svg
        ref={svgRef}
        tabIndex={-1}
        className={`select-none ${cursorClass}`}
        style={{ display: "block", width: "100%", height: "100%", outline: "none" }}
        onPointerDown={onSvgPointerDown}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
      >
        {/* Canvas group with pan/zoom transform */}
        <g
          style={{
            transform: `translate(calc(50% + ${panX}px), calc(50% + ${panY}px)) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* View frame */}
          <rect
            x={-view.width / 2}
            y={-view.height / 2}
            width={view.width}
            height={view.height}
            fill="white"
            stroke="#94a3b8"
            strokeWidth={1 / zoom}
          />

          {/* Background image */}
          {backgroundAsset && (
            <image
              x={-view.width / 2}
              y={-view.height / 2}
              width={view.width}
              height={view.height}
              href={backgroundAsset.src}
              preserveAspectRatio="xMidYMid meet"
            />
          )}

          {/* Areas — each layer rendered with its opacity */}
          {view.layers
            .filter((l) => l.visible)
            .map((l) => (
              <g key={l.id} opacity={l.opacity}>
                {l.areas.map((area) => (
                  <AreaShape
                    key={area.id}
                    area={area}
                    selected={selectedAreaId === area.id}
                    onPointerDown={onAreaPointerDown}
                    onHandlePointerDown={onHandlePointerDown}
                    onHoverChange={setHoveredAreaId}
                  />
                ))}
              </g>
            ))}

          {/* Rect drawing preview */}
          {previewRect && (
            <rect
              x={previewRect.x}
              y={previewRect.y}
              width={previewRect.width}
              height={previewRect.height}
              fill="rgba(59,130,246,0.1)"
              stroke="rgba(59,130,246,0.9)"
              strokeWidth={1.5 / zoom}
              strokeDasharray="4,3"
            />
          )}

          {/* Polygon in-progress */}
          {polyPts.length > 0 && (
            <>
              {polyPts.length >= 2 && (
                <polyline
                  points={polygonPointsToString([
                    ...polyPts,
                    ...(polyPreview ? [polyPreview] : []),
                  ])}
                  fill="none"
                  stroke="rgba(59,130,246,0.8)"
                  strokeWidth={1.5 / zoom}
                  strokeDasharray="4,3"
                />
              )}
              {[...polyPts, ...(polyPreview ? [polyPreview] : [])].map(([px, py], i) => (
                <circle
                  key={i}
                  cx={px}
                  cy={py}
                  r={3 / zoom}
                  fill={i === 0 ? "rgba(59,130,246,1)" : "white"}
                  stroke="rgba(59,130,246,1)"
                  strokeWidth={1.5 / zoom}
                />
              ))}
            </>
          )}
        </g>
      </svg>

      {/* Tooltip overlay */}
      {showTooltip && hoverPos && (
        <div
          className="pointer-events-none absolute z-50 max-w-48 rounded bg-neutral-800 px-2 py-1.5 text-xs shadow-lg ring-1 ring-neutral-600"
          style={{ left: hoverPos.x + 14, top: hoverPos.y + 14 }}
        >
          <div className="font-medium text-neutral-100">{hoveredArea!.tooltip!.title}</div>
          {hoveredArea!.tooltip!.body && (
            <div className="mt-0.5 text-neutral-400">{hoveredArea!.tooltip!.body}</div>
          )}
        </div>
      )}
    </div>
  );
}
