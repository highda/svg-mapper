// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * `schemaVersion` of a map definition: `MAJOR.MINOR.PATCH`. A major change is
 * breaking; minor and patch changes are additive. This release reads major
 * version 1 only (docs/data-model.md, "Versioning").
 */
export type SchemaVersion = `1.${number}.${number}`;

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

export type AssetMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/svg+xml";

export interface Asset {
  id: string;
  type: AssetMimeType;
  name: string;
  /** Relative path (export) or data URI / inline SVG markup (editor storage). */
  src: string;
  width: number;
  height: number;
  /** When true the asset is inlined into map.json rather than a separate file. */
  inline: boolean;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface RectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
}

export interface CircleGeometry {
  cx: number;
  cy: number;
  r: number;
}

export interface PolygonGeometry {
  points: [number, number][];
}

export interface PathGeometry {
  d: string;
}

export type MarkerAnchor =
  | "bottom-center"
  | "center"
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "middle-left"
  | "middle-right";

/**
 * How a marker's size responds to the visitor's zoom (#219): `map` scales
 * with the map; `screen` keeps the on-screen size it has at zoom 1 while the
 * visitor zooms, still anchored to its point.
 */
export type MarkerScaleMode = "map" | "screen";

export interface MarkerGeometry {
  x: number;
  y: number;
  anchor: MarkerAnchor;
  /** Key of the drawn icon in `ClickMapDefinition.icons`; omitted (or unknown) draws the default pin. */
  icon?: string;
  /** Width in canvas units, aspect preserved. Defaults to 24 (the pin is 24 × 32). */
  size?: number;
  /** Defaults to "map". */
  scaleMode?: MarkerScaleMode;
}

export type AreaType = "rect" | "circle" | "polygon" | "path" | "marker";

export type Geometry =
  | ({ type: "rect" } & RectGeometry)
  | ({ type: "circle" } & CircleGeometry)
  | ({ type: "polygon" } & PolygonGeometry)
  | ({ type: "path" } & PathGeometry)
  | ({ type: "marker" } & MarkerGeometry);

/**
 * A marker icon (#219), drawn in a `width` × `height` box with its origin at
 * 0,0 and scaled to the marker's `size`. Exactly one of `d` and `assetId`:
 * path data is painted with the marker's style states (fill, stroke); an
 * image asset cannot be recoloured, so its states paint only an outline.
 */
