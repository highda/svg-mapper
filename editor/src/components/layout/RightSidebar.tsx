import type {
  Action,
  AreaLabel,
  AreaStyle,
  AreaStyleState,
  AreaTrigger,
  BackgroundFit,
  CircleGeometry,
  PopupAction,
  RectGeometry,
  PolygonGeometry,
  SceneSwitcherPosition,
  ZoomControlsPosition,
  Tooltip,
  Viewport,
  View,
} from "@svg-mapper/shared";
import { useState } from "react";
import { useStore } from "../../store";
import { validateActionUrl } from "../../lib/url-validate";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-1 border-b border-neutral-700 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
      {title}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-20 shrink-0 text-[10px] text-neutral-500">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Uncontrolled text input — commits on blur/Enter; resets via key at parent level.
function TextField({
  defaultValue,
  onCommit,
  readOnly,
  placeholder,
}: {
  defaultValue: string;
  onCommit?: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (readOnly || !onCommit) return;
    onCommit(e.target.value);
  }
  return (
    <input
      type="text"
      defaultValue={defaultValue}
      readOnly={readOnly}
      placeholder={placeholder}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      }}
      className={`w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500 ${readOnly ? "cursor-default opacity-60" : ""}`}
    />
  );
}

// Uncontrolled number input — commits on blur/Enter; resets via key at parent level.
function NumberField({
  defaultValue,
  onCommit,
  min,
  max,
  step,
}: {
  defaultValue: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const n = parseFloat(e.target.value);
    if (!isNaN(n)) {
      const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
      onCommit(clamped);
    } else {
      e.target.value = String(defaultValue);
    }
  }
  return (
    <input
      type="number"
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step ?? 1}
      onBlur={handleBlur}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
      className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
    />
  );
}

function CheckToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Style picker for one state (default / hover / active)
// ---------------------------------------------------------------------------

