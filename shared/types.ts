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

export interface PopupAction {
  type: "popup";
  popupId: string;
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
  body?: string;
}

export interface AreaAccessibility {
  ariaLabel: string;
  tabIndex: number;
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

export interface Area {
  id: string;
  name: string;
  geometry: Geometry;
  style: AreaStyle;
  tooltip?: Tooltip;
  action: Action;
  accessibility?: AreaAccessibility;
  metadata?: Record<string, unknown>;
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
// Popup
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

export interface RendererOptions {
  container: string | HTMLElement;
  definition?: ClickMapDefinition;
  definitionUrl?: string;
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
}

export interface ClickMapAreaClickEvent {
  type: "area:click";
  areaId: string;
  areaName: string;
  action: Action;
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
  on<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ): void;
  off<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ): void;
}
