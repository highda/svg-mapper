import type {
  ClickMapDefinition,
  ClickMapEvent,
  ClickMapEventType,
  ClickMapInstance,
  RendererOptions,
  View,
  Area,
  Action,
  AreaStyleState,
} from "../../shared/types.js";
import { Emitter } from "./emitter.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<T extends SVGElement>(tag: string): T {
  return document.createElementNS(SVG_NS, tag) as T;
}

function escId(id: string): string {
  return CSS.escape(id);
}

// ---------------------------------------------------------------------------
// Core renderer
// ---------------------------------------------------------------------------

class Renderer implements ClickMapInstance {
  private def: ClickMapDefinition;
  private container: HTMLElement;
  private emitter = new Emitter();
  private history: string[] = [];
  private currentViewId: string;

  private root!: HTMLDivElement;
  private viewEl!: HTMLDivElement;
  private bgEl!: HTMLDivElement;
  private svgEl!: SVGSVGElement;
  private tooltipEl!: HTMLDivElement;
  private backBtn: HTMLButtonElement | null = null;

  private ro!: ResizeObserver;
  private roTimer: ReturnType<typeof setTimeout> | null = null;
  private viewW = 1;
  private viewH = 1;
  private hoveredId: string | null = null;

  constructor(options: RendererOptions, def: ClickMapDefinition) {
    this.def = def;

    const raw = options.container;
    const container =
      typeof raw === "string"
        ? document.querySelector<HTMLElement>(raw)
        : raw;

    if (!container)
      throw new Error(`ClickMapRenderer: container not found: ${String(raw)}`);
    this.container = container;

    this.currentViewId = def.settings.initialViewId;
    this.buildDOM();
    this.renderView(this.currentViewId);

    this.ro = new ResizeObserver(() => {
      if (this.roTimer !== null) clearTimeout(this.roTimer);
      this.roTimer = setTimeout(() => { this.roTimer = null; this.updateScale(); }, 16);
    });
    this.ro.observe(this.container);

    this.emitter.emit({ type: "ready", definition: def });
  }

  // -------------------------------------------------------------------------
  // DOM scaffolding
  // -------------------------------------------------------------------------

  private buildDOM() {
    this.root = document.createElement("div");
    this.root.className = "clickmap-root";

    this.viewEl = document.createElement("div");
    this.viewEl.className = "clickmap-view";

    this.bgEl = document.createElement("div");
    this.bgEl.className = "clickmap-bg";

    this.svgEl = svgEl<SVGSVGElement>("svg");
    this.svgEl.setAttribute("class", "clickmap-areas");
    this.svgEl.setAttribute("role", "presentation");

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "clickmap-tooltip";
    this.tooltipEl.setAttribute("role", "tooltip");
    this.tooltipEl.setAttribute("aria-hidden", "true");

    this.viewEl.appendChild(this.bgEl);
    this.viewEl.appendChild(this.svgEl);
    this.root.appendChild(this.viewEl);
    this.root.appendChild(this.tooltipEl);
    this.container.appendChild(this.root);

    // Delegated pointer + keyboard events on the SVG
    this.svgEl.addEventListener("pointerover", (e) => this.onPointerOver(e));
    this.svgEl.addEventListener("pointerout", (e) => this.onPointerOut(e));
    this.svgEl.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.svgEl.addEventListener("click", (e) => this.onClick(e));
    this.svgEl.addEventListener("keydown", (e) => this.onKeyDown(e));
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

    this.viewW = view.width;
    this.viewH = view.height;
    this.hoveredId = null;
    this.hideTooltip();

    this.renderBackground(view);
    this.renderAreas(view);
    this.renderBackButton(view);
    this.updateScale();
  }

  private renderBackground(view: View) {
    this.bgEl.innerHTML = "";
    if (!view.background) return;

    const asset = this.def.assets.find(
      (a) => a.id === view.background!.assetId
    );
    if (!asset) return;

    if (asset.type === "image/svg+xml" && asset.inline) {
      // Inline SVG markup stored in src
      this.bgEl.innerHTML = asset.src;
      const inlineSvg = this.bgEl.querySelector("svg");
      if (inlineSvg) {
        inlineSvg.classList.add("clickmap-bg-img");
        inlineSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      }
    } else {
      const img = document.createElement("img");
      img.src = asset.src;
      img.className = "clickmap-bg-img";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      this.bgEl.appendChild(img);
    }
  }

