// One resolution of how a published map is sized, shared by the renderer and
// every export artifact (map.json, index.html, embed snippet, README).
import type { ContainerSizingMode, Settings } from "./types.js";

/** Explicit `sizingMode`, else the legacy `responsive`/`maintainAspectRatio` inference. */
export function resolveSizingMode(settings: Pick<Settings, "sizingMode" | "responsive" | "maintainAspectRatio">): ContainerSizingMode {
  if (settings.sizingMode) return settings.sizingMode;
  if (!settings.responsive) return "fixed";
  return settings.maintainAspectRatio ? "fluid-width" : "fill-container";
}

/** CSS size given to the host element; only `fill-container` uses it. */
export interface HostSize {
  width: string;
  height: string;
}

export const DEFAULT_HOST_SIZE: HostSize = { width: "100%", height: "600px" };

const CSS_LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|%|vw|vh|dvh|svh|lvh|rem|em))$/;

/** Accepts one plain, non-negative CSS length such as `600px`, `100%`, or `100vh`. */
export function isHostLength(value: string): boolean {
  return CSS_LENGTH.test(value.trim());
}

/**
 * Inline CSS declarations for the host element in each mode:
 * - fixed: none; the renderer sizes itself to the active view's canvas.
 * - fluid-width: full width; the renderer derives height from the canvas aspect ratio.
 * - fill-container: the explicit host size the renderer fills.
 */
export function hostStyle(mode: ContainerSizingMode, host: HostSize = DEFAULT_HOST_SIZE): string {
  if (mode === "fixed") return "";
  if (mode === "fluid-width") return "width: 100%;";
  return `width: ${host.width.trim()}; height: ${host.height.trim()};`;
}
