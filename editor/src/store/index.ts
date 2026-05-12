import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { current } from "immer";
import type { Area, Asset, EditorState, Layer, ProjectFile, View } from "@svg-mapper/shared";
import {
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
  activeViewId: string;

  // Undo / redo
  past: HistorySnapshot[];
  future: HistorySnapshot[];

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
  setActiveViewId: (id: string) => void;

  // ── Asset / background ───────────────────────────────────────────────────
  importAsset: (asset: Asset) => void;
  setViewBackground: (viewId: string, assetId: string) => void;

  // ── Area CRUD ────────────────────────────────────────────────────────────
  addArea: (area: Area) => void;
  moveArea: (areaId: string, dx: number, dy: number) => void;
  updateAreaGeometry: (areaId: string, geometry: Area["geometry"]) => void;
  deleteArea: (areaId: string) => void;
  duplicateArea: (areaId: string) => void;

  // ── Undo / redo ──────────────────────────────────────────────────────────
  undo: () => void;
  redo: () => void;
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>()(
  immer((set, get) => ({
    project: createNewProject(),
    screen: "design",
    openError: null,
    activeTool: "select",
    selectedAreaId: null,
    activeViewId: (() => {
      const p = createNewProject();
      return p.settings.initialViewId || p.views[0]?.id || "";
    })(),
    past: [],
    future: [],

    // ── Project lifecycle ──────────────────────────────────────────────────

    newProject() {
      const p = createNewProject();
      set((s) => {
        s.project = p;
        s.activeViewId = deriveActiveViewId(p);
        s.selectedAreaId = null;
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
      });
    },

    setActiveViewId(id: string) {
      set((s) => {
        s.activeViewId = id;
        s.selectedAreaId = null;
      });
    },

    // ── Asset / background ─────────────────────────────────────────────────

    importAsset(asset: Asset) {
      set((s) => {
        s.past.push(snapshot(s));
        s.future = [];
        s.project.assets.push(asset);
      });
    },

    setViewBackground(viewId: string, assetId: string) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === viewId);
        if (!view) return;
        s.past.push(snapshot(s));
        s.future = [];
        view.background = { assetId, fit: "contain" };
        // Ensure a default layer exists
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

    // ── Area CRUD ──────────────────────────────────────────────────────────

    addArea(area: Area) {
      set((s) => {
        const view = s.project.views.find((v) => v.id === s.activeViewId);
        if (!view) return;
        // Snapshot before any mutation so undo fully reverses this action
        s.past.push(snapshot(s));
        s.future = [];
        // Ensure a default layer
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
        view.layers[0].areas.push(area);
        s.selectedAreaId = area.id;
        s.activeTool = "select";
      });
    },

    moveArea(areaId: string, dx: number, dy: number) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        s.past.push(snapshot(s));
        s.future = [];
        const area = s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx];
        area.geometry = moveGeometry(area.geometry as Area["geometry"], dx, dy) as typeof area.geometry;
      });
    },

    updateAreaGeometry(areaId: string, geometry: Area["geometry"]) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        s.past.push(snapshot(s));
        s.future = [];
        const area = s.project.views[loc.viewIdx].layers[loc.layerIdx].areas[loc.areaIdx];
        area.geometry = geometry as typeof area.geometry;
      });
    },

    deleteArea(areaId: string) {
      set((s) => {
        const loc = findAreaLocation(s.project.views as unknown as View[], areaId);
        if (!loc) return;
        s.past.push(snapshot(s));
        s.future = [];
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
        s.past.push(snapshot(s));
        s.future = [];
        s.project.views[loc.viewIdx].layers[loc.layerIdx].areas.splice(
          loc.areaIdx + 1,
          0,
          duped,
        );
        s.selectedAreaId = duped.id;
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
      });
    },
  })),
);

// Re-export helpers used by other modules
export { ensureDefaultLayer };
