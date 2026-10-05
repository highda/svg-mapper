import { useSyncExternalStore } from "react";

/** The documented authoring floor (ASSIGNMENT §2.4): docked panels from here up. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Live `matchMedia` result; environments without it (tests, old engines) count as matching. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener?.("change", onChange);
      return () => list.removeEventListener?.("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : true),
    () => true,
  );
}
