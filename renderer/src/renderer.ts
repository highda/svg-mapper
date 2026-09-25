import type {
  ClickMapDefinition,
  ClickMapEvent,
  ClickMapEventType,
  ClickMapInstance,
  RendererOptions,
  ChoroplethOptions,
  View,
  Area,
  Action,
  AreaStyleState,
} from "../../shared/types.js";
import { scopeViewCss, validateViewCss } from "../../shared/view-css.js";
import { validateActionUrl } from "../../shared/validation.js";
import { resolveSizingMode } from "../../shared/sizing.js";
import { Emitter } from "./emitter.js";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
  type Placement,
  type VirtualElement,
} from "@floating-ui/dom";

/** Keep overlays this far inside the map's clipping box. */
const OVERLAY_PADDING = 8;

/**
 * Below this renderer size the visitor controls switch to compact forms: a
 * "Find a place" button instead of an open directory and a dropdown scene
 * switcher. Measured on the renderer root, never the window, so a 400px embed
 * behaves the same on any page.
 */
const COMPACT_WIDTH = 560;
const COMPACT_HEIGHT = 360;

type ControlSlot = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<T extends SVGElement>(tag: string): T {
  return document.createElementNS(SVG_NS, tag) as T;
}

function escId(id: string): string {
  return CSS.escape(id);
}

function resolveAssetSource(src: string, baseUrl: string): string {
  if (/^\s*<svg\b/i.test(src)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
  }
  // Keep already self-contained or explicitly located sources byte-for-byte.
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) return src;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}

function areaBounds(geometry: Area["geometry"]): { x: number; y: number; w: number; h: number } {
  switch (geometry.type) {
    case "rect": return { x: geometry.x, y: geometry.y, w: geometry.width, h: geometry.height };
    case "circle": return { x: geometry.cx - geometry.r, y: geometry.cy - geometry.r, w: geometry.r * 2, h: geometry.r * 2 };
    case "polygon": {
      const xs = geometry.points.map(([x]) => x);
      const ys = geometry.points.map(([, y]) => y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case "marker": return { x: geometry.x - 16, y: geometry.y - 32, w: 32, h: 32 };
    case "path": return { x: 0, y: 0, w: 1, h: 1 };
  }
}

// ---------------------------------------------------------------------------
// HTML sanitiser (strips script tags and event-handler attributes)
// ---------------------------------------------------------------------------

function sanitiseHtml(raw: string): string {
  const div = document.createElement("div");
  div.innerHTML = raw;
  // Remove <script> tags and elements with event handlers
  div.querySelectorAll("script,iframe,object,embed").forEach((el) => el.remove());
  div.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      if (
        ["href", "src", "xlink:href", "action", "formaction", "poster"].includes(attr.name.toLowerCase()) &&
        !validateActionUrl(attr.value).valid
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Mustache-style template engine ({{name}}, {{metadata.key}})
// ---------------------------------------------------------------------------

function renderTemplate(
  template: string,
  vars: { name: string; id: string; metadata?: Record<string, unknown>; viewName?: string }
): string {
  const escapeHtml = (value: unknown) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    if (key === "name") return escapeHtml(vars.name);
    if (key === "id") return escapeHtml(vars.id);
    if (key === "viewName") return escapeHtml(vars.viewName);
    if (key.startsWith("metadata.")) {
      const mk = key.slice(9);
      return escapeHtml(vars.metadata?.[mk]);
    }
    return "";
  });
}

// ---------------------------------------------------------------------------
// Colour interpolation for choropleth
// ---------------------------------------------------------------------------

function colorToRgb(color: string): [number, number, number] | null {
  const clean = color.replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0], 16);
    const g = parseInt(clean[1]! + clean[1], 16);
    const b = parseInt(clean[2]! + clean[2], 16);
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return [r, g, b];
  }
  const probe = document.createElement("span");
  probe.style.color = color;
  if (!probe.style.color) return null;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const match = resolved.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
}

