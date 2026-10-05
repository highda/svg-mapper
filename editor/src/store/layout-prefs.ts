import { create } from "zustand";

/**
 * Desktop workspace layout preferences (#156): side panel widths, which panels
 * are collapsed, and which inspector sections are open. Editor-only: kept in
 * this browser's localStorage, never in the project JSON, undo history, drafts
 * or exports. Storage failures (private windows, blocked site data) fall back
 * to the defaults without interrupting editing.
 */

export type DockedPanel = "tree" | "inspector";

export interface PanelPrefs {
  /** Expanded width in CSS px; kept while the panel is collapsed. */
  size: number;
  collapsed: boolean;
}

export interface LayoutPrefs {
  tree: PanelPrefs;
  inspector: PanelPrefs;
}

export const PANEL_LIMITS: Record<DockedPanel, { min: number; max: number; default: number }> = {
  tree: { min: 180, max: 440, default: 240 },
  inspector: { min: 264, max: 560, default: 304 },
};

/** DOM ids of the keyboard separators, so collapse controls can hand focus to them. */
export const SEPARATOR_IDS: Record<DockedPanel, string> = {
  tree: "workspace-separator-tree",
  inspector: "workspace-separator-inspector",
};

/** The canvas never shrinks below this while side panels are resized. */
export const CANVAS_MIN_WIDTH = 360;

export const LAYOUT_STORAGE_KEY = "svg-mapper.editor.layout.v1";
export const SECTIONS_STORAGE_KEY = "svg-mapper.editor.inspector-sections.v1";

export const DEFAULT_LAYOUT: LayoutPrefs = {
  tree: { size: PANEL_LIMITS.tree.default, collapsed: false },
  inspector: { size: PANEL_LIMITS.inspector.default, collapsed: false },
};

function clampSize(panel: DockedPanel, value: unknown): number {
  const { min, max, default: fallback } = PANEL_LIMITS[panel];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;
}

function readPanel(panel: DockedPanel, raw: unknown): PanelPrefs {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { size: clampSize(panel, record.size), collapsed: record.collapsed === true };
}

function readJson(key: string): unknown {
  try {
    const text = globalThis.localStorage?.getItem(key);
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are a convenience; editing continues with in-memory values.
  }
}

export function loadLayoutPrefs(): LayoutPrefs {
  const raw = readJson(LAYOUT_STORAGE_KEY);
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { tree: readPanel("tree", record.tree), inspector: readPanel("inspector", record.inspector) };
}

function loadSections(): Record<string, boolean> {
  const raw = readJson(SECTIONS_STORAGE_KEY);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

interface LayoutPrefsStore extends LayoutPrefs {
  /**
   * Bumped whenever a control outside the panel group (toggle, reset) asks the
   * workspace to apply the stored layout to its panels.
   */
  layoutRequest: number;
  sections: Record<string, boolean>;
  /** Records sizes/collapse that the panel group already shows (no request). */
  recordPanel: (panel: DockedPanel, patch: Partial<PanelPrefs>) => void;
  setCollapsed: (panel: DockedPanel, collapsed: boolean) => void;
  toggleCollapsed: (panel: DockedPanel) => void;
  resetLayout: () => void;
  setSectionOpen: (key: string, open: boolean) => void;
}

export const useLayoutPrefs = create<LayoutPrefsStore>()((set, get) => {
  function persist() {
    const { tree, inspector } = get();
    writeJson(LAYOUT_STORAGE_KEY, { tree, inspector });
  }
  function patchPanel(panel: DockedPanel, patch: Partial<PanelPrefs>, request: boolean) {
    const current = get()[panel];
    const next: PanelPrefs = {
      size: patch.size === undefined ? current.size : clampSize(panel, patch.size),
      collapsed: patch.collapsed ?? current.collapsed,
    };
    if (next.size === current.size && next.collapsed === current.collapsed && !request) return;
    set((state) => ({ [panel]: next, layoutRequest: request ? state.layoutRequest + 1 : state.layoutRequest }) as Partial<LayoutPrefsStore>);
    persist();
  }
  return {
    ...loadLayoutPrefs(),
    layoutRequest: 0,
    sections: loadSections(),
    recordPanel: (panel, patch) => patchPanel(panel, patch, false),
    setCollapsed: (panel, collapsed) => patchPanel(panel, { collapsed }, true),
    toggleCollapsed: (panel) => patchPanel(panel, { collapsed: !get()[panel].collapsed }, true),
    resetLayout: () => {
      set((state) => ({ ...structuredClone(DEFAULT_LAYOUT), sections: {}, layoutRequest: state.layoutRequest + 1 }));
      persist();
      writeJson(SECTIONS_STORAGE_KEY, {});
    },
    setSectionOpen: (key, open) => {
      set((state) => ({ sections: { ...state.sections, [key]: open } }));
      writeJson(SECTIONS_STORAGE_KEY, get().sections);
    },
  };
});
