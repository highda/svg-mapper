import { useId, type ReactNode } from "react";
import { useLayoutPrefs } from "../../store/layout-prefs";

export type InspectorScope = "Project" | "View" | "Layer" | "Area";

/**
 * One titled, collapsible inspector section (#156). Collapsed content stays
 * mounted (hidden), so uncommitted drafts survive; the open state is a
 * per-browser layout preference keyed by `id`, never project data.
 */
export function InspectorSection({
  id,
  title,
  scope,
  advanced = false,
  defaultOpen = true,
  summary,
  children,
}: {
  id: string;
  title: string;
  scope?: InspectorScope;
  /** Marks rarely needed controls (CSS, templates, camera, metadata). */
  advanced?: boolean;
  defaultOpen?: boolean;
  /** Short state shown in the header, readable while collapsed. */
  summary?: string;
  children: ReactNode;
}) {
  const stored = useLayoutPrefs((s) => s.sections[id]);
  const setSectionOpen = useLayoutPrefs((s) => s.setSectionOpen);
  const open = stored ?? defaultOpen;
  const contentId = useId();

  return (
    <section data-inspector-section={id} className="border-b border-neutral-800 pb-2 last:border-b-0">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setSectionOpen(id, !open)}
          className="flex min-h-8 w-full items-center gap-2 rounded px-1 text-left text-[13px] font-semibold text-neutral-100 outline-none hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <span aria-hidden="true" className={`inline-block w-3 text-[11px] text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {summary && <span className="shrink-0 text-xs font-normal text-neutral-400">{summary}</span>}
          {advanced && <span className="shrink-0 rounded border border-amber-700/70 px-1.5 text-[11px] font-medium text-amber-200">Advanced</span>}
          {scope && <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] font-normal text-neutral-300">{scope}</span>}
        </button>
      </h3>
      <div id={contentId} hidden={!open} className="space-y-2 px-1 pt-1.5">
        {children}
      </div>
    </section>
  );
}
