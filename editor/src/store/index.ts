import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ProjectFile, EditorState } from "@svg-mapper/shared";
import {
  createNewProject,
  parseProjectFile,
  serializeProjectFile,
  downloadJson,
} from "../lib/project";

export type Screen = "design" | "tree" | "flow" | "preview" | "export";

export interface AppState {
  project: ProjectFile;
  screen: Screen;
  openError: string | null;

  // Project lifecycle
  newProject: () => void;
  loadProject: (json: string) => void;
  saveProject: () => void;
  setProjectName: (name: string) => void;

  // Editor state helpers
  setEditorState: (patch: Partial<EditorState>) => void;

  // Screen navigation
  setScreen: (screen: Screen) => void;

  // Error handling
  clearOpenError: () => void;
}

export const useStore = create<AppState>()(
  immer((set, get) => ({
    project: createNewProject(),
    screen: "design",
    openError: null,

    newProject() {
      set((state) => {
        state.project = createNewProject();
        state.openError = null;
      });
    },

    loadProject(json: string) {
      try {
        const parsed = parseProjectFile(json);
        set((state) => {
          state.project = parsed;
          state.openError = null;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error parsing file.";
        set((state) => {
          state.openError = message;
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
      set((state) => {
        state.project.project.name = name;
      });
    },

    setEditorState(patch: Partial<EditorState>) {
      set((state) => {
        state.project.editor = {
          ...(state.project.editor ?? {
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
      set((state) => {
        state.screen = screen;
      });
    },

    clearOpenError() {
      set((state) => {
        state.openError = null;
      });
    },
  })),
);
