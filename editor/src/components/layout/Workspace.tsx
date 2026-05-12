import { useStore } from "../../store";

export function Workspace() {
  const { project, screen } = useStore();
  const activeView = project.views[0];

  if (screen !== "design") {
    return (
      <main className="flex flex-1 items-center justify-center bg-neutral-800 text-neutral-500 text-sm">
        {screen.charAt(0).toUpperCase() + screen.slice(1)} screen — coming soon
      </main>
    );
  }

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-neutral-800">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 39px, #6b7280 39px, #6b7280 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, #6b7280 39px, #6b7280 40px)",
        }}
      />

      {/* Canvas area */}
      <div className="relative flex flex-col items-center gap-2">
        {activeView ? (
          <div
            className="relative rounded bg-white shadow-lg"
            style={{ width: activeView.width / 2, height: activeView.height / 2 }}
          >
            <span className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
              {activeView.name} — canvas area
            </span>
          </div>
        ) : (
          <p className="text-neutral-500 text-sm">No views yet. Click &ldquo;New&rdquo; to start.</p>
        )}
      </div>
    </main>
  );
}
