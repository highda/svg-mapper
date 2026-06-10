// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type SchemaVersion = "1.0.0";

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

export interface MarkerGeometry {
  x: number;
  y: number;
  anchor: MarkerAnchor;
}

export type AreaType = "rect" | "circle" | "polygon" | "path" | "marker";

export type Geometry =
  | ({ type: "rect" } & RectGeometry)
  | ({ type: "circle" } & CircleGeometry)
  | ({ type: "polygon" } & PolygonGeometry)
  | ({ type: "path" } & PathGeometry)
  | ({ type: "marker" } & MarkerGeometry);

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
  active: AreaStyleState;
  /** Rendered when area.disabled is true (issue #22). */
  disabled?: AreaStyleState;
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
  position?: PopupPosition;
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

export interface Area {
  id: string;
  name: string;
  geometry: Geometry;
  style: AreaStyle;
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

export interface ViewBackground {
  assetId: string;
  fit: BackgroundFit;
}

export interface Viewport {
  minZoom: number;
  maxZoom: number;
  initialZoom: number;
  panEnabled: boolean;
  zoomEnabled: boolean;
}

export interface ViewUI {
  showBackButton: boolean;
  showBreadcrumbs: boolean;
  showTitle: boolean;
}

export interface View {
  id: string;
  name: string;
  slug: string;
  background?: ViewBackground;
  viewport: Viewport;
  ui: ViewUI;
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
}

// ---------------------------------------------------------------------------
// Project settings
// ---------------------------------------------------------------------------

export type ThemeName = "default" | string;

export interface Settings {
  initialViewId: string;
  canvasSize: { width: number; height: number };
  responsive: boolean;
  maintainAspectRatio: boolean;
  theme: ThemeName;
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
  /** Expands the effective viewBox by these amounts (canvas units). */
  padding?: { top: number; right: number; bottom: number; left: number };
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
  sharedStyles: Record<string, unknown>;
  customEvents: string[];
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
  /** Choropleth data-driven fill colouring. */
  choropleth?: ChoroplethOptions;
  /** URL hash–based deep linking. */
  deepLink?: DeepLinkOptions;
  /** Wrap renderer DOM in a shadow root to isolate from host-page CSS. */
  shadowDom?: boolean;
  /** Extra CSS injected into the shadow root (only used when shadowDom: true). */
  css?: string;
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

export interface ClickMapPopupOpenEvent {
  type: "popup:open";
  popupId: string;
}

export interface ClickMapPopupCloseEvent {
  type: "popup:close";
  popupId: string;
}

export interface ClickMapErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type ClickMapEvent =
  | ClickMapReadyEvent
  | ClickMapViewChangeEvent
  | ClickMapAreaHoverEvent
  | ClickMapAreaClickEvent
  | ClickMapPopupOpenEvent
  | ClickMapPopupCloseEvent
  | ClickMapErrorEvent;

export type ClickMapEventType = ClickMapEvent["type"];

export interface ClickMapInstance {
  goToView(viewId: string): void;
  goBack(): void;
  reset(): void;
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

