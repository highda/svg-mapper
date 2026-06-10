import { useEffect, useMemo, useState } from "react";
import rendererJs from "../../../renderer/dist/clickmap-renderer.js?raw";
import rendererCss from "../../../renderer/dist/clickmap-renderer.css?raw";
import { useStore } from "../store";
import { toDefinition } from "../lib/project";
import { buildPreviewHtml, PREVIEW_MESSAGE_SOURCE } from "../lib/preview-html";

// Renders the current project with the real renderer build inside a
// sandboxed iframe — the same code path as the export package.

type PreviewWidth = "full" | "768" | "375";

const WIDTHS: { id: PreviewWidth; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "768", label: "Tablet 768" },
  { id: "375", label: "Mobile 375" },
];

interface PreviewMessage {
  source?: string;
  kind?: "event" | "url";
  event?: { type: string; currentViewId?: string; areaName?: string; message?: string };
  href?: string;
  blocked?: boolean;
}

export function PreviewScreen() {
  const project = useStore((s) => s.project);

  const [width, setWidth] = useState<PreviewWidth>("full");
  const [blockUrls, setBlockUrls] = useState(true);
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string>("—");

  const srcdoc = useMemo(
    () =>
      buildPreviewHtml({
        definition: toDefinition(project),
        rendererJs,
        rendererCss,
        blockUrls,
      }),
    [project, blockUrls],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data as PreviewMessage;
      if (!msg || msg.source !== PREVIEW_MESSAGE_SOURCE) return;
      if (msg.kind === "url") {
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
      <div className="flex items-center gap-3 border-b border-neutral-700 bg-neutral-900 px-3 py-1.5">
        <div className="flex gap-0.5">
          {WIDTHS.map((w) => (
            <button
              key={w.id}
              onClick={() => setWidth(w.id)}
              className={`rounded px-2 py-0.5 text-xs ${
                width === w.id
                  ? "bg-blue-600 text-white"
                  : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300 select-none">
          <input
            type="checkbox"
            checked={blockUrls}
            onChange={(e) => setBlockUrls(e.target.checked)}
            className="accent-blue-500"
          />
          Block outbound URLs
        </label>

        <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
          <span>
            View: <span className="text-neutral-300">{viewName}</span>
          </span>
          <span>
            Last event: <span className="text-neutral-300">{lastEvent}</span>
          </span>
        </div>
      </div>

      {/* Iframe stage */}
      <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
        <iframe
          title="Map preview"
          sandbox="allow-scripts allow-popups"
          srcDoc={srcdoc}
          className="h-full rounded border border-neutral-700 bg-neutral-800 shadow-lg"
          style={{ width: width === "full" ? "100%" : `${width}px`, flexShrink: 0 }}
        />
      </div>
    </main>
  );
}
