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
import { Emitter } from "./emitter.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<T extends SVGElement>(tag: string): T {
  return document.createElementNS(SVG_NS, tag) as T;
}

function escId(id: string): string {
  return CSS.escape(id);
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
      if (attr.value && /javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
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

let _inlinedCSS = "";
function getInlinedCSS(): string {
  return _inlinedCSS;
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
  private options: RendererOptions;

  // DOM nodes (attached to root or shadow root depending on shadowDom option)
  private root!: HTMLDivElement;
  private viewEl!: HTMLDivElement;
  private bgEl!: HTMLDivElement;
  private svgEl!: SVGSVGElement;
  private tooltipEl!: HTMLDivElement;
  private popoverEl!: HTMLDivElement;
  private backBtn: HTMLButtonElement | null = null;
  private sceneSwitcherEl: HTMLDivElement | null = null;
  private zoomControlsEl: HTMLDivElement | null = null;
  private ariaLiveEl!: HTMLDivElement;
  private shadowRoot: ShadowRoot | null = null;

  private ro!: ResizeObserver;
  private roTimer: ReturnType<typeof setTimeout> | null = null;
  private viewW = 1;
  private viewH = 1;
  private hoveredId: string | null = null;

  // Choropleth
  private choroplethData: Map<string, number> = new Map();
  private choroplethOptions: ChoroplethOptions | null = null;

  // Spacebar pan state
  private spaceHeld = false;
  private panStart: { x: number; y: number } | null = null;
  private panStartViewBox: { x: number; y: number; w: number; h: number } | null = null;
  private currentViewBox: { x: number; y: number; w: number; h: number } | null = null;

  // Popover state
  private openPopoverId: string | null = null;
  private popoverReturnFocus: HTMLElement | null = null;

  private onDocumentClick = (e: MouseEvent) => {
    if (this.openPopoverId === null || this.popoverEl.contains(e.target as Node)) return;

    const targetArea = (e.target as Element | null)?.closest?.("[data-area-id]");
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
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!this.popoverEl.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  };

  constructor(options: RendererOptions, def: ClickMapDefinition) {
    this.def = def;
    this.options = options;

    const raw = options.container;
    const container =
      typeof raw === "string"
        ? document.querySelector<HTMLElement>(raw)
        : raw;

    if (!container)
      throw new Error(`ClickMapRenderer: container not found: ${String(raw)}`);
    this.container = container;

    this.currentViewId = def.settings.initialViewId;
    this.viewW = def.settings.canvasSize.width;
    this.viewH = def.settings.canvasSize.height;

    // Choropleth initial data
    if (options.choropleth) {
      this.choroplethOptions = options.choropleth;
      for (const d of options.choropleth.data) {
        this.choroplethData.set(d.id, d.value);
      }
    }

    this.buildDOM();
    this.renderView(this.currentViewId);

    // Deep linking: restore from hash on load
    if (options.deepLink?.enabled) {
      this.initDeepLink();
    }

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
    this.root.appendChild(this.tooltipEl);
    this.root.appendChild(this.popoverEl);
    this.root.appendChild(this.ariaLiveEl);

    // Shadow DOM mode (issue #29)
    if (this.options.shadowDom) {
      this.shadowRoot = this.container.attachShadow({ mode: "open" });
      const styleEl = document.createElement("style");
      styleEl.textContent = getInlinedCSS() + (this.options.css ?? "");
      this.shadowRoot.appendChild(styleEl);
      this.shadowRoot.appendChild(this.root);
    } else {
      this.container.appendChild(this.root);
    }

    // Delegated pointer + keyboard events on the SVG
    this.svgEl.addEventListener("pointerover", (e) => this.onPointerOver(e));
    this.svgEl.addEventListener("pointerout", (e) => this.onPointerOut(e));
    this.svgEl.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.svgEl.addEventListener("click", (e) => this.onClick(e));
    this.svgEl.addEventListener("keydown", (e) => this.onKeyDown(e));

    // Spacebar pan (issue #27 G3)
    window.addEventListener("keydown", this.onWindowKeyDown);
    window.addEventListener("keyup", this.onWindowKeyUp);
    this.svgEl.addEventListener("pointerdown", (e) => this.onPanStart(e));
    window.addEventListener("pointermove", (e) => this.onPanMove(e));
    window.addEventListener("pointerup", () => this.onPanEnd());

    // Close popover on outside click
    document.addEventListener("click", this.onDocumentClick);
    document.addEventListener("keydown", this.onDocumentKeyDown);
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
    this.hideTooltip();
    this.closePopover();

    this.renderBackground(view);
    this.renderAreas(view);
    this.renderBackButton(view);
    this.renderSceneSwitcher();
    this.renderZoomControls();
    this.updateScale();
    this.applyChoropleth();
  }

  private renderBackground(view: View) {
    this.bgEl.innerHTML = "";
    if (!view.background) return;

    const asset = this.def.assets.find(
      (a) => a.id === view.background!.assetId
    );
    if (!asset) return;

    const fit = view.background.fit ?? "contain";

    if (asset.type === "image/svg+xml" && asset.inline) {
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
      // Wire up background fit mode (issue #27 G2)
      img.style.objectFit = fit;
      this.bgEl.appendChild(img);
    }
  }

  private renderAreas(view: View) {
    this.svgEl.innerHTML = "";

    const { width, height } = this.def.settings.canvasSize;
    const pad = this.def.settings.padding;
    if (pad) {
      this.svgEl.setAttribute(
        "viewBox",
        `${-pad.left} ${-pad.top} ${width + pad.left + pad.right} ${height + pad.top + pad.bottom}`
      );
    } else {
      this.svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
    this.currentViewBox = pad
      ? { x: -pad.left, y: -pad.top, w: width + pad.left + pad.right, h: height + pad.top + pad.bottom }
      : { x: 0, y: 0, w: width, h: height };

    const labelSettings = this.def.settings.areaLabels;

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

    if (!view.ui.showBackButton || this.history.length === 0) return;

    const btn = document.createElement("button");
    btn.className = "clickmap-back-btn";
    btn.textContent = "← Back";
    btn.addEventListener("click", () => this.goBack());
    this.root.appendChild(btn);
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

    const el = document.createElement("div");
    el.className = `clickmap-scene-switcher clickmap-scene-switcher--${ss.position ?? "bottom-center"} clickmap-scene-switcher--${ss.style ?? "buttons"}`;

    const views = this.def.views;
    views.forEach((view) => {
      if (ss.style === "dropdown") return; // handled below
      const btn = document.createElement("button");
      btn.textContent = view.name;
      btn.setAttribute("type", "button");
      btn.setAttribute("data-view-id", view.id);
      btn.className = "clickmap-scene-btn";
      if (view.id === this.currentViewId) btn.classList.add("clickmap-scene-btn--active");
      btn.addEventListener("click", () => this.goToView(view.id));
      el.appendChild(btn);
    });

    if (ss.style === "dropdown") {
      const sel = document.createElement("select");
      sel.className = "clickmap-scene-dropdown";
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

    this.root.appendChild(el);
    this.sceneSwitcherEl = el;
  }

  // -------------------------------------------------------------------------
  // Zoom controls (issue #27 G1)
  // -------------------------------------------------------------------------

  private renderZoomControls() {
    this.zoomControlsEl?.remove();
    this.zoomControlsEl = null;

    const zc = this.def.settings.zoomControls;
    if (!zc?.enabled) return;

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

    el.appendChild(makeBtn("clickmap-zoom-in", "Zoom in", () => this.adjustZoom(1.2)));
    el.appendChild(makeBtn("clickmap-zoom-out", "Zoom out", () => this.adjustZoom(1 / 1.2)));
    el.appendChild(makeBtn("clickmap-zoom-reset", "Reset zoom", () => this.resetZoom()));

    this.root.appendChild(el);
    this.zoomControlsEl = el;
  }

  private adjustZoom(factor: number) {
    if (!this.currentViewBox) return;
    const vb = this.currentViewBox;
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    const newW = vb.w / factor;
    const newH = vb.h / factor;
    this.currentViewBox = {
      x: cx - newW / 2,
      y: cy - newH / 2,
      w: newW,
      h: newH,
    };
    this.applyViewBox();
  }

  private resetZoom() {
    const { width, height } = this.def.settings.canvasSize;
    const pad = this.def.settings.padding;
    this.currentViewBox = pad
      ? { x: -pad.left, y: -pad.top, w: width + pad.left + pad.right, h: height + pad.top + pad.bottom }
      : { x: 0, y: 0, w: width, h: height };
    this.applyViewBox();
  }

  private applyViewBox() {
    if (!this.currentViewBox) return;
    const { x, y, w, h } = this.currentViewBox;
    this.svgEl.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
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

  private onPanStart(e: PointerEvent) {
    if (!this.spaceHeld || !this.currentViewBox) return;
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
  }

  private onPanEnd() {
    this.panStart = null;
    this.panStartViewBox = null;
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
    shape.setAttribute("data-area-id", area.id);

    if (isDisabled) {
      shape.setAttribute("aria-disabled", "true");
      shape.style.cursor = "not-allowed";
      shape.setAttribute("tabindex", "-1");
    } else {
      shape.setAttribute("tabindex", String(area.accessibility?.tabIndex ?? 0));
      shape.setAttribute("role", "button");
      shape.setAttribute(
        "aria-label",
        area.accessibility?.ariaLabel ?? area.name
      );
      const trigger = area.trigger ?? "both";
      const clickable = trigger === "click" || trigger === "both";
      shape.style.cursor = (area.action.type !== "none" && clickable) ? "pointer" : "default";
    }

    return shape;
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
      `position:absolute;bottom:10px;right:10px;background:rgba(255,255,255,0.9);` +
      `border:1px solid #ccc;border-radius:4px;padding:6px 8px;font-size:11px;`;

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
    this.root.appendChild(legend);
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
    return { area, el };
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
    if (prev && prevEl) {
      this.applyRestingStyle(prev, prevEl);
    }

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

    const trigger = area.trigger ?? "both";
    if (trigger === "hover") return; // hover-only: no click action

    this.emitter.emit({
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
    if (trigger === "hover") return;
    this.emitter.emit({
      type: "area:click",
      areaId: hit.area.id,
      areaName: hit.area.name,
      action: hit.area.action,
      ...(hit.area.metadata !== undefined ? { metadata: hit.area.metadata } : {}),
    });
    this.dispatchAction(hit.area.action, hit.area);
  }

  private dispatchAction(action: Action, area: Area) {
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
        this.openPopover(action, area);
        break;
      case "toggleLayer":
      case "none":
        break;
    }
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
      const img = document.createElement("img");
      img.src = tt.imageUrl;
      img.alt = "";
      img.style.cssText = "display:block;width:100%;max-height:80px;object-fit:cover;border-radius:2px;margin-bottom:4px;";
      this.tooltipEl.appendChild(img);
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
    this.tooltipEl.setAttribute("aria-hidden", "true");
    this.tooltipEl.classList.remove("clickmap-tooltip--visible");
  }

  private positionTooltip(clientX: number, clientY: number) {
    const rect = this.container.getBoundingClientRect();
    this.tooltipEl.style.left = `${clientX - rect.left + 14}px`;
    this.tooltipEl.style.top = `${clientY - rect.top + 14}px`;
  }

  // -------------------------------------------------------------------------
  // Popover (issue #23 B1)
  // -------------------------------------------------------------------------

  private openPopover(action: import("../../shared/types.js").PopupAction, area: Area) {
    const content = action.content;
    const templatedBody = this.resolveAreaTemplate(area);
    this.popoverReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.popoverEl.innerHTML = "";

    // Build content
    if (content.imageUrl) {
      const img = document.createElement("img");
      img.src = content.imageUrl;
      img.alt = "";
      img.style.cssText = "display:block;width:100%;max-height:120px;object-fit:cover;border-radius:2px 2px 0 0;margin-bottom:6px;";
      this.popoverEl.appendChild(img);
    }

    if (content.title && templatedBody === null) {
      const h = document.createElement("strong");
      h.style.cssText = "display:block;margin-bottom:4px;";
      h.textContent = content.title;
      this.popoverEl.appendChild(h);
    }

    if (templatedBody !== null || content.body) {
      const p = document.createElement("div");
      p.innerHTML = sanitiseHtml(templatedBody ?? content.body ?? "");
      p.style.fontSize = "12px";
      this.popoverEl.appendChild(p);
    }

    if (content.linkHref) {
      const a = document.createElement("a");
      a.href = content.linkHref;
      a.textContent = content.linkLabel ?? content.linkHref;
      a.style.cssText = "display:block;margin-top:6px;font-size:12px;color:#3b82f6;";
      this.popoverEl.appendChild(a);
    }

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.style.cssText =
      "position:absolute;top:4px;right:6px;background:none;border:none;font-size:16px;cursor:pointer;line-height:1;";
    closeBtn.addEventListener("click", () => this.closePopover());
    this.popoverEl.appendChild(closeBtn);

    // Position near area
    const bbox = this.getAreaBBox(area);
    const position = action.position ?? "auto";
    this.positionPopover(bbox, position);

    this.popoverEl.setAttribute("aria-hidden", "false");
    this.popoverEl.classList.add("clickmap-popover--visible");
    this.openPopoverId = area.id;

    // Aria live announcement
    this.ariaLiveEl.textContent = templatedBody === null ? (content.title ?? "Popup opened") : area.name;
    setTimeout(() => { this.ariaLiveEl.textContent = ""; }, 1000);

    // Focus trap
    setTimeout(() => closeBtn.focus(), 0);
  }

  private positionPopover(
    bbox: { cx: number; cy: number; w: number; h: number } | null,
    position: string
  ) {
    if (!bbox || !this.currentViewBox) {
      this.popoverEl.style.top = "50%";
      this.popoverEl.style.left = "50%";
      this.popoverEl.style.transform = "translate(-50%, -50%)";
      return;
    }

    const containerRect = this.container.getBoundingClientRect();
    const scaleX = containerRect.width / (this.currentViewBox?.w || 1);
    const scaleY = containerRect.height / (this.currentViewBox?.h || 1);
    const offsetX = -(this.currentViewBox?.x ?? 0) * scaleX;
    const offsetY = -(this.currentViewBox?.y ?? 0) * scaleY;

    const cx = bbox.cx * scaleX + offsetX;
    const cy = bbox.cy * scaleY + offsetY;
    const areaH = bbox.h * scaleY;

    let resolved = position;
    if (resolved === "auto") {
      const horizontal = (cx / Math.max(containerRect.width, 1)) - 0.5;
      const vertical = (cy / Math.max(containerRect.height, 1)) - 0.5;
      if (Math.abs(horizontal) > Math.abs(vertical)) {
        resolved = horizontal < 0 ? "right" : "left";
      } else {
        resolved = vertical < 0 ? "bottom" : "top";
      }
    }

    this.popoverEl.style.transform = "";
    this.popoverEl.className = `clickmap-popover clickmap-popover--${resolved} clickmap-popover--visible`;

    switch (resolved) {
      case "top":
        this.popoverEl.style.left = `${cx}px`;
        this.popoverEl.style.top = `${cy - areaH / 2 - 8}px`;
        this.popoverEl.style.transform = "translate(-50%, -100%)";
        break;
      case "bottom":
        this.popoverEl.style.left = `${cx}px`;
        this.popoverEl.style.top = `${cy + areaH / 2 + 8}px`;
        this.popoverEl.style.transform = "translateX(-50%)";
        break;
      case "left":
        this.popoverEl.style.left = `${cx - bbox.w * scaleX / 2 - 8}px`;
        this.popoverEl.style.top = `${cy}px`;
        this.popoverEl.style.transform = "translate(-100%, -50%)";
        break;
      case "right":
        this.popoverEl.style.left = `${cx + bbox.w * scaleX / 2 + 8}px`;
        this.popoverEl.style.top = `${cy}px`;
        this.popoverEl.style.transform = "translateY(-50%)";
        break;
    }
  }

  private closePopover() {
    if (this.openPopoverId === null) return;
    this.openPopoverId = null;
    this.popoverEl.setAttribute("aria-hidden", "true");
    this.popoverEl.classList.remove("clickmap-popover--visible");
    this.popoverEl.innerHTML = "";
    if (this.popoverReturnFocus?.isConnected) this.popoverReturnFocus.focus();
    this.popoverReturnFocus = null;
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
    if (this.def.settings.areaLabels?.enabled && this.def.settings.areaLabels.hideWhenSmaller !== false) {
      this.updateLabelVisibility();
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
    if (!this.options.deepLink?.enabled) return;
    const view = this.def.views.find((v) => v.id === viewId);
    if (!view) return;
    const useSlug = this.options.deepLink.useSlug !== false;
    const viewSlug = (useSlug && view.slug) ? view.slug : view.id;
    const hash = areaId ? `${viewSlug}/${areaId}` : viewSlug;
    history.replaceState(null, "", `#${hash}`);
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
    this.updateDeepLinkHash(viewId);
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
    this.updateDeepLinkHash(prev);
  }

  reset() {
    this.history = [];
    this.currentViewId = this.def.settings.initialViewId;
    this.renderView(this.currentViewId);
    this.updateDeepLinkHash(this.currentViewId);
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
    window.removeEventListener("keydown", this.onWindowKeyDown);
    window.removeEventListener("keyup", this.onWindowKeyUp);
    document.removeEventListener("click", this.onDocumentClick);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    if (this.shadowRoot) {
      // Remove shadow root by clearing the container's shadow
      this.root.remove();
    } else {
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

// ---------------------------------------------------------------------------
// CSS injection helper — called by build to inline the CSS string
// ---------------------------------------------------------------------------

export function __setInlinedCSS(css: string) {
  _inlinedCSS = css;
}
