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
  e: React.PointerEvent | React.MouseEvent | React.WheelEvent,
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
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
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
      if (e.key === " ") { spaceHeld.current = false; setIsSpaceDown(false); }
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
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
    const cp = toContent(sp);

    if (spaceHeld.current || e.button === 1) {
      // Pan
      svg.setPointerCapture(e.pointerId);
      drag.current = {
        type: "pan",
        startSvg: sp,
        startContent: cp,
        panBefore: { x: panX, y: panY },
      };
      return;
    }

    if (activeTool === "select") {
      // Click on background → deselect
      setSelectedAreaId(null);
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
    if (!svgRef.current || !drag.current) {
      // Update polygon cursor preview
      if (activeTool === "polygon" && svgRef.current) {
        const sp = svgPoint(e, svgRef.current);
        const cp = toContent(sp);
        setPolyPreview([cp.x, cp.y]);
      }
      return;
    }
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
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

    if (d.type === "draw-rect") {
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

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    e.preventDefault();
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
    const { width, height } = svg.getBoundingClientRect();
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (!view) {
    return (
      <div className="flex flex-1 items-center justify-center text-neutral-500 text-sm">
        No view selected
      </div>
    );
  }

  const cursorClass =
    isSpaceDown ? "cursor-grab" :
    activeTool === "rect" ? "cursor-crosshair" :
    activeTool === "polygon" ? "cursor-crosshair" :
    "cursor-default";

  return (
    <svg
      ref={svgRef}
      className={`flex-1 select-none ${cursorClass}`}
      style={{ display: "block", width: "100%", height: "100%" }}
      onPointerDown={onSvgPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onWheel={onWheel}
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

        {/* Areas */}
        {view.layers
          .filter((l) => l.visible)
          .flatMap((l) =>
            l.areas.map((area) => (
              <AreaShape
                key={area.id}
                area={area}
                selected={selectedAreaId === area.id}
                onPointerDown={onAreaPointerDown}
                onHandlePointerDown={onHandlePointerDown}
              />
            )),
          )}

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
  );
}
