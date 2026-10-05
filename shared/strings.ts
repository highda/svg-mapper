// Visitor-facing renderer text (#216). Every string the published map shows
// or announces has a key with an English default; `settings.strings`
// overrides any subset. The key list is part of the published contract
// (docs/data-model.md, "Visitor text").
import type { VisitorStringKey } from "./types.js";

/**
 * English defaults, merged under `settings.strings`. The `settings.strings`
 * schema is built from these keys.
 */
export const DEFAULT_VISITOR_STRINGS: Record<VisitorStringKey, string> = {
  directoryToggle: "Find a place",
  directoryTitle: "Find a place",
  directoryLabel: "Place directory",
  directoryCloseLabel: "Close place directory",
  searchPlaceholder: "Search places",
  searchLabel: "Search places",
  filterLabel: "Filter by category",
  placeCount: "{count} places",
  placeCountOne: "{count} place",
  noResults: "No places match your search.",
  result: "{name} — {view}",
  resultUnavailable: "{name} — {view} (unavailable)",
  revealAnnounce: "{name}, {view}",
  back: "← Back",
  backLabel: "Back",
  viewsLabel: "Views",
  chooseView: "Choose a view",
  viewAnnounce: "{name} view.",
  mapLabel: "Map, arrow keys pan",
  zoomIn: "+",
  zoomInLabel: "Zoom in",
  zoomOut: "−",
  zoomOutLabel: "Zoom out",
  zoomReset: "⊙",
  zoomResetLabel: "Reset zoom",
  close: "×",
  closeLabel: "Close",
  detailsLabel: "Details",
  layerShown: "{name} shown.",
  layerHidden: "{name} hidden.",
  layerError: "Layer could not be changed.",
  loading: "Loading map…",
  error: "This map could not be displayed. {message}",
};

/**
 * Visible text: an empty value hides it. Every other key is an accessible
 * name or a screen-reader announcement, which the renderer never leaves
 * empty (a blank value falls back to the default, and validation warns).
 */
export const VISIBLE_STRING_KEYS: readonly VisitorStringKey[] = [
  "directoryToggle", "directoryTitle", "searchPlaceholder", "placeCount", "placeCountOne", "noResults",
  "back", "zoomIn", "zoomOut", "zoomReset", "close", "loading",
];

/**
 * A visible control value made only of SVG path data (`M` followed by
 * numbers and path commands) is drawn as a 24×24 icon in the text colour.
 */
export const ICON_PATH_PATTERN = /^M[-\d.\s,]+[-\d.\s,MLHVCSQTAZmlhvcsqtaz]*$/;

/** Fill `{placeholder}`s; unknown placeholders are kept as written. */
export function formatVisitorString(template: string, vars: Record<string, unknown> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
