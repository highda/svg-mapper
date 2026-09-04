import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import type { Layer, View } from "@svg-mapper/shared";

// ---------------------------------------------------------------------------
// Inline-rename input
// ---------------------------------------------------------------------------

function InlineRename({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (name: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const trimmed = draft.trim();
    onCommit(trimmed || value);
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { setDraft(value); onCommit(value); }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      className={`min-w-0 flex-1 rounded border border-blue-500 bg-neutral-800 px-1 py-0 text-xs text-neutral-100 outline-none ${className ?? ""}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Area row
// ---------------------------------------------------------------------------

function AreaRow({ areaId, name }: { areaId: string; name: string }) {
  const { selectedAreaId, setSelectedAreaId, reorderArea } = useStore();
  const selected = selectedAreaId === areaId;

  return (
    <div
      onClick={() => setSelectedAreaId(areaId)}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs ${
        selected
          ? "bg-blue-600 text-white"
          : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
      }`}
    >
      <span className="text-[10px] opacity-50">▸</span>
      <span className="min-w-0 truncate">{name}</span>
      <span className="ml-auto flex shrink-0 gap-1">
        <button title="Move backward" onClick={(event) => { event.stopPropagation(); reorderArea(areaId, -1); }}>↓</button>
        <button title="Move forward" onClick={(event) => { event.stopPropagation(); reorderArea(areaId, 1); }}>↑</button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer row
// ---------------------------------------------------------------------------

function LayerRow({
  layer,
  idx,
  totalLayers,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  layer: Layer;
  idx: number;
  totalLayers: number;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (e: React.DragEvent, toIdx: number) => void;
}) {
  const {
    selectedLayerId,
    setSelectedLayerId,
    renameLayer,
    deleteLayer,
    toggleLayerVisibility,
    toggleLayerLock,
  } = useStore();

  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const selected = selectedLayerId === layer.id;

  function handleRowClick(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedLayerId(layer.id);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (totalLayers <= 1) return;
    deleteLayer(layer.id);
  }

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(idx); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(e, idx); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(e, idx); }}
      className="select-none"
    >
      {/* Layer header */}
      <div
        onClick={handleRowClick}
        className={`flex items-center gap-1 rounded px-1 py-0.5 ${
          selected
            ? "bg-neutral-700 text-neutral-100"
            : "text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        {/* Drag handle */}
        <span
          className="cursor-grab text-[10px] text-neutral-600 hover:text-neutral-400"
          title="Drag to reorder"
        >
          ⠿
        </span>

        {/* Expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
          className="text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          {expanded ? "▾" : "▸"}
        </button>

        {/* Name */}
        {renaming ? (
          <InlineRename
            value={layer.name}
            onCommit={(name) => { renameLayer(layer.id, name); setRenaming(false); }}
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}
            className="min-w-0 flex-1 truncate text-xs"
            title={layer.name}
          >
            {layer.name}
          </span>
        )}

        {/* Visibility toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
          title={layer.visible ? "Hide layer" : "Show layer"}
          className={`text-[11px] ${layer.visible ? "text-neutral-400 hover:text-neutral-200" : "text-neutral-600 hover:text-neutral-400"}`}
        >
          {layer.visible ? "○" : "◌"}
        </button>

        {/* Lock toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
          title={layer.locked ? "Unlock" : "Lock"}
          className={`text-[10px] ${layer.locked ? "text-amber-400 hover:text-amber-200" : "text-neutral-600 hover:text-neutral-400"}`}
        >
          {layer.locked ? "🔒" : "🔓"}
        </button>

        {/* Delete */}
        {totalLayers > 1 && (
          <button
            onClick={handleDelete}
            title="Delete layer"
            className="text-[10px] text-neutral-700 hover:text-red-400"
          >
            ✕
          </button>
        )}
      </div>

      {/* Areas */}
      {expanded && layer.areas.length > 0 && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {layer.areas.map((area) => (
            <AreaRow key={area.id} areaId={area.id} name={area.name} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View section
// ---------------------------------------------------------------------------

function ViewSection({ view, isActive }: { view: View; isActive: boolean }) {
  const {
    activeViewId,
    setActiveViewId,
    renameView,
    duplicateView,
    deleteView,
    addLayer,
    reorderLayer,
    project,
  } = useStore();

  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const dragFromIdx = useRef<number | null>(null);
  const canDelete = project.views.length > 1;

  function handleViewClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (activeViewId !== view.id) {
      setActiveViewId(view.id);
    }
  }

  function handleDragStart(idx: number) {
    dragFromIdx.current = idx;
  }

  function handleDragOver(e: React.DragEvent, _idx: number) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent, toIdx: number) {
    e.preventDefault();
    const fromIdx = dragFromIdx.current;
    if (fromIdx === null || fromIdx === toIdx) { dragFromIdx.current = null; return; }
    reorderLayer(view.id, fromIdx, toIdx);
    dragFromIdx.current = null;
  }

  return (
    <div className={`mb-1 rounded border ${isActive ? "border-blue-700" : "border-transparent"}`}>
      {/* View header */}
      <div
        onClick={handleViewClick}
        className={`flex cursor-pointer items-center gap-1 rounded px-1 py-1 ${
          isActive ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        }`}
      >
        {/* Expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
          className="text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          {expanded ? "▾" : "▸"}
        </button>

        {/* View name */}
        {renaming ? (
          <InlineRename
            value={view.name}
            onCommit={(name) => { renameView(view.id, name); setRenaming(false); }}
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}
            className="min-w-0 flex-1 truncate text-xs font-medium"
            title={view.name}
          >
            {view.name}
          </span>
        )}

        {/* Duplicate view */}
        <button
          onClick={(e) => { e.stopPropagation(); duplicateView(view.id); }}
          title="Duplicate view"
          className="text-[10px] text-neutral-700 hover:text-neutral-300"
        >
          ⧉
        </button>

        {/* Delete view */}
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); deleteView(view.id); }}
            title="Delete view"
            className="text-[10px] text-neutral-700 hover:text-red-400"
          >
            ✕
          </button>
        )}
      </div>

      {/* Layers */}
      {expanded && (
        <div className="ml-2 space-y-0.5 pb-1">
          {view.layers.map((layer, idx) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              idx={idx}
              totalLayers={view.layers.length}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))}

          {/* Add Layer */}
          {isActive && (
            <button
              onClick={() => addLayer(view.id)}
              className="mt-0.5 w-full rounded px-1 py-0.5 text-left text-[10px] text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
            >
              + Add Layer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeftPanel
// ---------------------------------------------------------------------------

export function LeftPanel() {
  const { project, activeViewId, addView, setSelectedAreaId, setActiveViewId } = useStore();
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" shortcut focuses the search input (issue #28 I5)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Filter views/areas by search query
  const query = searchQuery.trim().toLowerCase();

  function handleAreaSearchClick(viewId: string, areaId: string) {
    setActiveViewId(viewId);
    setSelectedAreaId(areaId);
    setSearchQuery("");
  }

  return (
    <aside className="hidden w-56 flex-col border-r border-neutral-700 bg-neutral-900 lg:flex">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-700 px-2 py-1.5">
        <span className="text-xs font-semibold text-neutral-300">Views &amp; Layers</span>
        <button
          onClick={addView}
          title="Add view"
          className="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200"
        >
          + View
        </button>
      </div>

      {/* Search (issue #28 I5) */}
      <div className="border-b border-neutral-700 px-2 py-1.5">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search areas… (/)"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[10px] text-neutral-300 placeholder-neutral-600 outline-none focus:border-blue-500"
        />
      </div>

      {/* Search results */}
      {query && (
        <div className="max-h-48 overflow-y-auto border-b border-neutral-700 p-1">
          {project.views.flatMap((view) =>
            view.layers.flatMap((layer) =>
              layer.areas
                .filter((a) => a.name.toLowerCase().includes(query))
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleAreaSearchClick(view.id, a.id)}
                    className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-[10px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
                  >
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="shrink-0 text-neutral-600">{view.name}</span>
                  </button>
                ))
            )
          ).slice(0, 50)}
        </div>
      )}

      {/* Tree (hidden when searching) */}
      {!query && (
        <div className="flex-1 overflow-y-auto p-1.5">
          {project.views.map((view) => (
            <ViewSection key={view.id} view={view} isActive={view.id === activeViewId} />
          ))}
        </div>
      )}
    </aside>
  );
}
