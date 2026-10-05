import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import type { Layer, View } from "@svg-mapper/shared";
import { shouldIgnoreShortcut } from "../../lib/shortcut-guard";
import { useLayoutPrefs } from "../../store/layout-prefs";

const ICON_BUTTON = "grid h-6 w-6 shrink-0 place-items-center rounded text-xs hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400";

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
      aria-label={`Rename ${value}`}
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

function AreaRow({ areaId, name, layerId, targetIndex, locked, onMoveMessage }: { areaId: string; name: string; layerId: string; targetIndex: number; locked: boolean; onMoveMessage: (message: string) => void }) {
  const { selectedAreaId, selectedAreaIds, setSelectedAreaId, setSelectedAreaIds, toggleSelectedAreaId, reorderArea, moveAreaToLayer } = useStore();
  const selected = selectedAreaIds.includes(areaId);
  const primary = selectedAreaId === areaId;
  const [dragOver, setDragOver] = useState(false);

  function visibleRows(element: HTMLElement) {
    const container = element.closest('[aria-label="Views and layers"]') ?? document;
    return [...container.querySelectorAll<HTMLElement>("[data-area-row]")];
  }

  function selectRange(element: HTMLElement, targetId: string) {
    const ids = visibleRows(element).map((row) => row.dataset.areaRow).filter((id): id is string => Boolean(id));
    const anchorIndex = selectedAreaId === null ? -1 : ids.indexOf(selectedAreaId);
    const targetIndex = ids.indexOf(targetId);
    if (anchorIndex < 0 || targetIndex < 0) {
      setSelectedAreaId(targetId);
      return;
    }
    const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    const range = ids.slice(start, end + 1);
    setSelectedAreaIds(anchorIndex <= targetIndex ? range : range.reverse());
  }

  function handleSelection(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
    if (event.shiftKey) selectRange(event.currentTarget, areaId);
    else if (event.metaKey || event.ctrlKey) toggleSelectedAreaId(areaId);
    else setSelectedAreaId(areaId);
  }

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-selected={selected}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      title={name}
      data-area-row={areaId}
      draggable={!locked}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData("application/x-svg-mapper-area", areaId);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-svg-mapper-area")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = locked ? "none" : "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        const movedAreaId = event.dataTransfer.getData("application/x-svg-mapper-area");
        if (!movedAreaId) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        const result = moveAreaToLayer(movedAreaId, layerId, targetIndex);
        onMoveMessage(result === "moved" ? `Area moved before ${name}.` : result === "locked" ? "Layer is locked." : "Area could not be moved.");
      }}
      onClick={handleSelection}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelection(event);
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        if (event.altKey) {
          // Alt+Arrow reorders within the layer: up paints earlier (backward).
          if (locked) { onMoveMessage("Layer is locked."); return; }
          const element = event.currentTarget;
          reorderArea(areaId, event.key === "ArrowUp" ? -1 : 1);
          onMoveMessage(`${name} moved ${event.key === "ArrowUp" ? "backward" : "forward"}.`);
          requestAnimationFrame(() => {
            const row = element.isConnected ? element : document.querySelector<HTMLElement>(`[data-area-row="${CSS.escape(areaId)}"]`);
            row?.focus();
          });
          return;
        }
        const rows = visibleRows(event.currentTarget);
        const index = rows.indexOf(event.currentTarget);
        const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
        if (!next) return;
        next.focus();
        const nextId = next.dataset.areaRow;
        if (nextId) {
          if (event.shiftKey) selectRange(event.currentTarget, nextId);
          else setSelectedAreaId(nextId);
        }
      }}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${dragOver ? locked ? "ring-1 ring-red-500" : "ring-1 ring-blue-400" : ""} ${
        selected
          ? primary ? "bg-blue-600 text-white" : "bg-blue-900 text-blue-50"
          : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? "bg-white" : "bg-neutral-500"}`} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selected area controls: paint order and layer destination for the primary
// selection, so tree rows keep their full width for names (#156).
// ---------------------------------------------------------------------------

function SelectedAreaControls({ onMoveMessage }: { onMoveMessage: (message: string) => void }) {
  const { selectedAreaId, project, reorderArea, moveAreaToLayer } = useStore();
  if (!selectedAreaId) return null;
  let found: { name: string; layer: Layer; index: number } | null = null;
  for (const view of project.views) {
    for (const layer of view.layers) {
      const index = layer.areas.findIndex((area) => area.id === selectedAreaId);
      if (index >= 0) found = { name: layer.areas[index].name, layer, index };
    }
  }
  if (!found) return null;
  const { name, layer, index } = found;
  const locked = layer.locked;
  const buttonClass = "min-h-7 rounded border border-neutral-700 px-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section aria-label={`Arrange ${name}`} className="space-y-1.5 border-t border-neutral-700 bg-neutral-900 px-2 py-2">
      <p className="truncate text-xs text-neutral-400" title={name}>
        <span className="text-neutral-500">Selected:</span> <span className="font-medium text-neutral-100">{name}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={buttonClass}
          disabled={locked || index === 0}
          aria-keyshortcuts="Alt+ArrowUp"
          title={locked ? "Layer is locked" : "Move backward (Alt+↑ in the tree)"}
          onClick={() => { reorderArea(selectedAreaId, -1); onMoveMessage(`${name} moved backward.`); }}
        >Move backward</button>
        <button
          type="button"
          className={buttonClass}
          disabled={locked || index === layer.areas.length - 1}
          aria-keyshortcuts="Alt+ArrowDown"
          title={locked ? "Layer is locked" : "Move forward (Alt+↓ in the tree)"}
          onClick={() => { reorderArea(selectedAreaId, 1); onMoveMessage(`${name} moved forward.`); }}
        >Move forward</button>
      </div>
      <label className="block text-xs text-neutral-400">
        Layer
        <select
          aria-label={`Move ${name} to layer`}
          title={locked ? "Area cannot be moved from a locked layer" : "Move to layer"}
          value={layer.id}
          disabled={locked}
          onChange={(event) => {
            const targetId = event.target.value;
            const target = project.views.flatMap((view) => view.layers).find((candidate) => candidate.id === targetId);
            const result = moveAreaToLayer(selectedAreaId, targetId);
            onMoveMessage(result === "moved" ? `${name} moved to ${target?.name ?? "layer"}.` : result === "locked" ? `${target?.name ?? "Layer"} is locked.` : "Area could not be moved.");
          }}
          className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 disabled:opacity-40"
        >
          {project.views.flatMap((view) => view.layers.map((destination) => (
            <option key={destination.id} value={destination.id} disabled={destination.locked}>
              {view.name} / {destination.name}{destination.locked ? " (locked)" : ""}
            </option>
          )))}
        </select>
      </label>
    </section>
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
  onMoveMessage,
}: {
  layer: Layer;
  idx: number;
  totalLayers: number;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (e: React.DragEvent, toIdx: number) => void;
  onMoveMessage: (message: string) => void;
}) {
  const {
    selectedLayerId,
    setSelectedLayerId,
    renameLayer,
    duplicateLayer,
    deleteLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    moveAreaToLayer,
  } = useStore();

  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const selected = selectedLayerId === layer.id;
  const [areaDragOver, setAreaDragOver] = useState(false);

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
      onDragOver={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer.types.includes("application/x-svg-mapper-area")) {
          e.dataTransfer.dropEffect = layer.locked ? "none" : "move";
          setAreaDragOver(true);
        } else onDragOver(e, idx);
      }}
      onDragLeave={() => setAreaDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation();
        setAreaDragOver(false);
        const areaId = e.dataTransfer.getData("application/x-svg-mapper-area");
        if (areaId) {
          const result = moveAreaToLayer(areaId, layer.id);
          onMoveMessage(result === "moved" ? `Area moved to ${layer.name}.` : result === "locked" ? `${layer.name} is locked.` : "Area could not be moved.");
        } else onDrop(e, idx);
      }}
      aria-label={`${layer.name}${layer.locked ? ", locked" : ", drop areas here"}`}
      className={`select-none rounded ${areaDragOver ? layer.locked ? "ring-1 ring-red-500" : "ring-1 ring-blue-400" : ""}`}
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
          className="cursor-grab text-xs text-neutral-500 hover:text-neutral-300"
          title="Drag to reorder"
        >
          ⠿
        </span>

        {/* Expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} layer ${layer.name}`}
          className={`${ICON_BUTTON} text-neutral-400 hover:text-neutral-100`}
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
            className="min-w-0 flex-1 truncate text-[13px]"
            title={layer.name}
          >
            {layer.name}
          </span>
        )}

        {/* Visibility toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
          title={layer.visible ? "Hide layer" : "Show layer"}
          aria-label={`${layer.visible ? "Hide" : "Show"} layer ${layer.name}`}
          className={`${ICON_BUTTON} ${layer.visible ? "text-neutral-300 hover:text-white" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {layer.visible ? "○" : "◌"}
        </button>

        {/* Lock toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
          title={layer.locked ? "Unlock" : "Lock"}
          aria-label={`${layer.locked ? "Unlock" : "Lock"} layer ${layer.name}`}
          className={`${ICON_BUTTON} ${layer.locked ? "text-amber-400 hover:text-amber-200" : "text-neutral-500 hover:text-neutral-200"}`}
        >
          {layer.locked ? "🔒" : "🔓"}
        </button>

        {/* Duplicate */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            duplicateLayer(layer.id);
            onMoveMessage(`${layer.name} duplicated.`);
          }}
          aria-label={`Duplicate layer ${layer.name}`}
          title="Duplicate layer"
          className={`${ICON_BUTTON} text-neutral-400 hover:text-neutral-100`}
        >
          ⧉
        </button>

        {/* Delete */}
        {totalLayers > 1 && (
          <button
            onClick={handleDelete}
            disabled={layer.locked}
            title={layer.locked ? "Unlock the layer to delete it" : "Delete layer"}
            aria-label={`Delete layer ${layer.name}`}
            className={`${ICON_BUTTON} text-neutral-400 hover:text-red-400 disabled:opacity-40 disabled:hover:text-neutral-400`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Areas */}
      {expanded && layer.areas.length > 0 && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {layer.areas.map((area, areaIndex) => (
            <AreaRow key={area.id} areaId={area.id} name={area.name} layerId={layer.id} targetIndex={areaIndex} locked={layer.locked} onMoveMessage={onMoveMessage} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View section
// ---------------------------------------------------------------------------

function ViewSection({ view, isActive, onMoveMessage }: { view: View; isActive: boolean; onMoveMessage: (message: string) => void }) {
  const {
    activeViewId,
    setActiveViewId,
    renameView,
    setInitialView,
    duplicateView,
    deleteView,
    addLayer,
    reorderLayer,
    project,
  } = useStore();

  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [retargetViewId, setRetargetViewId] = useState("");
  const dragFromIdx = useRef<number | null>(null);
  const canDelete = project.views.length > 1;
  const isInitial = project.settings.initialViewId === view.id;
  const inboundLinks = project.views.flatMap((sourceView) =>
    sourceView.id === view.id ? [] : sourceView.layers.flatMap((layer) =>
      layer.areas
        .filter((area) => area.action.type === "goToView" && area.action.targetViewId === view.id)
        .map((area) => ({ area: area.name, view: sourceView.name })),
    ),
  );
  const replacementViews = project.views.filter((candidate) => candidate.id !== view.id);

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
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} view ${view.name}`}
          className={`${ICON_BUTTON} text-neutral-400 hover:text-neutral-100`}
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
            className="min-w-0 flex-1 truncate text-[13px] font-medium"
            title={view.name}
          >
            {view.name}
          </span>
        )}

        {isInitial ? (
          <span className="rounded bg-blue-950 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-200" title="This view opens first">
            Initial
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setInitialView(view.id); }}
            title={`Set ${view.name} as initial view`}
            aria-label={`Set ${view.name} as initial view`}
            className={`${ICON_BUTTON} text-neutral-400 hover:text-blue-300`}
          >
            ☆
          </button>
        )}

        {/* Duplicate view */}
        <button
          onClick={(e) => { e.stopPropagation(); duplicateView(view.id); }}
          title="Duplicate view"
          aria-label={`Duplicate view ${view.name}`}
          className={`${ICON_BUTTON} text-neutral-400 hover:text-neutral-100`}
        >
          ⧉
        </button>

        {/* Delete view */}
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
            title="Delete view"
            aria-label={`Delete view ${view.name}`}
            className={`${ICON_BUTTON} text-neutral-400 hover:text-red-400`}
          >
            ✕
          </button>
        )}
      </div>

      {inboundLinks.length > 0 && !confirmingDelete && (
        <div className="px-2 pb-1 text-xs text-amber-300">
          {inboundLinks.length} inbound {inboundLinks.length === 1 ? "link" : "links"}
        </div>
      )}

      {confirmingDelete && (
        <div
          role="group"
          aria-label={`Delete ${view.name}`}
          className="m-1 space-y-1 rounded border border-red-900 bg-neutral-950 p-2 text-xs text-neutral-300"
          onClick={(event) => event.stopPropagation()}
        >
          <p>Delete <strong>{view.name}</strong>?</p>
          {inboundLinks.length > 0 ? (
            <>
              <p className="text-amber-300">
                {inboundLinks.length} surviving {inboundLinks.length === 1 ? "link" : "links"} from other areas: {inboundLinks.slice(0, 3).map((link) => `${link.area} (${link.view})`).join(", ")}{inboundLinks.length > 3 ? "…" : ""}
              </p>
              <label className="block">
                Retarget links
                <select
                  aria-label={`Retarget links from ${view.name}`}
                  value={retargetViewId}
                  onChange={(event) => setRetargetViewId(event.target.value)}
                  className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-800 p-1"
                >
                  <option value="">Keep diagnosed broken links</option>
                  {replacementViews.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                </select>
              </label>
            </>
          ) : <p>No other views link here.</p>}
          <div className="flex justify-end gap-1">
            <button className="rounded px-2 py-1 hover:bg-neutral-800" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            <button
              className="rounded bg-red-900 px-2 py-1 text-red-100 hover:bg-red-800"
              onClick={() => deleteView(view.id, retargetViewId || undefined)}
            >
              {retargetViewId ? "Retarget & delete" : "Delete view"}
            </button>
          </div>
        </div>
      )}

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
              onMoveMessage={onMoveMessage}
            />
          ))}

          {/* Add Layer */}
          {isActive && (
            <button
              onClick={() => addLayer(view.id)}
              className="mt-0.5 w-full rounded px-1.5 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
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

/**
 * The views/layers/areas tree. `workspace` fills the Tree screen; otherwise it
 * fills the docked, resizable panel of the desktop layout.
 */
export function LeftPanel({ workspace = false }: { workspace?: boolean }) {
  const { project, activeViewId, addView, setSelectedAreaId, setActiveViewId } = useStore();
  const setCollapsed = useLayoutPrefs((s) => s.setCollapsed);
  const [searchQuery, setSearchQuery] = useState("");
  const [moveMessage, setMoveMessage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" shortcut focuses the search input (issue #28 I5)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !shouldIgnoreShortcut(e)) {
        e.preventDefault();
        const input = searchRef.current;
        if (input?.closest("[inert]")) {
          // A collapsed docked tree opens again before taking focus.
          useLayoutPrefs.getState().setCollapsed("tree", false);
          requestAnimationFrame(() => requestAnimationFrame(() => searchRef.current?.focus()));
        } else input?.focus();
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
    <aside
      aria-label="Views and layers"
      className="flex min-w-0 flex-1 flex-col bg-neutral-900"
    >
      {/* Header */}
      <div className="flex min-h-10 items-center gap-1 border-b border-neutral-700 px-2 py-1">
        <h2 className="flex-1 truncate text-sm font-semibold text-neutral-200">Views &amp; Layers</h2>
        <button
          onClick={addView}
          title="Add view"
          className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white"
        >
          + View
        </button>
        {!workspace && (
          <button
            type="button"
            onClick={() => setCollapsed("tree", true)}
            aria-label="Hide views and layers panel"
            title="Hide panel (Enter on the panel edge restores it)"
            className="grid h-7 w-7 place-items-center rounded text-sm text-neutral-400 hover:bg-neutral-700 hover:text-white"
          >
            «
          </button>
        )}
      </div>

      {/* Search (issue #28 I5) */}
      <div className="border-b border-neutral-700 px-2 py-1.5">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search areas"
          placeholder="Search areas… (/)"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
        />
      </div>

      {/* Search results */}
      {query && (
        <div className="max-h-48 overflow-y-auto overscroll-contain border-b border-neutral-700 p-1">
          {project.views.flatMap((view) =>
            view.layers.flatMap((layer) =>
              layer.areas
                .filter((a) => a.name.toLowerCase().includes(query))
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleAreaSearchClick(view.id, a.id)}
                    className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white"
                  >
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="shrink-0 text-neutral-500">{view.name}</span>
                  </button>
                ))
            )
          ).slice(0, 50)}
        </div>
      )}

      {/* Tree (hidden when searching) */}
      {!query && (
        <div role="tree" aria-label="Map hierarchy" className="relative flex-1 overflow-y-auto overscroll-contain p-1.5">
          {project.views.map((view) => (
            <ViewSection key={view.id} view={view} isActive={view.id === activeViewId} onMoveMessage={setMoveMessage} />
          ))}
        </div>
      )}
      {!query && <SelectedAreaControls onMoveMessage={setMoveMessage} />}
      <div role="status" aria-live="polite" className="sr-only">{moveMessage}</div>
    </aside>
  );
}
