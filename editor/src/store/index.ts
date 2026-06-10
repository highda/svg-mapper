import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { current } from "immer";
import type {
  Action,
  Area,
  AreaStyle,
  Asset,
  EditorState,
  Layer,
  ProjectFile,
  Tooltip,
  ValidationRef,
  View,
  Viewport,
} from "@svg-mapper/shared";
import {
  createDefaultView,
  createNewProject,
  parseProjectFile,
  serializeProjectFile,
  downloadJson,
} from "../lib/project";
import { findAreaLocation, moveGeometry } from "../lib/area-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Screen = "design" | "tree" | "flow" | "preview" | "export";
export type Tool = "select" | "rect" | "polygon";

interface HistorySnapshot {
  views: View[];
  assets: Asset[];
}

export interface AppState {
  project: ProjectFile;
  screen: Screen;
  openError: string | null;

  // Design screen
  activeTool: Tool;
  selectedAreaId: string | null;
  selectedLayerId: string | null;
  activeViewId: string;

  // Undo / redo
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  historyVersion: number;

  // ── Project lifecycle ────────────────────────────────────────────────────
  newProject: () => void;
  loadProject: (json: string) => void;
  saveProject: () => void;
  setProjectName: (name: string) => void;
  setEditorState: (patch: Partial<EditorState>) => void;
  setScreen: (screen: Screen) => void;
  clearOpenError: () => void;

  // ── Design screen ────────────────────────────────────────────────────────
  setActiveTool: (tool: Tool) => void;
  setSelectedAreaId: (id: string | null) => void;
  setSelectedLayerId: (id: string | null) => void;
  setActiveViewId: (id: string) => void;

  // ── Asset / background ───────────────────────────────────────────────────
  importAsset: (asset: Asset) => void;
  setViewBackground: (viewId: string, assetId: string) => void;

  // ── View CRUD ────────────────────────────────────────────────────────────
  addView: () => void;
  duplicateView: (viewId: string) => void;
  renameView: (viewId: string, name: string) => void;
  deleteView: (viewId: string) => void;
  setCanvasSize: (width: number, height: number) => void;
  setViewport: (viewId: string, patch: Partial<Viewport>) => void;

