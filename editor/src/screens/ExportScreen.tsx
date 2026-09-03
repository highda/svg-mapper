import { useMemo, useState } from "react";
import {
  validateProject,
  hasBlockingErrors,
  type ValidationResult,
} from "@svg-mapper/shared";
import { useStore } from "../store";
import { toDefinition } from "../lib/project";
import { generateExportPackage } from "../lib/export-package";
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

  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={copy}
      className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export function ExportScreen() {
  const project = useStore((s) => s.project);
  const [confirmingWarnings, setConfirmingWarnings] = useState(false);
  const [inlineAssets, setInlineAssets] = useState(true);

  const definition = useMemo(() => toDefinition(project), [project]);
  const results = useMemo(() => validateProject(definition), [definition]);
  const errors = results.filter((r) => r.severity === "error");
  const warnings = results.filter((r) => r.severity === "warning");
  const blocked = hasBlockingErrors(results);

  const mapJsonPreview = useMemo(() => JSON.stringify(definition, null, 2), [definition]);

  function doExport() {
    const pkg = generateExportPackage(definition, rendererJs, rendererCss, {
      inlineAssets,
    });

    // Trigger download.
    const blob = new Blob([pkg.zip.buffer as ArrayBuffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = definition.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    a.href = url;
    a.download = `${slug}-export.zip`;
    a.click();
    URL.revokeObjectURL(url);

    setConfirmingWarnings(false);
  }

  function handleExportClick() {
    if (blocked) return;
    if (warnings.length > 0) {
      setConfirmingWarnings(true);
      return;
    }
    doExport();
  }

  const embedSnippet = useMemo(
    () => generateExportPackage(definition, "", "", { inlineAssets }).embedSnippet,
    [definition, inlineAssets],
  );

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-neutral-800" data-testid="export-screen">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-200">Export</h2>
          <div className="flex items-center gap-2">
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
              disabled={blocked}
              data-testid="export-button"
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              Download ZIP
            </button>
          </div>
        </div>

        {/* Validation */}
        {blocked && (
          <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">
            Fix all errors before exporting. Click an entry to jump to the offending object.
          </p>
        )}

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
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            The optimized production renderer is included automatically.
          </p>
        </section>

        {/* Quick copy actions */}
        <section className="rounded border border-neutral-700 p-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Quick copy
          </h3>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={embedSnippet} label="Copy embed snippet" />
            <CopyButton text={mapJsonPreview} label="Copy map.json" />
          </div>

          <pre className="mt-3 overflow-x-auto rounded bg-neutral-900 p-2 text-[10px] leading-relaxed text-neutral-400">
            {embedSnippet}
          </pre>
        </section>
      </div>

      {/* Warnings confirmation dialog */}
      {confirmingWarnings && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl">
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
                onClick={doExport}
                data-testid="export-anyway"
                className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
              >
                Export anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
