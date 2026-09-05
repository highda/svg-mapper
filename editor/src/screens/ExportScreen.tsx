import { useMemo, useState } from "react";
import {
  validateProject,
  hasBlockingErrors,
  type ValidationResult,
} from "@svg-mapper/shared";
import { useStore } from "../store";
import { toDefinition } from "../lib/project";
import { generateExportPackage, generateExportPreview } from "../lib/export-package";
import rendererJs from "../../../renderer/dist/clickmap-renderer.js?raw";
import rendererCss from "../../../renderer/dist/clickmap-renderer.css?raw";

function ResultRow({ result }: { result: ValidationResult }) {
  const revealValidationRef = useStore((s) => s.revealValidationRef);
  const isError = result.severity === "error";
  const clickable = !!result.ref;

  return (
    <li>
      <button
        disabled={!clickable}
        onClick={() => result.ref && revealValidationRef(result.ref)}
        className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs ${
          clickable ? "hover:bg-neutral-800" : "cursor-default"
        }`}
      >
        <span
          className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-semibold uppercase ${
            isError ? "bg-red-700 text-red-50" : "bg-amber-600 text-amber-50"
          }`}
        >
          {isError ? "Error" : "Warn"}
        </span>
        <span className={isError ? "text-neutral-200" : "text-neutral-300"}>
          {result.message}
          {clickable && <span className="ml-1 text-[10px] text-blue-400">↗ reveal</span>}
        </span>
      </button>
    </li>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <div>
      <button
        onClick={() => void copy()}
        className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      >
        {copied ? "Copied!" : copyFailed ? "Retry copy" : label}
      </button>
      {copyFailed && (
        <div className="mt-2" role="alert">
          <p className="mb-1 text-[11px] text-amber-300">Clipboard access failed. Select and copy manually:</p>
          <textarea readOnly value={text} aria-label={`${label} manual copy`} className="h-24 w-full rounded border border-amber-700 bg-neutral-950 p-2 text-[10px] text-neutral-300" onFocus={(event) => event.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExportScreen() {
  const project = useStore((s) => s.project);
  const [confirmingWarnings, setConfirmingWarnings] = useState(false);
  const [inlineAssets, setInlineAssets] = useState(true);
  const [basePath, setBasePath] = useState("/maps/my-map");
  const [containerId, setContainerId] = useState("clickmap");
  const [size, setSize] = useState<"responsive" | "fixed" | "viewport">("responsive");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const definition = useMemo(() => toDefinition(project), [project]);
  const results = useMemo(() => validateProject(definition), [definition]);
  const errors = results.filter((r) => r.severity === "error");
  const warnings = results.filter((r) => r.severity === "warning");
  const blocked = hasBlockingErrors(results);

  const sizing = size === "fixed"
    ? { containerWidth: "800px", containerHeight: "600px" }
    : size === "viewport"
      ? { containerWidth: "100vw", containerHeight: "100vh" }
      : { containerWidth: "100%", containerHeight: "auto" };
  const configError = !/^[A-Za-z][A-Za-z0-9_-]*$/.test(containerId)
    ? "Container ID must start with a letter and contain only letters, numbers, _ or -."
    : !basePath.trim()
      ? "Upload base path is required."
      : null;
  const exportOptions = { inlineAssets, basePath, containerId, ...sizing };
  const preview = useMemo(
    () => generateExportPreview(definition, rendererJs, rendererCss, {
      inlineAssets,
      basePath,
      containerId,
      containerWidth: sizing.containerWidth,
      containerHeight: sizing.containerHeight,
    }),
    [definition, inlineAssets, basePath, containerId, sizing.containerWidth, sizing.containerHeight],
  );

  async function doExport() {
    if (exporting || configError) return;
    setExporting(true);
    setExportError(null);
    try {
      // Let React paint the busy state before synchronous compression begins.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const pkg = generateExportPackage(definition, rendererJs, rendererCss, exportOptions);

      const blob = new Blob([pkg.zip.buffer as ArrayBuffer], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = definition.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      a.href = url;
      a.download = `${slug}-export.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setConfirmingWarnings(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Packaging failed. Try again.");
    } finally {
      setExporting(false);
    }
  }

  function handleExportClick() {
    if (blocked) return;
    if (warnings.length > 0) {
      setConfirmingWarnings(true);
      return;
    }
    void doExport();
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-neutral-800" data-testid="export-screen">
      <div className="mx-auto flex min-w-0 w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">Export</h2>
          <div className="flex flex-wrap items-center gap-2">
            {errors.length > 0 && (
              <span
                className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-semibold text-red-50"
                data-testid="error-badge"
              >
                {errors.length} error{errors.length === 1 ? "" : "s"}
              </span>
            )}
            {warnings.length > 0 && (
              <span className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold text-amber-50">
                {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              </span>
            )}
            <button
              onClick={handleExportClick}
              disabled={blocked || exporting || !!configError}
              data-testid="export-button"
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {exporting ? "Packaging…" : "Download ZIP"}
            </button>
          </div>
        </div>

        {/* Validation */}
        {blocked && (
          <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">
            Fix all errors before exporting. Click an entry to jump to the offending object.
          </p>
        )}

        {exportError && <p role="alert" className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">Export failed: {exportError} You can retry without losing your settings.</p>}

        {results.length === 0 ? (
          <p className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">
            ✓ Validation passed — no issues found.
          </p>
        ) : (
          <div className="space-y-3">
            {errors.length > 0 && (
              <section>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-400">
                  Errors ({errors.length})
                </h3>
                <ul className="space-y-0.5">
                  {errors.map((r, i) => (
                    <ResultRow key={`e${i}`} result={r} />
                  ))}
                </ul>
              </section>
            )}
            {warnings.length > 0 && (
              <section>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                  Warnings ({warnings.length})
                </h3>
                <ul className="space-y-0.5">
                  {warnings.map((r, i) => (
                    <ResultRow key={`w${i}`} result={r} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Options */}
        <section className="rounded border border-neutral-700 p-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Package options
          </h3>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={inlineAssets}
              onChange={(e) => setInlineAssets(e.target.checked)}
              className="accent-blue-500"
            />
            Inline assets into map.json (larger file, no separate assets/ folder)
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-300">Upload base path
              <input value={basePath} onChange={(event) => setBasePath(event.target.value)} placeholder="/maps/store-directory" className="mt-1 w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-neutral-100" />
            </label>
            <label className="text-xs text-neutral-300">Container ID
              <input value={containerId} onChange={(event) => setContainerId(event.target.value)} className="mt-1 w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-neutral-100" />
            </label>
            <label className="text-xs text-neutral-300 sm:col-span-2">Container sizing
              <select value={size} onChange={(event) => setSize(event.target.value as typeof size)} className="mt-1 w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-neutral-100">
                <option value="responsive">Responsive — 100% wide, intrinsic height</option>
                <option value="fixed">Fixed — 800 × 600 px</option>
                <option value="viewport">Viewport — 100vw × 100vh</option>
              </select>
            </label>
          </div>
          {configError && <p role="alert" className="mt-2 text-xs text-red-300">{configError}</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Includes renderer JS and CSS plus {inlineAssets ? "one self-contained map.json; no assets folder is required" : `${preview.assetFileCount} file${preview.assetFileCount === 1 ? "" : "s"} in assets/ referenced by map.json`}. Estimated uncompressed package: {formatBytes(preview.estimatedUncompressedBytes)} ({formatBytes(preview.assetBytes)} of source assets).
          </p>
        </section>

        {/* Quick copy actions */}
        <section className="rounded border border-neutral-700 p-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Quick copy
          </h3>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={preview.embedSnippet} label="Copy embed snippet" />
            <CopyButton text={preview.mapJson} label="Copy map.json" />
          </div>

          <pre className="mt-3 max-w-full overflow-x-auto rounded bg-neutral-900 p-2 text-[10px] leading-relaxed text-neutral-400">
            {preview.embedSnippet}
          </pre>
        </section>
      </div>

      {/* Warnings confirmation dialog */}
      {confirmingWarnings && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-neutral-100">Export with warnings?</h3>
            <p className="mt-1.5 text-xs text-neutral-400">
              This project has {warnings.length} warning{warnings.length === 1 ? "" : "s"}.
              You can export anyway, but consider reviewing them first.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmingWarnings(false)}
                className="rounded px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={() => void doExport()}
                disabled={exporting}
                data-testid="export-anyway"
                className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
              >
                {exporting ? "Packaging…" : "Export anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
