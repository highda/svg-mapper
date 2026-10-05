// Inspector controls for popup presentation and the details panel (#220).
// Kept apart from RightSidebar so the presentation settings stay one unit.
import type { DetailsPanelSide, DetailsPresentation, DetailsSettings, PopupAction } from "@svg-mapper/shared";
import { useId, useState } from "react";
import { useStore } from "../../store";
import { parseDetailsSize } from "../../lib/details-size";

const fieldClass =
  "w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500 disabled:opacity-50";

const PRESENTATIONS: Array<[DetailsPresentation, string]> = [
  ["popover", "Popover next to the area"],
  ["panel", "Details panel"],
  ["modal", "Modal dialog"],
];

function LabeledRow({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="w-20 shrink-0 text-[10px] text-neutral-500">{label}</label>
      <div className="min-w-0 flex-1">{children(id)}</div>
    </div>
  );
}

/** Drop a key instead of storing `undefined`, so files stay exact-optional. */
function withField<T extends object, K extends keyof T>(value: T, key: K, next: T[K] | undefined): T {
  const copy = { ...value };
  if (next === undefined) delete copy[key];
  else copy[key] = next;
  return copy;
}

/** Per-area choice of how a popup action's content is shown. */
export function PopupPresentationField({ areaId, action }: { areaId: string; action: PopupAction }) {
  const { project, updateAreaAction } = useStore();
  const fallback = project.settings.details?.presentation ?? "popover";
  const fallbackLabel = PRESENTATIONS.find(([value]) => value === fallback)?.[1] ?? fallback;
  return (
    <LabeledRow label="Show as">
      {(id) => (
        <select
          id={id}
          value={action.presentation ?? ""}
          onChange={(e) => updateAreaAction(areaId, withField(action, "presentation", (e.target.value || undefined) as DetailsPresentation | undefined))}
          className={fieldClass}
        >
          <option value="">Project default ({fallbackLabel.toLowerCase()})</option>
          {PRESENTATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      )}
    </LabeledRow>
  );
}

/** Project-wide default presentation, panel layout and default content. */
export function DetailsSettingsSection() {
  const { project, updateSettings } = useStore();
  const details: DetailsSettings = project.settings.details ?? {};
  const set = <K extends keyof DetailsSettings>(key: K, value: DetailsSettings[K] | undefined) => {
    const next = withField(details, key, value);
    updateSettings({ details: Object.keys(next).length ? next : undefined });
  };
  const setDefault = (key: "title" | "body", value: string) => {
    const content = withField(details.defaultContent ?? {}, key, value.trim() ? value : undefined);
    set("defaultContent", Object.keys(content).length ? content : undefined);
  };
  const sizeText = details.size === undefined ? "" : String(details.size);
  const [size, setSize] = useState(sizeText);
  const [sizeSource, setSizeSource] = useState(sizeText);
  if (sizeSource !== sizeText) {
    // The stored value changed elsewhere (undo, open): show it.
    setSizeSource(sizeText);
    setSize(sizeText);
  }
  const sizeError = parseDetailsSize(size).ok ? null : "Use a fraction from 0 to 1 (0.35) or a px, %, em or rem length (320px, 35%).";
  const errorId = useId();
  const sheetHintId = useId();
  const usesPanel = details.presentation === "panel" || project.views.some((view) => view.layers.some((layer) =>
    layer.areas.some((area) => area.action.type === "popup" && area.action.presentation === "panel")));

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-neutral-600">
        How popup actions show their content. Areas can override this under Action.
      </p>
      <LabeledRow label="Show popups as">
        {(id) => (
          <select
            id={id}
            value={details.presentation ?? "popover"}
            onChange={(e) => set("presentation", e.target.value === "popover" ? undefined : e.target.value as DetailsPresentation)}
            className={fieldClass}
          >
            {PRESENTATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        )}
      </LabeledRow>
      <fieldset className="space-y-1" disabled={!usesPanel} aria-label="Details panel">
        {!usesPanel && <p className="text-[10px] text-neutral-600">Panel options apply once the panel is the default or an area uses it.</p>}
        <LabeledRow label="Panel side">
          {(id) => (
            <select
              id={id}
              value={details.side ?? "right"}
              onChange={(e) => set("side", e.target.value === "right" ? undefined : e.target.value as DetailsPanelSide)}
              className={fieldClass}
            >
              <option value="right">Right</option>
              <option value="left">Left</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          )}
        </LabeledRow>
        <LabeledRow label="Panel size">
          {(id) => (
            <input
              id={id}
              type="text"
              value={size}
              placeholder="35%"
              aria-invalid={sizeError ? "true" : undefined}
              aria-describedby={sizeError ? errorId : undefined}
              onChange={(e) => setSize(e.target.value)}
              onBlur={() => {
                const parsed = parseDetailsSize(size);
                if (parsed.ok && parsed.value !== details.size) set("size", parsed.value);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              className={fieldClass}
            />
          )}
        </LabeledRow>
        {sizeError && <p id={errorId} role="alert" className="text-[10px] text-red-400">{sizeError}</p>}
        <LabeledRow label="Sheet below">
          {(id) => (
            <input
              key={details.sheetBelow ?? ""}
              id={id}
              type="number"
              min={0}
              max={4000}
              defaultValue={details.sheetBelow ?? ""}
              placeholder="560"
              aria-describedby={sheetHintId}
              onBlur={(e) => {
                const value = e.target.value === "" ? undefined : Math.max(0, Math.min(4000, Number(e.target.value)));
                if (value === undefined || Number.isFinite(value)) set("sheetBelow", value);
              }}
              className={fieldClass}
            />
          )}
        </LabeledRow>
        <p id={sheetHintId} className="text-[10px] text-neutral-600">
          Maps narrower than this many CSS px (measured on the map, not the window) show the panel as a bottom sheet.
        </p>
        <LabeledRow label="Panel name">
          {(id) => (
            <input
              key={details.label ?? ""}
              id={id}
              type="text"
              defaultValue={details.label ?? ""}
              placeholder={details.defaultContent?.title || "Details"}
              onBlur={(e) => set("label", e.target.value.trim() || undefined)}
              className={fieldClass}
            />
          )}
        </LabeledRow>
        <LabeledRow label="Default title">
          {(id) => (
            <input
              key={details.defaultContent?.title ?? ""}
              id={id}
              type="text"
              defaultValue={details.defaultContent?.title ?? ""}
              placeholder="Explore the map"
              onBlur={(e) => setDefault("title", e.target.value)}
              className={fieldClass}
            />
          )}
        </LabeledRow>
        <LabeledRow label="Default text">
          {(id) => (
            <textarea
              key={details.defaultContent?.body ?? ""}
              id={id}
              rows={3}
              defaultValue={details.defaultContent?.body ?? ""}
              placeholder="Click a building to learn more."
              onBlur={(e) => setDefault("body", e.target.value)}
              className={`${fieldClass} resize-y`}
            />
          )}
        </LabeledRow>
        <p className="text-[10px] text-neutral-600">Shown while nothing is selected. HTML allowed; {"{{viewName}}"} names the current view.</p>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300 select-none">
          <input
            type="checkbox"
            checked={details.hideWhenIdle ?? false}
            onChange={(e) => set("hideWhenIdle", e.target.checked || undefined)}
            className="accent-blue-500"
          />
          Hide panel until an area is selected
        </label>
      </fieldset>
    </div>
  );
}
