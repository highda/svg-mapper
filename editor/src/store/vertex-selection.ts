import { create } from "zustand";

/**
 * The vertex the author last picked on the selected polygon (#176), shared by
 * the canvas handles and the Inspector's vertex list. Editor-only and
 * ephemeral: never saved, exported, or part of undo history. Consumers treat it
 * as active only while `areaId` is the single selected area and `index` is in
 * range, so a stale entry after undo or reselection is simply ignored.
 */
interface VertexSelectionStore {
  areaId: string | null;
  index: number | null;
  select: (areaId: string, index: number) => void;
  clear: () => void;
}

export const useVertexSelection = create<VertexSelectionStore>()((set) => ({
  areaId: null,
  index: null,
  select: (areaId, index) => set({ areaId, index }),
  clear: () => set({ areaId: null, index: null }),
}));

/** The active vertex index for `areaId` with `count` vertices, or null. */
export function activeVertexIndex(
  state: Pick<VertexSelectionStore, "areaId" | "index">,
  areaId: string | null | undefined,
  count: number,
): number | null {
  if (!areaId || state.areaId !== areaId || state.index === null) return null;
  return state.index >= 0 && state.index < count ? state.index : null;
}
