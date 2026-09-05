import type { ClickMapDefinition } from "@svg-mapper/shared";
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
#map { height: 100%; }
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
<div id="map"></div>
<div id="preview-toast" role="status"></div>
<script>${opts.rendererJs}</script>
<script>
(function () {
  var DEFINITION = ${serializeJsonForScript(opts.definition)};
  var BLOCK_URLS = ${opts.blockUrls ? "true" : "false"};

  function post(payload) {
    parent.postMessage(Object.assign({ source: "${PREVIEW_MESSAGE_SOURCE}" }, payload), "*");
  }

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
  ["view:change", "area:hover", "area:click", "popup:open", "popup:close", "error"]
    .forEach(function (t) {
      map.on(t, function (e) { post({ kind: "event", event: e }); });
    });
  // The renderer emits "ready" synchronously inside create(), before any
  // listener can attach — synthesize it here instead.
  post({ kind: "event", event: { type: "ready", currentViewId: map.getCurrentView() } });
})();
</script>
</body>
</html>`;
}