export interface MarkerIcon {
  name: string;
  width: number;
  height: number;
  /** SVG path data in the icon box. */
  d?: string;
  /** An image asset (PNG, WebP, JPEG or SVG) fitted to the icon box. */
  assetId?: string;
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export interface AreaStyleState {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface AreaStyle {
  default: AreaStyleState;
  hover: AreaStyleState;
  /** Selected: the area the visitor last activated, until the selection is cleared (#214). */
  active: AreaStyleState;
  /** Rendered when area.disabled is true (issue #22). */
  disabled?: AreaStyleState;
}

/** A named style that can be copied once or kept linked to areas in the editor. */
export interface SharedStyle {
  name: string;
  style: AreaStyle;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export type TransitionType = "fade" | "none";
export type UrlTarget = "_blank" | "_self";

export interface NoneAction {
  type: "none";
}

export interface UrlAction {
  type: "url";
  href: string;
  target: UrlTarget;
}

export interface GoToViewAction {
  type: "goToView";
  targetViewId: string;
  transition?: TransitionType;
}

export type PopupPosition = "auto" | "top" | "bottom" | "left" | "right";

/**
 * How popup content is shown (#220): `popover` anchored to the area, `panel`
 * in the docked details panel (`settings.details`), or `modal` as a centred
 * dialog with a backdrop.
 */
export type DetailsPresentation = "popover" | "panel" | "modal";
export type DetailsPanelSide = "left" | "right" | "top" | "bottom";

export interface PopupAction {
  type: "popup";
  content: {
    title?: string;
    /** HTML allowed; sanitised by renderer before insertion. */
    body?: string;
    imageUrl?: string;
    linkHref?: string;
    linkLabel?: string;
  };
  /** Popover placement preference; ignored by the panel and modal presentations. */
  position?: PopupPosition;
  /** Overrides `settings.details.presentation` for this area. */
  presentation?: DetailsPresentation;
}

export interface ToggleLayerAction {
  type: "toggleLayer";
  targetLayerId: string;
}

export interface CustomEventAction {
  type: "customEvent";
  eventName: string;
  payload?: Record<string, unknown>;
}

export type Action =
  | NoneAction
  | UrlAction
  | GoToViewAction
  | PopupAction
  | ToggleLayerAction
  | CustomEventAction;

// ---------------------------------------------------------------------------
// Tooltip & Accessibility
// ---------------------------------------------------------------------------

export interface Tooltip {
  enabled: boolean;
  title?: string;
  /** HTML allowed; sanitised by renderer before insertion. */
  body?: string;
  /** Optional thumbnail shown above title. */
  imageUrl?: string;
}

export interface AreaAccessibility {
  ariaLabel: string;
  tabIndex: number;
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

export type AreaTrigger = "click" | "hover" | "both";

export interface AreaLabel {
  /** Overrides area.name when set. */
  text?: string;
  /** Per-area visibility override; undefined = follows project setting. */
  visible?: boolean;
}

/** Bounded, export-time alpha bitmap. One bit per pixel, row-major, base64 encoded. */
export interface AlphaHitMask {
  mode: "alpha";
  assetId: string;
  threshold: number;
  width: number;
  height: number;
  data: string;
  /** Editor-only preview aid; the renderer ignores it. */
  debug?: boolean;
}

export interface AreaImage {
  assetId: string;
  /** How the asset is fitted inside its rectangular bounds. */
  fit?: "fill" | "contain" | "cover";
  opacity?: number;
  rotation?: number;
  /** Decorative images are omitted from keyboard navigation when action is none. */
  decorative?: boolean;
  locked?: boolean;
  visible?: boolean;
  /** Omit for the portable rectangular fallback. */
  hitMask?: AlphaHitMask;
}

export interface Area {
  id: string;
  name: string;
  geometry: Geometry;
  style: AreaStyle;
  /** When set, editor updates to this shared style are propagated to the area. */
  sharedStyleId?: string;
  tooltip?: Tooltip;
  action: Action;
  accessibility?: AreaAccessibility;
  metadata?: Record<string, unknown>;
  /** Controls which pointer events trigger hover/click behaviour. Default "both". */
  trigger?: AreaTrigger;
  /** When true the renderer renders the area in its hover style permanently. */
  alwaysHighlight?: boolean;
  /** When true the area is non-interactive and visually distinct. */
  disabled?: boolean;
  /** Per-area label override (see Settings.areaLabels). */
  label?: AreaLabel;
  /** Optional reusable image element fitted to a rectangular area. */
  image?: AreaImage;
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  areas: Area[];
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export type BackgroundFit = "contain" | "cover" | "fill" | "none";

/** Normalized object-position. 0 is left/top and 1 is right/bottom. */
export interface BackgroundPosition {
  x: number;
  y: number;
}

export interface ViewBackground {
  assetId: string;
  fit: BackgroundFit;
  /** Alignment/focal point used by contain, cover, and intrinsic-size backgrounds. */
  position?: BackgroundPosition;
}

export interface Viewport {
  minZoom: number;
  maxZoom: number;
  initialZoom: number;
  panEnabled: boolean;
  zoomEnabled: boolean;
}

export interface ViewUI {
  /** Shows a Back control after the visitor has navigated into this view. */
  showBackButton: boolean;
  /** Shows the trail of visited views (the navigation stack) while this view is active. */
  showBreadcrumbs: boolean;
}

export interface View {
  id: string;
  name: string;
  slug: string;
  /** Canonical coordinate space for this view. */
  canvas: { width: number; height: number };
  background?: ViewBackground;
  viewport: Viewport;
  ui: ViewUI;
  /** Optional advanced CSS, scoped by the renderer to this view and instance. */
  customCss?: string;
  layers: Layer[];
}

// ---------------------------------------------------------------------------
// Popup (legacy — kept for backwards compat; new popup content lives in PopupAction)
// ---------------------------------------------------------------------------

export interface Popup {
  id: string;
  name: string;
  title?: string;
  body?: string;
  /** When true, body is rendered as HTML (export-time warning emitted). */
  allowHtml?: boolean;
}

// ---------------------------------------------------------------------------
// Area labels project setting
// ---------------------------------------------------------------------------

export interface AreaLabelsSettings {
  enabled: boolean;
  fontSize?: number;
  color?: string;
  fontWeight?: string;
  /** Auto-hide label when its rendered width exceeds the area bounding-box width. */
  hideWhenSmaller?: boolean;
}

// ---------------------------------------------------------------------------
// Scene switcher setting
// ---------------------------------------------------------------------------

export type SceneSwitcherPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center";

export interface SceneSwitcherSettings {
  enabled: boolean;
  position: SceneSwitcherPosition;
  style?: "tabs" | "buttons" | "dropdown";
}

// ---------------------------------------------------------------------------
// Zoom controls setting
// ---------------------------------------------------------------------------

export type ZoomControlsPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface ZoomControlsSettings {
  enabled: boolean;
  position?: ZoomControlsPosition;
  /** Fractional zoom change per button/wheel step. Defaults to 0.2. */
  step?: number;
  /** Camera used by the reset button. Defaults to the view's initial zoom. */
  resetBehavior?: "initial" | "fit";
  /** Wheel gesture required to zoom. Defaults to off to preserve page scrolling. */
  wheelMode?: "off" | "ctrl" | "meta" | "alt" | "shift" | "always";
}

export interface DirectoryCategory {
  /** Metadata value matched against `categoryKey`. */
  value: string;
  /** Visitor-facing text; ensures the legend never relies on color alone. */
  label: string;
}

export interface DirectorySettings {
  enabled: boolean;
  /** Metadata fields included with area names in full-text search. */
  metadataKeys?: string[];
  /** Metadata field used by the configured category filters. */
  categoryKey?: string;
  categories?: DirectoryCategory[];
}

/** Author content shown in the details panel while no area's details are open. */
export interface DetailsDefaultContent {
  title?: string;
  /** HTML allowed (sanitised); `{{viewName}}` is replaced with the current view's name. */
  body?: string;
}

/** Project-wide presentation of popup content (#220). */
export interface DetailsSettings {
  /** Presentation of popup actions without their own. Defaults to "popover". */
  presentation?: DetailsPresentation;
  /** Side of the renderer box the details panel docks to. Defaults to "right". */
  side?: DetailsPanelSide;
  /** Panel width (left/right) or height (top/bottom): a fraction 0–1 of the box, or a px, %, em or rem length. Defaults to "35%". */
  size?: number | string;
  /** Below this renderer width (CSS px) the panel becomes a bottom sheet. Defaults to 560, the compact breakpoint. */
  sheetBelow?: number;
  /** Accessible name of the panel region. Defaults to the default content title. */
  label?: string;
  /** Shown in the panel while nothing is selected. */
  defaultContent?: DetailsDefaultContent;
  /** Keep the panel hidden until an area's details are shown, even with default content. */
  hideWhenIdle?: boolean;
}

// ---------------------------------------------------------------------------
// Visitor text (#216)
// ---------------------------------------------------------------------------

/**
 * Every visitor-facing renderer string, all optional; defaults are English
 * (`DEFAULT_VISITOR_STRINGS` in shared/strings.ts). Visible text may be ""
 * to hide it; accessible names and announcements are never left empty.
 * Placeholders in braces are filled by the renderer.
 */
export interface VisitorStrings {
  /** Visible. Compact "open directory" button text (control content). */
  directoryToggle?: string;
  /** Visible. Directory heading. */
  directoryTitle?: string;
  /** Name. Directory region; also names the compact button when its text is hidden. */
  directoryLabel?: string;
  /** Name. The compact directory's close button. */
  directoryCloseLabel?: string;
  /** Visible. Search field placeholder. */
  searchPlaceholder?: string;
  /** Name. Search field. */
  searchLabel?: string;
  /** Name. Category filter group. */
  filterLabel?: string;
  /** Visible. Result count, `{count}` other than one. */
  placeCount?: string;
  /** Visible. Result count, `{count}` of one. */
  placeCountOne?: string;
  /** Visible. Empty search result. */
  noResults?: string;
  /** Name. A directory result: `{name}`, `{view}`. */
  result?: string;
  /** Name. A disabled directory result: `{name}`, `{view}`. */
  resultUnavailable?: string;
  /** Announcement after a directory result is revealed: `{name}`, `{view}`. */
  revealAnnounce?: string;
  /** Visible. Back button content. */
  back?: string;
  /** Name. Back button, when its content is hidden or an icon. */
  backLabel?: string;
  /** Name. The breadcrumb trail. */
  breadcrumbLabel?: string;
  /** Name. Scene switcher buttons or tabs. */
  viewsLabel?: string;
  /** Name. Scene switcher dropdown. */
  chooseView?: string;
  /** Announcement after navigation: `{name}`. */
  viewAnnounce?: string;
  /** Name. The zoomed-in map while it can be panned with arrow keys. */
  mapLabel?: string;
  /** Visible. Zoom-in button content. */
  zoomIn?: string;
  /** Name. Zoom-in button. */
  zoomInLabel?: string;
  /** Visible. Zoom-out button content. */
  zoomOut?: string;
  /** Name. Zoom-out button. */
  zoomOutLabel?: string;
  /** Visible. Reset-zoom button content. */
  zoomReset?: string;
  /** Name. Reset-zoom button. */
  zoomResetLabel?: string;
  /** Visible. Close button content (details and compact directory). */
  close?: string;
  /** Name. Details close button. */
  closeLabel?: string;
  /** Name. Untitled panel default content, unless `settings.details.label` is set. */
  detailsLabel?: string;
  /** Announcement after a layer toggle shows a layer: `{name}`. */
  layerShown?: string;
  /** Announcement after a layer toggle hides a layer: `{name}`. */
  layerHidden?: string;
  /** Announcement when a layer toggle fails. */
  layerError?: string;
  /** Visible. Loading state (`create()` option `strings`, before map.json loads). */
  loading?: string;
  /** Error state: `{message}` (`create()` option `strings`). */
  error?: string;
}

export type VisitorStringKey = keyof VisitorStrings;

// ---------------------------------------------------------------------------
// Project settings
// ---------------------------------------------------------------------------

export type ContainerSizingMode = "fixed" | "fluid-width" | "fill-container";

export interface Settings {
  initialViewId: string;
  responsive: boolean;
  maintainAspectRatio: boolean;
  /** Explicit host-container sizing contract. Legacy files infer this from responsive flags. */
  sizingMode?: ContainerSizingMode;
  enableHistory: boolean;
  enableKeyboardNavigation: boolean;
  /** Mustache-style template evaluated for tooltip/popover content. */
  contentTemplate?: string;
  /** Project-wide area label rendering settings. */
  areaLabels?: AreaLabelsSettings;
  /** Built-in view-switcher control rendered inside the map container. */
  sceneSwitcher?: SceneSwitcherSettings;
  /** Built-in +/− zoom buttons rendered inside the map container. */
  zoomControls?: ZoomControlsSettings;
  /** Optional static visitor directory spanning all visible layers and views. */
  directory?: DirectorySettings;
  /** Popup presentation default plus the details panel's layout and default content. */
  details?: DetailsSettings;
  /** Expands the effective viewBox by these amounts (canvas units). */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** The map's one language, a BCP 47 tag such as `cs`: set as `lang` on the renderer root and used for number formatting. */
  lang?: string;
  /** Text direction of the renderer root; set only when given. */
  dir?: "ltr" | "rtl";
  /** Visitor-facing text overrides; see VisitorStrings. */
  strings?: VisitorStrings;
}

// ---------------------------------------------------------------------------
// Project metadata
// ---------------------------------------------------------------------------

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// ClickMapDefinition — the renderer's input (map.json)
// Editor-only fields are stripped before this type is produced.
// ---------------------------------------------------------------------------

export interface ClickMapDefinition {
  schemaVersion: SchemaVersion;
  project: ProjectMeta;
  settings: Settings;
  assets: Asset[];
  views: View[];
  popups: Popup[];
  sharedStyles: Record<string, SharedStyle>;
  customEvents: string[];
  /** Marker icons by key, referenced by `MarkerGeometry.icon` (#219). Export keeps only used ones. */
  icons?: Record<string, MarkerIcon>;
}

// ---------------------------------------------------------------------------
// Editor-only state (stripped on export)
// ---------------------------------------------------------------------------

export interface GridSettings {
  enabled: boolean;
  size: number;
}

export interface EditorState {
  selectedAreaId?: string;
  selectedLayerId?: string;
  selectedViewId?: string;
  zoom: number;
  pan: { x: number; y: number };
  grid: GridSettings;
  guides: unknown[];
  history: unknown[];
}

// ---------------------------------------------------------------------------
// ProjectFile — what the editor saves to disk (superset of ClickMapDefinition)
// ---------------------------------------------------------------------------

export interface ProjectFile extends ClickMapDefinition {
  editor?: EditorState;
}

// ---------------------------------------------------------------------------
// Renderer public API types
// ---------------------------------------------------------------------------

export interface ChoroplethOptions {
  data: Array<{ id: string; value: number }>;
  colorLow: string;
  colorHigh: string;
  noDataColor?: string;
  /** Render a legend element inside the container. */
  legend?: boolean;
}

export interface DeepLinkOptions {
  enabled: boolean;
  /** Use view.slug in hash when available (default true). */
  useSlug?: boolean;
}

export interface RendererOptions {
  container: string | HTMLElement;
  definition?: ClickMapDefinition;
  definitionUrl?: string;
  /** Base URL for relative reusable asset sources. Defaults to the fetched definition URL or document.baseURI. */
  assetBaseUrl?: string;
  /** Choropleth data-driven fill colouring. */
  choropleth?: ChoroplethOptions;
  /** URL hash–based deep linking. */
  deepLink?: DeepLinkOptions;
  /** Wrap renderer DOM in a shadow root to isolate from host-page CSS. */
  shadowDom?: boolean;
  /** Extra CSS injected into the shadow root (only used when shadowDom: true). */
  css?: string;
  /**
   * Text shown before a map is mounted: `loading` and `error`. map.json is not
   * read yet (or could not be read), so `settings.strings` cannot supply them.
   */
  strings?: Pick<VisitorStrings, "loading" | "error">;
}

export interface ClickMapReadyEvent {
  type: "ready";
  definition: ClickMapDefinition;
}

export interface ClickMapViewChangeEvent {
  type: "view:change";
  previousViewId: string;
  currentViewId: string;
}

export interface ClickMapViewEnterEvent {
  type: "view:enter";
  instanceId: string;
  viewId: string;
}

export interface ClickMapViewLeaveEvent {
  type: "view:leave";
  instanceId: string;
  viewId: string;
  nextViewId: string;
}

export interface ClickMapCameraChangeEvent {
  type: "camera:change";
  instanceId: string;
  viewId: string;
  reason: "zoom" | "pan" | "reset" | "reveal";
  viewBox: { x: number; y: number; width: number; height: number };
  zoom: number;
}

export interface ClickMapAreaHoverEvent {
  type: "area:hover";
  areaId: string;
  areaName: string;
  metadata?: Record<string, unknown>;
}

export interface ClickMapAreaClickEvent {
  type: "area:click";
  areaId: string;
  areaName: string;
  action: Action;
  metadata?: Record<string, unknown>;
}

/** The view's selected area changed; `areaId` and `areaName` are null when it was cleared. */
export interface ClickMapAreaSelectEvent {
  type: "area:select";
  instanceId: string;
  viewId: string;
  areaId: string | null;
  areaName: string | null;
}

export interface ClickMapPopupOpenEvent {
  type: "popup:open";
  popupId: string;
  presentation: DetailsPresentation;
}

export interface ClickMapPopupCloseEvent {
  type: "popup:close";
  popupId: string;
  presentation: DetailsPresentation;
}

export interface ClickMapErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type ClickMapEvent =
  | ClickMapReadyEvent
  | ClickMapViewChangeEvent
  | ClickMapViewEnterEvent
  | ClickMapViewLeaveEvent
  | ClickMapCameraChangeEvent
  | ClickMapAreaHoverEvent
  | ClickMapAreaClickEvent
  | ClickMapAreaSelectEvent
  | ClickMapPopupOpenEvent
  | ClickMapPopupCloseEvent
  | ClickMapErrorEvent;

export type ClickMapEventType = ClickMapEvent["type"];

export interface ClickMapInstance {
  goToView(viewId: string): void;
  goBack(): void;
  reset(): void;
  /** Select an area of the current view (painted with `style.active`); ignored for unknown, hidden or disabled areas. */
  select(areaId: string): void;
  /** Clear the current view's selection, if any. */
  clearSelection(): void;
  getCurrentView(): string;
  getDefinition(): ClickMapDefinition;
  destroy(): void;
  setChoroplethData(data: Array<{ id: string; value: number }>): void;
  on<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ): void;
  off<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ): void;
}