function lerpColor(
  low: string,
  high: string,
  t: number
): string {
  const lo = colorToRgb(low);
  const hi = colorToRgb(high);
  if (!lo || !hi) return low;
  const r = Math.round(lo[0] + (hi[0] - lo[0]) * t);
  const g = Math.round(lo[1] + (hi[1] - lo[1]) * t);
  const b = Math.round(lo[2] + (hi[2] - lo[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// CSS for renderer (used when shadow DOM is enabled)
// ---------------------------------------------------------------------------

declare const __CLICKMAP_CSS__: string;

let _inlinedCSS =
  typeof __CLICKMAP_CSS__ === "string" ? __CLICKMAP_CSS__ : "";
function getInlinedCSS(): string {
  return _inlinedCSS;
}

const managedShadowRoots = new WeakMap<HTMLElement, ShadowRoot>();
let rendererSequence = 0;
const HISTORY_STATE_KEY = "__clickmapViews";

type ClickMapHistoryEntry = { viewId: string; stack: string[] };
type ClickMapHistoryState = Record<string, ClickMapHistoryEntry>;

// ---------------------------------------------------------------------------
// Core renderer
// ---------------------------------------------------------------------------

class Renderer implements ClickMapInstance {
  private def: ClickMapDefinition;
  private container: HTMLElement;
  private emitter = new Emitter();
  private destroyed = false;
  private navigationStack: string[] = [];
  private currentViewId: string;
  private options: RendererOptions;
  private assetBaseUrl: string;

  // DOM nodes (attached to root or shadow root depending on shadowDom option)
  private root!: HTMLDivElement;
  private viewEl!: HTMLDivElement;
  private bgEl!: HTMLDivElement;
  private bgSvgEl: SVGSVGElement | null = null;
  private svgEl!: SVGSVGElement;
  private tooltipEl!: HTMLDivElement;
  private popoverEl!: HTMLDivElement;
  private backBtn: HTMLButtonElement | null = null;
  private sceneSwitcherEl: HTMLDivElement | null = null;
  private zoomControlsEl: HTMLDivElement | null = null;
  private ariaLiveEl!: HTMLDivElement;
  private shadowRoot: ShadowRoot | null = null;
  private viewStyleEl: HTMLStyleElement | null = null;
  private readonly instanceId = `clickmap-${++rendererSequence}`;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  private ro!: ResizeObserver;
  private roTimer: ReturnType<typeof setTimeout> | null = null;
  private viewW = 1;
  private viewH = 1;
  private hoveredId: string | null = null;
  private focusedId: string | null = null;
  private pinnedTooltipId: string | null = null;
  private alphaMaskBytes = new Map<string, string>();
  /** Per-view runtime overrides. They survive navigation, while reset clears them. */
  private layerVisibility = new Map<string, Map<string, boolean>>();

  // Choropleth
  private choroplethData: Map<string, number> = new Map();
  private choroplethOptions: ChoroplethOptions | null = null;

  // Spacebar pan state
  private spaceHeld = false;
  private panStart: { x: number; y: number } | null = null;
  private panStartViewBox: { x: number; y: number; w: number; h: number } | null = null;
  private currentViewBox: { x: number; y: number; w: number; h: number } | null = null;
  private navigationInProgress = false;

  // Popover state
  private openPopoverId: string | null = null;
  /** One grid of corner/centre slots so controls stack instead of overlapping. */
  private controlsEl!: HTMLDivElement;
  private slots = new Map<ControlSlot, HTMLDivElement>();
  private compact = false;
  private directoryEl: HTMLElement | null = null;
  private directoryToggle: HTMLButtonElement | null = null;
  /** Stops Floating UI tracking; set only while a popover is open. */
  private stopPopoverTracking: (() => void) | null = null;
  private popoverPlacement: Placement = "bottom";
  /** What the visible tooltip is anchored to, so camera changes can re-place it. */
  private tooltipAnchor: Element | VirtualElement | null = null;
  private popoverReturnFocus: HTMLElement | SVGElement | null = null;

  private onDocumentClick = (e: MouseEvent) => {
    const path = e.composedPath();
    const targetArea = path.find((target): target is Element =>
      target instanceof Element && target.hasAttribute("data-area-id")
    );

    if (this.pinnedTooltipId !== null && targetArea?.getAttribute("data-area-id") !== this.pinnedTooltipId) {
      this.pinnedTooltipId = null;
      if (this.focusedId === null && this.hoveredId === null) this.hideTooltip();
    }

    if (this.openPopoverId === null || path.includes(this.popoverEl)) return;

    if (targetArea?.getAttribute("data-area-id") === this.openPopoverId) return;
    this.closePopover();
  };

  private onDocumentKeyDown = (e: KeyboardEvent) => {
    if (this.openPopoverId === null) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.closePopover();
      return;
    }
    if (e.key !== "Tab") return;

    const focusable = Array.from(
      this.popoverEl.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hidden);
    if (focusable.length === 0) {
      e.preventDefault();
      this.popoverEl.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = this.getActiveElement();
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!active || !this.popoverEl.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  constructor(options: RendererOptions, def: ClickMapDefinition) {
    this.def = def;
    this.options = options;
    try {
      this.assetBaseUrl = new URL(options.assetBaseUrl ?? document.baseURI, document.baseURI).href;
    } catch {
      this.assetBaseUrl = document.baseURI;
    }

    const raw = options.container;
    const container =
      typeof raw === "string"
        ? document.querySelector<HTMLElement>(raw)
        : raw;

    if (!container)
      throw new Error(`ClickMapRenderer: container not found: ${String(raw)}`);
    this.container = container;

    this.currentViewId = def.settings.initialViewId;
    const initialView = def.views.find((view) => view.id === this.currentViewId) ?? def.views[0];
    this.viewW = initialView?.canvas.width ?? 1;
    this.viewH = initialView?.canvas.height ?? 1;

    // Choropleth initial data
    if (options.choropleth) {
      this.choroplethOptions = options.choropleth;
      for (const d of options.choropleth.data) {
        this.choroplethData.set(d.id, d.value);
      }
    }

    this.buildDOM();
    this.renderDirectory();
    this.renderView(this.currentViewId);

    // Deep linking: restore from hash on load
    if (options.deepLink?.enabled) {
      this.initDeepLink();
    }
    if (def.settings.enableHistory) {
      window.addEventListener("popstate", this.onPopState);
      this.replaceOwnedHistoryState(this.currentViewId);
    }

    this.ro = new ResizeObserver(() => {
      if (this.roTimer !== null) clearTimeout(this.roTimer);
      this.roTimer = setTimeout(() => { this.roTimer = null; this.updateScale(); }, 16);
    });
    this.ro.observe(this.container);

    // Defer readiness until create() has returned so callers can subscribe on
    // the immediately returned instance. A same-turn destroy cancels it.
    queueMicrotask(() => {
      if (!this.destroyed) this.emitter.emit({ type: "ready", definition: def });
    });
  }

  // -------------------------------------------------------------------------
  // DOM scaffolding
  // -------------------------------------------------------------------------

  private buildDOM() {
    this.root = document.createElement("div");
    this.root.className = "clickmap-root";
    this.root.dataset.clickmapInstance = this.instanceId;

    this.viewEl = document.createElement("div");
    this.viewEl.className = "clickmap-view";

    this.bgEl = document.createElement("div");
    this.bgEl.className = "clickmap-bg";

    this.svgEl = svgEl<SVGSVGElement>("svg");
    this.svgEl.setAttribute("class", "clickmap-areas");
    this.svgEl.setAttribute("role", "presentation");

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "clickmap-tooltip";
    this.tooltipEl.id = `${this.instanceId}-tooltip`;
    this.tooltipEl.setAttribute("role", "tooltip");
    this.tooltipEl.setAttribute("aria-hidden", "true");

    this.popoverEl = document.createElement("div");
    this.popoverEl.className = "clickmap-popover";
    this.popoverEl.setAttribute("role", "dialog");
    this.popoverEl.setAttribute("aria-modal", "true");
    this.popoverEl.setAttribute("aria-hidden", "true");
    this.popoverEl.tabIndex = -1;

    this.ariaLiveEl = document.createElement("div");
    this.ariaLiveEl.setAttribute("aria-live", "polite");
    this.ariaLiveEl.setAttribute("aria-atomic", "true");
    this.ariaLiveEl.className = "clickmap-aria-live";
    this.ariaLiveEl.style.cssText =
      "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;";

    this.viewEl.appendChild(this.bgEl);
    this.viewEl.appendChild(this.svgEl);
    this.root.appendChild(this.viewEl);
    this.controlsEl = document.createElement("div");
    this.controlsEl.className = "clickmap-controls";
    for (const slot of ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const) {
      const cell = document.createElement("div");
      cell.className = `clickmap-slot clickmap-slot--${slot}`;
      this.controlsEl.appendChild(cell);
      this.slots.set(slot, cell);
    }
    this.root.appendChild(this.controlsEl);
    this.root.appendChild(this.tooltipEl);
    this.root.appendChild(this.popoverEl);
    this.root.appendChild(this.ariaLiveEl);

    this.viewStyleEl = document.createElement("style");
    this.viewStyleEl.dataset.clickmapViewStyle = "";

    // Shadow DOM mode (issue #29)
    if (this.options.shadowDom) {
      this.shadowRoot = managedShadowRoots.get(this.container) ?? null;
      if (!this.shadowRoot) {
        this.shadowRoot = this.container.attachShadow({ mode: "open" });
        managedShadowRoots.set(this.container, this.shadowRoot);
      }
      this.shadowRoot.replaceChildren();
      const styleEl = document.createElement("style");
      styleEl.textContent = `${getInlinedCSS()}\n${this.options.css ?? ""}`;
      this.shadowRoot.appendChild(styleEl);
      this.shadowRoot.appendChild(this.viewStyleEl);
      this.shadowRoot.appendChild(this.root);
    } else {
      this.container.appendChild(this.viewStyleEl);
      this.container.appendChild(this.root);
    }

    // Delegated pointer + keyboard events on the SVG
    this.svgEl.addEventListener("pointerover", (e) => this.onPointerOver(e));
    this.svgEl.addEventListener("pointerout", (e) => this.onPointerOut(e));
    this.svgEl.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.svgEl.addEventListener("click", (e) => this.onClick(e));
    this.svgEl.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.svgEl.addEventListener("focusin", (e) => this.onFocusIn(e));
    this.svgEl.addEventListener("focusout", (e) => this.onFocusOut(e));
    this.svgEl.addEventListener("wheel", this.onWheel, { passive: false });

    // Spacebar pan (issue #27 G3)
    window.addEventListener("keydown", this.onWindowKeyDown);
    window.addEventListener("keyup", this.onWindowKeyUp);
    this.svgEl.addEventListener("pointerdown", (e) => this.onPanStart(e));
    window.addEventListener("pointermove", this.onWindowPointerMove);
    window.addEventListener("pointerup", this.onWindowPointerUp);

    // Close popover on outside click
    document.addEventListener("click", this.onDocumentClick);
    document.addEventListener("keydown", this.onDocumentKeyDown);
  }

  private renderDirectory() {
    const config = this.def.settings.directory;
    if (!config?.enabled) return;

    type Entry = { area: Area; view: View; search: string; category: string };
    const entries: Entry[] = [];
    for (const view of this.def.views) {
      for (const layer of view.layers) {
        if (!layer.visible) continue; // Hidden authoring layers are intentionally undiscoverable.
        for (const area of layer.areas) {
          const metadataText = (config.metadataKeys ?? []).map((key) => area.metadata?.[key])
            .filter((value) => value !== undefined && value !== null)
            .map(String).join(" ");
          entries.push({
            area,
            view,
            search: `${area.name} ${metadataText}`.toLocaleLowerCase(),
            category: String(config.categoryKey ? area.metadata?.[config.categoryKey] ?? "" : ""),
          });
        }
      }
    }

    const panel = document.createElement("section");
    panel.className = "clickmap-directory";
    panel.id = `${this.instanceId}-directory`;
    panel.setAttribute("aria-label", "Place directory");
    const heading = document.createElement("h2");
    heading.textContent = "Find a place";

    // Compact embeds show only this button; the panel opens over the map.
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "clickmap-directory-toggle";
    toggle.textContent = "Find a place";
    toggle.setAttribute("aria-controls", panel.id);
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => this.setDirectoryOpen(!panel.classList.contains("clickmap-directory--open")));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "clickmap-directory-close";
    close.setAttribute("aria-label", "Close place directory");
    close.textContent = "×";
    close.addEventListener("click", () => this.setDirectoryOpen(false, true));
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.compact && panel.classList.contains("clickmap-directory--open")) {
        event.stopPropagation();
        this.setDirectoryOpen(false, true);
      }
    });
    const input = document.createElement("input");
    input.type = "search";
    input.className = "clickmap-directory-search";
    input.placeholder = "Search places";
    input.setAttribute("aria-label", "Search places");
    const filters = document.createElement("div");
    filters.className = "clickmap-directory-filters";
    filters.setAttribute("aria-label", "Filter by category");
    const status = document.createElement("div");
    status.className = "clickmap-directory-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const list = document.createElement("ul");
    list.className = "clickmap-directory-results";
    let category = "";

    const update = () => {
      const query = input.value.trim().toLocaleLowerCase();
      const matches = entries.filter((entry) => (!query || entry.search.includes(query)) && (!category || entry.category === category));
      status.textContent = `${matches.length} ${matches.length === 1 ? "place" : "places"}`;
      list.replaceChildren();
      if (matches.length === 0) {
        const empty = document.createElement("li");
        empty.className = "clickmap-directory-empty";
        empty.textContent = "No places match your search.";
        list.appendChild(empty);
        return;
      }
      const fragment = document.createDocumentFragment();
      for (const entry of matches) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "clickmap-directory-result";
        button.disabled = entry.area.disabled === true;
        button.textContent = `${entry.area.name} — ${entry.view.name}${entry.area.disabled ? " (unavailable)" : ""}`;
        button.addEventListener("click", () => this.revealDirectoryEntry(entry.view, entry.area));
        item.appendChild(button);
        fragment.appendChild(item);
      }
      list.appendChild(fragment);
    };

    const addFilter = (value: string, label: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clickmap-directory-filter";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(category === value));
      button.addEventListener("click", () => {
        category = category === value ? "" : value;
        filters.querySelectorAll("button").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button && category === value)));
        update();
      });
      filters.appendChild(button);
    };
    for (const item of config.categories ?? []) addFilter(item.value, item.label);
    input.addEventListener("input", update);
    panel.append(close, heading, input);
    if (filters.childElementCount) panel.appendChild(filters);
    panel.append(status, list);
    const slot = this.slots.get("top-left")!;
    slot.append(toggle, panel);
    this.directoryEl = panel;
    this.directoryToggle = toggle;
    update();
  }

  /** Compact mode only: open or dismiss the directory panel over the map. */
  private setDirectoryOpen(open: boolean, restoreFocus = false) {
    const panel = this.directoryEl;
    const toggle = this.directoryToggle;
    if (!panel || !toggle) return;
    panel.classList.toggle("clickmap-directory--open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) panel.querySelector<HTMLInputElement>(".clickmap-directory-search")?.focus();
    else if (restoreFocus) toggle.focus();
  }

  private revealDirectoryEntry(view: View, area: Area) {
    // In a compact embed, get the panel out of the way so the result is visible.
    if (this.compact) this.setDirectoryOpen(false);
    const reveal = () => {
      const el = this.findAreaEl(area.id);
      if (!el) return;
      const bounds = areaBounds(area.geometry);
      const base = this.getBaseViewBox(view);
      const limits = this.getZoomLimits(view);
      const targetZoom = Math.max(limits.min, Math.min(limits.max, Math.min(base.w / Math.max(bounds.w * 2, 1), base.h / Math.max(bounds.h * 2, 1))));
      const width = base.w / targetZoom;
      const height = base.h / targetZoom;
      this.currentViewBox = { x: bounds.x + bounds.w / 2 - width / 2, y: bounds.y + bounds.h / 2 - height / 2, w: width, h: height };
      this.applyViewBox();
      this.emitCameraChange("reveal");
      el.focus();
      this.ariaLiveEl.textContent = `${area.name}, ${view.name}`;
      this.updateDeepLinkHash(view.id, area.id);
    };
    if (view.id !== this.currentViewId) {
      this.goToView(view.id);
      window.setTimeout(reveal, 170);
    } else reveal();
  }

  // -------------------------------------------------------------------------
  // View rendering
  // -------------------------------------------------------------------------

  private renderView(viewId: string) {
    const view = this.def.views.find((v) => v.id === viewId);
    if (!view) {
      this.emitter.emit({
        type: "error",
        code: "VIEW_NOT_FOUND",
        message: `View "${viewId}" not found`,
      });
      return;
    }

    this.hoveredId = null;
    this.focusedId = null;
    this.pinnedTooltipId = null;
    this.hideTooltip();
    this.closePopover();
    this.viewW = view.canvas.width;
    this.viewH = view.canvas.height;
    this.applyViewCss(view);

    this.renderBackground(view);
    this.renderAreas(view);
    this.svgEl.style.touchAction = view.viewport.panEnabled ? "none" : "auto";
    this.renderBackButton(view);
    this.renderSceneSwitcher();
    this.renderZoomControls();
    this.updateScale();
    this.applyChoropleth();
  }

  private applyViewCss(view: View) {
    if (!this.viewStyleEl) return;
    const css = view.customCss?.trim() ?? "";
    if (!css) {
      this.viewStyleEl.textContent = "";
      return;
    }
    const error = validateViewCss(css);
    if (error) {
      this.viewStyleEl.textContent = "";
      this.emitter.emit({ type: "error", code: "INVALID_VIEW_CSS", message: `${view.name}: ${error}` });
      return;
    }
    try {
      this.viewStyleEl.textContent = scopeViewCss(css, `[data-clickmap-instance="${this.instanceId}"]`);
    } catch (reason) {
      this.viewStyleEl.textContent = "";
      this.emitter.emit({ type: "error", code: "INVALID_VIEW_CSS", message: `${view.name}: ${(reason as Error).message}` });
    }
  }

  private renderBackground(view: View) {
    this.bgEl.innerHTML = "";
    this.bgSvgEl = null;
    if (!view.background) return;

    const asset = this.def.assets.find(
      (a) => a.id === view.background!.assetId
    );
    if (!asset) return;

    const fit = view.background.fit ?? "contain";
    const { width, height } = view.canvas;
    const backgroundSvg = svgEl<SVGSVGElement>("svg");
    backgroundSvg.setAttribute("class", "clickmap-bg-svg");
    backgroundSvg.setAttribute("aria-hidden", "true");

    const image = svgEl<SVGImageElement>("image");
    image.setAttribute("class", "clickmap-bg-img");
    const src = resolveAssetSource(asset.src, this.assetBaseUrl);
    image.setAttribute("href", src);

    const position = view.background.position ?? { x: 0.5, y: 0.5 };
    const positionX = Math.max(0, Math.min(1, position.x));
    const positionY = Math.max(0, Math.min(1, position.y));
    let imageWidth = width;
    let imageHeight = height;
    if (fit === "none") {
      imageWidth = asset.width;
      imageHeight = asset.height;
    } else if (fit !== "fill" && asset.width > 0 && asset.height > 0) {
      const scale = fit === "cover"
        ? Math.max(width / asset.width, height / asset.height)
        : Math.min(width / asset.width, height / asset.height);
      imageWidth = asset.width * scale;
      imageHeight = asset.height * scale;
    }
    image.setAttribute("x", String((width - imageWidth) * positionX));
    image.setAttribute("y", String((height - imageHeight) * positionY));
    image.setAttribute("width", String(imageWidth));
    image.setAttribute("height", String(imageHeight));
    image.setAttribute("preserveAspectRatio", "none");

    backgroundSvg.appendChild(image);
    this.bgEl.appendChild(backgroundSvg);
    this.bgSvgEl = backgroundSvg;
  }

  private renderAreas(view: View) {
    this.svgEl.innerHTML = "";

    const base = this.getBaseViewBox(view);
    const initialZoom = this.getZoomLimits(view).initial;
    this.currentViewBox = this.zoomedViewBox(base, initialZoom);
    this.applyViewBox();

    const labelSettings = this.def.settings.areaLabels;

    for (const layer of view.layers) {
      const visible = this.layerVisibility.get(view.id)?.get(layer.id) ?? layer.visible;
      if (!visible) continue;

      const g = svgEl<SVGGElement>("g");
      g.setAttribute("class", "clickmap-layer");
      g.setAttribute("opacity", String(layer.opacity));
      g.setAttribute("data-layer-id", layer.id);

      for (const area of layer.areas) {
        const visual = this.makeAreaImageEl(area);
        if (visual) g.appendChild(visual);
        const el = this.makeAreaEl(area);
        if (el) g.appendChild(el);
      }

      this.svgEl.appendChild(g);
    }

    // Area labels (issue #26)
    if (labelSettings?.enabled) {
      const labelsG = svgEl<SVGGElement>("g");
      labelsG.setAttribute("class", "clickmap-area-labels");
      labelsG.setAttribute("pointer-events", "none");

      for (const layer of view.layers) {
        if (!layer.visible) continue;
        for (const area of layer.areas) {
          if (area.label?.visible === false) continue;
          const bbox = this.getAreaBBox(area);
          if (!bbox) continue;
          const text = svgEl<SVGTextElement>("text");
          text.setAttribute("class", "clickmap-area-label");
          text.setAttribute("x", String(bbox.cx));
          text.setAttribute("y", String(bbox.cy));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("dominant-baseline", "central");
          text.setAttribute("fill", labelSettings.color ?? "#000000");
          text.setAttribute("font-size", String(labelSettings.fontSize ?? 14));
          text.setAttribute("font-weight", labelSettings.fontWeight ?? "normal");
          text.setAttribute("pointer-events", "none");
          text.setAttribute("data-label-area", area.id);
          text.textContent = area.label?.text ?? area.name;
          labelsG.appendChild(text);
        }
      }

      this.svgEl.appendChild(labelsG);

      // After paint: hide labels wider than their area (done in a rAF so text is measured)
      if (labelSettings.hideWhenSmaller !== false) {
        requestAnimationFrame(() => this.updateLabelVisibility());
      }
    }
  }

  private updateLabelVisibility() {
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    if (!view) return;
    const labelsG = this.svgEl.querySelector<SVGGElement>(".clickmap-area-labels");
    if (!labelsG) return;
    const zoom = this.getViewBoxZoom();
    for (const textEl of Array.from(labelsG.querySelectorAll<SVGTextElement>("[data-label-area]"))) {
      const areaId = textEl.getAttribute("data-label-area")!;
      const area = this.findAreaInView(areaId, view);
      if (!area) continue;
      const bbox = this.getAreaBBox(area);
      if (!bbox) continue;
      // getBBox() works in SVG coordinate space
      try {
        const tb = (textEl as SVGTextElement).getBBox();
        textEl.setAttribute("visibility", tb.width > bbox.w * zoom ? "hidden" : "visible");
      } catch {
        // getBBox unavailable in non-rendered context (tests) — skip
      }
    }
  }

  private getViewBoxZoom(): number {
    if (!this.currentViewBox) return 1;
    const containerW = this.container.clientWidth || 1;
    return containerW / this.currentViewBox.w;
  }

  private getAreaBBox(area: Area): { cx: number; cy: number; w: number; h: number } | null {
    const g = area.geometry;
    switch (g.type) {
      case "rect":
        return { cx: g.x + g.width / 2, cy: g.y + g.height / 2, w: g.width, h: g.height };
      case "circle":
        return { cx: g.cx, cy: g.cy, w: g.r * 2, h: g.r * 2 };
      case "polygon": {
        if (!g.points.length) return null;
        const xs = g.points.map((p) => p[0]);
        const ys = g.points.map((p) => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
      }
      default:
        return null;
    }
  }

  private renderBackButton(view: View) {
    this.backBtn?.remove();
    this.backBtn = null;

    if (!view.ui.showBackButton || this.navigationStack.length === 0) return;

    const btn = document.createElement("button");
    btn.className = "clickmap-back-btn";
    btn.textContent = "← Back";
    btn.addEventListener("click", () => this.goBack());
    this.slots.get("top-left")!.prepend(btn);
    this.backBtn = btn;
  }

  // -------------------------------------------------------------------------
  // Scene switcher (issue #25 D3)
  // -------------------------------------------------------------------------

  private renderSceneSwitcher() {
    this.sceneSwitcherEl?.remove();
    this.sceneSwitcherEl = null;

    const ss = this.def.settings.sceneSwitcher;
    if (!ss?.enabled) return;

    // Compact embeds always use the dropdown: it fits any width.
    const style = this.compact ? "dropdown" : ss.style ?? "buttons";
    const position = ss.position ?? "bottom-center";
    const el = document.createElement("div");
    el.className = `clickmap-scene-switcher clickmap-scene-switcher--${position} clickmap-scene-switcher--${style}`;

    const views = this.def.views;
    views.forEach((view) => {
      if (style === "dropdown") return; // handled below
      const btn = document.createElement("button");
      btn.textContent = view.name;
      btn.title = view.name;
      btn.setAttribute("type", "button");
      btn.setAttribute("data-view-id", view.id);
      btn.className = "clickmap-scene-btn";
      const active = view.id === this.currentViewId;
      if (active) btn.classList.add("clickmap-scene-btn--active");
      if (style === "tabs") {
        el.setAttribute("role", "tablist");
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", String(active));
        btn.tabIndex = active ? 0 : -1;
      }
      btn.addEventListener("click", () => this.goToView(view.id));
      el.appendChild(btn);
    });

    if (style === "dropdown") {
      const sel = document.createElement("select");
      sel.className = "clickmap-scene-dropdown";
      sel.setAttribute("aria-label", "Choose a view");
      views.forEach((view) => {
        const opt = document.createElement("option");
        opt.value = view.id;
        opt.textContent = view.name;
        if (view.id === this.currentViewId) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", () => this.goToView(sel.value));
      el.appendChild(sel);
    }

    // Keyboard: arrow keys move between buttons (tabs behaviour)
    el.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      const btns = Array.from(el.querySelectorAll<HTMLButtonElement>(".clickmap-scene-btn"));
      const idx = btns.findIndex((b) => b === document.activeElement);
      if (idx === -1) return;
      const next = (e.key === "ArrowRight" || e.key === "ArrowDown")
        ? btns[(idx + 1) % btns.length]
        : btns[(idx - 1 + btns.length) % btns.length];
      next?.focus();
      e.preventDefault();
    });

    this.slots.get(position)!.appendChild(el);
    this.sceneSwitcherEl = el;
    // A long switcher scrolls sideways: keep the active view in sight without
    // scrollIntoView(), which could also scroll the host page.
    const active = el.querySelector<HTMLElement>(".clickmap-scene-btn--active");
    if (active && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    }
  }

  // -------------------------------------------------------------------------
  // Zoom controls (issue #27 G1)
  // -------------------------------------------------------------------------

  private renderZoomControls() {
    this.zoomControlsEl?.remove();
    this.zoomControlsEl = null;

    const zc = this.def.settings.zoomControls;
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    if (!zc?.enabled || !view?.viewport.zoomEnabled) return;

    const el = document.createElement("div");
    el.className = `clickmap-zoom-controls clickmap-zoom-controls--${zc.position ?? "top-right"}`;

    const makeBtn = (cls: string, label: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.className = cls;
      btn.setAttribute("aria-label", label);
      btn.setAttribute("type", "button");
      btn.textContent = label === "Zoom in" ? "+" : label === "Zoom out" ? "−" : "⊙";
      btn.addEventListener("click", onClick);
      return btn;
    };

    const factor = 1 + this.getZoomStep();
    el.appendChild(makeBtn("clickmap-zoom-in", "Zoom in", () => this.adjustZoom(factor)));
    el.appendChild(makeBtn("clickmap-zoom-out", "Zoom out", () => this.adjustZoom(1 / factor)));
    el.appendChild(makeBtn("clickmap-zoom-reset", "Reset zoom", () => this.resetZoom()));

    this.slots.get(zc.position ?? "top-right")!.appendChild(el);
    this.zoomControlsEl = el;
  }

  private adjustZoom(factor: number, anchor?: { x: number; y: number }) {
    if (!this.currentViewBox) return;
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    if (!view?.viewport.zoomEnabled || !Number.isFinite(factor) || factor <= 0) return;
    const base = this.getBaseViewBox(view);
    const limits = this.getZoomLimits(view);
    const vb = this.currentViewBox;
    const cx = anchor?.x ?? vb.x + vb.w / 2;
    const cy = anchor?.y ?? vb.y + vb.h / 2;
    const currentZoom = base.w / vb.w;
    const targetZoom = Math.max(limits.min, Math.min(limits.max, currentZoom * factor));
    const newW = base.w / targetZoom;
    const newH = base.h / targetZoom;
    const x = cx - (cx - vb.x) * (newW / vb.w);
    const y = cy - (cy - vb.y) * (newH / vb.h);
    this.currentViewBox = {
      x: Math.abs(x - base.x) < 1e-10 ? base.x : x,
      y: Math.abs(y - base.y) < 1e-10 ? base.y : y,
      w: newW,
      h: newH,
    };
    this.applyViewBox();
    this.emitCameraChange("zoom");
  }

  private resetZoom() {
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    if (!view) return;
    const base = this.getBaseViewBox(view);
    const zoom = this.def.settings.zoomControls?.resetBehavior === "fit"
      ? this.getZoomLimits(view).min
      : this.getZoomLimits(view).initial;
    this.currentViewBox = this.zoomedViewBox(base, zoom);
    this.applyViewBox();
    this.emitCameraChange("reset");
  }

  private getZoomStep() {
    const step = this.def.settings.zoomControls?.step;
    return Number.isFinite(step) && step! > 0 ? Math.min(step!, 4) : 0.2;
  }

  private onWheel = (event: WheelEvent) => {
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    const mode = this.def.settings.zoomControls?.wheelMode ?? "off";
    if (!view?.viewport.zoomEnabled || mode === "off") return;
    const permitted = mode === "always" ||
      (mode === "ctrl" && event.ctrlKey) || (mode === "meta" && event.metaKey) ||
      (mode === "alt" && event.altKey) || (mode === "shift" && event.shiftKey);
    if (!permitted || !this.currentViewBox || event.deltaY === 0) return;

    event.preventDefault();
    const rect = this.svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const vb = this.currentViewBox;
    const renderedScale = Math.min(rect.width / vb.w, rect.height / vb.h);
    const renderedW = vb.w * renderedScale;
    const renderedH = vb.h * renderedScale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    const anchor = {
      x: vb.x + (event.clientX - rect.left - offsetX) / renderedScale,
      y: vb.y + (event.clientY - rect.top - offsetY) / renderedScale,
    };
    const factor = 1 + this.getZoomStep();
    this.adjustZoom(event.deltaY < 0 ? factor : 1 / factor, anchor);
  };

  private getBaseViewBox(view: View) {
    const { width, height } = view.canvas;
    const pad = this.def.settings.padding;
    return pad
      ? { x: -pad.left, y: -pad.top, w: width + pad.left + pad.right, h: height + pad.top + pad.bottom }
      : { x: 0, y: 0, w: width, h: height };
  }

  private getZoomLimits(view: View) {
    const min = Number.isFinite(view.viewport.minZoom) && view.viewport.minZoom > 0
      ? view.viewport.minZoom
      : 1;
    const max = Number.isFinite(view.viewport.maxZoom) && view.viewport.maxZoom >= min
      ? view.viewport.maxZoom
      : min;
    const requestedInitial = Number.isFinite(view.viewport.initialZoom)
      ? view.viewport.initialZoom
      : min;
    return { min, max, initial: Math.max(min, Math.min(max, requestedInitial)) };
  }

  private zoomedViewBox(base: { x: number; y: number; w: number; h: number }, zoom: number) {
    const w = base.w / zoom;
    const h = base.h / zoom;
    return {
      x: base.x + (base.w - w) / 2,
      y: base.y + (base.h - h) / 2,
      w,
      h,
    };
  }

  private applyViewBox() {
    if (!this.currentViewBox) return;
    const { x, y, w, h } = this.currentViewBox;
    this.svgEl.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    this.bgSvgEl?.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  }

  // -------------------------------------------------------------------------
  // Spacebar pan (issue #27 G3)
  // -------------------------------------------------------------------------

  private onWindowKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space" && !e.repeat) {
      // Only activate when the renderer container is focused or hovered
      if (this.root.contains(document.activeElement) || this.root.matches(":hover")) {
        this.spaceHeld = true;
        e.preventDefault();
      }
    }
  };

  private onWindowKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      this.spaceHeld = false;
      this.panStart = null;
      this.panStartViewBox = null;
    }
  };

  private onWindowPointerMove = (e: PointerEvent) => this.onPanMove(e);
  private onWindowPointerUp = () => this.onPanEnd();

  private onPanStart(e: PointerEvent) {
    if (!this.spaceHeld || !this.currentViewBox) return;
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    if (!view?.viewport.panEnabled || !this.isZoomedIn()) return;
    this.panStart = { x: e.clientX, y: e.clientY };
    this.panStartViewBox = { ...this.currentViewBox };
    this.svgEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private onPanMove(e: PointerEvent) {
    if (!this.panStart || !this.panStartViewBox || !this.currentViewBox) return;
    const containerW = this.container.clientWidth || 1;
    const scale = this.panStartViewBox.w / containerW;
    const dx = (e.clientX - this.panStart.x) * scale;
    const dy = (e.clientY - this.panStart.y) * scale;
    this.currentViewBox = {
      ...this.panStartViewBox,
      x: this.panStartViewBox.x - dx,
      y: this.panStartViewBox.y - dy,
    };
    this.applyViewBox();
    this.emitCameraChange("pan");
  }

  private onPanEnd() {
    this.panStart = null;
    this.panStartViewBox = null;
  }

  private isZoomedIn() {
    if (!this.currentViewBox) return false;
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    if (!view) return false;
    const base = this.getBaseViewBox(view);
    return this.currentViewBox.w < base.w || this.currentViewBox.h < base.h;
  }

  private emitCameraChange(reason: "zoom" | "pan" | "reset" | "reveal") {
    if (!this.currentViewBox) return;
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    if (!view) return;
    const base = this.getBaseViewBox(view);
    const { x, y, w, h } = this.currentViewBox;
    this.refreshOverlays();
    this.emitter.emit({
      type: "camera:change",
      instanceId: this.instanceId,
      viewId: view.id,
      reason,
      viewBox: { x, y, width: w, height: h },
      zoom: base.w / w,
    });
  }

  // -------------------------------------------------------------------------
  // Area element construction
  // -------------------------------------------------------------------------

  private makeAreaEl(area: Area): SVGElement | null {
    const g = area.geometry;
    let shape: SVGElement;

    switch (g.type) {
      case "rect": {
        const r = svgEl<SVGRectElement>("rect");
        r.setAttribute("x", String(g.x));
        r.setAttribute("y", String(g.y));
        r.setAttribute("width", String(g.width));
        r.setAttribute("height", String(g.height));
        if (g.rx !== undefined) r.setAttribute("rx", String(g.rx));
        shape = r;
        break;
      }
      case "polygon": {
        const p = svgEl<SVGPolygonElement>("polygon");
        p.setAttribute("points", g.points.map((pt) => pt.join(",")).join(" "));
        shape = p;
        break;
      }
      case "circle": {
        const c = svgEl<SVGCircleElement>("circle");
        c.setAttribute("cx", String(g.cx));
        c.setAttribute("cy", String(g.cy));
        c.setAttribute("r", String(g.r));
        shape = c;
        break;
      }
      case "path": {
        const p = svgEl<SVGPathElement>("path");
        p.setAttribute("d", g.d);
        shape = p;
        break;
      }
      case "marker": {
        const width = 24;
        const height = 32;
        const horizontal = g.anchor.endsWith("left") ? 0 : g.anchor.endsWith("right") ? width : width / 2;
        const vertical = g.anchor.startsWith("top") ? 0 : g.anchor.startsWith("middle") || g.anchor === "center" ? height / 2 : height;
        const x = g.x - horizontal;
        const y = g.y - vertical;
        const p = svgEl<SVGPathElement>("path");
        p.setAttribute("d", `M${x + 12},${y + 32} C${x + 10},${y + 27} ${x + 2},${y + 20} ${x + 2},${y + 12} A10,10 0 1,1 ${x + 22},${y + 12} C${x + 22},${y + 20} ${x + 14},${y + 27} ${x + 12},${y + 32} Z`);
        shape = p;
        break;
      }
      default:
        return null;
    }

    const isDisabled = area.disabled === true;
    const alwaysHL = area.alwaysHighlight === true;

    // Choose initial style
    const initialStyle = isDisabled
      ? (area.style.disabled ?? this.makeDisabledStyle(area.style.default))
      : alwaysHL
        ? area.style.hover
        : area.style.default;

    this.applyStyle(shape, initialStyle);
    shape.setAttribute("class", "clickmap-area");
    shape.setAttribute("data-area-id", area.id);

    if (isDisabled) {
      shape.setAttribute("aria-disabled", "true");
      shape.style.cursor = "not-allowed";
      shape.setAttribute("tabindex", "-1");
    } else {
      shape.setAttribute("tabindex", String(area.image?.decorative && area.action.type === "none" ? -1 : (area.accessibility?.tabIndex ?? 0)));
      shape.setAttribute("role", "button");
      shape.setAttribute(
        "aria-label",
        area.accessibility?.ariaLabel ?? area.name
      );
      if (area.tooltip?.enabled) {
        shape.setAttribute("aria-describedby", this.tooltipEl.id);
      }
      const trigger = area.trigger ?? "both";
      const clickable = trigger === "click" || trigger === "both";
      shape.style.cursor = (area.action.type !== "none" && clickable) ? "pointer" : "default";
    }

    return shape;
  }

  private makeAreaImageEl(area: Area): SVGImageElement | null {
    if (!area.image || area.geometry.type !== "rect") return null;
    const asset = this.def.assets.find((candidate) => candidate.id === area.image!.assetId);
    if (!asset) return null;
    const image = svgEl<SVGImageElement>("image");
    if (area.image.visible === false) return null;
    image.setAttribute("href", resolveAssetSource(asset.src, this.assetBaseUrl));
    image.setAttribute("x", String(area.geometry.x));
    image.setAttribute("y", String(area.geometry.y));
    image.setAttribute("width", String(area.geometry.width));
    image.setAttribute("height", String(area.geometry.height));
    const fit = area.image.fit ?? "fill";
    image.setAttribute("preserveAspectRatio", fit === "contain" ? "xMidYMid meet" : fit === "cover" ? "xMidYMid slice" : "none");
    image.setAttribute("opacity", String(area.image.opacity ?? 1));
    const rotation = area.image.rotation ?? 0;
    if (rotation) image.setAttribute("transform", `rotate(${rotation} ${area.geometry.x + area.geometry.width / 2} ${area.geometry.y + area.geometry.height / 2})`);
    image.setAttribute("pointer-events", "none");
    image.setAttribute("class", "clickmap-area-image");
    return image;
  }

  private makeDisabledStyle(base: AreaStyleState): AreaStyleState {
    return { ...base, fill: "#9ca3af", stroke: "#6b7280", strokeWidth: base.strokeWidth };
  }

  private applyStyle(el: SVGElement, style: AreaStyleState) {
    el.setAttribute("fill", style.fill);
    el.setAttribute("stroke", style.stroke);
    el.setAttribute("stroke-width", String(style.strokeWidth));
  }

  // -------------------------------------------------------------------------
  // Choropleth (issue #24 C3)
  // -------------------------------------------------------------------------

  private applyChoropleth() {
    const opts = this.choroplethOptions;
    this.root.querySelector(".clickmap-legend")?.remove();

    const view = this.def.views.find((v) => v.id === this.currentViewId);
    if (!view) return;
    if (!opts) return;
    if (this.choroplethData.size === 0) {
      for (const layer of view.layers) {
        for (const area of layer.areas) {
          const el = this.findAreaEl(area.id);
          if (el) this.applyRestingStyle(area, el);
        }
      }
      return;
    }

    const values = Array.from(this.choroplethData.values());
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    for (const layer of view.layers) {
      for (const area of layer.areas) {
        const el = this.findAreaEl(area.id);
        if (!el) continue;
        if (this.choroplethData.has(area.id)) {
          const t = (this.choroplethData.get(area.id)! - minV) / range;
          const color = lerpColor(opts.colorLow, opts.colorHigh, t);
          el.setAttribute("fill", color);
        } else if (opts.noDataColor) {
          el.setAttribute("fill", opts.noDataColor);
        }
      }
    }

    if (opts.legend) this.renderChoroplethLegend(opts);
  }

  private renderChoroplethLegend(opts: ChoroplethOptions) {
    const legend = document.createElement("div");
    legend.className = "clickmap-legend";
    legend.style.cssText =
      `background:rgba(255,255,255,0.9);border:1px solid #ccc;border-radius:4px;padding:6px 8px;font-size:11px;`;

    const values = Array.from(this.choroplethData.values());
    const minV = Math.min(...values);
    const maxV = Math.max(...values);

    const gradient = document.createElement("div");
    gradient.style.cssText =
      `width:100px;height:12px;border-radius:2px;margin-bottom:2px;` +
      `background:linear-gradient(to right, ${opts.colorLow}, ${opts.colorHigh});`;

    const labels = document.createElement("div");
    labels.style.cssText = "display:flex;justify-content:space-between;width:100px;";
    labels.innerHTML = `<span>${minV.toFixed(1)}</span><span>${maxV.toFixed(1)}</span>`;

    legend.appendChild(gradient);
    legend.appendChild(labels);
    this.slots.get("bottom-right")!.appendChild(legend);
  }

  setChoroplethData(data: Array<{ id: string; value: number }>) {
    this.choroplethData.clear();
    for (const d of data) this.choroplethData.set(d.id, d.value);
    if (this.choroplethOptions) {
      this.choroplethOptions = { ...this.choroplethOptions, data };
      this.applyChoropleth();
    }
  }

  private applyRestingStyle(area: Area, el: SVGElement) {
    if (area.disabled) {
      this.applyStyle(el, area.style.disabled ?? this.makeDisabledStyle(area.style.default));
      return;
    }
    if (area.alwaysHighlight) {
      this.applyStyle(el, area.style.hover);
      return;
    }
    this.applyStyle(el, area.style.default);
    const opts = this.choroplethOptions;
    if (!opts || this.choroplethData.size === 0) return;
    const value = this.choroplethData.get(area.id);
    if (value === undefined) {
      if (opts.noDataColor) el.setAttribute("fill", opts.noDataColor);
      return;
    }
    const values = Array.from(this.choroplethData.values());
    const minV = Math.min(...values);
    const range = Math.max(...values) - minV || 1;
    el.setAttribute("fill", lerpColor(opts.colorLow, opts.colorHigh, (value - minV) / range));
  }

  // -------------------------------------------------------------------------
  // Event helpers
  // -------------------------------------------------------------------------

  private findAreaEl(areaId: string): SVGElement | null {
    return this.svgEl.querySelector<SVGElement>(
      `[data-area-id="${escId(areaId)}"]`
    );
  }

  private getAreaFromEvent(
    e: Event
  ): { area: Area; el: SVGElement } | null {
    const el = (e.target as Element).closest<SVGElement>("[data-area-id]");
    if (!el) return null;
    const id = el.getAttribute("data-area-id");
    if (!id) return null;
    const area = this.findAreaInCurrentView(id);
    if (!area) return null;
    if (area.disabled) return null;
    if (e instanceof MouseEvent && !this.alphaMaskContains(area, e.clientX, e.clientY)) return null;
    return { area, el };
  }

  private alphaMaskContains(area: Area, clientX: number, clientY: number): boolean {
    const mask = area.image?.hitMask;
    if (!mask || area.geometry.type !== "rect") return true;
    const point = this.svgEl.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = this.svgEl.getScreenCTM();
    if (!matrix) return true;
    const local = point.matrixTransform(matrix.inverse());
    const col = Math.floor(((local.x - area.geometry.x) / area.geometry.width) * mask.width);
    const row = Math.floor(((local.y - area.geometry.y) / area.geometry.height) * mask.height);
    if (col < 0 || row < 0 || col >= mask.width || row >= mask.height) return false;
    try {
      let binary = this.alphaMaskBytes.get(mask.data);
      if (binary === undefined) {
        binary = atob(mask.data);
        this.alphaMaskBytes.set(mask.data, binary);
      }
      const index = row * mask.width + col;
      return ((binary.charCodeAt(index >> 3) >> (index & 7)) & 1) !== 0;
    } catch {
      return true;
    }
  }

  private findAreaInCurrentView(areaId: string): Area | null {
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    if (!view) return null;
    return this.findAreaInView(areaId, view);
  }

  private findAreaInView(areaId: string, view: View): Area | null {
    for (const layer of view.layers) {
      const a = layer.areas.find((a) => a.id === areaId);
      if (a) return a;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Pointer / keyboard event handlers
  // -------------------------------------------------------------------------

  private onPointerOver(e: PointerEvent) {
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    const { area, el } = hit;

    const trigger = area.trigger ?? "both";
    if (trigger === "click") return; // no hover style for click-only

    if (this.hoveredId === area.id) return;

    // Restore previous
    if (this.hoveredId) {
      const prev = this.findAreaInCurrentView(this.hoveredId);
      const prevEl = prev ? this.findAreaEl(this.hoveredId) : null;
      if (prev && prevEl) {
        this.applyRestingStyle(prev, prevEl);
      }
    }

    this.hoveredId = area.id;
    this.applyStyle(el, area.style.hover);
    this.emitter.emit({
      type: "area:hover",
      areaId: area.id,
      areaName: area.name,
      ...(area.metadata !== undefined ? { metadata: area.metadata } : {}),
    });

    if (area.tooltip?.enabled) {
      this.showTooltip(area);
    }
  }

  private onPointerOut(e: PointerEvent) {
    if (!this.hoveredId) return;
    const related = e.relatedTarget as Element | null;
    if (
      related &&
      related.closest?.(`[data-area-id="${escId(this.hoveredId)}"]`)
    )
      return;

    const prev = this.findAreaInCurrentView(this.hoveredId);
    const prevEl = this.findAreaEl(this.hoveredId);
    if (prev && prevEl && this.focusedId !== prev.id) {
      this.applyRestingStyle(prev, prevEl);
    }

    this.hoveredId = null;
    if (this.focusedId === null && this.pinnedTooltipId === null) this.hideTooltip();
  }

  private onPointerMove(e: PointerEvent) {
    if (this.hoveredId) this.positionTooltip(e.clientX, e.clientY);
  }

  private onClick(e: MouseEvent) {
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    const { area } = hit;

    const trigger = area.trigger ?? "both";
    if (trigger === "hover") {
      // Touch has no durable hover state. Tapping a hover-only area toggles its
      // authored tooltip without dispatching the click action.
      if (!area.tooltip?.enabled) return;
      if (this.pinnedTooltipId === area.id) {
        this.pinnedTooltipId = null;
        if (this.focusedId === null && this.hoveredId === null) this.hideTooltip();
      } else {
        this.pinnedTooltipId = area.id;
        this.showTooltip(area);
        this.positionTooltipForArea(area);
      }
      return;
    }

    this.emitter.emit({
      type: "area:click",
      areaId: area.id,
      areaName: area.name,
      action: area.action,
      ...(area.metadata !== undefined ? { metadata: area.metadata } : {}),
    });
    this.updateDeepLinkHash(this.currentViewId, area.id);
    this.dispatchAction(area.action, area);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    const trigger = hit.area.trigger ?? "both";
    if (trigger === "hover") {
      if (hit.area.tooltip?.enabled) {
        this.showTooltip(hit.area);
        this.positionTooltipForArea(hit.area);
        this.ariaLiveEl.textContent = this.tooltipEl.textContent?.trim() || hit.area.name;
      }
      return;
    }
    this.emitter.emit({
      type: "area:click",
      areaId: hit.area.id,
      areaName: hit.area.name,
      action: hit.area.action,
      ...(hit.area.metadata !== undefined ? { metadata: hit.area.metadata } : {}),
    });
    this.updateDeepLinkHash(this.currentViewId, hit.area.id);
    this.dispatchAction(hit.area.action, hit.area);
  }

  private onFocusIn(e: FocusEvent) {
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    this.focusedId = hit.area.id;
    this.applyStyle(hit.el, hit.area.style.hover);
    if (hit.area.tooltip?.enabled) {
      this.showTooltip(hit.area);
      this.positionTooltipForArea(hit.area);
    }
  }

  private onFocusOut(e: FocusEvent) {
    if (!this.focusedId) return;
    const related = e.relatedTarget as Element | null;
    if (related?.closest?.(`[data-area-id="${escId(this.focusedId)}"]`)) return;
    const area = this.findAreaInCurrentView(this.focusedId);
    const el = this.findAreaEl(this.focusedId);
    if (area && el && this.hoveredId !== area.id) this.applyRestingStyle(area, el);
    this.focusedId = null;
    if (this.hoveredId === null && this.pinnedTooltipId === null) this.hideTooltip();
  }

  private dispatchAction(action: Action, area: Area) {
    switch (action.type) {
      case "url":
        // Definitions can be supplied directly or fetched without passing
        // through editor validation, so navigation needs its own hard boundary.
        if (validateActionUrl(action.href).valid) window.open(action.href, action.target);
        break;
      case "goToView":
        this.navigateToView(action.targetViewId, {
          transition: action.transition ?? "fade",
          historyMode: "push",
        });
        break;
      case "customEvent": {
        const init: CustomEventInit = action.payload !== undefined
          ? { detail: action.payload }
          : {};
        window.dispatchEvent(new CustomEvent(action.eventName, init));
        break;
      }
      case "popup":
        this.openPopover(action, area);
        break;
      case "toggleLayer":
        this.toggleLayer(action.targetLayerId);
        break;
      case "none":
        break;
    }
  }

  private toggleLayer(targetLayerId: string) {
    const view = this.def.views.find((candidate) => candidate.id === this.currentViewId);
    const layer = view?.layers.find((candidate) => candidate.id === targetLayerId);
    if (!view || !layer) {
      this.emitter.emit({
        type: "error",
        code: "LAYER_NOT_FOUND",
        message: `Layer "${targetLayerId}" was not found in the current view.`,
      });
      this.ariaLiveEl.textContent = "Layer could not be changed.";
      return;
    }
    const overrides = this.layerVisibility.get(view.id) ?? new Map<string, boolean>();
    const visible = !(overrides.get(layer.id) ?? layer.visible);
    overrides.set(layer.id, visible);
    this.layerVisibility.set(view.id, overrides);
    this.renderAreas(view);
    this.applyChoropleth();
    this.ariaLiveEl.textContent = `${layer.name} ${visible ? "shown" : "hidden"}.`;
  }

  // -------------------------------------------------------------------------
  // Tooltip (issues #22, #23)
  // -------------------------------------------------------------------------

  private showTooltip(area: Area) {
    const tt = area.tooltip!;
    const settings = this.def.settings;

    // Resolve title/body from content template or per-area fields
    let title: string;
    let body: string;

    if (settings.contentTemplate) {
      const view = this.def.views.find((v) => v.id === this.currentViewId);
      const resolved = renderTemplate(settings.contentTemplate, {
        name: area.name,
        id: area.id,
        ...(area.metadata !== undefined ? { metadata: area.metadata } : {}),
        ...(view?.name !== undefined ? { viewName: view.name } : {}),
      });
      title = "";
      body = resolved;
    } else {
      title = tt.title ?? area.name;
      body = tt.body ?? "";
    }

    this.tooltipEl.innerHTML = "";

    // Rich tooltip: optional image (issue #23 B4)
    if (tt.imageUrl) {
      if (validateActionUrl(tt.imageUrl).valid) {
        const img = document.createElement("img");
        img.src = tt.imageUrl;
        img.alt = "";
        img.style.cssText = "display:block;width:100%;max-height:80px;object-fit:cover;border-radius:2px;margin-bottom:4px;";
        this.tooltipEl.appendChild(img);
      }
    }

    if (title) {
      const t = document.createElement("strong");
      t.textContent = title;
      this.tooltipEl.appendChild(t);
    }
    if (body) {
      const p = document.createElement("p");
      // Body is HTML — sanitise before inserting
      p.innerHTML = sanitiseHtml(body);
      this.tooltipEl.appendChild(p);
    }
    this.tooltipEl.setAttribute("aria-hidden", "false");
    this.tooltipEl.classList.add("clickmap-tooltip--visible");
  }

  private resolveAreaTemplate(area: Area): string | null {
    const template = this.def.settings.contentTemplate;
    if (!template) return null;
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    return renderTemplate(template, {
      name: area.name,
      id: area.id,
      ...(area.metadata !== undefined ? { metadata: area.metadata } : {}),
      ...(view?.name !== undefined ? { viewName: view.name } : {}),
    });
  }

  private hideTooltip() {
    this.tooltipAnchor = null;
    this.tooltipEl.setAttribute("aria-hidden", "true");
    this.tooltipEl.classList.remove("clickmap-tooltip--visible");
  }

  /** Follow the pointer: a zero-size virtual reference at the cursor. */
  private positionTooltip(clientX: number, clientY: number) {
    this.tooltipAnchor = {
      contextElement: this.root,
      getBoundingClientRect: () => ({ x: clientX, y: clientY, left: clientX, top: clientY, right: clientX, bottom: clientY, width: 0, height: 0 }),
    };
    this.placeTooltip();
  }

  /** Focus and pinned tooltips anchor to the rendered area element itself. */
  private positionTooltipForArea(area: Area) {
    const el = this.findAreaEl(area.id);
    if (!el) return;
    this.tooltipAnchor = el;
    this.placeTooltip();
  }

  private placeTooltip() {
    const anchor = this.tooltipAnchor;
    if (!anchor) return;
    const boundary = this.root;
    void computePosition(anchor, this.tooltipEl, {
      strategy: "absolute",
      placement: "bottom-start",
      middleware: [
        offset(12),
        flip({ boundary, padding: OVERLAY_PADDING, fallbackPlacements: ["top-start", "bottom-end", "top-end", "right", "left"] }),
        shift({ boundary, padding: OVERLAY_PADDING, crossAxis: true }),
      ],
    }).then(({ x, y }) => {
      if (this.tooltipAnchor !== anchor) return;
      Object.assign(this.tooltipEl.style, { left: `${x}px`, top: `${y}px` });
    });
  }

  // -------------------------------------------------------------------------
  // Popover (issue #23 B1)
  // -------------------------------------------------------------------------

  private openPopover(action: import("../../shared/types.js").PopupAction, area: Area) {
    const content = action.content;
    const templatedBody = this.resolveAreaTemplate(area);
    const active = this.getActiveElement();
    this.popoverReturnFocus = active instanceof HTMLElement || active instanceof SVGElement
      ? active
      : null;
    this.stopPopoverTracking?.();
    this.stopPopoverTracking = null;
    this.popoverEl.innerHTML = "";
    // Content scrolls inside the popover so Close stays reachable when space is short.
    const bodyEl = document.createElement("div");
    bodyEl.className = "clickmap-popover-body";
    this.popoverEl.appendChild(bodyEl);

    // Build content
    if (content.imageUrl) {
      if (validateActionUrl(content.imageUrl).valid) {
        const img = document.createElement("img");
        img.src = content.imageUrl;
        img.alt = "";
        img.style.cssText = "display:block;width:100%;max-height:120px;object-fit:cover;border-radius:2px 2px 0 0;margin-bottom:6px;";
        bodyEl.appendChild(img);
      }
    }

    if (content.title && templatedBody === null) {
      const h = document.createElement("strong");
      h.style.cssText = "display:block;margin-bottom:4px;";
      h.textContent = content.title;
      bodyEl.appendChild(h);
    }

    if (templatedBody !== null || content.body) {
      const p = document.createElement("div");
      p.innerHTML = sanitiseHtml(templatedBody ?? content.body ?? "");
      p.style.fontSize = "12px";
      bodyEl.appendChild(p);
    }

    if (content.linkHref && validateActionUrl(content.linkHref).valid) {
      const a = document.createElement("a");
      a.href = content.linkHref;
      a.textContent = content.linkLabel ?? content.linkHref;
      a.style.cssText = "display:block;margin-top:6px;font-size:12px;color:#3b82f6;";
      bodyEl.appendChild(a);
    }

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.className = "clickmap-popover-close";
    closeBtn.addEventListener("click", () => this.closePopover());
    this.popoverEl.appendChild(closeBtn);

    this.popoverEl.setAttribute("aria-hidden", "false");
    this.popoverEl.className = "clickmap-popover clickmap-popover--visible";
    this.openPopoverId = area.id;
    // After openPopoverId is set: placement results for a closed popover are dropped.
    this.trackPopover(area, action.position ?? "auto");
    this.emitter.emit({ type: "popup:open", popupId: area.id });

    // Aria live announcement
    this.ariaLiveEl.textContent = templatedBody === null ? (content.title ?? "Popup opened") : area.name;
    setTimeout(() => { this.ariaLiveEl.textContent = ""; }, 1000);

    // Focus trap
    setTimeout(() => closeBtn.focus(), 0);
  }

  /**
   * Anchor the open popover to the area's rendered element and keep it inside
   * the map box: flip to the side with room, shift along the edge, and cap its
   * size so content scrolls instead of being clipped. autoUpdate follows host
   * resizes, layout shifts and late-loading images while the popover is open;
   * camera changes call refreshOverlays() because they move the SVG content
   * without resizing any element.
   */
  private trackPopover(area: Area, position: string) {
    const areaEl = this.findAreaEl(area.id);
    const root = this.root;
    const reference: Element | VirtualElement = areaEl ?? {
      contextElement: root,
      getBoundingClientRect: () => {
        const r = root.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        return { x: cx, y: cy, left: cx, top: cy, right: cx, bottom: cy, width: 0, height: 0 };
      },
    };
    this.popoverPlacement = position === "top" || position === "left" || position === "right" ? position : "bottom";
    const update = () => this.placePopover(reference);
    this.stopPopoverTracking = autoUpdate(reference, this.popoverEl, update, { animationFrame: false });
  }

  private placePopover(reference: Element | VirtualElement) {
    const boundary = this.root;
    const popover = this.popoverEl;
    const opening = this.openPopoverId;
    void computePosition(reference, popover, {
      strategy: "absolute",
      placement: this.popoverPlacement,
      middleware: [
        offset(8),
        flip({ boundary, padding: OVERLAY_PADDING }),
        shift({ boundary, padding: OVERLAY_PADDING }),
        size({
          boundary,
          padding: OVERLAY_PADDING,
          apply({ availableWidth, availableHeight }) {
            popover.style.maxWidth = `${Math.max(120, Math.min(220, availableWidth))}px`;
            popover.style.maxHeight = `${Math.max(64, availableHeight)}px`;
          },
        }),
      ],
    }).then(({ x, y, placement, middlewareData }) => {
      if (this.openPopoverId !== opening || this.openPopoverId === null) return;
      const side = placement.split("-")[0];
      popover.className = `clickmap-popover clickmap-popover--${side} clickmap-popover--visible`;
      // Keep the arrow pointing at the area after shift() moved the box.
      const shiftX = middlewareData.shift?.x ?? 0;
      const shiftY = middlewareData.shift?.y ?? 0;
      popover.style.setProperty("--clickmap-arrow-shift", `${side === "top" || side === "bottom" ? -shiftX : -shiftY}px`);
      Object.assign(popover.style, { left: `${x}px`, top: `${y}px`, transform: "" });
    });
  }

  /** Re-place visible overlays after the camera or host size changed. */
  private refreshOverlays() {
    if (this.tooltipAnchor && this.tooltipEl.classList.contains("clickmap-tooltip--visible")) this.placeTooltip();
    if (this.openPopoverId !== null) {
      const areaEl = this.findAreaEl(this.openPopoverId);
      if (areaEl) this.placePopover(areaEl);
    }
  }

  private closePopover() {
    if (this.openPopoverId === null) return;
    const popupId = this.openPopoverId;
    this.openPopoverId = null;
    this.stopPopoverTracking?.();
    this.stopPopoverTracking = null;
    this.popoverEl.setAttribute("aria-hidden", "true");
    this.popoverEl.classList.remove("clickmap-popover--visible");
    this.popoverEl.innerHTML = "";
    if (this.popoverReturnFocus?.isConnected) this.popoverReturnFocus.focus();
    this.popoverReturnFocus = null;
    this.emitter.emit({ type: "popup:close", popupId });
  }

  private getActiveElement(): Element | null {
    return this.shadowRoot?.activeElement ?? document.activeElement;
  }

  // -------------------------------------------------------------------------
  // Responsive scaling
  // -------------------------------------------------------------------------

  private updateScale() {
    const mode = resolveSizingMode(this.def.settings);
    this.root.dataset.sizing = mode;
    this.updateCompact();
    this.root.style.width = mode === "fixed" ? `${this.viewW}px` : "100%";
    this.root.style.height = mode === "fixed" ? `${this.viewH}px` : mode === "fill-container" ? "100%" : "auto";
    // The view's children are absolutely positioned, so it has no intrinsic
    // height: it must fill the sized root (fixed, fill-container) or derive its
    // height from the canvas aspect ratio (fluid-width).
    this.viewEl.style.width = "100%";
    this.viewEl.style.height = mode === "fluid-width" ? "auto" : "100%";
    if (mode === "fluid-width" && this.viewW > 0 && this.viewH > 0) {
      this.viewEl.style.aspectRatio = `${this.viewW} / ${this.viewH}`;
    } else {
      this.viewEl.style.removeProperty("aspect-ratio");
    }
    if (this.def.settings.areaLabels?.enabled && this.def.settings.areaLabels.hideWhenSmaller !== false) {
      this.updateLabelVisibility();
    }
    this.refreshOverlays();
  }

  /** Switch control forms when the renderer (not the window) crosses the compact size. */
  private updateCompact() {
    const { width, height } = this.root.getBoundingClientRect();
    // A zero-size host (hidden, not laid out yet) keeps its current mode.
    if (width === 0 && height === 0) return;
    const compact = width < COMPACT_WIDTH || height < COMPACT_HEIGHT;
    if (compact === this.compact) return;
    this.compact = compact;
    this.root.classList.toggle("clickmap-root--compact", compact);
    if (!compact) this.setDirectoryOpen(false);
    this.renderSceneSwitcher();
  }

  // -------------------------------------------------------------------------
  // Fade transition
  // -------------------------------------------------------------------------

  private cancelTransition() {
    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.viewEl) {
      this.viewEl.style.removeProperty("transition");
      this.viewEl.style.removeProperty("opacity");
    }
  }

  private fade(render: () => void, transition: "fade" | "none" = "fade") {
    this.cancelTransition();
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches ?? false;
    if (reduced || transition === "none") {
      render();
      return;
    }
    this.viewEl.style.transition = "opacity 0.15s ease";
    this.viewEl.style.opacity = "0";
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      if (this.destroyed) return;
      render();
      this.viewEl.style.opacity = "1";
    }, 150);
  }

  private focusNavigationDestination(viewId: string, preserveFocus: boolean) {
    const view = this.def.views.find((candidate) => candidate.id === viewId);
    if (!view) return;
    this.ariaLiveEl.textContent = `${view.name} view.`;
    if (!preserveFocus) return;

    const sceneControl = this.sceneSwitcherEl?.querySelector<HTMLElement>(
      `[data-view-id="${escId(viewId)}"]`
    ) ?? this.sceneSwitcherEl?.querySelector<HTMLElement>("select");
    const destination = sceneControl ?? this.svgEl.querySelector<SVGElement>('[tabindex="0"]') ?? this.backBtn;
    destination?.focus();
  }

  // -------------------------------------------------------------------------
  // Deep linking (issue #25 D1)
  // -------------------------------------------------------------------------

  private initDeepLink() {
    const hash = window.location.hash.slice(1); // strip #
    if (!hash) return;
    const [slugOrId, areaId] = hash.split("/");
    if (!slugOrId) return;

    const view = this.def.views.find((v) =>
      v.slug === slugOrId || v.id === slugOrId
    );
    if (view && view.id !== this.currentViewId) {
      this.currentViewId = view.id;
      this.renderView(view.id);
    }

    if (areaId) {
      const el = this.findAreaEl(areaId);
      el?.setAttribute("data-deep-linked", "true");
    }
  }

  private updateDeepLinkHash(viewId: string, areaId?: string) {
    const url = this.deepLinkUrl(viewId, areaId);
    if (!url) return;
    history.replaceState(history.state, "", url);
  }

  private deepLinkUrl(viewId: string, areaId?: string): string | null {
    if (!this.options.deepLink?.enabled) return null;
    const view = this.def.views.find((v) => v.id === viewId);
    if (!view) return null;
    const useSlug = this.options.deepLink.useSlug !== false;
    const viewSlug = (useSlug && view.slug) ? view.slug : view.id;
    const hash = areaId ? `${viewSlug}/${areaId}` : viewSlug;
    return `#${hash}`;
  }

  private getOwnedHistoryState(state: unknown = history.state): ClickMapHistoryState {
    if (!state || typeof state !== "object") return {};
    const owned = (state as Record<string, unknown>)[HISTORY_STATE_KEY];
    if (!owned || typeof owned !== "object" || Array.isArray(owned)) return {};
    return { ...(owned as ClickMapHistoryState) };
  }

  private historyStateWithView(viewId: string): Record<string, unknown> {
    const hostState = history.state && typeof history.state === "object" && !Array.isArray(history.state)
      ? { ...history.state as Record<string, unknown> }
      : {};
    return {
      ...hostState,
      [HISTORY_STATE_KEY]: {
        ...this.getOwnedHistoryState(),
        [this.instanceId]: { viewId, stack: [...this.navigationStack] },
      },
    };
  }

  private replaceOwnedHistoryState(viewId: string) {
    history.replaceState(this.historyStateWithView(viewId), "", window.location.href);
  }

  private pushOwnedHistoryState(viewId: string) {
    history.pushState(this.historyStateWithView(viewId), "", this.deepLinkUrl(viewId) ?? window.location.href);
  }

  private onPopState = (event: PopStateEvent) => {
    if (this.destroyed || !this.def.settings.enableHistory) return;
    const target = this.getOwnedHistoryState(event.state)[this.instanceId];
    if (!target || !Array.isArray(target.stack)) return;
    this.navigationStack = [...target.stack];
    if (target.viewId === this.currentViewId) return;
    this.navigateToView(target.viewId, { transition: "none", historyMode: "browser" });
  };

  private navigateToView(
    viewId: string,
    options: { transition?: "fade" | "none"; historyMode: "push" | "browser" | "none" },
  ) {
    if (viewId === this.currentViewId || this.navigationInProgress) return;
    if (!this.def.views.some((view) => view.id === viewId)) {
      this.emitter.emit({ type: "error", code: "VIEW_NOT_FOUND", message: `View "${viewId}" not found` });
      return;
    }
    const active = this.getActiveElement();
    const preserveFocus = Boolean(active && (this.root.contains(active) || this.shadowRoot?.contains(active)));
    const prev = this.currentViewId;
    this.navigationInProgress = true;
    this.emitter.emit({ type: "view:leave", instanceId: this.instanceId, viewId: prev, nextViewId: viewId });
    this.navigationInProgress = false;
    if (options.historyMode !== "browser") this.navigationStack.push(prev);
    this.currentViewId = viewId;
    this.fade(() => {
      this.renderView(viewId);
      this.focusNavigationDestination(viewId, preserveFocus);
      this.navigationInProgress = true;
      this.emitter.emit({ type: "view:enter", instanceId: this.instanceId, viewId });
      this.emitter.emit({ type: "view:change", previousViewId: prev, currentViewId: viewId });
      this.navigationInProgress = false;
    }, options.transition);
    if (this.def.settings.enableHistory && options.historyMode === "push") {
      this.pushOwnedHistoryState(viewId);
    } else if (options.historyMode !== "browser") {
      this.updateDeepLinkHash(viewId);
    }
  }

  // -------------------------------------------------------------------------
  // ClickMapInstance public API
  // -------------------------------------------------------------------------

  goToView(viewId: string) {
    this.navigateToView(viewId, { transition: "fade", historyMode: "push" });
  }

  goBack() {
    if (this.navigationInProgress) return;
    const prev = this.navigationStack.pop();
    if (prev === undefined) return;
    const active = this.getActiveElement();
    const preserveFocus = Boolean(active && (this.root.contains(active) || this.shadowRoot?.contains(active)));
    const from = this.currentViewId;
    this.navigationInProgress = true;
    this.emitter.emit({ type: "view:leave", instanceId: this.instanceId, viewId: from, nextViewId: prev });
    this.navigationInProgress = false;
    this.currentViewId = prev;
    this.fade(() => {
      this.renderView(prev);
      this.focusNavigationDestination(prev, preserveFocus);
      this.navigationInProgress = true;
      this.emitter.emit({ type: "view:enter", instanceId: this.instanceId, viewId: prev });
      this.emitter.emit({ type: "view:change", previousViewId: from, currentViewId: prev });
      this.navigationInProgress = false;
    });
    if (this.def.settings.enableHistory) this.pushOwnedHistoryState(prev);
    else this.updateDeepLinkHash(prev);
  }

  reset() {
    this.cancelTransition();
    const from = this.currentViewId;
    const to = this.def.settings.initialViewId;
    if (this.navigationInProgress) return;
    this.navigationInProgress = true;
    if (from !== to) this.emitter.emit({ type: "view:leave", instanceId: this.instanceId, viewId: from, nextViewId: to });
    this.navigationStack = [];
    this.layerVisibility.clear();
    this.currentViewId = this.def.settings.initialViewId;
    this.renderView(this.currentViewId);
    if (from !== to) {
      this.emitter.emit({ type: "view:enter", instanceId: this.instanceId, viewId: to });
      this.emitter.emit({ type: "view:change", previousViewId: from, currentViewId: to });
    }
    this.emitCameraChange("reset");
    this.navigationInProgress = false;
    this.updateDeepLinkHash(this.currentViewId);
    if (this.def.settings.enableHistory) this.replaceOwnedHistoryState(this.currentViewId);
  }

  getCurrentView() {
    return this.currentViewId;
  }

  getDefinition() {
    return this.def;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.navigationInProgress = false;
    this.stopPopoverTracking?.();
    this.stopPopoverTracking = null;
    this.cancelTransition();
    if (this.roTimer !== null) clearTimeout(this.roTimer);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onWindowKeyDown);
    window.removeEventListener("keyup", this.onWindowKeyUp);
    window.removeEventListener("pointermove", this.onWindowPointerMove);
    window.removeEventListener("pointerup", this.onWindowPointerUp);
    window.removeEventListener("popstate", this.onPopState);
    document.removeEventListener("click", this.onDocumentClick);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    this.svgEl.removeEventListener("wheel", this.onWheel);
    this.emitter.clear();
    if (this.shadowRoot) {
      // Shadow roots cannot be detached; clear all renderer-owned contents.
      this.shadowRoot.replaceChildren();
    } else {
      this.viewStyleEl?.remove();
      this.root.remove();
    }
  }

  on<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ) {
    this.emitter.on(eventName, callback);
  }

  off<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ) {
    this.emitter.off(eventName, callback);
  }
}