  // ── Layer CRUD ───────────────────────────────────────────────────────────
  addLayer: (viewId: string) => void;
  renameLayer: (layerId: string, name: string) => void;
  deleteLayer: (layerId: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerLock: (layerId: string) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  reorderLayer: (viewId: string, fromIdx: number, toIdx: number) => void;

  // ── Area CRUD ────────────────────────────────────────────────────────────
  addArea: (area: Area) => void;
  moveArea: (areaId: string, dx: number, dy: number) => void;
  updateAreaGeometry: (areaId: string, geometry: Area["geometry"]) => void;
  renameArea: (areaId: string, name: string) => void;
  updateAreaStyle: (areaId: string, style: AreaStyle) => void;
  updateAreaTooltip: (areaId: string, tooltip: Tooltip | undefined) => void;
  updateAreaAction: (areaId: string, action: Action) => void;
  deleteArea: (areaId: string) => void;
  duplicateArea: (areaId: string) => void;

  // ── Undo / redo ──────────────────────────────────────────────────────────
  undo: () => void;
  redo: () => void;

  // ── Clipboard ────────────────────────────────────────────────────────────
  clipboardArea: Area | null;
  copyArea: (areaId: string) => void;
  pasteArea: () => void;

  // ── Validation ─────────────────────────────────────────────────────────────
  revealValidationRef: (ref: ValidationRef) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// current() extracts a plain (non-draft) copy from an immer draft,
// so the snapshot is not affected by subsequent mutations in the same set() call.
function snapshot(state: AppState): HistorySnapshot {
  return {
    views: current(state.project.views) as View[],
    assets: current(state.project.assets) as Asset[],
  };
}

// Push a history entry and bump historyVersion so inspector inputs reset.
// Call this before any mutation that should be undoable.
function pushHistory(s: AppState): void {
  s.past.push(snapshot(s));
  s.future = [];
  s.historyVersion += 1;
}

function ensureDefaultLayer(view: View): View {
  if (view.layers.length > 0) return view;
  const layer: Layer = {
    id: `layer_${Math.random().toString(36).slice(2, 10)}`,
    name: "Layer 1",
    visible: true,
    locked: false,
    opacity: 1,
    areas: [],
  };
  return { ...view, layers: [layer] };
}

function deriveActiveViewId(project: ProjectFile): string {
  return project.settings.initialViewId || project.views[0]?.id || "";
}

function findLayerInViews(
  views: ProjectFile["views"],
  layerId: string,
): { viewIdx: number; layerIdx: number } | null {
  for (let vi = 0; vi < views.length; vi++) {
    const li = views[vi].layers.findIndex((l) => l.id === layerId);
    if (li !== -1) return { viewIdx: vi, layerIdx: li };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialProject = createNewProject();

export const useStore = create<AppState>()(
  immer((set, get) => ({
    project: initialProject,
    screen: "design",
    openError: null,
    activeTool: "select",
    selectedAreaId: null,
    selectedLayerId: null,
    activeViewId: deriveActiveViewId(initialProject),
    past: [],
    future: [],
    historyVersion: 0,
    clipboardArea: null,

    // ── Project lifecycle ──────────────────────────────────────────────────

    newProject() {
      const p = createNewProject();
      set((s) => {
        s.project = p;
        s.activeViewId = deriveActiveViewId(p);
        s.selectedAreaId = null;
        s.selectedLayerId = null;
        s.activeTool = "select";
        s.past = [];
        s.future = [];
        s.openError = null;
      });
    },

    loadProject(json: string) {
      try {
        const parsed = parseProjectFile(json);
        set((s) => {
          s.project = parsed;
          s.activeViewId = deriveActiveViewId(parsed);
          s.selectedAreaId = null;
          s.selectedLayerId = null;
          s.activeTool = "select";
          s.past = [];
          s.future = [];
          s.openError = null;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error parsing file.";
        set((s) => {
          s.openError = message;
        });
      }
    },

    saveProject() {
      const { project } = get();
      const content = serializeProjectFile(project);
      const slug = project.project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      downloadJson(`${slug || "map"}.json`, content);
    },

    setProjectName(name: string) {
      set((s) => {
        s.project.project.name = name;
      });
    },

    setEditorState(patch: Partial<EditorState>) {
      set((s) => {
        s.project.editor = {
          ...(s.project.editor ?? {
            zoom: 1,
            pan: { x: 0, y: 0 },
            grid: { enabled: false, size: 10 },
            guides: [],
            history: [],
          }),
          ...patch,
        };
      });
    },

    setScreen(screen: Screen) {
      set((s) => {
        s.screen = screen;
      });
    },

    clearOpenError() {
      set((s) => {
        s.openError = null;
      });
    },

    // ── Design screen ──────────────────────────────────────────────────────

    setActiveTool(tool: Tool) {
      set((s) => {
        s.activeTool = tool;
        if (tool !== "select") s.selectedAreaId = null;
      });
    },

    setSelectedAreaId(id: string | null) {
      set((s) => {
        s.selectedAreaId = id;
        if (id !== null) s.selectedLayerId = null;
      });
    },

    setSelectedLayerId(id: string | null) {
      set((s) => {
        s.selectedLayerId = id;
        if (id !== null) s.selectedAreaId = null;
      });
    },

    setActiveViewId(id: string) {
      set((s) => {
        s.activeViewId = id;
        s.selectedAreaId = null;
        s.selectedLayerId = null;
      });
    },

    // ── Asset / background ─────────────────────────────────────────────────

    importAsset(asset: Asset) {
      set((s) => {
        pushHistory(s);
        s.project.assets.push(asset);
      });
    },

    setViewBackground(viewId: string, assetId: string) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === viewId);
        if (!view) return;
        pushHistory(s);
        view.background = { assetId, fit: "contain" };
        if (view.layers.length === 0) {
          view.layers.push({
            id: `layer_${Math.random().toString(36).slice(2, 10)}`,
            name: "Layer 1",
            visible: true,
            locked: false,
            opacity: 1,
            areas: [],
          });
        }
      });
    },

    // ── View CRUD ──────────────────────────────────────────────────────────

    addView() {
      set((s) => {
        pushHistory(s);
        const view = createDefaultView();
        view.name = `View ${s.project.views.length + 1}`;
        view.slug = view.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        s.project.views.push(view);
        s.activeViewId = view.id;
        s.selectedAreaId = null;
        s.selectedLayerId = null;
      });
    },

    duplicateView(viewId: string) {
      set((s) => {
        const idx = s.project.views.findIndex((v) => v.id === viewId);
        if (idx === -1) return;
        pushHistory(s);
        const original = current(s.project.views[idx]) as View;
        const copy: View = {
          ...original,
          id: `view_${Math.random().toString(36).slice(2, 10)}`,
          name: original.name + " copy",
          slug: (original.slug + "-copy").replace(/-+/g, "-"),
          layers: original.layers.map((l) => ({
            ...l,
            id: `layer_${Math.random().toString(36).slice(2, 10)}`,
            areas: l.areas.map((a) => ({
              ...a,
              id: `area_${Math.random().toString(36).slice(2, 10)}`,
            })),
          })),
        };
        s.project.views.splice(idx + 1, 0, copy as typeof s.project.views[0]);
        s.activeViewId = copy.id;
        s.selectedAreaId = null;
        s.selectedLayerId = null;
      });
    },

    renameView(viewId: string, name: string) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === viewId);
        if (!view) return;
        pushHistory(s);
        view.name = name;
        view.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || view.slug;
      });
    },

    deleteView(viewId: string) {
      set((s) => {
        if (s.project.views.length <= 1) return;
        const idx = s.project.views.findIndex((v) => v.id === viewId);
        if (idx === -1) return;
        pushHistory(s);
        s.project.views.splice(idx, 1);
        if (s.activeViewId === viewId) {
          const nextView = s.project.views[Math.max(0, idx - 1)];
          s.activeViewId = nextView?.id ?? s.project.views[0].id;
        }
        s.selectedAreaId = null;
        s.selectedLayerId = null;
      });
    },

    setCanvasSize(width: number, height: number) {
      set((s) => {
        pushHistory(s);
        s.project.settings.canvasSize = { width, height };
      });
    },

    setViewport(viewId: string, patch: Partial<Viewport>) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === viewId);
        if (!view) return;
        pushHistory(s);
        view.viewport = { ...view.viewport, ...patch };
      });
    },

    // ── Layer CRUD ─────────────────────────────────────────────────────────

    addLayer(viewId: string) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === viewId);
        if (!view) return;
        pushHistory(s);
        const layer: Layer = {
          id: `layer_${Math.random().toString(36).slice(2, 10)}`,
          name: `Layer ${view.layers.length + 1}`,
          visible: true,
          locked: false,
          opacity: 1,
          areas: [],
        };
        view.layers.push(layer);
        s.selectedLayerId = layer.id;
        s.selectedAreaId = null;
      });
    },

    renameLayer(layerId: string, name: string) {
      set((s) => {
        const loc = findLayerInViews(s.project.views as unknown as View[], layerId);
        if (!loc) return;
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].name = name;
      });
    },

    deleteLayer(layerId: string) {
      set((s) => {
        const loc = findLayerInViews(s.project.views as unknown as View[], layerId);
        if (!loc) return;
        const view = s.project.views[loc.viewIdx];
        if (view.layers.length <= 1) return;
        pushHistory(s);
        view.layers.splice(loc.layerIdx, 1);
        if (s.selectedLayerId === layerId) s.selectedLayerId = null;
      });
    },

    toggleLayerVisibility(layerId: string) {
      set((s) => {
        const loc = findLayerInViews(s.project.views as unknown as View[], layerId);
        if (!loc) return;
        pushHistory(s);
        const layer = s.project.views[loc.viewIdx].layers[loc.layerIdx];
        layer.visible = !layer.visible;
      });
    },

    toggleLayerLock(layerId: string) {
      set((s) => {
        const loc = findLayerInViews(s.project.views as unknown as View[], layerId);
        if (!loc) return;
        pushHistory(s);
        const layer = s.project.views[loc.viewIdx].layers[loc.layerIdx];
        layer.locked = !layer.locked;
      });
    },

    setLayerOpacity(layerId: string, opacity: number) {
      set((s) => {
        const loc = findLayerInViews(s.project.views as unknown as View[], layerId);
        if (!loc) return;
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].opacity = Math.max(
          0,
          Math.min(1, opacity),
        );
      });
    },

    reorderLayer(viewId: string, fromIdx: number, toIdx: number) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === viewId);
        if (!view) return;
        if (fromIdx === toIdx) return;
        if (fromIdx < 0 || fromIdx >= view.layers.length) return;
        if (toIdx < 0 || toIdx >= view.layers.length) return;
        pushHistory(s);
        const [moved] = view.layers.splice(fromIdx, 1);
        view.layers.splice(toIdx, 0, moved);
      });
    },

    // ── Area CRUD ──────────────────────────────────────────────────────────

    addArea(area: Area) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === s.activeViewId);
        if (!view) return;
        pushHistory(s);
        if (view.layers.length === 0) {
          view.layers.push({
            id: `layer_${Math.random().toString(36).slice(2, 10)}`,
            name: "Layer 1",
            visible: true,
            locked: false,
            opacity: 1,
            areas: [],
          });
        }
        const targetLayer =
          (s.selectedLayerId && view.layers.find((l) => l.id === s.selectedLayerId)) ||
          view.layers[0];
        targetLayer.areas.push(area);
        s.selectedAreaId = area.id;
        s.selectedLayerId = null;
        s.activeTool = "select";
      });
    },

    moveArea(areaId: string, dx: number, dy: number) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        pushHistory(s);
        const area = s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx];
        area.geometry = moveGeometry(area.geometry as Area["geometry"], dx, dy) as typeof area.geometry;
      });
    },

    updateAreaGeometry(areaId: string, geometry: Area["geometry"]) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        pushHistory(s);
        const area = s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx];
        area.geometry = geometry as typeof area.geometry;
      });
    },

    renameArea(areaId: string, name: string) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx].name = name;
      });
    },

    updateAreaStyle(areaId: string, style: AreaStyle) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx].style =
          style as unknown as typeof s.project.views[0]["layers"][0]["areas"][0]["style"];
      });
    },

    updateAreaTooltip(areaId: string, tooltip: Tooltip | undefined) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx].tooltip =
          tooltip as typeof s.project.views[0]["layers"][0]["areas"][0]["tooltip"];
      });
    },

    updateAreaAction(areaId: string, action: Action) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx].action =
          action as typeof s.project.views[0]["layers"][0]["areas"][0]["action"];
      });
    },

    deleteArea(areaId: string) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].areas.splice(loc.areaIdx, 1);
        if (s.selectedAreaId === areaId) s.selectedAreaId = null;
      });
    },

    duplicateArea(areaId: string) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        const original = s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx];
        const duped: typeof original = {
          ...original,
          id: `area_${Math.random().toString(36).slice(2, 10)}`,
          name: original.name + " copy",
          geometry:
            original.geometry.type === "rect"
              ? {
                  ...original.geometry,
                  x: (original.geometry as { x: number }).x + 10,
                  y: (original.geometry as { y: number }).y + 10,
                }
              : original.geometry,
        };
        pushHistory(s);
        s.project.views[loc.viewIdx].layers[loc.layerIdx].areas.splice(
          loc.areaIdx + 1,
          0,
          duped,
        );
        s.selectedAreaId = duped.id;
        s.selectedLayerId = null;
      });
    },

    // ── Clipboard ──────────────────────────────────────────────────────────

    copyArea(areaId: string) {
      const views = get().project.views as unknown as View[];
      const loc = findAreaLocation(views, areaId);
      if (!loc) return;
      const area = views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx];
      set((s) => {
        s.clipboardArea = area as typeof s.clipboardArea;
      });
    },

    pasteArea() {
      set((s) => {
        if (!s.clipboardArea) return;
        const original = s.clipboardArea;
        const pasted: typeof original = {
          ...original,
          id: `area_${Math.random().toString(36).slice(2, 10)}`,
          name: original.name + " copy",
          geometry:
            original.geometry.type === "rect"
              ? { ...original.geometry, x: (original.geometry as { x: number }).x + 10, y: (original.geometry as { y: number }).y + 10 }
              : original.geometry,
        };
        const viewIdx = s.project.views.findIndex((v) => v.id === s.activeViewId);
        if (viewIdx === -1) return;
        const layers = s.project.views[viewIdx].layers;
        if (layers.length === 0) return;
        pushHistory(s);
        layers[0].areas.push(pasted as typeof layers[0]["areas"][0]);
        s.selectedAreaId = pasted.id;
        s.selectedLayerId = null;
      });
    },

    // ── Undo / redo ────────────────────────────────────────────────────────

    undo() {
      set((s) => {
        const prev = s.past.pop();
        if (!prev) return;
        s.future.push(snapshot(s));
        s.project.views = prev.views as typeof s.project.views;
        s.project.assets = prev.assets;
        s.selectedAreaId = null;
        s.selectedLayerId = null;
        s.historyVersion += 1;
      });
    },

    redo() {
      set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.past.push(snapshot(s));
        s.project.views = next.views as typeof s.project.views;
        s.project.assets = next.assets;
        s.selectedAreaId = null;
        s.selectedLayerId = null;
        s.historyVersion += 1;
      });
    },

    // ── Validation ───────────────────────────────────────────────────────────

    revealValidationRef(ref: ValidationRef) {
      set((s) => {
        s.screen = "design";
        if (ref.viewId && s.project.views.some((v) => v.id === ref.viewId)) {
          s.activeViewId = ref.viewId;
        }
        if (ref.areaId) {
          s.selectedAreaId = ref.areaId;
          s.selectedLayerId = null;
        } else if (ref.layerId) {
          s.selectedLayerId = ref.layerId;
          s.selectedAreaId = null;
        } else {
          s.selectedAreaId = null;
          s.selectedLayerId = null;
        }
      });
    },
  })),
);

// Re-export helpers used by other modules
export { ensureDefaultLayer };
