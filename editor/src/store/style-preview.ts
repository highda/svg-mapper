import { create } from "zustand";

/**
 * Which authored style state the canvas shows for the selected area(s), so
 * authors can see Hover and Active (selected) without leaving Design (#214).
 * Editor-only and ephemeral: never saved, exported, or part of undo history.
 */
export type StylePreviewState = "default" | "hover" | "active";

interface StylePreviewStore {
  state: StylePreviewState;
  setState: (state: StylePreviewState) => void;
}

export const useStylePreview = create<StylePreviewStore>()((set) => ({
  state: "default",
  setState: (state) => set({ state }),
}));