  private renderAreas(view: View) {
    this.svgEl.innerHTML = "";
    this.svgEl.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);

    for (const layer of view.layers) {
      if (!layer.visible) continue;

      const g = svgEl<SVGGElement>("g");
      g.setAttribute("opacity", String(layer.opacity));
      g.setAttribute("data-layer-id", layer.id);

      for (const area of layer.areas) {
        const el = this.makeAreaEl(area);
        if (el) g.appendChild(el);
      }

      this.svgEl.appendChild(g);
    }
  }

  private renderBackButton(view: View) {
    this.backBtn?.remove();
    this.backBtn = null;

    if (!view.ui.showBackButton || this.history.length === 0) return;

    const btn = document.createElement("button");
    btn.className = "clickmap-back-btn";
    btn.textContent = "← Back";
    btn.addEventListener("click", () => this.goBack());
    this.root.appendChild(btn);
    this.backBtn = btn;
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
      default:
        // marker — skip for now (no visual SVG shape)
        return null;
    }

    this.applyStyle(shape, area.style.default);
    shape.setAttribute("data-area-id", area.id);
    shape.setAttribute("tabindex", String(area.accessibility?.tabIndex ?? 0));
    shape.setAttribute("role", "button");
    shape.setAttribute(
      "aria-label",
      area.accessibility?.ariaLabel ?? area.name
    );
    shape.style.cursor = area.action.type !== "none" ? "pointer" : "default";

    return shape;
  }

  private applyStyle(el: SVGElement, style: AreaStyleState) {
    el.setAttribute("fill", style.fill);
    el.setAttribute("stroke", style.stroke);
    el.setAttribute("stroke-width", String(style.strokeWidth));
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
    return { area, el };
  }

  private findAreaInCurrentView(areaId: string): Area | null {
    const view = this.def.views.find((v) => v.id === this.currentViewId);
    if (!view) return null;
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
    if (this.hoveredId === area.id) return;

    // Restore previous
    if (this.hoveredId) {
      const prev = this.findAreaInCurrentView(this.hoveredId);
      const prevEl = prev ? this.findAreaEl(this.hoveredId) : null;
      if (prev && prevEl) this.applyStyle(prevEl, prev.style.default);
    }

    this.hoveredId = area.id;
    this.applyStyle(el, area.style.hover);
    this.emitter.emit({
      type: "area:hover",
      areaId: area.id,
      areaName: area.name,
    });

    if (area.tooltip?.enabled) {
      this.showTooltip(
        area.tooltip.title ?? area.name,
        area.tooltip.body ?? ""
      );
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
    if (prev && prevEl) this.applyStyle(prevEl, prev.style.default);

    this.hoveredId = null;
    this.hideTooltip();
  }

  private onPointerMove(e: PointerEvent) {
    if (this.hoveredId) this.positionTooltip(e.clientX, e.clientY);
  }

  private onClick(e: MouseEvent) {
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    const { area } = hit;
    this.emitter.emit({
      type: "area:click",
      areaId: area.id,
      areaName: area.name,
      action: area.action,
    });
    this.dispatchAction(area.action);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const hit = this.getAreaFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    this.emitter.emit({
      type: "area:click",
      areaId: hit.area.id,
      areaName: hit.area.name,
      action: hit.area.action,
    });
    this.dispatchAction(hit.area.action);
  }

  private dispatchAction(action: Action) {
    switch (action.type) {
      case "url":
        window.open(action.href, action.target);
        break;
      case "goToView":
        this.goToView(action.targetViewId);
        break;
      case "customEvent": {
        const init: CustomEventInit = action.payload !== undefined
          ? { detail: action.payload }
          : {};
        window.dispatchEvent(new CustomEvent(action.eventName, init));
        break;
      }
      case "popup":
      case "toggleLayer":
      case "none":
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Tooltip
  // -------------------------------------------------------------------------

  private showTooltip(title: string, body: string) {
    this.tooltipEl.innerHTML = "";
    if (title) {
      const t = document.createElement("strong");
      t.textContent = title;
      this.tooltipEl.appendChild(t);
    }
    if (body) {
      const p = document.createElement("p");
      p.textContent = body;
      this.tooltipEl.appendChild(p);
    }
    this.tooltipEl.setAttribute("aria-hidden", "false");
    this.tooltipEl.classList.add("clickmap-tooltip--visible");
  }

  private hideTooltip() {
    this.tooltipEl.setAttribute("aria-hidden", "true");
    this.tooltipEl.classList.remove("clickmap-tooltip--visible");
  }

  private positionTooltip(clientX: number, clientY: number) {
    const rect = this.container.getBoundingClientRect();
    this.tooltipEl.style.left = `${clientX - rect.left + 14}px`;
    this.tooltipEl.style.top = `${clientY - rect.top + 14}px`;
  }

  // -------------------------------------------------------------------------
  // Responsive scaling
  // -------------------------------------------------------------------------

  private updateScale() {
    if (
      !this.def.settings.maintainAspectRatio ||
      this.viewW === 0 ||
      this.viewH === 0
    ) {
      this.viewEl.style.removeProperty("aspect-ratio");
    } else {
      this.viewEl.style.aspectRatio = `${this.viewW} / ${this.viewH}`;
    }
  }

  // -------------------------------------------------------------------------
  // Fade transition
  // -------------------------------------------------------------------------

  private fade(render: () => void) {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduced) {
      render();
      return;
    }
    this.viewEl.style.transition = "opacity 0.15s ease";
    this.viewEl.style.opacity = "0";
    setTimeout(() => {
      render();
      this.viewEl.style.opacity = "1";
    }, 150);
  }

  // -------------------------------------------------------------------------
  // ClickMapInstance public API
  // -------------------------------------------------------------------------

  goToView(viewId: string) {
    if (viewId === this.currentViewId) return;
    const prev = this.currentViewId;
    this.history.push(this.currentViewId);
    this.currentViewId = viewId;
    this.fade(() => this.renderView(viewId));
    this.emitter.emit({
      type: "view:change",
      previousViewId: prev,
      currentViewId: viewId,
    });
  }

  goBack() {
    const prev = this.history.pop();
    if (prev === undefined) return;
    const from = this.currentViewId;
    this.currentViewId = prev;
    this.fade(() => this.renderView(prev));
    this.emitter.emit({
      type: "view:change",
      previousViewId: from,
      currentViewId: prev,
    });
  }

  reset() {
    this.history = [];
    this.currentViewId = this.def.settings.initialViewId;
    this.renderView(this.currentViewId);
  }

  getCurrentView() {
    return this.currentViewId;
  }

  getDefinition() {
    return this.def;
  }

  destroy() {
    if (this.roTimer !== null) clearTimeout(this.roTimer);
    this.ro.disconnect();
    this.root.remove();
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
  | { kind: "destroy" };

class DeferredRenderer implements ClickMapInstance {
  private inner: Renderer | null = null;
  private queue: QueuedOp[] = [];
  private emitter = new Emitter();
  private destroyed = false;

  constructor(options: RendererOptions) {
    fetch(options.definitionUrl!)
      .then((r) => {
        if (!r.ok)
          throw new Error(`HTTP ${r.status} loading definition`);
        return r.json() as Promise<ClickMapDefinition>;
      })
      .then((def) => {
        if (this.destroyed) return;
        this.inner = new Renderer(options, def);
        // Replay queued event registrations first so listeners catch 'ready'
        for (const op of this.queue) {
          if (op.kind === "on")
            this.inner.on(op.type as ClickMapEventType, op.cb as never);
          else if (op.kind === "off")
            this.inner.off(op.type as ClickMapEventType, op.cb as never);
          else if (op.kind === "goToView") this.inner.goToView(op.viewId);
          else if (op.kind === "goBack") this.inner.goBack();
          else if (op.kind === "reset") this.inner.reset();
          else if (op.kind === "destroy") this.inner.destroy();
        }
        this.queue = [];
      })
      .catch((err: Error) => {
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
  destroy() {
    this.destroyed = true;
    this.inner ? this.inner.destroy() : this.queue.push({ kind: "destroy" });
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
