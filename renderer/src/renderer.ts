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
  Layer,
  AreaStyleState,
} from "../../shared/types.js";
import { scopeViewCss, validateViewCss } from "../../shared/view-css.js";
import { validateActionUrl } from "../../shared/validation.js";
import { sanitizeRichHtml } from "../../shared/sanitize.js";
import { decodeDefinition } from "../../shared/schema.js";
import { resolveSizingMode } from "../../shared/sizing.js";
import { assetDisplaySource, fitImageRect, geometryBounds, markerPathData } from "../../shared/scene-geometry.js";
import { alphaMaskHit, areaImagePlacement, imagePreserveAspectRatio, imageRotationTransform, isAreaHidden } from "../../shared/area-image.js";
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

/** Rendered bounds for shapes without analytic bounds (free-form paths). */
function svgBBox(el: Element): { x: number; y: number; width: number; height: number } {
  try {
    const b = (el as SVGGraphicsElement).getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
}

function escId(id: string): string {
  return CSS.escape(id);
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
  private currentViewId = "";
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
  private breadcrumbsEl: HTMLElement | null = null;
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
  private maskedViews = new Map<string, boolean>();
  private pinnedTooltipId: string | null = null;
  /** The current view's selected area, painted with `style.active` until cleared. */
  private selectedId: string | null = null;
  /** Directory reveal waiting for its destination view to finish rendering. */
  private pendingReveal: { viewId: string; run: () => void } | null = null;
  /** Re-filters the directory after effective layer visibility changes. */
  private refreshDirectory: (() => void) | null = null;
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

  // Events raised while the instance is being built are held until create()
  // has returned, so an immediate on("error") still receives them (#169).
  private constructing = true;
  private pendingEvents: ClickMapEvent[] = [];

  private emit(event: ClickMapEvent) {
    if (this.constructing) {
      this.pendingEvents.push(event);
      return;
    }
    this.flushPendingEvents();
    this.emitter.emit(event);
  }

  private flushPendingEvents() {
    const pending = this.pendingEvents;
    this.pendingEvents = [];
    if (!this.destroyed) for (const event of pending) this.emitter.emit(event);
  }

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

    try {
      this.mount(options, def);
    } catch (error) {
      // Unwind partial DOM and listeners; create() reports the failure.
      this.destroy();
      throw error;
    }

    // Defer readiness until create() has returned so callers can subscribe on
    // the immediately returned instance. A same-turn destroy cancels it.
    this.constructing = false;
    queueMicrotask(() => {
      this.flushPendingEvents();
      if (!this.destroyed) this.emitter.emit({ type: "ready", definition: def });
    });
  }

  private mount(options: RendererOptions, def: ClickMapDefinition) {
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
    // Non-modal: the popup is anchored details for one area. It never traps
    // Tab or claims keys outside its own map, so the host page stays usable.
    this.popoverEl.setAttribute("role", "dialog");
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
    this.root.addEventListener("keydown", (e) => this.onRootKeyDown(e));
    window.addEventListener("pointermove", this.onWindowPointerMove);
    window.addEventListener("pointerup", this.onWindowPointerUp);

    // Close popover on outside click
    document.addEventListener("click", this.onDocumentClick);
  }

  private renderDirectory() {
    const config = this.def.settings.directory;
    if (!config?.enabled) return;

    // Every layer is indexed once; effective (authored + runtime) visibility is
    // applied on each update, so toggled and reset layers stay in sync with the map.
    type Entry = { area: Area; view: View; layer: Layer; search: string; category: string };
    const entries: Entry[] = [];
    for (const view of this.def.views) {
      for (const layer of view.layers) {
        for (const area of layer.areas) {
          if (isAreaHidden(area)) continue;
          const metadataText = (config.metadataKeys ?? []).map((key) => area.metadata?.[key])
            .filter((value) => value !== undefined && value !== null)
            .map(String).join(" ");
          entries.push({
            area,
            view,
            layer,
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
      // Hidden layers (authored or toggled at runtime) are intentionally undiscoverable.
      const matches = entries.filter((entry) => this.isLayerVisible(entry.view, entry.layer) &&
        (!query || entry.search.includes(query)) && (!category || entry.category === category));
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
    this.refreshDirectory = update;
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
      if (this.destroyed || this.currentViewId !== view.id) return;
      const el = this.findAreaEl(area.id);
      if (!el) return;
      const shape = geometryBounds(area.geometry) ?? svgBBox(el);
      const bounds = { x: shape.x, y: shape.y, w: shape.width, h: shape.height };
      const base = this.getBaseViewBox(view);
      const limits = this.getZoomLimits(view);
      const targetZoom = Math.max(limits.min, Math.min(limits.max, Math.min(base.w / Math.max(bounds.w * 2, 1), base.h / Math.max(bounds.h * 2, 1))));
      const width = base.w / targetZoom;
      const height = base.h / targetZoom;
      this.currentViewBox = { x: bounds.x + bounds.w / 2 - width / 2, y: bounds.y + bounds.h / 2 - height / 2, w: width, h: height };
      this.applyViewBox();
      this.emitCameraChange("reveal");
      this.setSelection(area.id);
      el.focus();
      this.ariaLiveEl.textContent = `${area.name}, ${view.name}`;
    };
    // Only the latest choice may reveal: a newer one replaces any pending reveal.
    this.pendingReveal = null;
    if (view.id !== this.currentViewId) {
      this.goToView(view.id);
      // Navigation was refused (re-entrant or unknown view): nothing to reveal.
      if (this.currentViewId !== view.id) return;
    }
    if (this.transitionTimer !== null) {
      // The destination is still fading in; reveal once its render completes.
      this.pendingReveal = { viewId: view.id, run: reveal };
    } else reveal();
  }

  /** Called when a view render finishes: run a reveal waiting for exactly that view. */
  private completePendingReveal(viewId: string) {
    const pending = this.pendingReveal;
    this.pendingReveal = null;
    if (pending && pending.viewId === viewId && !this.destroyed) pending.run();
  }

  // -------------------------------------------------------------------------
  // View rendering
  // -------------------------------------------------------------------------

  private renderView(viewId: string) {
    const view = this.def.views.find((v) => v.id === viewId);
    if (!view) {
      this.emit({
        type: "error",
        code: "VIEW_NOT_FOUND",
        message: `View "${viewId}" not found`,
      });
      return;
    }

    this.hoveredId = null;
    this.focusedId = null;
    this.pinnedTooltipId = null;
    // Navigation and reset already announced the cleared selection; the old
    // nodes are replaced below, so the view always starts unselected.
    this.selectedId = null;
    this.hideTooltip();
    this.closePopover();
    this.viewW = view.canvas.width;
    this.viewH = view.canvas.height;
    this.applyViewCss(view);

    this.renderBackground(view);
    // Entering a view starts from its authored camera; later scene refreshes
    // (layer toggles) keep whatever camera the visitor has since chosen.
    this.resetCameraForView(view);
    this.svgEl.replaceChildren();
    this.syncLayers(view);
    this.renderLabels(view);
    this.svgEl.style.touchAction = view.viewport.panEnabled ? "none" : "auto";
    this.renderBreadcrumbs(view);
    this.renderBackButton(view);
    this.renderSceneSwitcher();
    this.renderZoomControls();
    this.updateScale();
    this.renderChoroplethLegend();
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
      this.emit({ type: "error", code: "INVALID_VIEW_CSS", message: `${view.name}: ${error}` });
      return;
    }
    try {
      this.viewStyleEl.textContent = scopeViewCss(css, `[data-clickmap-instance="${this.instanceId}"]`);
    } catch (reason) {
      this.viewStyleEl.textContent = "";
      this.emit({ type: "error", code: "INVALID_VIEW_CSS", message: `${view.name}: ${(reason as Error).message}` });
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
    const src = assetDisplaySource(asset.src, this.assetBaseUrl);
    this.reportAssetFailure(image, asset.name);
    image.setAttribute("href", src);

    const placed = fitImageRect({ width, height }, asset, fit, view.background.position);
    image.setAttribute("x", String(placed.x));
    image.setAttribute("y", String(placed.y));
    image.setAttribute("width", String(placed.width));
    image.setAttribute("height", String(placed.height));
    image.setAttribute("preserveAspectRatio", "none");

    backgroundSvg.appendChild(image);
    this.bgEl.appendChild(backgroundSvg);
    this.bgSvgEl = backgroundSvg;
  }

  private resetCameraForView(view: View) {
    const base = this.getBaseViewBox(view);
    this.currentViewBox = this.zoomedViewBox(base, this.getZoomLimits(view).initial);
    this.applyViewBox();
  }

  /** Effective visibility: a runtime toggle when present, otherwise the authored value. */
  private isLayerVisible(view: View, layer: Layer): boolean {
    return this.layerVisibility.get(view.id)?.get(layer.id) ?? layer.visible;
  }

  /**
   * Bring the rendered layer groups in line with effective visibility without
   * rebuilding layers that stay visible, so their SVG nodes (and any keyboard
   * focus, hover or open popover anchored to them) survive. Returns the groups
   * that were removed.
   */
  private syncLayers(view: View): SVGGElement[] {
    const rendered = new Map<string, SVGGElement>();
    for (const child of Array.from(this.svgEl.children)) {
      if (child instanceof SVGGElement && child.classList.contains("clickmap-layer")) {
        rendered.set(child.getAttribute("data-layer-id") ?? "", child);
      }
    }
    const removed: SVGGElement[] = [];
    let previous: SVGGElement | null = null;
    for (const layer of view.layers) {
      const existing = rendered.get(layer.id) ?? null;
      if (!this.isLayerVisible(view, layer)) {
        if (existing) removed.push(existing);
        continue;
      }
      let g = existing;
      if (!g) {
        g = svgEl<SVGGElement>("g");
        g.setAttribute("class", "clickmap-layer");
        g.setAttribute("opacity", String(layer.opacity));
        g.setAttribute("data-layer-id", layer.id);
        for (const area of layer.areas) {
          if (isAreaHidden(area)) continue;
          const visual = this.makeAreaImageEl(area);
          if (visual) g.appendChild(visual);
          const el = this.makeAreaEl(area);
          if (!el) continue;
          this.applyAreaStyle(area, el);
          g.appendChild(el);
        }
        if (previous) previous.after(g);
        else this.svgEl.prepend(g);
      }
      previous = g;
    }
    for (const g of removed) g.remove();
    return removed;
  }

  /** Labels follow the same effective visibility as the geometry they name (issue #26). */
  private renderLabels(view: View) {
    this.svgEl.querySelector(":scope > .clickmap-area-labels")?.remove();
    const labelSettings = this.def.settings.areaLabels;
    if (!labelSettings?.enabled) return;

    const labelsG = svgEl<SVGGElement>("g");
    labelsG.setAttribute("class", "clickmap-area-labels");
    labelsG.setAttribute("pointer-events", "none");

    for (const layer of view.layers) {
      if (!this.isLayerVisible(view, layer)) continue;
      for (const area of layer.areas) {
        if (area.label?.visible === false || isAreaHidden(area)) continue;
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

  private updateLabelVisibility() {
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    if (!view) return;
    const labelsG = this.svgEl.querySelector<SVGGElement>(".clickmap-area-labels");
    if (!labelsG) return;
    for (const textEl of Array.from(labelsG.querySelectorAll<SVGTextElement>("[data-label-area]"))) {
      const areaId = textEl.getAttribute("data-label-area")!;
      const area = this.findAreaInView(areaId, view);
      if (!area) continue;
      const bbox = this.getAreaBBox(area);
      if (!bbox) continue;
      // getBBox() and the area bounds are both in canvas (user) units, so
      // the comparison holds at every zoom level.
      try {
        const tb = (textEl as SVGTextElement).getBBox();
        textEl.setAttribute("visibility", tb.width > bbox.w ? "hidden" : "visible");
      } catch {
        // getBBox unavailable in non-rendered context (tests) — skip
      }
    }
  }

  private getAreaBBox(area: Area): { cx: number; cy: number; w: number; h: number } | null {
    const b = geometryBounds(area.geometry);
    return b ? { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height } : null;
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

  /**
   * The trail of visited views, oldest first, ending at the current view
   * (#217). Earlier entries are buttons that return to that view, dropping
   * the views visited after it; the current view is marked aria-current.
   */
  private renderBreadcrumbs(view: View) {
    this.breadcrumbsEl?.remove();
    this.breadcrumbsEl = null;
    const stack = this.navigationStack;
    if (!view.ui.showBreadcrumbs || stack.length === 0) return;

    const nav = document.createElement("nav");
    nav.className = "clickmap-breadcrumbs";
    nav.setAttribute("aria-label", "Breadcrumb");
    const list = document.createElement("ol");
    [...stack, view.id].forEach((viewId, depth) => {
      const item = document.createElement("li");
      const current = depth === stack.length;
      const crumb = document.createElement(current ? "span" : "button");
      crumb.className = "clickmap-crumb";
      crumb.textContent = crumb.title = this.def.views.find((candidate) => candidate.id === viewId)?.name ?? viewId;
      if (current) crumb.setAttribute("aria-current", "page");
      else {
        crumb.setAttribute("type", "button");
        crumb.addEventListener("click", () => this.goBackTo(depth));
      }
      item.append(crumb);
      list.append(item);
    });
    nav.append(list);
    this.slots.get("top-left")!.prepend(nav);
    this.breadcrumbsEl = nav;
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
    // Buttons and tabs share one group name; the dropdown is named by its own label.
    if (style !== "dropdown") {
      el.setAttribute("role", style === "tabs" ? "tablist" : "group");
      el.setAttribute("aria-label", "Views");
    }

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
      // The event target is the focused button in light and Shadow DOM alike;
      // document.activeElement would be the shadow host.
      const idx = btns.indexOf(e.target as HTMLButtonElement);
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
    if (e.code !== "Space" || e.repeat) return;
    // The composed path reaches into open shadow roots, so the real target is
    // known in both DOM modes. Space keeps its native meaning in text fields,
    // buttons, links and other controls, inside the map or on the host page.
    const path = e.composedPath();
    const target = path[0];
    if (target instanceof HTMLElement && (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY|IFRAME|AUDIO|VIDEO)$/.test(target.tagName) ||
      target.closest('[contenteditable]:not([contenteditable="false"])'))) return;
    // Claim Space only when focus is inside this map, or nothing in particular
    // is focused and the pointer is over it. Another map or a host control keeps it.
    const pageFocus = target === document.body || target === document.documentElement || target === window || target === document;
    if (path.includes(this.root) || (pageFocus && this.root.matches(":hover"))) {
      this.spaceHeld = true;
      e.preventDefault();
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
    this.emit({
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
        const p = svgEl<SVGPathElement>("path");
        p.setAttribute("d", markerPathData(g.x, g.y, g.anchor));
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
      shape.setAttribute("tabindex", "-1");
    } else {
      shape.setAttribute("tabindex", String(area.image?.decorative && area.action.type === "none" ? -1 : (area.accessibility?.tabIndex ?? 0)));
      shape.setAttribute("role", "button");
      shape.setAttribute(
        "aria-label",
        area.accessibility?.ariaLabel?.trim() || area.name
      );
      if (area.tooltip?.enabled) {
        shape.setAttribute("aria-describedby", this.tooltipEl.id);
      }
    }
    // A masked shape's transparent pixels may sit over another area, so its
    // cursor follows the hit test (set on the SVG) instead of the shape.
    if (!area.image?.hitMask) shape.style.cursor = areaCursor(area);

    return shape;
  }

  private reportAssetFailure(image: SVGImageElement, name: string) {
    image.addEventListener("error", () => {
      if (!this.destroyed) this.emit({ type: "error", code: "ASSET_LOAD_FAILED", message: `Image "${name}" could not be loaded.` });
    }, { once: true });
  }

  private makeAreaImageEl(area: Area): SVGImageElement | null {
    if (!area.image || area.geometry.type !== "rect") return null;
    const asset = this.def.assets.find((candidate) => candidate.id === area.image!.assetId);
    if (!asset) return null;
    const image = svgEl<SVGImageElement>("image");
    this.reportAssetFailure(image, asset.name);
    image.setAttribute("href", assetDisplaySource(asset.src, this.assetBaseUrl));
    image.setAttribute("x", String(area.geometry.x));
    image.setAttribute("y", String(area.geometry.y));
    image.setAttribute("width", String(area.geometry.width));
    image.setAttribute("height", String(area.geometry.height));
    image.setAttribute("preserveAspectRatio", imagePreserveAspectRatio(area.image.fit));
    image.setAttribute("opacity", String(area.image.opacity ?? 1));
    const rotation = imageRotationTransform(areaImagePlacement(area.geometry, area.image));
    if (rotation) image.setAttribute("transform", rotation);
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

  /** Repaint every rendered area of the current view through the style resolver. */
  private applyChoropleth() {
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    if (view) {
      for (const layer of view.layers) {
        for (const area of layer.areas) {
          const el = this.findAreaEl(area.id);
          if (el) this.applyAreaStyle(area, el);
        }
      }
    }
    this.renderChoroplethLegend();
  }

  private renderChoroplethLegend() {
    this.root.querySelector(".clickmap-legend")?.remove();
    const opts = this.choroplethOptions;
    if (!opts?.legend || this.choroplethData.size === 0) return;

    const legend = document.createElement("div");
    legend.className = "clickmap-legend";
    legend.style.cssText =
      `background:rgba(255,255,255,0.9);border:1px solid #ccc;border-radius:4px;padding:6px 8px;font-size:11px;`;

    const { min: minV, max: maxV } = this.getChoroplethRange();

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

  private choroplethRange: { min: number; max: number } | null = null;

  private getChoroplethRange() {
    if (!this.choroplethRange) {
      const values = Array.from(this.choroplethData.values());
      this.choroplethRange = { min: Math.min(...values), max: Math.max(...values) };
    }
    return this.choroplethRange;
  }

  setChoroplethData(data: Array<{ id: string; value: number }>) {
    this.choroplethData.clear();
    this.choroplethRange = null;
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
    const { min, max } = this.getChoroplethRange();
    el.setAttribute("fill", lerpColor(opts.colorLow, opts.colorHigh, (value - min) / (max - min || 1)));
  }

  /**
   * The single style resolver for an area's current state. Precedence:
   * disabled, then selected (`style.active`), then hover/focus, then resting
   * (always-highlight, choropleth or default).
   */
  private applyAreaStyle(area: Area, el: SVGElement) {
    if (!area.disabled && this.selectedId === area.id) {
      this.applyStyle(el, area.style.active);
    } else if (!area.disabled && (this.hoveredId === area.id || this.focusedId === area.id)) {
      this.applyStyle(el, area.style.hover);
    } else {
      this.applyRestingStyle(area, el);
    }
  }

  /**
   * Make `id` the current view's selected area, or clear the selection with
   * null. Repaints both areas through the resolver, mirrors the selection in
   * `aria-current` and (optionally) an enabled deep link, and emits
   * `area:select`. Unknown, hidden and disabled areas cannot be selected.
   */
  private setSelection(id: string | null, updateHash = true) {
    const area = id === null ? null : this.findAreaInCurrentView(id);
    const el = id === null ? null : this.findAreaEl(id);
    if (id !== null && (!area || !el || area.disabled)) return;
    const previous = this.selectedId;
    if (previous === id) return;
    this.selectedId = id;
    if (previous !== null) {
      const prevArea = this.findAreaInCurrentView(previous);
      const prevEl = this.findAreaEl(previous);
      prevEl?.removeAttribute("aria-current");
      if (prevArea && prevEl) this.applyAreaStyle(prevArea, prevEl);
    }
    if (area && el) {
      el.setAttribute("aria-current", "true");
      this.applyAreaStyle(area, el);
    }
    if (updateHash) this.updateDeepLinkHash(this.currentViewId, id ?? undefined);
    this.emit({
      type: "area:select",
      instanceId: this.instanceId,
      viewId: this.currentViewId,
      areaId: id,
      areaName: area?.name ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Event helpers
  // -------------------------------------------------------------------------

  private findAreaEl(areaId: string): SVGElement | null {
    return this.svgEl.querySelector<SVGElement>(
      `[data-area-id="${escId(areaId)}"]`
    );
  }

  /**
   * The enabled area an event targets. Keyboard and focus events use their
   * target element; pointer events use the paint-order hit test, so they never
   * depend on which DOM shape happened to receive the event.
   */
  private getAreaFromEvent(e: Event): { area: Area; el: SVGElement } | null {
    const hit = this.topAreaOfEvent(e);
    return hit && !hit.area.disabled ? hit : null;
  }

  private topAreaOfEvent(e: Event): { area: Area; el: SVGElement } | null {
    // A click with detail 0 was synthesized (element.click(), assistive tech) and has no real position.
    const pointer = e instanceof MouseEvent && (e.type !== "click" || e.detail > 0);
    return pointer ? this.areaAtPointer(e as MouseEvent) : this.areaOfElement(e.target as Element);
  }

  private areaOfElement(target: Element | null): { area: Area; el: SVGElement } | null {
    const el = target?.closest?.<SVGElement>("[data-area-id]");
    const area = el ? this.findAreaInCurrentView(el.getAttribute("data-area-id") ?? "") : null;
    return area && el ? { area, el } : null;
  }

  /**
   * Topmost area under the pointer, in paint order (disabled areas included,
   * so they still block what lies beneath). An area with a usable alpha mask is
   * hit only on its displayed opaque pixels: fitted, cropped and rotated with
   * its image, using the cached bitmap rather than canvas reads. Where it
   * rejects the point, the next area down is tried. Other areas, and masks that
   * cannot be decoded, use their rendered shape.
   */
  private areaAtPointer(e: MouseEvent): { area: Area; el: SVGElement } | null {
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    if (!view || !this.hasAlphaMasks(view)) return this.areaOfElement(e.target as Element);
    const matrix = this.svgEl.getScreenCTM();
    const root = this.svgEl.getRootNode() as Document | ShadowRoot;
    const stack = typeof root.elementsFromPoint === "function" ? root.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element];
    const underPointer = new Map<string, SVGElement>();
    for (const element of stack) {
      const hit = this.areaOfElement(element);
      if (hit && this.svgEl.contains(hit.el) && !underPointer.has(hit.area.id)) underPointer.set(hit.area.id, hit.el);
    }
    const point = matrix ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()) : null;
    for (let l = view.layers.length - 1; l >= 0; l--) {
      const layer = view.layers[l]!;
      if (!this.isLayerVisible(view, layer)) continue;
      for (let a = layer.areas.length - 1; a >= 0; a--) {
        const area = layer.areas[a]!;
        const mask = area.image?.hitMask;
        const masked = mask && point && area.geometry.type === "rect"
          ? alphaMaskHit(areaImagePlacement(area.geometry, area.image!, this.def.assets.find((asset) => asset.id === area.image!.assetId)), mask, point)
          : null;
        const el = masked === null ? underPointer.get(area.id) : masked ? this.findAreaEl(area.id) : null;
        if (el) return { area, el };
      }
    }
    return null;
  }

  private hasAlphaMasks(view: View): boolean {
    let cached = this.maskedViews.get(view.id);
    if (cached === undefined) {
      cached = view.layers.some((layer) => layer.areas.some((area) => area.image?.hitMask && !isAreaHidden(area)));
      this.maskedViews.set(view.id, cached);
    }
    return cached;
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

  /**
   * Hover follows the paint-order hit test. Pointer moves re-resolve it in
   * views with alpha masks, so crossing a transparent hole into opaque pixels
   * (or into an area beneath) updates hover without a new pointerover.
   */
  private updateHover(e: PointerEvent) {
    const masked = this.masked();
    const top = masked ? this.areaAtPointer(e) : this.areaOfElement(e.target as Element);
    if (masked) this.svgEl.style.cursor = top ? areaCursor(top.area) : "";
    const next = top && !top.area.disabled && (top.area.trigger ?? "both") !== "click" ? top : null;
    if (this.hoveredId === (next?.area.id ?? null)) return;
    const previousId = this.hoveredId;
    this.hoveredId = next?.area.id ?? null;
    if (previousId) {
      const prev = this.findAreaInCurrentView(previousId);
      const prevEl = prev ? this.findAreaEl(previousId) : null;
      if (prev && prevEl) this.applyAreaStyle(prev, prevEl);
    }
    if (!next) {
      if (this.focusedId === null && this.pinnedTooltipId === null) this.hideTooltip();
      return;
    }
    const { area, el } = next;
    this.applyAreaStyle(area, el);
    this.emit({
      type: "area:hover",
      areaId: area.id,
      areaName: area.name,
      ...(area.metadata !== undefined ? { metadata: area.metadata } : {}),
    });

    if (area.tooltip?.enabled) {
      this.showTooltip(area);
    } else if (this.focusedId === null && this.pinnedTooltipId === null) {
      this.hideTooltip();
    }
  }

  private masked(): boolean {
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    return view ? this.hasAlphaMasks(view) : false;
  }

  private onPointerOver(e: PointerEvent) {
    this.updateHover(e);
  }

  private onPointerOut(e: PointerEvent) {
    // Moves within the map are resolved by the pointerover/pointermove that follows.
    const related = e.relatedTarget as Node | null;
    if (related && this.svgEl.contains(related)) return;
    this.svgEl.style.cursor = "";
    if (!this.hoveredId) return;
    const prev = this.findAreaInCurrentView(this.hoveredId);
    const prevEl = this.findAreaEl(this.hoveredId);
    this.hoveredId = null;
    if (prev && prevEl) this.applyAreaStyle(prev, prevEl);

    if (this.focusedId === null && this.pinnedTooltipId === null) this.hideTooltip();
  }

  private onPointerMove(e: PointerEvent) {
    if (this.masked()) this.updateHover(e);
    if (this.hoveredId) this.positionTooltip(e.clientX, e.clientY);
  }

  private onClick(e: MouseEvent) {
    const hit = this.getAreaFromEvent(e);
    if (!hit) {
      // Activating empty map space (including transparent pixels of an
      // alpha-masked image with nothing beneath) clears the selection; a disabled area or a
      // Space-drag pan does not.
      if (!this.spaceHeld && !this.topAreaOfEvent(e)?.area.disabled) this.setSelection(null);
      return;
    }
    const { area } = hit;

    const trigger = area.trigger ?? "both";
    if (trigger === "hover") {
      // Touch has no durable hover state. Tapping a hover-only area toggles its
      // authored tooltip (and its selection) without dispatching the click action.
      if (this.pinnedTooltipId === area.id || this.selectedId === area.id) {
        this.pinnedTooltipId = null;
        if (this.focusedId === null && this.hoveredId === null) this.hideTooltip();
        this.setSelection(null);
      } else {
        this.setSelection(area.id);
        if (!area.tooltip?.enabled) return;
        this.pinnedTooltipId = area.id;
        this.showTooltip(area);
        this.positionTooltipForArea(area);
      }
      return;
    }
    this.activateArea(area);
  }

  /** Select the area, announce the click, then run its action. */
  private activateArea(area: Area) {
    this.setSelection(area.id);
    this.emit({
      type: "area:click",
      areaId: area.id,
      areaName: area.name,
      action: area.action,
      ...(area.metadata !== undefined ? { metadata: area.metadata } : {}),
    });
    this.dispatchAction(area.action, area);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    const trigger = hit.area.trigger ?? "both";
    if (trigger === "hover") {
      this.setSelection(hit.area.id);
      if (hit.area.tooltip?.enabled) {
        this.showTooltip(hit.area);
        this.positionTooltipForArea(hit.area);
        this.ariaLiveEl.textContent = this.tooltipEl.textContent?.trim() || hit.area.name;
      }
      return;
    }
    this.activateArea(hit.area);
  }

  /**
   * Escape inside the map closes its open popup (which also clears that area's
   * selection) and otherwise clears the selection. The listener sits on this
   * map's root, so Escape pressed elsewhere on the host page or in another map
   * never reaches it. Text fields keep their native Escape behaviour.
   */
  private onRootKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const target = e.composedPath()[0];
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (this.openPopoverId !== null) {
      e.preventDefault();
      this.closePopover(true);
    } else if (this.selectedId !== null) {
      this.setSelection(null);
    }
  }

  private onFocusIn(e: FocusEvent) {
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    this.focusedId = hit.area.id;
    this.applyAreaStyle(hit.area, hit.el);
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
    this.focusedId = null;
    if (area && el) this.applyAreaStyle(area, el);
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
      this.emit({
        type: "error",
        code: "LAYER_NOT_FOUND",
        message: `Layer "${targetLayerId}" was not found in the current view.`,
      });
      this.ariaLiveEl.textContent = "Layer could not be changed.";
      return;
    }
    const overrides = this.layerVisibility.get(view.id) ?? new Map<string, boolean>();
    const visible = !this.isLayerVisible(view, layer);
    overrides.set(layer.id, visible);
    this.layerVisibility.set(view.id, overrides);
    this.refreshScene(view);
    this.ariaLiveEl.textContent = `${layer.name} ${visible ? "shown" : "hidden"}.`;
  }

  /**
   * Re-derive geometry, labels and directory from effective visibility while
   * keeping the camera. Surviving area nodes are untouched, so their focus,
   * hover and popover anchoring persist; state on removed areas is cleared and
   * focus that was inside a removed layer moves to the nearest remaining control.
   */
  private refreshScene(view: View) {
    const active = this.getActiveElement();
    const removed = this.syncLayers(view);
    if (removed.length > 0) {
      const gone = (id: string | null) => id !== null && !this.findAreaEl(id);
      if (gone(this.selectedId)) this.setSelection(null);
      if (gone(this.hoveredId)) this.hoveredId = null;
      if (gone(this.focusedId)) this.focusedId = null;
      if (gone(this.pinnedTooltipId)) this.pinnedTooltipId = null;
      if (gone(this.openPopoverId)) {
        // The trigger is gone too: do not let closing pull focus back to it.
        this.popoverReturnFocus = null;
        this.closePopover();
      }
      if (this.hoveredId === null && this.focusedId === null && this.pinnedTooltipId === null) this.hideTooltip();
      if (active && removed.some((g) => g.contains(active))) this.focusNearestArea(removed);
    }
    this.renderLabels(view);
    this.refreshDirectory?.();
    this.refreshOverlays();
  }

  /** Move focus from a removed layer to the next remaining area, else the previous, else a map control. */
  private focusNearestArea(removed: SVGGElement[]) {
    const focusable = (root: ParentNode) =>
      Array.from(root.querySelectorAll<SVGElement>('[data-area-id][tabindex]:not([tabindex="-1"])'));
    // Removed groups are detached; locate their former position by the layer order.
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    const removedIds = new Set(removed.map((g) => g.getAttribute("data-layer-id")));
    const order = view?.layers.map((layer) => layer.id) ?? [];
    const firstRemoved = order.findIndex((id) => removedIds.has(id));
    let after: SVGElement | undefined;
    let before: SVGElement | undefined;
    for (const g of Array.from(this.svgEl.querySelectorAll<SVGGElement>(":scope > .clickmap-layer"))) {
      const index = order.indexOf(g.getAttribute("data-layer-id") ?? "");
      const areas = focusable(g);
      if (index > firstRemoved && !after) after = areas[0];
      if (index < firstRemoved && areas.length) before = areas[areas.length - 1];
    }
    const target = after ?? before ??
      this.controlsEl.querySelector<HTMLElement>("button:not([disabled]), select, input");
    target?.focus({ preventScroll: true });
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
      // Body is untrusted HTML: insert the sanitized fragment, never a re-parsed string.
      p.append(sanitizeRichHtml(body, p.ownerDocument));
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

    // Name and describe the dialog from its visible content; a templated popup
    // shows no title, so the area's accessible name labels it instead.
    for (const attr of ["aria-label", "aria-labelledby", "aria-describedby"]) this.popoverEl.removeAttribute(attr);
    if (content.title && templatedBody === null) {
      const h = document.createElement("strong");
      h.id = `${this.instanceId}-popup-title`;
      this.popoverEl.setAttribute("aria-labelledby", h.id);
      h.style.cssText = "display:block;margin-bottom:4px;";
      h.textContent = content.title;
      bodyEl.appendChild(h);
    }

    if (!this.popoverEl.hasAttribute("aria-labelledby")) {
      this.popoverEl.setAttribute("aria-label", area.accessibility?.ariaLabel?.trim() || area.name);
    }

    if (templatedBody !== null || content.body) {
      const p = document.createElement("div");
      p.id = `${this.instanceId}-popup-body`;
      this.popoverEl.setAttribute("aria-describedby", p.id);
      p.append(sanitizeRichHtml(templatedBody ?? content.body ?? "", p.ownerDocument));
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
    closeBtn.addEventListener("click", () => this.closePopover(true));
    this.popoverEl.appendChild(closeBtn);

    this.popoverEl.setAttribute("aria-hidden", "false");
    this.popoverEl.className = "clickmap-popover clickmap-popover--visible";
    this.openPopoverId = area.id;
    // After openPopoverId is set: placement results for a closed popover are dropped.
    this.trackPopover(area, action.position ?? "auto");
    this.emit({ type: "popup:open", popupId: area.id });

    // Aria live announcement
    this.ariaLiveEl.textContent = templatedBody === null ? (content.title ?? "Popup opened") : area.name;
    setTimeout(() => { this.ariaLiveEl.textContent = ""; }, 1000);

    // Move focus into the popup so its content is read and Escape reaches it.
    setTimeout(() => { if (this.openPopoverId === area.id) closeBtn.focus(); }, 0);
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

  /**
   * Close the open popup. With `restoreFocus`, focus returns to the trigger, or
   * to the area's re-rendered element when the original node was replaced.
   * By default focus is only returned when it would otherwise be lost inside
   * the closing popup, so a host control the visitor moved to keeps focus.
   */
  private closePopover(restoreFocus = this.popoverEl.contains(this.getActiveElement())) {
    if (this.openPopoverId === null) return;
    const popupId = this.openPopoverId;
    this.openPopoverId = null;
    this.stopPopoverTracking?.();
    this.stopPopoverTracking = null;
    this.popoverEl.setAttribute("aria-hidden", "true");
    this.popoverEl.classList.remove("clickmap-popover--visible");
    this.popoverEl.innerHTML = "";
    const trigger = this.popoverReturnFocus?.isConnected ? this.popoverReturnFocus : this.findAreaEl(popupId);
    if (restoreFocus) trigger?.focus();
    this.popoverReturnFocus = null;
    this.emit({ type: "popup:close", popupId });
    // Closing an area's details ends its selection.
    if (this.selectedId === popupId) this.setSelection(null);
  }

  /** Focused element in the tree that owns this map (its shadow root or the document). */
  private getActiveElement(): Element | null {
    return (this.root.getRootNode() as Document | ShadowRoot).activeElement;
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
      // The link already names this area, so the hash is left as written.
      this.setSelection(areaId, false);
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
      this.emit({ type: "error", code: "VIEW_NOT_FOUND", message: `View "${viewId}" not found` });
      return;
    }
    const active = this.getActiveElement();
    const preserveFocus = Boolean(active && (this.root.contains(active) || this.shadowRoot?.contains(active)));
    const prev = this.currentViewId;
    this.navigationInProgress = true;
    this.emit({ type: "view:leave", instanceId: this.instanceId, viewId: prev, nextViewId: viewId });
    this.setSelection(null, false);
    this.navigationInProgress = false;
    if (options.historyMode !== "browser") this.navigationStack.push(prev);
    this.currentViewId = viewId;
    this.fade(() => {
      this.renderView(viewId);
      this.focusNavigationDestination(viewId, preserveFocus);
      this.navigationInProgress = true;
      this.emit({ type: "view:enter", instanceId: this.instanceId, viewId });
      this.emit({ type: "view:change", previousViewId: prev, currentViewId: viewId });
      this.navigationInProgress = false;
      this.completePendingReveal(viewId);
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
    this.pendingReveal = null;
    const active = this.getActiveElement();
    const preserveFocus = Boolean(active && (this.root.contains(active) || this.shadowRoot?.contains(active)));
    const from = this.currentViewId;
    this.navigationInProgress = true;
    this.emit({ type: "view:leave", instanceId: this.instanceId, viewId: from, nextViewId: prev });
    this.setSelection(null, false);
    this.navigationInProgress = false;
    this.currentViewId = prev;
    this.fade(() => {
      this.renderView(prev);
      this.focusNavigationDestination(prev, preserveFocus);
      this.navigationInProgress = true;
      this.emit({ type: "view:enter", instanceId: this.instanceId, viewId: prev });
      this.emit({ type: "view:change", previousViewId: from, currentViewId: prev });
      this.navigationInProgress = false;
    });
    if (this.def.settings.enableHistory) this.pushOwnedHistoryState(prev);
    else this.updateDeepLinkHash(prev);
  }

  /** Returns to the view at `depth` in the navigation stack, dropping the later entries. */
  private goBackTo(depth: number) {
    if (this.navigationInProgress || depth >= this.navigationStack.length) return;
    this.navigationStack.length = depth + 1;
    this.goBack();
  }

  reset() {
    this.cancelTransition();
    this.pendingReveal = null;
    const from = this.currentViewId;
    const to = this.def.settings.initialViewId;
    if (this.navigationInProgress) return;
    this.navigationInProgress = true;
    if (from !== to) this.emit({ type: "view:leave", instanceId: this.instanceId, viewId: from, nextViewId: to });
    this.setSelection(null, false);
    this.navigationStack = [];
    this.layerVisibility.clear();
    this.currentViewId = this.def.settings.initialViewId;
    this.renderView(this.currentViewId);
    this.refreshDirectory?.();
    if (from !== to) {
      this.emit({ type: "view:enter", instanceId: this.instanceId, viewId: to });
      this.emit({ type: "view:change", previousViewId: from, currentViewId: to });
    }
    this.emitCameraChange("reset");
    this.navigationInProgress = false;
    this.updateDeepLinkHash(this.currentViewId);
    if (this.def.settings.enableHistory) this.replaceOwnedHistoryState(this.currentViewId);
  }

  select(areaId: string) {
    if (!this.destroyed) this.setSelection(areaId);
  }

  clearSelection() {
    if (!this.destroyed) this.setSelection(null);
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
    this.pendingReveal = null;
    this.refreshDirectory = null;
    this.stopPopoverTracking?.();
    this.stopPopoverTracking = null;
    this.cancelTransition();
    this.pendingEvents = [];
    if (this.roTimer !== null) clearTimeout(this.roTimer);
    this.ro?.disconnect();
    window.removeEventListener("keydown", this.onWindowKeyDown);
    window.removeEventListener("keyup", this.onWindowKeyUp);
    window.removeEventListener("pointermove", this.onWindowPointerMove);
    window.removeEventListener("pointerup", this.onWindowPointerUp);
    window.removeEventListener("popstate", this.onPopState);
    document.removeEventListener("click", this.onDocumentClick);
    this.svgEl?.removeEventListener("wheel", this.onWheel);
    this.emitter.clear();
    if (this.shadowRoot) {
      // Shadow roots cannot be detached; clear all renderer-owned contents.
      this.shadowRoot.replaceChildren();
    } else {
      this.viewStyleEl?.remove();
      this.root?.remove();
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
  | { kind: "select"; areaId: string }
  | { kind: "clearSelection" }
  | { kind: "destroy" }
  | { kind: "setChoroplethData"; data: Array<{ id: string; value: number }> };

function resolveContainer(options: RendererOptions): HTMLElement {
  const raw = options.container;
  const container = typeof raw === "string" ? document.querySelector<HTMLElement>(raw) : raw;
  if (!container) throw new Error(`ClickMapRenderer: container not found: ${String(raw)}`);
  return container;
}

/**
 * Accessible loading/error state shown in the host while no map is mounted
 * (#169). Styled inline so it works before or without the renderer stylesheet.
 */
class HostStatus {
  private el: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.style.cssText = "display:flex;align-items:center;justify-content:center;min-height:120px;padding:16px;box-sizing:border-box;font:14px/1.4 system-ui,sans-serif;text-align:center;";
    container.appendChild(this.el);
  }

  loading() {
    this.el.className = "clickmap-root clickmap-root--loading";
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-busy", "true");
    this.el.textContent = "Loading map…";
  }

  error(message: string) {
    this.el.className = "clickmap-root clickmap-root--error";
    this.el.setAttribute("role", "alert");
    this.el.removeAttribute("aria-busy");
    this.el.dataset.error = message;
    this.el.textContent = `This map could not be displayed. ${message}`;
  }

  remove() {
    this.el.remove();
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function areaCursor(area: Area): string {
  if (area.disabled) return "not-allowed";
  const trigger = area.trigger ?? "both";
  return area.action.type !== "none" && trigger !== "hover" ? "pointer" : "default";
}

/** The instance returned when a definition cannot be shown: visible, observable, inert. */
class FailedRenderer implements ClickMapInstance {
  private emitter = new Emitter();
  private status: HostStatus;
  private destroyed = false;
  private message: string;

  constructor(container: HTMLElement, code: string, message: string) {
    this.message = message;
    this.status = new HostStatus(container);
    this.status.error(message);
    // Delivered after create() returns, so an immediate on("error") receives it.
    queueMicrotask(() => {
      if (!this.destroyed) this.emitter.emit({ type: "error", code, message });
    });
  }

  goToView() {}
  goBack() {}
  reset() {}
  select() {}
  clearSelection() {}
  setChoroplethData() {}
  getCurrentView() {
    return "";
  }
  getDefinition(): ClickMapDefinition {
    throw new Error(`ClickMapRenderer: no definition loaded (${this.message})`);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.status.remove();
    this.emitter.clear();
  }
  on<T extends ClickMapEventType>(eventName: T, callback: (event: Extract<ClickMapEvent, { type: T }>) => void) {
    this.emitter.on(eventName, callback);
  }
  off<T extends ClickMapEventType>(eventName: T, callback: (event: Extract<ClickMapEvent, { type: T }>) => void) {
    this.emitter.off(eventName, callback);
  }
}

class DeferredRenderer implements ClickMapInstance {
  private inner: Renderer | null = null;
  private queue: QueuedOp[] = [];
  private emitter = new Emitter();
  private destroyed = false;
  private abortController = new AbortController();
  private status: HostStatus;

  constructor(options: RendererOptions) {
    const container = resolveContainer(options);
    this.status = new HostStatus(container);
    this.status.loading();
    fetch(options.definitionUrl!, { signal: this.abortController.signal })
      .then((r) => {
        if (!r.ok)
          throw new Error(`HTTP ${r.status} loading definition`);
        return Promise.resolve(r.json() as Promise<unknown>)
          .then((json) => ({ json, responseUrl: r.url }));
      })
      .then(({ json, responseUrl }) => {
        if (this.destroyed) return;
        // Decode before any map DOM is mounted.
        const decoded = decodeDefinition(json);
        if (!decoded.ok) {
          this.fail(decoded.code, decoded.message);
          return;
        }
        const fallbackUrl = new URL(options.definitionUrl!, document.baseURI).href;
        this.status.remove();
        try {
          this.inner = new Renderer(
            { ...options, container, assetBaseUrl: options.assetBaseUrl ?? (responseUrl || fallbackUrl) },
            decoded.value,
          );
        } catch (error) {
          this.fail("LOAD_FAILED", failureMessage(error));
          return;
        }
        for (const op of this.queue) {
          if (op.kind === "on")
            this.inner.on(op.type as ClickMapEventType, op.cb as never);
          else if (op.kind === "off")
            this.inner.off(op.type as ClickMapEventType, op.cb as never);
          else if (op.kind === "goToView") this.inner.goToView(op.viewId);
          else if (op.kind === "goBack") this.inner.goBack();
          else if (op.kind === "reset") this.inner.reset();
          else if (op.kind === "select") this.inner.select(op.areaId);
          else if (op.kind === "clearSelection") this.inner.clearSelection();
          else if (op.kind === "destroy") this.inner.destroy();
          else if (op.kind === "setChoroplethData") this.inner.setChoroplethData(op.data);
        }
        this.queue = [];
      })
      .catch((err: Error) => {
        if (this.destroyed) return;
        this.fail("LOAD_FAILED", err.message);
      });
  }

  private fail(code: string, message: string) {
    this.status.error(message);
    this.emitter.emit({ type: "error", code, message });
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
  select(areaId: string) {
    this.inner ? this.inner.select(areaId) : this.queue.push({ kind: "select", areaId });
  }
  clearSelection() {
    this.inner ? this.inner.clearSelection() : this.queue.push({ kind: "clearSelection" });
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
    this.status.remove();
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
  if (options.definition) {
    // Decode before mounting: an invalid definition never builds partial DOM.
    const container = resolveContainer(options);
    const decoded = decodeDefinition(options.definition);
    if (!decoded.ok) return new FailedRenderer(container, decoded.code, decoded.message);
    try {
      return new Renderer({ ...options, container }, decoded.value);
    } catch (error) {
      return new FailedRenderer(container, "LOAD_FAILED", failureMessage(error));
    }
  }
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