function StyleStateEditor({
  label,
  styleState,
  onChange,
}: {
  label: string;
  styleState: AreaStyleState;
  onChange: (s: AreaStyleState) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-neutral-400">{label}</div>
      <Row label="Fill">
        <TextField
          defaultValue={styleState.fill}
          onCommit={(v) => onChange({ ...styleState, fill: v })}
          placeholder="rgba(0,0,0,0)"
        />
      </Row>
      <Row label="Stroke">
        <TextField
          defaultValue={styleState.stroke}
          onCommit={(v) => onChange({ ...styleState, stroke: v })}
          placeholder="rgba(0,0,0,0)"
        />
      </Row>
      <Row label="Width">
        <NumberField
          defaultValue={styleState.strokeWidth}
          min={0}
          max={20}
          step={0.5}
          onCommit={(v) => onChange({ ...styleState, strokeWidth: v })}
        />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No-selection: View inspector
// ---------------------------------------------------------------------------

function ViewInspector({ view }: { view: View }) {
  const { renameView, setCanvasSize, project, setViewBackground, setViewBackgroundFit, updateSettings, setEditorState } = useStore();
  const canvasSize = project.settings.canvasSize;
  const grid = project.editor?.grid ?? { enabled: false, size: 10 };

  function handleAssetChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value) setViewBackground(view.id, e.target.value);
  }

  return (
    <div className="space-y-3">
      <SectionHeader title="View" />

      <Row label="Name">
        <TextField
          defaultValue={view.name}
          onCommit={(name) => { const t = name.trim(); if (t && t !== view.name) renameView(view.id, t); }}
        />
      </Row>
      {view.background && (
        <Row label="Fit">
          <select
            aria-label="Background Fit"
            value={view.background.fit}
            onChange={(e) => setViewBackgroundFit(view.id, e.target.value as BackgroundFit)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
          >
            {(["contain", "cover", "fill", "none"] as const).map((fit) => (
              <option key={fit} value={fit}>{fit}</option>
            ))}
          </select>
        </Row>
      )}

      <Row label="Background">
        <select
          value={view.background?.assetId ?? ""}
          onChange={handleAssetChange}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="">— none —</option>
          {project.assets.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Row>

      <SectionHeader title="Canvas Size" />
      <p className="text-[10px] text-neutral-600 -mt-1">Shared across all views.</p>
      <Row label="Width">
        <NumberField
          defaultValue={canvasSize.width}
          min={1}
          max={10000}
          onCommit={(v) => setCanvasSize(v, canvasSize.height)}
        />
      </Row>
      <Row label="Height">
        <NumberField
          defaultValue={canvasSize.height}
          min={1}
          max={10000}
          onCommit={(v) => setCanvasSize(canvasSize.width, v)}
        />
      </Row>

      <SectionHeader title="Grid" />
      <CheckToggle
        checked={grid.enabled}
        onChange={(enabled) => setEditorState({ grid: { ...grid, enabled } })}
        label="Snap to grid"
      />
      <Row label="Grid size">
        <NumberField
          defaultValue={grid.size}
          min={1}
          max={1000}
          onCommit={(size) => setEditorState({ grid: { ...grid, size } })}
        />
      </Row>

      <SectionHeader title="Content Template" />
      <p className="text-[10px] text-neutral-600 -mt-1">
        HTML with {"{{name}}"}, {"{{id}}"}, {"{{viewName}}"}, or {"{{metadata.key}}"} variables.
      </p>
      <textarea
        aria-label="Content Template"
        defaultValue={project.settings.contentTemplate ?? ""}
        onBlur={(e) => updateSettings({ contentTemplate: e.target.value || undefined })}
        rows={4}
        placeholder={'<h3>{{name}}</h3>'}
        className="w-full resize-y rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-blue-500"
      />

      <SectionHeader title="Area Labels" />
      <CheckToggle
        checked={project.settings.areaLabels?.enabled ?? false}
        onChange={(enabled) => updateSettings({
          areaLabels: { ...project.settings.areaLabels, enabled },
        })}
        label="Show area labels"
      />
      <Row label="Font size">
        <NumberField
          defaultValue={project.settings.areaLabels?.fontSize ?? 14}
          min={1}
          max={200}
          onCommit={(fontSize) => updateSettings({
            areaLabels: { enabled: project.settings.areaLabels?.enabled ?? false, ...project.settings.areaLabels, fontSize },
          })}
        />
      </Row>
      <Row label="Color">
        <input
          aria-label="Area Label Color"
          type="color"
          value={project.settings.areaLabels?.color ?? "#000000"}
          onChange={(e) => updateSettings({
            areaLabels: { enabled: project.settings.areaLabels?.enabled ?? false, ...project.settings.areaLabels, color: e.target.value },
          })}
          className="h-6 w-full cursor-pointer rounded border border-neutral-700 bg-neutral-800"
        />
      </Row>
      <CheckToggle
        checked={project.settings.areaLabels?.hideWhenSmaller ?? true}
        onChange={(hideWhenSmaller) => updateSettings({
          areaLabels: { enabled: project.settings.areaLabels?.enabled ?? false, ...project.settings.areaLabels, hideWhenSmaller },
        })}
        label="Hide labels that do not fit"
      />

      <SectionHeader title="Scene Switcher" />
      <CheckToggle
        checked={project.settings.sceneSwitcher?.enabled ?? false}
        onChange={(enabled) => updateSettings({
          sceneSwitcher: {
            enabled,
            position: project.settings.sceneSwitcher?.position ?? "bottom-center",
            style: project.settings.sceneSwitcher?.style ?? "buttons",
          },
        })}
        label="Show view switcher"
      />
      <Row label="Position">
        <select
          aria-label="Scene Switcher Position"
          value={project.settings.sceneSwitcher?.position ?? "bottom-center"}
          disabled={!project.settings.sceneSwitcher?.enabled}
          onChange={(e) => updateSettings({
            sceneSwitcher: {
              enabled: project.settings.sceneSwitcher?.enabled ?? false,
              position: e.target.value as SceneSwitcherPosition,
              style: project.settings.sceneSwitcher?.style ?? "buttons",
            },
          })}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500 disabled:opacity-50"
        >
          {(["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const).map((position) => (
            <option key={position} value={position}>{position.replace("-", " ")}</option>
          ))}
        </select>
      </Row>
      <Row label="Style">
        <select
          aria-label="Scene Switcher Style"
          value={project.settings.sceneSwitcher?.style ?? "buttons"}
          disabled={!project.settings.sceneSwitcher?.enabled}
          onChange={(e) => updateSettings({
            sceneSwitcher: {
              enabled: project.settings.sceneSwitcher?.enabled ?? false,
              position: project.settings.sceneSwitcher?.position ?? "bottom-center",
              style: e.target.value as "buttons" | "tabs" | "dropdown",
            },
          })}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500 disabled:opacity-50"
        >
          <option value="buttons">Buttons</option>
          <option value="tabs">Tabs</option>
          <option value="dropdown">Dropdown</option>
        </select>
      </Row>

      <SectionHeader title="Viewport" />
      <ViewportEditor viewport={view.viewport} viewId={view.id} />

      <SectionHeader title="Renderer Controls" />
      <CheckToggle
        checked={project.settings.zoomControls?.enabled ?? false}
        onChange={(enabled) => updateSettings({
          zoomControls: { enabled, position: project.settings.zoomControls?.position ?? "top-right" },
        })}
        label="Show zoom controls"
      />
      <Row label="Position">
        <select
          aria-label="Zoom Controls Position"
          value={project.settings.zoomControls?.position ?? "top-right"}
          disabled={!project.settings.zoomControls?.enabled}
          onChange={(e) => updateSettings({
            zoomControls: {
              enabled: project.settings.zoomControls?.enabled ?? false,
              position: e.target.value as ZoomControlsPosition,
            },
          })}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500 disabled:opacity-50"
        >
          {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((position) => (
            <option key={position} value={position}>{position.replace("-", " ")}</option>
          ))}
        </select>
      </Row>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Row key={side} label={`Padding ${side}`}>
          <NumberField
            defaultValue={project.settings.padding?.[side] ?? 0}
            min={0}
            max={10000}
            onCommit={(value) => updateSettings({
              padding: {
                top: project.settings.padding?.top ?? 0,
                right: project.settings.padding?.right ?? 0,
                bottom: project.settings.padding?.bottom ?? 0,
                left: project.settings.padding?.left ?? 0,
                [side]: value,
              },
            })}
          />
        </Row>
      ))}
    </div>
  );
}

