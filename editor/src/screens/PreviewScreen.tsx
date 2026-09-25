import { useEffect, useMemo, useRef, useState } from "react";
import { resolveSizingMode } from "@svg-mapper/shared";
import rendererJs from "../../../renderer/dist/clickmap-renderer.js?raw";
import rendererCss from "../../../renderer/dist/clickmap-renderer.css?raw";
import { useStore } from "../store";
import { toDefinition } from "../lib/project";
import { buildPreviewHtml, PREVIEW_MESSAGE_SOURCE, type PreviewHostSize } from "../lib/preview-html";

// Renders the current project with the real renderer build inside a
// sandboxed iframe — the same code path as the export package. The iframe is
// the host *page*; the map host inside it is sized independently, so viewport
// width and embedding-element size can be tested separately. Size changes are
// posted to the running map, never applied by rebuilding it.

type PageWidth = "full" | 1200 | 768 | 375;

const PAGE_WIDTHS: { id: PageWidth; label: string }[] = [
  { id: "full", label: "Full" },
  { id: 1200, label: "1200" },
  { id: 768, label: "768" },
  { id: 375, label: "375" },
];

const MODE_LABEL = { "fluid-width": "Fluid width", "fill-container": "Fill host", fixed: "Canvas size" } as const;

interface Box { width: number; height: number }

function parseDimension(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : undefined;
}

interface PreviewMessage {
  source?: string;
  kind?: "event" | "url" | "hook-log" | "hook-error" | "size" | "host-resized" | "harness-ready";
  event?: { type: string; currentViewId?: string; areaName?: string; message?: string };
  page?: Box;
  map?: Box;
  host?: Box | PreviewHostSize;
  href?: string;
  blocked?: boolean;
  message?: string;
}

