import { useRef, useState } from "react";
import { useStore } from "../store";
import { Canvas } from "../components/canvas/Canvas";
import { Toolbar } from "../components/ui/Toolbar";
import { importFileAsAsset, isAllowedAssetType } from "../lib/asset";

export function DesignScreen() {
  const { activeViewId, importAsset, setViewBackground, openError, clearOpenError, canvasSizeSuggestion, dismissCanvasSizeSuggestion, setCanvasSize } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!isAllowedAssetType(file.type)) {
      setImportError(`Unsupported type "${file.type}". Use PNG, JPG, WebP, or SVG.`);
      return;
    }
    setImportError(null);
    setImporting(true);
    try {
      const asset = await importFileAsAsset(file);
      importAsset(asset);
      setViewBackground(activeViewId, asset.id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave() {
    setDragOver(false);
  }

  const error = importError || (openError && !importError ? openError : null);

  return (
    <div
      className="relative flex flex-1 overflow-hidden"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* Drag-over overlay */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-blue-900/40 ring-2 ring-inset ring-blue-500">
          <span className="rounded bg-blue-700 px-4 py-2 text-sm text-white">
            Drop image or SVG to set background
          </span>
        </div>
      )}

      <Toolbar />

      <div className="relative flex flex-1 flex-col">
        {/* Error / import toast */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-red-700 bg-red-950 px-3 py-1.5 text-xs text-red-300"
          >
            <span className="flex-1">{error}</span>
            <button
              onClick={() => {
                setImportError(null);
                clearOpenError();
              }}
              className="text-red-400 hover:text-red-200"
            >
              ✕
            </button>
          </div>
        )}

        {/* Canvas size suggestion banner (issue #28 I4) */}
        {canvasSizeSuggestion && (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-blue-700 bg-blue-950 px-3 py-1.5 text-xs text-blue-200"
          >
            <span className="flex-1">
              Background image is {canvasSizeSuggestion.width}×{canvasSizeSuggestion.height} — match canvas size?
            </span>
            <button
              onClick={() => { setCanvasSize(canvasSizeSuggestion.width, canvasSizeSuggestion.height); dismissCanvasSizeSuggestion(); }}
              className="rounded bg-blue-700 px-2 py-0.5 text-xs text-white hover:bg-blue-600"
            >
              Yes
            </button>
            <button
              onClick={dismissCanvasSizeSuggestion}
              className="text-blue-400 hover:text-blue-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Import button */}
        <div className="absolute right-2 top-2 z-10 flex gap-1.5">
          <button
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import background"}
          </button>
        </div>

        <Canvas />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  );
}