// ---------------------------------------------------------------------------
// Deferred renderer (for definitionUrl — async fetch)
// ---------------------------------------------------------------------------

type QueuedOp =
  | { kind: "on"; type: string; cb: Function }
  | { kind: "off"; type: string; cb: Function }
  | { kind: "goToView"; viewId: string }
  | { kind: "goBack" }
  | { kind: "reset" }
  | { kind: "destroy" }
  | { kind: "setChoroplethData"; data: Array<{ id: string; value: number }> };

class DeferredRenderer implements ClickMapInstance {
  private inner: Renderer | null = null;
  private queue: QueuedOp[] = [];
  private emitter = new Emitter();
  private destroyed = false;
  private abortController = new AbortController();

  constructor(options: RendererOptions) {
    fetch(options.definitionUrl!, { signal: this.abortController.signal })
      .then((r) => {
        if (!r.ok)
          throw new Error(`HTTP ${r.status} loading definition`);
        return Promise.resolve(r.json() as Promise<ClickMapDefinition>)
          .then((def) => ({ def, responseUrl: r.url }));
      })
      .then(({ def, responseUrl }) => {
        if (this.destroyed) return;
        const fallbackUrl = new URL(options.definitionUrl!, document.baseURI).href;
        this.inner = new Renderer(
          { ...options, assetBaseUrl: options.assetBaseUrl ?? (responseUrl || fallbackUrl) },
          def,
        );
        for (const op of this.queue) {
          if (op.kind === "on")
            this.inner.on(op.type as ClickMapEventType, op.cb as never);
          else if (op.kind === "off")
            this.inner.off(op.type as ClickMapEventType, op.cb as never);
          else if (op.kind === "goToView") this.inner.goToView(op.viewId);
          else if (op.kind === "goBack") this.inner.goBack();
          else if (op.kind === "reset") this.inner.reset();
          else if (op.kind === "destroy") this.inner.destroy();
          else if (op.kind === "setChoroplethData") this.inner.setChoroplethData(op.data);
        }
        this.queue = [];
      })
      .catch((err: Error) => {
        if (this.destroyed) return;
        this.emitter.emit({
          type: "error",
          code: "LOAD_FAILED",
          message: err.message,
        });
      });
  }