export function PreviewScreen() {
  const project = useStore((s) => s.project);

  const [pageWidth, setPageWidth] = useState<PageWidth>("full");
  const [host, setHost] = useState<PreviewHostSize>({ width: null, height: null });
  const [hostWidthText, setHostWidthText] = useState("");
  const [hostHeightText, setHostHeightText] = useState("");
  const [measured, setMeasured] = useState<{ page: Box; host: Box; map: Box } | null>(null);
  const [restartCount, setRestartCount] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [harnessGeneration, setHarnessGeneration] = useState(0);
  const sizingMode = resolveSizingMode(project.settings);
  const [blockUrls, setBlockUrls] = useState(true);
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string>("—");
  const [showHooks, setShowHooks] = useState(false);
  const [hookCode, setHookCode] = useState('map.on("area:click", event => log(`Clicked ${event.areaName}`));');
  const [activeHookCode, setActiveHookCode] = useState("");
  const [hookLogs, setHookLogs] = useState<string[]>([]);

  const srcdoc = useMemo(
    () =>
      buildPreviewHtml({
        definition: toDefinition(project),
        rendererJs,
        rendererCss,
        blockUrls,
        hookCode: activeHookCode,
        sizingMode,
      }),
    [project, blockUrls, activeHookCode, sizingMode],
  );

  // Resize the running map; also re-sent whenever a (re)loaded frame announces itself.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ source: PREVIEW_MESSAGE_SOURCE, kind: "set-host", host }, "*");
  }, [host, harnessGeneration]);

  function applyHost(next: PreviewHostSize) {
    setHost(next);
    setHostWidthText(next.width ? String(next.width) : "");
    setHostHeightText(next.height ? String(next.height) : "");
  }

  function commitHostText(width: string, height: string) {
    const w = parseDimension(width);
    const h = parseDimension(height);
    if (w === undefined || h === undefined) return;
    setHost({ width: w, height: h });
  }

  const viewCanvas =
    project.views.find((v) => v.id === currentViewId)?.canvas ??
    project.views.find((v) => v.id === project.settings.initialViewId)?.canvas;

  /** Size the host so the whole map is visible in the stage without scrolling the page. */
  function fitToStage() {
    const page = measured?.page;
    if (sizingMode === "fluid-width" && page && viewCanvas && viewCanvas.height > 0) {
      const width = Math.min(page.width, Math.floor(page.height * viewCanvas.width / viewCanvas.height));
      applyHost({ width, height: null });
    } else {
      applyHost({ width: null, height: null });
    }
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data as PreviewMessage;
      // The marker alone is forgeable; only the frame we own may report status.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (!msg || msg.source !== PREVIEW_MESSAGE_SOURCE) return;
      if (msg.kind === "size" && msg.page && msg.map && msg.host) {
        setMeasured({ page: msg.page, host: msg.host as Box, map: msg.map });
      } else if (msg.kind === "harness-ready") {
        // A freshly loaded map starts over; drop status from the previous one.
        setCurrentViewId(null);
        setLastEvent("—");
        setHarnessGeneration((n) => n + 1);
      } else if (msg.kind === "host-resized" && msg.host) {
        const next = msg.host as PreviewHostSize;
        setHost(next);
        setHostWidthText(next.width ? String(next.width) : "");
        setHostHeightText(next.height ? String(next.height) : "");
      } else if (msg.kind === "hook-log") {
        setHookLogs((logs) => [...logs.slice(-4), msg.message ?? ""]);
        setLastEvent(`hook: ${msg.message ?? ""}`);
      } else if (msg.kind === "hook-error") {
        setHookLogs((logs) => [...logs.slice(-4), `Error: ${msg.message ?? ""}`]);
        setLastEvent(`hook error: ${msg.message ?? ""}`);
      } else if (msg.kind === "url") {
        setLastEvent(
          msg.blocked ? `URL blocked: ${msg.href}` : `URL opened: ${msg.href}`,
        );
      } else if (msg.kind === "event" && msg.event) {
        const ev = msg.event;
        if (ev.type === "view:change" || ev.type === "ready") {
          if (ev.currentViewId) setCurrentViewId(ev.currentViewId);
        }
        if (ev.type === "ready") {
          setLastEvent("ready");
        } else if (ev.type === "error") {
          setLastEvent(`error: ${ev.message ?? ""}`);
        } else if (ev.type !== "area:hover") {
          setLastEvent(ev.areaName ? `${ev.type} (${ev.areaName})` : ev.type);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const viewName =
    project.views.find((v) => v.id === currentViewId)?.name ??
    project.views.find((v) => v.id === project.settings.initialViewId)?.name ??
    "—";

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-neutral-800" data-testid="preview-screen">
      {/* Preview toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-700 bg-neutral-900 px-3 py-1.5">
        <div className="flex items-center gap-0.5" role="group" aria-label="Page width">
          <span className="mr-1 text-xs text-neutral-500">Page</span>
          {PAGE_WIDTHS.map((w) => (
            <button
              key={w.id}
              onClick={() => setPageWidth(w.id)}
              aria-pressed={pageWidth === w.id}
              className={`rounded px-2 py-0.5 text-xs ${
                pageWidth === w.id
                  ? "bg-blue-600 text-white"
                  : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        <form
          className="flex items-center gap-1 text-xs text-neutral-400"
          onSubmit={(event) => { event.preventDefault(); commitHostText(hostWidthText, hostHeightText); }}
        >
          <span>Map host</span>
          <input
            aria-label="Map host width in pixels"
            value={hostWidthText}
            placeholder="auto"
            inputMode="numeric"
            onChange={(event) => setHostWidthText(event.target.value)}
            onBlur={() => commitHostText(hostWidthText, hostHeightText)}
            className="w-16 rounded border border-neutral-600 bg-neutral-900 px-1.5 py-0.5 text-neutral-100"
          />
          <span aria-hidden="true">×</span>
          <input
            aria-label="Map host height in pixels"
            value={hostHeightText}
            placeholder="auto"
            inputMode="numeric"
            onChange={(event) => setHostHeightText(event.target.value)}
            onBlur={() => commitHostText(hostWidthText, hostHeightText)}
            className="w-16 rounded border border-neutral-600 bg-neutral-900 px-1.5 py-0.5 text-neutral-100"
          />
          <button type="submit" className="sr-only">Apply host size</button>
        </form>
        <button type="button" onClick={fitToStage} className="rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700">
          Fit to stage
        </button>
        <button
          type="button"
          onClick={() => { setMeasured(null); setRestartCount((n) => n + 1); }}
          className="rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700"
        >
          Restart preview
        </button>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300 select-none">
          <input
            type="checkbox"
            checked={blockUrls}
            onChange={(e) => setBlockUrls(e.target.checked)}
            className="accent-blue-500"
          />
          Block outbound URLs
        </label>

        <button
          type="button"
          onClick={() => setShowHooks((shown) => !shown)}
          className="rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700"
          aria-expanded={showHooks}
        >
          Advanced: trusted hooks
        </button>

        <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
          <span>
            View: <span className="text-neutral-300">{viewName}</span>
          </span>
          <span>
            Last event: <span className="text-neutral-300">{lastEvent}</span>
          </span>
        </div>
      </div>

      {showHooks && (
        <div className="flex items-start gap-2 border-b border-amber-800/60 bg-neutral-900 px-3 py-2">
          <label className="min-w-0 flex-1 text-xs text-amber-100">
            Trusted JavaScript (Preview session only; never saved)
            <textarea
              value={hookCode}
              onChange={(event) => setHookCode(event.target.value)}
              rows={3}
              spellCheck={false}
              className="mt-1 block w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-xs text-neutral-200"
            />
          </label>
          <button
            type="button"
            onClick={() => { setHookLogs([]); setActiveHookCode(hookCode); }}
            className="mt-5 rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
          >
            Run trusted hooks
          </button>
        </div>
      )}
      {showHooks && hookLogs.length > 0 && (
        <div className="border-b border-neutral-700 bg-neutral-950 px-3 py-1 font-mono text-xs text-neutral-300" role="log" aria-label="Hook log">
          {hookLogs.map((entry, index) => <div key={`${index}-${entry}`}>{entry}</div>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-700 bg-neutral-900/60 px-3 py-1 text-xs text-neutral-500" role="status" aria-label="Preview dimensions">
        <span>Sizing: <span className="text-neutral-300">{MODE_LABEL[sizingMode]}</span></span>
        {measured ? (
          <>
            <span>Page <span className="text-neutral-300">{measured.page.width} × {measured.page.height}</span></span>
            <span>Host <span className="text-neutral-300">{measured.host.width} × {measured.host.height}</span></span>
            <span>Map <span className="text-neutral-300">{measured.map.width} × {measured.map.height}</span></span>
            {measured.map.height > measured.page.height && (
              <span className="text-amber-300">
                The map is taller than the page, so the preview page scrolls as a visitor's would. Use Fit to stage to see it whole.
              </span>
            )}
          </>
        ) : (
          <span>Measuring…</span>
        )}
        <span className="ml-auto">Drag the blue corner handle, or focus it and use the arrow keys, to resize the host.</span>
      </div>

      {/* Iframe stage */}
      <div className="flex min-h-0 flex-1 justify-center overflow-auto overscroll-contain p-4">
        <iframe
          key={restartCount}
          ref={iframeRef}
          title="Map preview"
          sandbox="allow-scripts allow-popups"
          srcDoc={srcdoc}
          className="h-full rounded border border-neutral-700 bg-neutral-800 shadow-lg"
          style={{
            // content-box: a "1200" page is 1200 CSS px inside the frame border.
            width: pageWidth === "full" ? "calc(100% - 2px)" : `${pageWidth}px`,
            boxSizing: "content-box",
            flexShrink: 0,
          }}
        />
      </div>
    </main>
  );
}
