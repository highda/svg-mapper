import { useMemo } from "react";
import { validateProject } from "@svg-mapper/shared";
import { useStore } from "../../store";
import { toDefinition } from "../../lib/project";

export function BottomBar() {
  const zoom = useStore((s) => s.project.editor?.zoom ?? 1);
  const project = useStore((s) => s.project);
  const setScreen = useStore((s) => s.setScreen);

  const { errors, warnings } = useMemo(() => {
    const results = validateProject(toDefinition(project));
    return {
      errors: results.filter((r) => r.severity === "error").length,
      warnings: results.filter((r) => r.severity === "warning").length,
    };
  }, [project]);

  const clean = errors === 0 && warnings === 0;

  return (
    <footer className="flex h-7 items-center gap-4 border-t border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-500">
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

      <span className="ml-auto">svg-mapper editor</span>
    </footer>
  );
}