  goToView(viewId: string) {
    this.inner ? this.inner.goToView(viewId) : this.queue.push({ kind: "goToView", viewId });
  }
  goBack() {
    this.inner ? this.inner.goBack() : this.queue.push({ kind: "goBack" });
  }
  reset() {
    this.inner ? this.inner.reset() : this.queue.push({ kind: "reset" });
  }
  getCurrentView() {
    return this.inner?.getCurrentView() ?? "";
  }
  getDefinition(): ClickMapDefinition {
    if (!this.inner) throw new Error("ClickMapRenderer: definition not yet loaded");
    return this.inner.getDefinition();
  }
  setChoroplethData(data: Array<{ id: string; value: number }>) {
    this.inner ? this.inner.setChoroplethData(data) : this.queue.push({ kind: "setChoroplethData", data });
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    this.inner?.destroy();
    this.queue = [];
  }
  on<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ) {
    this.emitter.on(eventName, callback);
    this.inner
      ? this.inner.on(eventName, callback)
      : this.queue.push({ kind: "on", type: eventName, cb: callback as Function });
  }
  off<T extends ClickMapEventType>(
    eventName: T,
    callback: (event: Extract<ClickMapEvent, { type: T }>) => void
  ) {
    this.emitter.off(eventName, callback);
    this.inner
      ? this.inner.off(eventName, callback)
      : this.queue.push({ kind: "off", type: eventName, cb: callback as Function });
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function create(options: RendererOptions): ClickMapInstance {
  if (options.definition) return new Renderer(options, options.definition);
  if (options.definitionUrl) return new DeferredRenderer(options);
  throw new Error(
    "ClickMapRenderer.create: provide either `definition` or `definitionUrl`"
  );
}

// ---------------------------------------------------------------------------
// CSS injection helper — called by build to inline the CSS string
// ---------------------------------------------------------------------------

export function __setInlinedCSS(css: string) {
  _inlinedCSS = css;
}
