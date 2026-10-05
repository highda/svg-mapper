import { useMemo } from "react";
import { validateProject } from "@svg-mapper/shared";
import { useStore } from "../../store";
import { toDefinition } from "../../lib/project";
import { DESKTOP_QUERY, useMediaQuery } from "../../lib/use-media-query";
import { useLayoutPrefs } from "../../store/layout-prefs";

/** Show/hide and reset controls for the docked desktop panels (#156). */
function LayoutControls({ treeAvailable }: { treeAvailable: boolean }) {
  const treeCollapsed = useLayoutPrefs((s) => s.tree.collapsed);
  const inspectorCollapsed = useLayoutPrefs((s) => s.inspector.collapsed);
  const toggleCollapsed = useLayoutPrefs((s) => s.toggleCollapsed);
  const resetLayout = useLayoutPrefs((s) => s.resetLayout);
  const button = "rounded px-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white aria-pressed:text-blue-300";
  return (
    <div role="group" aria-label="Workspace layout" className="ml-auto flex items-center gap-1">
      {treeAvailable && (
        <button type="button" className={button} aria-pressed={!treeCollapsed} onClick={() => toggleCollapsed("tree")} title={treeCollapsed ? "Show the views and layers panel" : "Hide the views and layers panel"}>
          Tree panel
        </button>
      )}
      <button type="button" className={button} aria-pressed={!inspectorCollapsed} onClick={() => toggleCollapsed("inspector")} title={inspectorCollapsed ? "Show the inspector panel" : "Hide the inspector panel"}>
        Inspector panel
      </button>
      <button type="button" className={button} onClick={resetLayout} title="Restore default panel widths and inspector sections">
        Reset layout
      </button>
    </div>
  );
}

export function BottomBar() {
  const zoom = useStore((s) => s.project.editor?.zoom ?? 1);
  const project = useStore((s) => s.project);
  const setScreen = useStore((s) => s.setScreen);
  const screen = useStore((s) => s.screen);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const docked = desktop && (screen === "design" || screen === "tree" || screen === "flow");

  const { errors, warnings } = useMemo(() => {
    const results = validateProject(toDefinition(project));
    return {
      errors: results.filter((r) => r.severity === "error").length,
      warnings: results.filter((r) => r.severity === "warning").length,
    };
  }, [project]);

  const clean = errors === 0 && warnings === 0;

  return (
    <footer className="flex h-7 items-center gap-4 border-t border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-400">
      <span>Zoom: {Math.round(zoom * 100)}%</span>
      <span>Views: {project.views.length}</span>

      <button
        onClick={() => setScreen("export")}
        title="Open Export to see details"
        className="flex items-center gap-1.5 rounded px-1.5 hover:bg-neutral-800"
      >
        <span>Validation:</span>
        {clean ? (
          <span className="text-emerald-400">✓ clean</span>
        ) : (
          <>
            {errors > 0 && <span className="text-red-400">{errors} error{errors === 1 ? "" : "s"}</span>}
            {warnings > 0 && (
              <span className="text-amber-400">{warnings} warning{warnings === 1 ? "" : "s"}</span>
            )}
          </>
        )}
      </button>

      {docked ? <LayoutControls treeAvailable={screen !== "tree"} /> : <span className="ml-auto">svg-mapper editor</span>}
    </footer>
  );
}
