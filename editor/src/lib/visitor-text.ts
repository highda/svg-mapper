// Author-facing labels for the visitor text keys (#216), grouped by control.
import type { Settings, VisitorStringKey } from "@svg-mapper/shared";

/** Every key, grouped by the control it belongs to, with an author-facing label. */
export const VISITOR_TEXT_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [VisitorStringKey, string]>]> = [
  ["Place directory", [
    ["directoryToggle", "Open button"],
    ["directoryTitle", "Heading"],
    ["directoryLabel", "Directory name"],
    ["directoryCloseLabel", "Close button name"],
    ["searchPlaceholder", "Search placeholder"],
    ["searchLabel", "Search field name"],
    ["filterLabel", "Filter group name"],
    ["placeCount", "Result count"],
    ["placeCountOne", "Result count (one)"],
    ["noResults", "No results"],
    ["result", "Result"],
    ["resultUnavailable", "Unavailable result"],
    ["revealAnnounce", "Result announcement"],
  ]],
  ["Navigation", [
    ["back", "Back button"],
    ["backLabel", "Back button name"],
    ["viewsLabel", "Scene switcher name"],
    ["chooseView", "Scene dropdown name"],
    ["viewAnnounce", "View announcement"],
    ["mapLabel", "Pannable map name"],
  ]],
  ["Zoom", [
    ["zoomIn", "Zoom in button"],
    ["zoomInLabel", "Zoom in name"],
    ["zoomOut", "Zoom out button"],
    ["zoomOutLabel", "Zoom out name"],
    ["zoomReset", "Reset button"],
    ["zoomResetLabel", "Reset name"],
  ]],
  ["Details", [
    ["close", "Close button"],
    ["closeLabel", "Close button name"],
    ["detailsLabel", "Panel name"],
  ]],
  ["Layer toggles", [
    ["layerShown", "Layer shown"],
    ["layerHidden", "Layer hidden"],
    ["layerError", "Layer failed"],
  ]],
  ["Loading and errors", [
    ["loading", "Loading"],
    ["error", "Error"],
  ]],
];

/** Number of authored overrides, for the section summary. */
export function visitorTextSummary(settings: Settings): string | undefined {
  const count = Object.keys(settings.strings ?? {}).length;
  const parts = [settings.lang, count ? `${count} custom` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
