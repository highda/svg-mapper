import { useCallback, useEffect, useRef, useState } from "react";
import type { Area, CircleGeometry, ProjectFile } from "@svg-mapper/shared";
import { assetDisplaySource, fitImageRect, geometryBounds } from "@svg-mapper/shared";
import { canEditGeometry, useStore } from "../../store";
import { AreaShape } from "./AreaShape";
import { VertexHandles } from "./VertexHandles";
import { activeVertexIndex, useVertexSelection } from "../../store/vertex-selection";
import { isActivatableTarget, shouldIgnoreShortcut } from "../../lib/shortcut-guard";
import {
  createRectArea,
  createPolygonArea,
  createCircleArea,
  createMarkerArea,
  polygonPointsToString,
  resizeMarker,
  resizeRect,
  resizePathToBounds,
  moveGeometry,
  snapGeometryToGrid,
  snapValue,
  getGeometryBbox,
  calculateZoomToFit,
  type RectHandle,
} from "../../lib/area-utils";
import {
  edgeMidpoints,
  editableVertices,
  insertVertex,
  minVertexCount,
  moveVertex,
  removeVertex,
  snapPoint,
  type Point,
} from "../../lib/vertex-edit";

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

/** Label anchor: the centre of the same bounds the renderer uses. */
function areaCenter(area: Area, icons: ProjectFile["icons"]): { x: number; y: number; width: number } | null {
  const b = geometryBounds(area.geometry, icons);
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width } : null;
}

type StoreState = ReturnType<typeof useStore.getState>;

/**
 * The area whose vertices can be edited right now (#176): the single selected
 * area in the active view, on a visible layer, with editable geometry that has
 * vertices. Locked layers and position-locked images never qualify (#164).
 */
function findVertexEditTarget(state: Pick<StoreState, "project" | "activeViewId" | "selectedAreaIds" | "activeTool">): { area: Area; vertices: Point[] } | null {
  if (state.activeTool !== "select" || state.selectedAreaIds.length !== 1) return null;
  const view = state.project.views.find((candidate) => candidate.id === state.activeViewId);
  for (const layer of view?.layers ?? []) {
    const area = layer.areas.find((candidate) => candidate.id === state.selectedAreaIds[0]);
    if (!area) continue;
    if (!layer.visible || !canEditGeometry(layer, area)) return null;
    const vertices = editableVertices(area.geometry as Area["geometry"]);
    return vertices ? { area: area as Area, vertices } : null;
  }
  return null;
}

// ── Canvas ───────────────────────────────────────────────────────────────────