function ViewportEditor({ viewport, viewId }: { viewport: Viewport; viewId: string }) {
  const { setViewport: doSetViewport } = useStore();
  function setViewport(patch: Partial<Viewport>) { doSetViewport(viewId, patch); }
  return (
    <div className="space-y-1.5">
      <CheckToggle
        checked={viewport.panEnabled}
        onChange={(v) => setViewport({ panEnabled: v })}
        label="Pan enabled"
      />
      <CheckToggle
        checked={viewport.zoomEnabled}
        onChange={(v) => setViewport({ zoomEnabled: v })}
        label="Zoom enabled"
      />
      <Row label="Min zoom">
        <NumberField
          defaultValue={viewport.minZoom}
          min={0.1}
          max={viewport.maxZoom}
          step={0.1}
          onCommit={(v) => setViewport({ minZoom: v })}
        />
      </Row>
      <Row label="Max zoom">
        <NumberField
          defaultValue={viewport.maxZoom}
          min={viewport.minZoom}
          max={20}
          step={0.5}
          onCommit={(v) => setViewport({ maxZoom: v })}
        />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer inspector
// ---------------------------------------------------------------------------

function LayerInspector() {
  const {
    selectedLayerId,
    project,
    renameLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    setLayerOpacity,
  } = useStore();

  if (!selectedLayerId) return null;

  let layer = null;
  for (const view of project.views) {
    const found = view.layers.find((l) => l.id === selectedLayerId);
    if (found) { layer = found; break; }
  }
  if (!layer) return null;

  const l = layer;

  return (
    <div className="space-y-3">
      <SectionHeader title="Layer" />

      <Row label="Name">
        <TextField
          defaultValue={l.name}
          onCommit={(name) => { const t = name.trim(); if (t) renameLayer(l.id, t); }}
        />
      </Row>

      <div className="space-y-1.5">
        <CheckToggle
          checked={l.visible}
          onChange={() => toggleLayerVisibility(l.id)}
          label="Visible"
        />
        <CheckToggle
          checked={l.locked}
          onChange={() => toggleLayerLock(l.id)}
          label="Locked"
        />
      </div>

      <Row label="Opacity">
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={l.opacity}
            onChange={(e) => setLayerOpacity(l.id, parseFloat(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-8 text-right text-xs text-neutral-400">
            {Math.round(l.opacity * 100)}%
          </span>
        </div>
      </Row>

      <Row label="Areas">
        <span className="text-xs text-neutral-400">{l.areas.length}</span>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area inspector
// ---------------------------------------------------------------------------

function GeometryEditor({
  areaId,
  geometry,
}: {
  areaId: string;
  geometry: { type: string };
}) {
  const { updateAreaGeometry } = useStore();

  if (geometry.type === "rect") {
    const g = geometry as unknown as RectGeometry & { type: "rect" };
    function set(patch: Partial<RectGeometry>) {
      updateAreaGeometry(areaId, { ...g, ...patch });
    }
    return (
      <div className="space-y-1">
        <Row label="X"><NumberField defaultValue={g.x} onCommit={(v) => set({ x: v })} /></Row>
        <Row label="Y"><NumberField defaultValue={g.y} onCommit={(v) => set({ y: v })} /></Row>
        <Row label="W"><NumberField defaultValue={g.width} min={1} onCommit={(v) => set({ width: v })} /></Row>
        <Row label="H"><NumberField defaultValue={g.height} min={1} onCommit={(v) => set({ height: v })} /></Row>
        <Row label="Radius">
          <NumberField defaultValue={g.rx ?? 0} min={0} onCommit={(v) => set({ rx: v })} />
        </Row>
      </div>
    );
  }

  if (geometry.type === "circle") {
    const g = geometry as unknown as CircleGeometry & { type: "circle" };
    function setC(patch: Partial<CircleGeometry>) {
      updateAreaGeometry(areaId, { ...g, ...patch });
    }
    return (
      <div className="space-y-1">
        <Row label="CX"><NumberField defaultValue={g.cx} onCommit={(v) => setC({ cx: v })} /></Row>
        <Row label="CY"><NumberField defaultValue={g.cy} onCommit={(v) => setC({ cy: v })} /></Row>
        <Row label="R"><NumberField defaultValue={g.r} min={1} onCommit={(v) => setC({ r: v })} /></Row>
      </div>
    );
  }

  if (geometry.type === "polygon") {
    const g = geometry as unknown as PolygonGeometry & { type: "polygon" };
    return (
      <div className="text-xs text-neutral-400">
        {g.points.length} vertices — vertex editing not available yet
      </div>
    );
  }

  return (
    <div className="text-xs text-neutral-500 italic">
      {geometry.type} — no editable fields
    </div>
  );
}

// Controlled URL input — validates on every change (ASSIGNMENT §10.2),
// shows an inline error, and only commits valid values to the store.
function UrlField({
  defaultValue,
  onCommit,
}: {
  defaultValue: string;
  onCommit: (v: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const validation = value === "" ? { valid: true } : validateActionUrl(value);

  function commit() {
    if (value !== defaultValue && validateActionUrl(value).valid) {
      onCommit(value.trim());
    }
  }

  return (
    <div className="space-y-0.5">
      <input
        type="text"
        value={value}
        placeholder="https://…"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        }}
        className={`w-full rounded border bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none ${
          validation.valid
            ? "border-neutral-700 focus:border-blue-500"
            : "border-red-500 focus:border-red-500"
        }`}
      />
      {!validation.valid && (
        <p className="text-[10px] leading-tight text-red-400">{validation.error}</p>
      )}
    </div>
  );
}

function PopupContentEditor({
  areaId,
  action,
}: {
  areaId: string;
  action: PopupAction;
}) {
  const { updateAreaAction } = useStore();
  const update = (patch: Partial<PopupAction["content"]>) =>
    updateAreaAction(areaId, { ...action, content: { ...action.content, ...patch } });

  return (
    <div className="space-y-1 pl-2">
      <Row label="Title">
        <TextField
          defaultValue={action.content.title ?? ""}
          onCommit={(v) => update({ title: v })}
          placeholder="Popup title"
        />
      </Row>
      <Row label="Body">
        <textarea
          defaultValue={action.content.body ?? ""}
          onBlur={(e) => update({ body: e.target.value })}
          rows={3}
          placeholder="HTML allowed"
          className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
        />
      </Row>
      <Row label="Image URL">
        <TextField
          defaultValue={action.content.imageUrl ?? ""}
          onCommit={(v) => update({ imageUrl: v || undefined })}
          placeholder="https://…"
        />
      </Row>
      <Row label="Link URL">
        <TextField
          defaultValue={action.content.linkHref ?? ""}
          onCommit={(v) => update({ linkHref: v || undefined })}
          placeholder="https://…"
        />
      </Row>
      <Row label="Link label">
        <TextField
          defaultValue={action.content.linkLabel ?? ""}
          onCommit={(v) => update({ linkLabel: v || undefined })}
        />
      </Row>
      <Row label="Position">
        <select
          value={action.position ?? "auto"}
          onChange={(e) =>
            updateAreaAction(areaId, { ...action, position: e.target.value as PopupAction["position"] })
          }
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="auto">Auto</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </Row>
    </div>
  );
}

function ActionEditor({ areaId, action }: { areaId: string; action: Action }) {
  const { updateAreaAction, project } = useStore();

  const views = project.views;

  function setType(type: Action["type"]) {
    switch (type) {
      case "none":
        updateAreaAction(areaId, { type: "none" });
        break;
      case "url":
        updateAreaAction(areaId, { type: "url", href: "", target: "_blank" });
        break;
      case "popup":
        updateAreaAction(areaId, { type: "popup", content: {}, position: "auto" });
        break;
      case "goToView": {
        const { activeViewId } = useStore.getState();
        const other = views.find((v) => v.id !== activeViewId) ?? views[0];
        updateAreaAction(areaId, {
          type: "goToView",
          targetViewId: other?.id ?? "",
          transition: "fade",
        });
        break;
      }
      default:
        updateAreaAction(areaId, { type: "none" });
    }
  }

  return (
    <div className="space-y-1.5">
      <Row label="Type">
        <select
          value={action.type}
          onChange={(e) => setType(e.target.value as Action["type"])}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="none">None</option>
          <option value="url">URL</option>
          <option value="popup">Popup</option>
          <option value="goToView">Go to View</option>
        </select>
      </Row>

      {action.type === "url" && (
        <>
          <Row label="URL">
            <UrlField
              defaultValue={action.href}
              onCommit={(v) => updateAreaAction(areaId, { ...action, href: v })}
            />
          </Row>
          <Row label="Target">
            <select
              value={action.target}
              onChange={(e) =>
                updateAreaAction(areaId, { ...action, target: e.target.value as "_blank" | "_self" })
              }
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
            >
              <option value="_blank">New tab</option>
              <option value="_self">Same tab</option>
            </select>
          </Row>
        </>
      )}

      {action.type === "popup" && (
        <PopupContentEditor areaId={areaId} action={action} />
      )}

      {action.type === "goToView" && (
        <>
          <Row label="Target">
            <select
              value={action.targetViewId}
              onChange={(e) =>
                updateAreaAction(areaId, { ...action, targetViewId: e.target.value })
              }
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
            >
              {views.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </Row>
          <Row label="Transition">
            <select
              value={action.transition ?? "fade"}
              onChange={(e) =>
                updateAreaAction(areaId, { ...action, transition: e.target.value as "fade" | "none" })
              }
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
            >
              <option value="fade">Fade</option>
              <option value="none">None</option>
            </select>
          </Row>
        </>
      )}
    </div>
  );
}

function TooltipEditor({ areaId, tooltip }: { areaId: string; tooltip: Tooltip | undefined }) {
  const { updateAreaTooltip } = useStore();

  function setEnabled(enabled: boolean) {
    updateAreaTooltip(areaId, { enabled, title: tooltip?.title ?? "", body: tooltip?.body ?? "" });
  }

  return (
    <div className="space-y-1.5">
      <CheckToggle
        checked={tooltip?.enabled ?? false}
        onChange={setEnabled}
        label="Enable tooltip"
      />
      {tooltip?.enabled && (
        <>
          <Row label="Title">
            <TextField
              defaultValue={tooltip.title ?? ""}
              onCommit={(v) => updateAreaTooltip(areaId, { ...tooltip, title: v })}
            />
          </Row>
          <Row label="Body (HTML)">
            <textarea
              defaultValue={tooltip.body ?? ""}
              onBlur={(e) => updateAreaTooltip(areaId, { ...tooltip, body: e.target.value })}
              rows={3}
              placeholder="HTML allowed"
              className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
            />
          </Row>
          <Row label="Image URL">
            <TextField
              defaultValue={tooltip.imageUrl ?? ""}
              onCommit={(v) => updateAreaTooltip(areaId, { ...tooltip, imageUrl: v || undefined })}
              placeholder="https://…"
            />
          </Row>
        </>
      )}
    </div>
  );
}

function InteractionEditor({ areaId, area }: { areaId: string; area: { trigger?: AreaTrigger; alwaysHighlight?: boolean; disabled?: boolean } }) {
  const { updateAreaInteraction } = useStore();

  return (
    <div className="space-y-1.5">
      <Row label="Trigger">
        <select
          value={area.trigger ?? "both"}
          onChange={(e) =>
            updateAreaInteraction(areaId, { trigger: e.target.value as AreaTrigger })
          }
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="both">Both (hover + click)</option>
          <option value="hover">Hover only</option>
          <option value="click">Click only</option>
        </select>
      </Row>
      <CheckToggle
        checked={area.alwaysHighlight ?? false}
        onChange={(v) => updateAreaInteraction(areaId, { alwaysHighlight: v })}
        label="Always highlighted"
      />
      <CheckToggle
        checked={area.disabled ?? false}
        onChange={(v) => updateAreaInteraction(areaId, { disabled: v })}
        label="Disabled (non-interactive)"
      />
    </div>
  );
}

function MetadataEditor({ areaId, metadata }: { areaId: string; metadata: Record<string, unknown> | undefined }) {
  const { updateAreaMetadata } = useStore();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const entries = Object.entries(metadata ?? {});

  function addRow() {
    const k = newKey.trim();
    if (!k) return;
    if (Object.hasOwn(metadata ?? {}, k)) return;
    updateAreaMetadata(areaId, { ...(metadata ?? {}), [k]: newValue });
    setNewKey("");
    setNewValue("");
  }

  function updateRow(key: string, value: string) {
    updateAreaMetadata(areaId, { ...(metadata ?? {}), [key]: value });
  }

  function deleteRow(key: string) {
    const next = { ...(metadata ?? {}) };
    delete next[key];
    updateAreaMetadata(areaId, next);
  }

  function renameRow(oldKey: string, nextKey: string) {
    const k = nextKey.trim();
    if (!k || k === oldKey || Object.hasOwn(metadata ?? {}, k)) return;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata ?? {})) {
      next[key === oldKey ? k : key] = value;
    }
    updateAreaMetadata(areaId, next);
  }

  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <input
            type="text"
            aria-label={`Metadata key ${k}`}
            defaultValue={k}
            onBlur={(e) => renameRow(k, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="w-16 shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400 outline-none focus:border-blue-500"
          />
          <input
            type="text"
            aria-label={`Metadata value ${k}`}
            defaultValue={String(v)}
            onBlur={(e) => updateRow(k, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
          />
          <button
            onClick={() => deleteRow(k)}
            className="text-[10px] text-neutral-600 hover:text-red-400"
            title="Delete"
          >✕</button>
        </div>
      ))}
      <div className="flex items-center gap-1 pt-0.5">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addRow(); }}
          placeholder="key"
          aria-label="New metadata key"
          className="w-16 shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400 outline-none focus:border-blue-500"
        />
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addRow(); }}
          placeholder="value"
          aria-label="New metadata value"
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400 outline-none focus:border-blue-500"
        />
        <button
          onClick={addRow}
          className="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200"
        >+ Add</button>
      </div>
    </div>
  );
}

function LabelEditor({ areaId, label }: { areaId: string; label: AreaLabel | undefined }) {
  const { updateAreaLabel } = useStore();

  return (
    <div className="space-y-1.5">
      <Row label="Label text">
        <TextField
          defaultValue={label?.text ?? ""}
          onCommit={(v) => updateAreaLabel(areaId, v ? { ...label, text: v } : { ...label, text: undefined })}
          placeholder="(uses area name)"
        />
      </Row>
      <Row label="Visibility">
        <select
          value={label?.visible === true ? "show" : label?.visible === false ? "hide" : "inherit"}
          onChange={(e) => {
            const v = e.target.value;
            updateAreaLabel(areaId, {
              ...label,
              visible: v === "show" ? true : v === "hide" ? false : undefined,
            });
          }}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="inherit">Follow project setting</option>
          <option value="show">Always show</option>
          <option value="hide">Always hide</option>
        </select>
      </Row>
    </div>
  );
}

function AreaInspector() {
  const { selectedAreaId, project, renameArea, updateAreaStyle } = useStore();

  if (!selectedAreaId) return null;

  let area = null;
  for (const view of project.views) {
    for (const layer of view.layers) {
      const found = layer.areas.find((a) => a.id === selectedAreaId);
      if (found) { area = found; break; }
    }
    if (area) break;
  }
  if (!area) return null;

  const a = area;
  const style = a.style as AreaStyle;
  const tooltip = a.tooltip as Tooltip | undefined;

  function updateStyleState(stateKey: keyof AreaStyle, styleState: AreaStyleState) {
    updateAreaStyle(a.id, { ...style, [stateKey]: styleState });
  }

  return (
    <div className="space-y-3">
      <SectionHeader title="Area" />

      <Row label="Name">
        <TextField
          defaultValue={a.name}
          onCommit={(name) => { const t = name.trim(); if (t) renameArea(a.id, t); }}
        />
      </Row>
      <Row label="ID">
        <TextField defaultValue={a.id} readOnly />
      </Row>

      <SectionHeader title="Geometry" />
      <GeometryEditor areaId={a.id} geometry={a.geometry as unknown as { type: string }} />

      <SectionHeader title="Style" />
      <StyleStateEditor
        label="Default"
        styleState={style.default}
        onChange={(s) => updateStyleState("default", s)}
      />
      <StyleStateEditor
        label="Hover"
        styleState={style.hover}
        onChange={(s) => updateStyleState("hover", s)}
      />
      <StyleStateEditor
        label="Active"
        styleState={style.active}
        onChange={(s) => updateStyleState("active", s)}
      />

      <SectionHeader title="Interaction" />
      <InteractionEditor areaId={a.id} area={a} />

      <SectionHeader title="Label" />
      <LabelEditor areaId={a.id} label={a.label} />

      <SectionHeader title="Metadata" />
      <MetadataEditor areaId={a.id} metadata={a.metadata} />

      <SectionHeader title="Tooltip" />
      <TooltipEditor areaId={a.id} tooltip={tooltip} />

      <SectionHeader title="Action" />
      <ActionEditor areaId={a.id} action={a.action} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// RightSidebar
// ---------------------------------------------------------------------------

export function RightSidebar() {
  const { selectedAreaId, selectedLayerId, project, activeViewId, historyVersion } = useStore();

  const activeView = project.views.find((v) => v.id === activeViewId);

  // Key forces inspector panels to remount when selection changes or undo/redo fires,
  // resetting all uncontrolled inputs to the current store values.
  const inspectorKey =
    (selectedAreaId ?? selectedLayerId ?? activeViewId) + ":" + historyVersion;

  let content: React.ReactNode;
  if (selectedAreaId) {
    content = <AreaInspector key={inspectorKey} />;
  } else if (selectedLayerId) {
    content = <LayerInspector key={inspectorKey} />;
  } else if (activeView) {
    content = <ViewInspector key={inspectorKey} view={activeView} />;
  } else {
    content = (
      <p className="text-xs italic text-neutral-600">No view selected.</p>
    );
  }

  return (
    <aside className="flex w-64 flex-col border-l border-neutral-700 bg-neutral-900">
      <div className="border-b border-neutral-700 px-3 py-1.5">
        <span className="text-xs font-semibold text-neutral-300">Inspector</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">{content}</div>
    </aside>
  );
}
