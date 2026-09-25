import type { ClickMapDefinition, ContainerSizingMode } from "@svg-mapper/shared";
import { serializeJsonForScript } from "./script-json";

// Builds the srcdoc for the Preview iframe. The document embeds the *real*
// renderer build (same code path as the export package) plus a thin harness
// that forwards renderer events to the parent and optionally blocks
// outbound URLs (the renderer dispatches `url` actions via window.open).

export const PREVIEW_MESSAGE_SOURCE = "clickmap-preview";

export interface PreviewHtmlOptions {
  definition: ClickMapDefinition;
  rendererJs: string;
  rendererCss: string;
  blockUrls: boolean;
  /** Explicitly trusted, session-only JavaScript. Never sourced from project JSON. */
  hookCode?: string;
  /** Resolved renderer sizing mode; decides what an automatic host height means. */
  sizingMode: ContainerSizingMode;
}

/**
 * The map host element inside the preview page. null width fills the page
 * width; null height is the page height for fill-container maps and the
 * content height otherwise. The frame starts automatic and announces
 * `harness-ready`; the editor answers with `set-host`, and every later change
 * arrives the same way, so the map is resized, never rebuilt.
 */
export interface PreviewHostSize {
  width: number | null;
  height: number | null;
}

export function buildPreviewHtml(opts: PreviewHtmlOptions): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${opts.rendererCss}
html, body { margin: 0; height: 100%; background: #262626; }
body { overflow: auto; }
#host-wrap { position: relative; box-sizing: border-box; outline: 1px dashed rgba(96, 165, 250, .55); }
#map { width: 100%; }
#host-handle {
  position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; z-index: 2147483647;
  border-radius: 3px; background: #3b82f6; border: 2px solid #fff; cursor: nwse-resize; touch-action: none;
}
#host-handle:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
#preview-toast {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  background: #b91c1c; color: #fff; font: 12px system-ui, sans-serif;
  padding: 6px 12px; border-radius: 6px; opacity: 0; transition: opacity .2s;
  pointer-events: none; max-width: 90%; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
#preview-toast.visible { opacity: 1; }
</style>
</head>
<body>
<div id="host-wrap"><div id="map"></div><div id="host-handle" role="slider" tabindex="0" aria-label="Resize map host (arrow keys; Shift for larger steps)" aria-valuetext=""></div></div>
<div id="preview-toast" role="status"></div>
<script>${opts.rendererJs}</script>
<script>
(function () {
  var DEFINITION = ${serializeJsonForScript(opts.definition)};
  var BLOCK_URLS = ${opts.blockUrls ? "true" : "false"};
  var TRUSTED_HOOK_CODE = ${serializeJsonForScript(opts.hookCode ?? "")};
  var SIZING_MODE = ${serializeJsonForScript(opts.sizingMode)};
  var host = { width: null, height: null };
  var MIN_W = 120, MIN_H = 80;

  function post(payload) {
    parent.postMessage(Object.assign({ source: "${PREVIEW_MESSAGE_SOURCE}" }, payload), "*");
  }

  var wrap = document.getElementById("host-wrap");
  var mapHost = document.getElementById("map");
  var handle = document.getElementById("host-handle");

  function applyHost() {
    var fill = SIZING_MODE === "fill-container";
    wrap.style.width = host.width ? host.width + "px" : "100%";
    wrap.style.height = host.height ? host.height + "px" : (fill ? "100%" : "auto");
    mapHost.style.height = host.height || fill ? "100%" : "auto";
  }
  applyHost();

  function round(n) { return Math.round(n); }
  function reportSize() {
    var hostBox = wrap.getBoundingClientRect();
    var root = mapHost.querySelector(".clickmap-root");
    var mapBox = root ? root.getBoundingClientRect() : { width: 0, height: 0 };
    handle.setAttribute("aria-valuetext", round(hostBox.width) + " by " + round(hostBox.height) + " pixels");
    post({
      kind: "size",
      page: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      host: { width: round(hostBox.width), height: round(hostBox.height) },
      map: { width: round(mapBox.width), height: round(mapBox.height) },
    });
  }
  var sizeObserver = new ResizeObserver(reportSize);
  sizeObserver.observe(wrap);
  sizeObserver.observe(document.documentElement);

  function setHostFromUser(width, height) {
    host = { width: Math.max(MIN_W, round(width)), height: Math.max(MIN_H, round(height)) };
    applyHost();
    post({ kind: "host-resized", host: host });
  }

  // Only the editor window that owns this frame may resize the host.
  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (event.source !== parent || !msg || msg.source !== "${PREVIEW_MESSAGE_SOURCE}") return;
    if (msg.kind === "set-host" && msg.host) {
      host = { width: msg.host.width || null, height: msg.host.height || null };
      applyHost();
    }
  });

  var drag = null;
  handle.addEventListener("pointerdown", function (event) {
    var box = wrap.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, width: box.width, height: box.height };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener("pointermove", function (event) {
    if (!drag) return;
    setHostFromUser(drag.width + event.clientX - drag.x, drag.height + event.clientY - drag.y);
  });
  function endDrag() { drag = null; }
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("keydown", function (event) {
    var step = event.shiftKey ? 50 : 10;
    var box = wrap.getBoundingClientRect();
    var dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    var dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    setHostFromUser(box.width + dx, box.height + dy);
  });

  var toastTimer = null;
  function toast(text) {
    var el = document.getElementById("preview-toast");
    el.textContent = text;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("visible"); }, 2500);
  }

  var realOpen = window.open.bind(window);
  window.open = function (href, target) {
    post({ kind: "url", href: String(href), target: String(target), blocked: BLOCK_URLS });
    if (BLOCK_URLS) {
      toast("Blocked outbound URL: " + href);
      return null;
    }
    return realOpen(href, target);
  };

  var map = ClickMapRenderer.create({ container: "#map", definition: DEFINITION });
  post({ kind: "harness-ready" });
  map.on("ready", function () {
    var root = mapHost.querySelector(".clickmap-root");
    if (root) sizeObserver.observe(root);
    reportSize();
  });
  ["ready", "view:leave", "view:enter", "view:change", "camera:change", "area:hover", "area:click", "popup:open", "popup:close", "error"]
    .forEach(function (t) {
      map.on(t, function (e) { post({ kind: "event", event: e }); });
    });
  if (TRUSTED_HOOK_CODE) {
    try {
      Function("map", "log", '"use strict";\\n' + TRUSTED_HOOK_CODE)(map, function (message) {
        post({ kind: "hook-log", message: String(message) });
      });
    } catch (error) {
      post({ kind: "hook-error", message: error && error.message ? error.message : String(error) });
    }
  }
})();
</script>
</body>
</html>`;
}
