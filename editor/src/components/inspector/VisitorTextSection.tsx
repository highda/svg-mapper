// Inspector controls for the map's language and every visitor-facing renderer
// string (#216). Blank means the English default; visible text can be hidden.
import type { Settings, VisitorStringKey, VisitorStrings } from "@svg-mapper/shared";
import { DEFAULT_VISITOR_STRINGS, VISIBLE_STRING_KEYS } from "@svg-mapper/shared";
import { useId } from "react";
import { useStore } from "../../store";
import { VISITOR_TEXT_GROUPS } from "../../lib/visitor-text";

const fieldClass =
  "w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-blue-500 disabled:opacity-50";

const visible = new Set<VisitorStringKey>(VISIBLE_STRING_KEYS);

function StringRow({ id: key, label, value, onChange }: {
  id: VisitorStringKey;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const hidden = value === "";
  const hint = visible.has(key) ? "Visible" : "Screen reader";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="min-w-0 flex-1 truncate text-[10px] text-neutral-400" title={key}>{label}</label>
        <span className="shrink-0 text-[10px] text-neutral-600">{hint}</span>
        {visible.has(key) && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-neutral-400 select-none">
            <input
              type="checkbox"
              checked={hidden}
              aria-label={`Hide ${label.toLowerCase()}`}
              onChange={(e) => onChange(e.target.checked ? "" : undefined)}
              className="accent-blue-500"
            />
            Hide
          </label>
        )}
      </div>
      <input
        key={value ?? "\u0000default"}
        id={id}
        type="text"
        data-visitor-text={key}
        defaultValue={value ?? ""}
        disabled={hidden}
        placeholder={hidden ? "Hidden" : DEFAULT_VISITOR_STRINGS[key]}
        // Blank means the default: names and announcements can never be emptied here.
        onBlur={(e) => { if (!hidden) onChange(e.target.value.trim() ? e.target.value : undefined); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        className={fieldClass}
      />
    </div>
  );
}


export function VisitorTextSection() {
  const { project, updateSettings } = useStore();
  const { settings } = project;
  const strings: VisitorStrings = settings.strings ?? {};
  const langId = useId();
  const dirId = useId();
  const langHintId = useId();

  const setString = (key: VisitorStringKey, value: string | undefined) => {
    if (strings[key] === value) return;
    const next = { ...strings };
    if (value === undefined) delete next[key];
    else next[key] = value;
    updateSettings({ strings: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-400">
        The published map has one language. Leave a field blank for the default shown in grey. Visible text can be hidden; screen reader names and announcements cannot.
      </p>
      <div className="flex items-center gap-1">
        <label htmlFor={langId} className="w-20 shrink-0 text-[10px] text-neutral-500">Language</label>
        <input
          key={settings.lang ?? ""}
          id={langId}
          type="text"
          defaultValue={settings.lang ?? ""}
          placeholder="en"
          aria-describedby={langHintId}
          onBlur={(e) => {
            const lang = e.target.value.trim() || undefined;
            if (lang !== settings.lang) updateSettings({ lang });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
          className={fieldClass}
        />
      </div>
      <p id={langHintId} className="text-[10px] text-neutral-600">
        A language tag such as <code>cs</code> or <code>pt-BR</code>. Screen readers use it for pronunciation, and legend numbers follow its format.
      </p>
      <div className="flex items-center gap-1">
        <label htmlFor={dirId} className="w-20 shrink-0 text-[10px] text-neutral-500">Direction</label>
        <select
          id={dirId}
          value={settings.dir ?? ""}
          onChange={(e) => updateSettings({ dir: (e.target.value || undefined) as Settings["dir"] })}
          className={fieldClass}
        >
          <option value="">From the page</option>
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
        </select>
      </div>
      <p className="text-[10px] text-neutral-600">
        Button text can also be SVG path data in a 24×24 box, such as <code>M5 11h14v2H5z</code>, to show an icon. Words in braces, such as <code>{"{name}"}</code>, are filled in by the map.
      </p>
      {VISITOR_TEXT_GROUPS.map(([group, keys]) => (
        <fieldset key={group} className="space-y-1.5">
          <legend className="text-[11px] font-medium text-neutral-300">{group}</legend>
          {group === "Loading and errors" && (
            <p className="text-[10px] text-neutral-600">Shown before map.json loads, so exports pass them to the embed snippet.</p>
          )}
          {keys.map(([key, label]) => (
            <StringRow key={key} id={key} label={label} value={strings[key]} onChange={(value) => setString(key, value)} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