export function Canvas() {
  const {
    project,
    activeViewId,
    activeTool,
    selectedAreaId,
    selectedAreaIds,
    setActiveTool,
    setSelectedAreaId,
    setSelectedAreaIds,
    toggleSelectedAreaId,
    addArea,
    deleteArea,
    duplicateArea,
    duplicateAreas,
    moveAreas,
    undo,
    redo,
    copyArea,
    pasteArea,
    setEditorState,
  } = useStore();

  const editorState = project.editor;
  const panX = editorState?.pan.x ?? 0;
  const panY = editorState?.pan.y ?? 0;
  const zoom = editorState?.zoom ?? 1;
  const grid = editorState?.grid ?? { enabled: false, size: 10 };

  const snapGeometry = useCallback(
    (geometry: Area["geometry"]) => grid.enabled ? snapGeometryToGrid(geometry, grid.size) : geometry,
    [grid.enabled, grid.size],
  );

  /**
   * Corner-handle resize. Rectangles resize directly; a path is stretched so
   * its bounds fill the resized (and grid-snapped) box (#218).
   */
  const resizedGeometry = (before: Area["geometry"], handle: RectHandle, dx: number, dy: number): Area["geometry"] | null => {
    if (before.type === "rect") return snapGeometry(resizeRect(before, handle, dx, dy));
    // A marker keeps its anchor point and aspect ratio; only its size changes (#219).
    if (before.type === "marker") return resizeMarker(before, project.icons, handle, dx, dy);
    if (before.type !== "path") return null;
    const bounds = getGeometryBbox(before);
    if (!bounds) return null;
    const box = snapGeometry(resizeRect({ type: "rect", ...bounds }, handle, dx, dy));
    return box.type === "rect" ? resizePathToBounds(before, box) : null;
  };

  const svgRef = useRef<SVGSVGElement>(null);

  // Polygon in-progress vertices (local state — transient)
  const [polyPts, setPolyPts] = useState<[number, number][]>([]);
  const [polyPreview, setPolyPreview] = useState<[number, number] | null>(null);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  // Circle drawing preview
  const [circlePreview, setCirclePreview] = useState<{ cx: number; cy: number; r: number } | null>(null);
  // Explains a refused vertex removal (minimum vertex count) without a modal.
  const [vertexNotice, setVertexNotice] = useState<{ areaId: string; text: string } | null>(null);
  const vertexSelection = useVertexSelection();

  // Tooltip hover state
  const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Last pointer position for space-hold panning (no click required)
  const lastSpacePanPos = useRef<{ x: number; y: number } | null>(null);

  // Drag state (refs to avoid re-renders during drag)
  const drag = useRef<{
    type: "pan" | "marquee" | "move" | "draw-rect" | "resize" | "draw-circle" | "resize-circle" | "vertex";
    startSvg: { x: number; y: number };
    startContent: { x: number; y: number };
    areaId?: string;
    handle?: RectHandle;
    areaGeoBefore?: Area["geometry"];
    areaGeometriesBefore?: Array<{ id: string; geometry: Area["geometry"] }>;
    /** Every area the move was requested for, locked ones included (#164). */
    movingIds?: string[];
    panBefore?: { x: number; y: number };
    previewRect?: { x: number; y: number; width: number; height: number } | null;
    selectionBefore?: string[];
    /** Vertex drag (#176): the vertex index being placed and where it started. */
    vertexIndex?: number;
    vertexStart?: Point;
    /** Set when the drag began on an edge midpoint: the edge that gains a vertex. */
    insertEdge?: number;
  } | null>(null);

  const spaceHeld = useRef(false);
  // Lets the window key/blur listeners cancel the drag owned by pointer handlers.
  const cancelDragRef = useRef<() => void>(() => {});

  const view = project.views.find((v) => v.id === activeViewId);
  const canvasWidth = Number(view?.canvas.width ?? 1);
  const canvasHeight = Number(view?.canvas.height ?? 1);
  const canvasSize = { width: canvasWidth, height: canvasHeight };
  const backgroundAsset = view?.background
    ? project.assets.find((a) => a.id === view.background!.assetId)
    : undefined;
  const backgroundFit = view?.background?.fit ?? "contain";
  const backgroundRect = backgroundAsset
    ? fitImageRect(canvasSize, backgroundAsset, backgroundFit, view?.background?.position)
    : null;

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
      if (shouldIgnoreShortcut(e)) return;

      // While a pointer drag is active, Escape abandons it and other editing
      // shortcuts wait, so undo or delete never interleave with a drag (#163).
      if (drag.current && drag.current.type !== "pan") {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelDragRef.current();
        }
        return;
      }

      // Ctrl/Cmd commands first, so Ctrl+C never reaches the C (circle) tool.
      // Only handled commands prevent the browser default.
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "d" && selectedAreaId) {
          e.preventDefault();
          if (selectedAreaIds.length > 1) duplicateAreas(selectedAreaIds);
          else duplicateArea(selectedAreaId);
        } else if (key === "c" && selectedAreaId && !e.shiftKey && !e.altKey) {
          // Leave native copy alone when nothing is selected or text is selected.
          if (window.getSelection()?.toString()) return;
          e.preventDefault();
          copyArea(selectedAreaId);
        } else if (key === "v" && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          pasteArea();
        } else if (key === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
        } else if (key === "z") {
          e.preventDefault();
          undo();
        }
        return;
      }
      if (e.altKey) return;

      if (e.key === " ") {
        // Space activates a focused button or link; it only pans from the workspace.
        if (isActivatableTarget(e)) return;
        spaceHeld.current = true;
        setIsSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (handleVertexKey(e)) return;
      if (e.key === "v" || e.key === "V") { setActiveTool("select"); return; }
      if (e.key === "r" || e.key === "R") { setActiveTool("rect"); return; }
      if (e.key === "p" || e.key === "P") { setActiveTool("polygon"); return; }
      if (e.key === "c" || e.key === "C") { setActiveTool("circle"); return; }
      if (e.key === "m" || e.key === "M") { setActiveTool("marker"); return; }
      if (e.key === "g" || e.key === "G") {
        const grid = useStore.getState().project.editor?.grid;
        setEditorState({ grid: { enabled: !(grid?.enabled ?? false), size: grid?.size ?? 10 } });
        return;
      }
      if (e.key === "f" || e.key === "F") {
        // Zoom to fit selection or canvas
        const svg = svgRef.current;
        if (!svg) return;
        const { width: svgW, height: svgH } = svg.getBoundingClientRect();
        const { selectedAreaId: saId, project: proj } = useStore.getState();
        const cv = proj.views.find((candidate) => candidate.id === useStore.getState().activeViewId)?.canvas ?? { width: 1, height: 1 };
        let bounds = { x: 0, y: 0, width: cv.width, height: cv.height };
        if (saId) {
          const selectedArea = proj.views
            .flatMap((candidateView) => candidateView.layers)
            .flatMap((layer) => layer.areas)
            .find((area) => area.id === saId);
          const selectedBounds = selectedArea ? getGeometryBbox(selectedArea.geometry, useStore.getState().project.icons) : null;
          if (selectedBounds) bounds = selectedBounds;
        }
        setEditorState(calculateZoomToFit(bounds, cv, { width: svgW, height: svgH }));
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedAreaId) {
        deleteArea(selectedAreaId);
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
    // A Space released outside the window never sends keyup; drop the pan state.
    function onBlur() {
      cancelDragRef.current();
      spaceHeld.current = false;
      setIsSpaceDown(false);
      lastSpacePanPos.current = null;
    }
    /**
     * Keyboard editing of the active vertex (#176): arrows nudge it (Shift for
     * 10 units, the grid step while snapping), Delete removes it, Escape lets
     * go of it. Each key press is one undo entry. Returns true when handled.
     */
    function handleVertexKey(e: KeyboardEvent): boolean {
      const state = useStore.getState();
      const target = findVertexEditTarget(state);
      if (!target) return false;
      const index = activeVertexIndex(useVertexSelection.getState(), target.area.id, target.vertices.length);
      if (index === null) return false;
      const geo = target.area.geometry;
      if (e.key === "Escape") {
        useVertexSelection.getState().clear();
        setVertexNotice(null);
        return true;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const next = removeVertex(geo, index);
        if (!next) {
          setVertexNotice({ areaId: target.area.id, text: `A polygon needs at least ${minVertexCount(geo)} points, so this point stays. Add a point first, or press Escape and then Delete to remove the whole area.` });
          return true;
        }
        setVertexNotice(null);
        state.updateAreaGeometry(target.area.id, next);
        useVertexSelection.getState().select(target.area.id, Math.max(0, index - 1));
        return true;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dir = arrows[e.key];
      // Arrows belong to the canvas only; list and tree widgets keep theirs.
      const keyTarget = e.target instanceof Element ? e.target : null;
      const onCanvas = !keyTarget || keyTarget === document.body || (svgRef.current?.parentElement?.contains(keyTarget) ?? false);
      if (!dir || !onCanvas) return false;
      e.preventDefault();
      const grid = state.project.editor?.grid;
      const step = grid?.enabled ? grid.size : e.shiftKey ? 10 : 1;
      const from = target.vertices[index]!;
      const next = moveVertex(geo, index, snapPoint({ x: from.x + dir[0] * step, y: from.y + dir[1] * step }, grid));
      if (next) state.updateAreaGeometry(target.area.id, next);
      return true;
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    activeTool,
    selectedAreaId,
    selectedAreaIds,
    polyPts,
    zoom,
    setActiveTool,
    setSelectedAreaId,
    setIsSpaceDown,
    addArea,
    deleteArea,
    duplicateArea,
    duplicateAreas,
    moveAreas,
    copyArea,
    pasteArea,
    undo,
    redo,
    setEditorState,
    panX,
    panY,
    canvasWidth,
    canvasHeight,
  ]);

  // ── Pointer events ────────────────────────────────────────────────────────

  const [previewRect, setPreviewRect] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);

  function toContent(svgPt: { x: number; y: number }) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = contentPoint(svgPt, svg, panX, panY, zoom);
    // Shift from centered-canvas space to view-local space (0,0 = view top-left).
    // The renderer's SVG viewBox uses top-left origin; areas must match.
    return { x: pt.x + canvasWidth / 2, y: pt.y + canvasHeight / 2 };
  }

  // A transform drag (move/resize) previews geometry directly in the store
  // without history. Its pointerdown baseline is restored before the single
  // committed edit, or on cancel, so one drag is one undo entry (#163).
  function restoreDragBaseline(d: NonNullable<typeof drag.current>) {
    const baseline = d.areaGeometriesBefore;
    if (!baseline?.length) return;
    useStore.setState((s) => {
      for (const v of s.project.views) for (const layer of v.layers) for (const area of layer.areas) {
        const entry = baseline.find((candidate) => candidate.id === area.id);
        if (entry) (area as Area).geometry = entry.geometry as typeof area.geometry;
      }
    });
  }

  /** Abandon the active drag: roll back previewed geometry and clear transient state. */
  function cancelDrag() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    restoreDragBaseline(d);
    if (d.type === "marquee") setMarqueeRect(null);
    if (d.type === "draw-rect") setPreviewRect(null);
    if (d.type === "draw-circle") setCirclePreview(null);
    setIsPanning(false);
  }
  useEffect(() => {
    cancelDragRef.current = cancelDrag;
  });

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
      // Background drag selects intersecting regions. Space/middle-button pans.
      svg.setPointerCapture(e.pointerId);
      drag.current = {
        type: "marquee",
        startSvg: sp,
        startContent: cp,
        selectionBefore: e.shiftKey ? selectedAreaIds : [],
      };
      setMarqueeRect({ x: cp.x, y: cp.y, width: 0, height: 0 });
    } else if (activeTool === "rect") {
      svg.setPointerCapture(e.pointerId);
      drag.current = {
        type: "draw-rect",
        startSvg: sp,
        startContent: cp,
      };
      setPreviewRect({ x: cp.x, y: cp.y, width: 0, height: 0 });
    } else if (activeTool === "circle") {
      svg.setPointerCapture(e.pointerId);
      drag.current = { type: "draw-circle", startSvg: sp, startContent: cp };
      setCirclePreview({ cx: cp.x, cy: cp.y, r: 0 });
    } else if (activeTool === "polygon") {
      setPolyPts((pts) => [...pts, [
        grid.enabled ? snapValue(cp.x, grid.size) : cp.x,
        grid.enabled ? snapValue(cp.y, grid.size) : cp.y,
      ]]);
    } else if (activeTool === "marker") {
      const x = grid.enabled ? snapValue(cp.x, grid.size) : cp.x;
      const y = grid.enabled ? snapValue(cp.y, grid.size) : cp.y;
      addArea(createMarkerArea(x, y));
    }
  }

  function onAreaPointerDown(e: React.PointerEvent, areaId: string) {
    if (activeTool !== "select" || spaceHeld.current) return;
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const sp = svgPoint(e, svg);
    const cp = toContent(sp);

    if (e.shiftKey) {
      toggleSelectedAreaId(areaId);
      return;
    }
    const movingIds = selectedAreaIds.includes(areaId) ? selectedAreaIds : [areaId];
    if (!selectedAreaIds.includes(areaId)) setSelectedAreaId(areaId);

    // Find the area geometry for drag baseline
    let geoSnapshot: Area["geometry"] | undefined;
    for (const view of project.views) {
      for (const layer of view.layers) {
        const a = layer.areas.find((ar) => ar.id === areaId);
        if (a) { geoSnapshot = a.geometry; break; }
      }
    }
    // Locked layers and position-locked images never enter the preview, so
    // their geometry is untouched for the whole drag (#164).
    const geometrySnapshots: Array<{ id: string; geometry: Area["geometry"] }> = [];
    for (const view of project.views) {
      if (view.id !== activeViewId) continue;
      for (const layer of view.layers) {
        for (const area of layer.areas) {
          if (movingIds.includes(area.id) && canEditGeometry(layer, area)) {
            geometrySnapshots.push({ id: area.id, geometry: area.geometry });
          }
        }
      }
    }

    svg.setPointerCapture(e.pointerId);
    drag.current = {
      type: "move",
      startSvg: sp,
      startContent: cp,
      areaId,
      areaGeoBefore: geoSnapshot,
      areaGeometriesBefore: geometrySnapshots,
      movingIds,
    };
  }

  /** Resize handles act only on areas whose geometry is editable (#164). */
  function isGeometryEditable(areaId: string): boolean {
    for (const candidateView of project.views) {
      for (const layer of candidateView.layers) {
        const area = layer.areas.find((candidate) => candidate.id === areaId);
        if (area) return canEditGeometry(layer, area);
      }
    }
    return false;
  }

  function onHandlePointerDown(e: React.PointerEvent, areaId: string, handle: RectHandle) {
    if (!svgRef.current || !isGeometryEditable(areaId)) return;
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
      areaGeometriesBefore: geoSnapshot ? [{ id: areaId, geometry: geoSnapshot }] : [],
    };
  }

  function onCircleHandlePointerDown(e: React.PointerEvent, areaId: string) {
    if (!svgRef.current || !isGeometryEditable(areaId)) return;
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
      type: "resize-circle",
      startSvg: sp,
      startContent: cp,
      areaId,
      areaGeoBefore: geoSnapshot,
      areaGeometriesBefore: geoSnapshot ? [{ id: areaId, geometry: geoSnapshot }] : [],
    };
  }

  /**
   * A vertex handle drag moves one vertex; a midpoint handle drag inserts a
   * vertex on that edge and places it. Either previews without history and
   * commits once on release, so one gesture is one undo entry (#176).
   */
  function startVertexDrag(e: React.PointerEvent, areaId: string, index: number, insertEdge?: number) {
    const svg = svgRef.current;
    if (!svg || spaceHeld.current) return;
    const target = findVertexEditTarget(useStore.getState());
    if (!target || target.area.id !== areaId) return;
    const geo = target.area.geometry;
    const start = insertEdge === undefined ? target.vertices[index] : edgeMidpoints(geo)[insertEdge];
    if (!start) return;
    const sp = svgPoint(e, svg);
    // Keep keyboard focus on the canvas so arrows and Delete reach the vertex.
    svg.focus();
    svg.setPointerCapture(e.pointerId);
    if (insertEdge === undefined) useVertexSelection.getState().select(areaId, index);
    setVertexNotice(null);
    drag.current = {
      type: "vertex",
      startSvg: sp,
      startContent: toContent(sp),
      areaId,
      areaGeoBefore: geo,
      areaGeometriesBefore: [{ id: areaId, geometry: geo }],
      vertexIndex: index,
      vertexStart: start,
      insertEdge,
    };
  }

  function onVertexPointerDown(e: React.PointerEvent, areaId: string, index: number) {
    startVertexDrag(e, areaId, index);
  }

  function onMidpointPointerDown(e: React.PointerEvent, areaId: string, edgeIndex: number) {
    startVertexDrag(e, areaId, edgeIndex + 1, edgeIndex);
  }

  /** The geometry a vertex drag produces with the pointer at `sp`, or null for no edit. */
  function vertexDragGeometry(d: NonNullable<typeof drag.current>, sp: { x: number; y: number }): Area["geometry"] | null {
    if (!d.areaGeoBefore || d.vertexIndex === undefined || !d.vertexStart) return null;
    // A press on a vertex that barely moves only picks it.
    const moved = Math.abs(sp.x - d.startSvg.x) >= 3 || Math.abs(sp.y - d.startSvg.y) >= 3;
    if (!moved && d.insertEdge === undefined) return null;
    const cp = toContent(sp);
    const point = snapPoint(moved
      ? { x: d.vertexStart.x + cp.x - d.startContent.x, y: d.vertexStart.y + cp.y - d.startContent.y }
      : d.vertexStart, grid);
    return d.insertEdge === undefined
      ? moveVertex(d.areaGeoBefore, d.vertexIndex, point)
      : insertVertex(d.areaGeoBefore, d.insertEdge, point);
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
    } else if (d.type === "marquee") {
      setMarqueeRect({
        x: Math.min(d.startContent.x, cp.x),
        y: Math.min(d.startContent.y, cp.y),
        width: Math.abs(cp.x - d.startContent.x),
        height: Math.abs(cp.y - d.startContent.y),
      });
    } else if (d.type === "draw-rect") {
      const rx = Math.min(d.startContent.x, cp.x);
      const ry = Math.min(d.startContent.y, cp.y);
      const rw = Math.abs(cp.x - d.startContent.x);
      const rh = Math.abs(cp.y - d.startContent.y);
      setPreviewRect({ x: rx, y: ry, width: rw, height: rh });
    } else if (d.type === "move" && d.areaId) {
      const dx = cp.x - d.startContent.x;
      const dy = cp.y - d.startContent.y;
      if (d.areaGeometriesBefore?.length) {
        // Directly mutate store for smooth dragging (no undo entry mid-drag)
        useStore.setState((s) => {
          for (const v of s.project.views) {
            for (const layer of v.layers) {
              for (const area of layer.areas) {
                const baseline = d.areaGeometriesBefore!.find((entry) => entry.id === area.id);
                if (baseline) {
                  (area as Area).geometry = moveGeometry(baseline.geometry, dx, dy) as typeof area.geometry;
                }
              }
            }
          }
        });
      }
    } else if (d.type === "resize" && d.areaId && d.handle && d.areaGeoBefore) {
      const newGeo = resizedGeometry(d.areaGeoBefore, d.handle, cp.x - d.startContent.x, cp.y - d.startContent.y);
      if (!newGeo) return;
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
    } else if (d.type === "vertex" && d.areaId) {
      const preview = vertexDragGeometry(d, sp) ?? d.areaGeoBefore;
      if (!preview) return;
      useStore.setState((s) => {
        for (const v of s.project.views) {
          for (const layer of v.layers) {
            const a = layer.areas.find((ar) => ar.id === d.areaId);
            if (a) {
              (a as Area).geometry = preview as (typeof a)["geometry"];
              return;
            }
          }
        }
      });
    } else if (d.type === "draw-circle") {
      const r = Math.sqrt(
        Math.pow(cp.x - d.startContent.x, 2) + Math.pow(cp.y - d.startContent.y, 2)
      );
      setCirclePreview({ cx: d.startContent.x, cy: d.startContent.y, r });
    } else if (d.type === "resize-circle" && d.areaId && d.areaGeoBefore) {
      if (d.areaGeoBefore.type !== "circle") return;
      const geo = d.areaGeoBefore as CircleGeometry & { type: "circle" };
      const newR = grid.enabled ? Math.max(grid.size, snapValue(cp.x - geo.cx, grid.size)) : Math.max(1, cp.x - geo.cx);
      useStore.setState((s) => {
        for (const v of s.project.views) {
          for (const layer of v.layers) {
            const a = layer.areas.find((ar) => ar.id === d.areaId);
            if (a) {
              (a as Area).geometry = { ...geo, r: newR } as (typeof a)["geometry"];
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
      // Panning is handled continuously above.
    } else if (d.type === "marquee") {
      const x = Math.min(d.startContent.x, cp.x);
      const y = Math.min(d.startContent.y, cp.y);
      const width = Math.abs(cp.x - d.startContent.x);
      const height = Math.abs(cp.y - d.startContent.y);
      setMarqueeRect(null);
      if (Math.abs(sp.x - d.startSvg.x) < 4 && Math.abs(sp.y - d.startSvg.y) < 4) {
        setSelectedAreaIds(d.selectionBefore ?? []);
      } else {
        if (!view) return;
        const hits = view.layers
          .filter((layer) => layer.visible)
          .flatMap((layer) => layer.areas)
          .filter((area) => {
            const bounds = getGeometryBbox(area.geometry, project.icons);
            return bounds !== null
              && bounds.x <= x + width && bounds.x + bounds.width >= x
              && bounds.y <= y + height && bounds.y + bounds.height >= y;
          })
          .map((area) => area.id);
        setSelectedAreaIds([...(d.selectionBefore ?? []), ...hits]);
      }
    } else if (d.type === "draw-rect") {
      const rx = Math.min(d.startContent.x, cp.x);
      const ry = Math.min(d.startContent.y, cp.y);
      const rw = Math.abs(cp.x - d.startContent.x);
      const rh = Math.abs(cp.y - d.startContent.y);
      setPreviewRect(null);
      if (rw > 4 && rh > 4) {
        const area = createRectArea(rx, ry, rw, rh);
        area.geometry = snapGeometry(area.geometry);
        addArea(area);
      }
    } else if (d.type === "move" && d.movingIds?.length) {
      const dx = grid.enabled ? snapValue(cp.x - d.startContent.x, grid.size) : cp.x - d.startContent.x;
      const dy = grid.enabled ? snapValue(cp.y - d.startContent.y, grid.size) : cp.y - d.startContent.y;
      restoreDragBaseline(d);
      // The store skips locked areas itself and reports them in one notice.
      useStore.getState().moveAreas(d.movingIds, dx, dy);
    } else if (d.type === "resize" && d.areaId && d.handle && d.areaGeoBefore) {
      const finalGeo = resizedGeometry(d.areaGeoBefore, d.handle, cp.x - d.startContent.x, cp.y - d.startContent.y);
      if (!finalGeo) return;
      restoreDragBaseline(d);
      useStore.getState().updateAreaGeometry(d.areaId, finalGeo);
    } else if (d.type === "draw-circle") {
      const r = Math.sqrt(
        Math.pow(cp.x - d.startContent.x, 2) + Math.pow(cp.y - d.startContent.y, 2)
      );
      setCirclePreview(null);
      if (r > 4) {
        const area = createCircleArea(d.startContent.x, d.startContent.y, r);
        area.geometry = snapGeometry(area.geometry);
        addArea(area);
      }
    } else if (d.type === "resize-circle" && d.areaId && d.areaGeoBefore) {
      if (d.areaGeoBefore.type !== "circle") return;
      const geo = d.areaGeoBefore as CircleGeometry & { type: "circle" };
      const newR = grid.enabled ? Math.max(grid.size, snapValue(cp.x - geo.cx, grid.size)) : Math.max(1, cp.x - geo.cx);
      restoreDragBaseline(d);
      useStore.getState().updateAreaGeometry(d.areaId, { ...geo, r: newR });
    } else if (d.type === "vertex" && d.areaId) {
      const finalGeo = vertexDragGeometry(d, sp);
      restoreDragBaseline(d);
      if (!finalGeo) return;
      useStore.getState().updateAreaGeometry(d.areaId, finalGeo);
      if (d.insertEdge !== undefined && d.vertexIndex !== undefined) {
        useVertexSelection.getState().select(d.areaId, d.vertexIndex);
      }
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
    activeTool === "circle" ? "cursor-crosshair" :
    activeTool === "marker" ? "cursor-crosshair" :
    "cursor-default";

  // Find hovered area's tooltip for overlay
  const hoveredArea = hoveredAreaId
    ? view.layers.flatMap((l) => l.areas).find((a) => a.id === hoveredAreaId)
    : undefined;
  const showTooltip =
    hoveredArea?.tooltip?.enabled && hoveredArea.tooltip.title && hoverPos;

  const vertexTarget = findVertexEditTarget({ project, activeViewId, selectedAreaIds, activeTool });

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
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
      >
        {/* Canvas group with pan/zoom transform */}
        <g
          style={{
            // Offset so view top-left (0,0) is visually centered when pan=0.
            transform: `translate(calc(50% + ${panX - zoom * canvasSize.width / 2}px), calc(50% + ${panY - zoom * canvasSize.height / 2}px)) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {grid.enabled && grid.size > 0 && (
            <defs>
              <pattern id="clickmap-grid-pattern" width={grid.size} height={grid.size} patternUnits="userSpaceOnUse">
                <circle cx={0} cy={0} r={1 / zoom} fill="#94a3b8" opacity="0.55" />
              </pattern>
            </defs>
          )}
          {/* View frame */}
          <rect
            x={0}
            y={0}
            width={canvasSize.width}
            height={canvasSize.height}
            fill="white"
            stroke="#94a3b8"
            strokeWidth={1 / zoom}
          />
          {grid.enabled && grid.size > 0 && (
            <rect
              className="clickmap-grid"
              x={0}
              y={0}
              width={canvasSize.width}
              height={canvasSize.height}
              fill="url(#clickmap-grid-pattern)"
              pointerEvents="none"
            />
          )}

          {/* Background image, clipped to the view frame like the renderer */}
          {backgroundAsset && backgroundRect && (
            <>
              <clipPath id="clickmap-view-frame">
                <rect x={0} y={0} width={canvasSize.width} height={canvasSize.height} />
              </clipPath>
              <image
                className="clickmap-editor-bg"
                x={backgroundRect.x}
                y={backgroundRect.y}
                width={backgroundRect.width}
                height={backgroundRect.height}
                href={assetDisplaySource(backgroundAsset.src)}
                preserveAspectRatio="none"
                clipPath="url(#clickmap-view-frame)"
                pointerEvents="none"
              />
            </>
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
                    selected={selectedAreaIds.includes(area.id)}
                    geometryLocked={!canEditGeometry(l, area)}
                    zoom={zoom}
                    onPointerDown={onAreaPointerDown}
                    onHandlePointerDown={onHandlePointerDown}
                    onCircleHandlePointerDown={onCircleHandlePointerDown}
                    onHoverChange={setHoveredAreaId}
                  />
                ))}
              </g>
            ))}

          {project.settings.areaLabels?.enabled && (
            <g className="clickmap-area-labels" pointerEvents="none">
              {view.layers.filter((layer) => layer.visible).flatMap((layer) =>
                layer.areas.map((area) => {
                  if (area.label?.visible === false) return null;
                  const center = areaCenter(area, project.icons);
                  if (!center) return null;
                  const settings = project.settings.areaLabels!;
                  const fontSize = settings.fontSize ?? 14;
                  const text = area.label?.text ?? area.name;
                  const hidden = settings.hideWhenSmaller !== false && text.length * fontSize * 0.6 > center.width;
                  return (
                    <text
                      key={`label-${area.id}`}
                      className="clickmap-area-label"
                      x={center.x}
                      y={center.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={settings.color ?? "#000000"}
                      fontSize={fontSize}
                      fontWeight={settings.fontWeight ?? "normal"}
                      visibility={hidden ? "hidden" : "visible"}
                      pointerEvents="none"
                    >
                      {text}
                    </text>
                  );
                }),
              )}
            </g>
          )}

          {/* Vertex handles of the selected polygon, above every area (#176) */}
          {vertexTarget && (
            <VertexHandles
              areaId={vertexTarget.area.id}
              vertices={vertexTarget.vertices}
              midpoints={edgeMidpoints(vertexTarget.area.geometry)}
              activeIndex={activeVertexIndex(vertexSelection, vertexTarget.area.id, vertexTarget.vertices.length)}
              zoom={zoom}
              onVertexPointerDown={onVertexPointerDown}
              onMidpointPointerDown={onMidpointPointerDown}
            />
          )}

          {/* Rect drawing preview */}
          {marqueeRect && (
            <rect
              data-testid="selection-marquee"
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              fill="rgba(59,130,246,0.12)"
              stroke="#3b82f6"
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              pointerEvents="none"
            />
          )}

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

          {/* Circle drawing preview */}
          {circlePreview && circlePreview.r > 0 && (
            <circle
              cx={circlePreview.cx}
              cy={circlePreview.cy}
              r={circlePreview.r}
              fill="rgba(59,130,246,0.1)"
              stroke="rgba(59,130,246,0.9)"
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${4 / zoom},${3 / zoom}`}
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

      {vertexNotice && vertexNotice.areaId === vertexTarget?.area.id && (
        <div role="status" data-testid="vertex-notice" className="pointer-events-none absolute inset-x-0 bottom-12 z-10 flex justify-center px-2">
          <p className="max-w-md rounded bg-neutral-800/95 px-3 py-1.5 text-xs text-neutral-200 shadow-lg ring-1 ring-neutral-600">{vertexNotice.text}</p>
        </div>
      )}

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
