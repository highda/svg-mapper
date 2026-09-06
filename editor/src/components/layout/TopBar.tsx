import { useRef, useState } from "react";
import { projectSnapshot, useStore, type Screen } from "../../store";

const SCREENS: { id: Screen; label: string }[] = [
  { id: "design", label: "Design" },
  { id: "tree", label: "Tree" },
  { id: "flow", label: "Flow" },
  { id: "preview", label: "Preview" },
  { id: "export", label: "Export" },
];

export function TopBar({
  draftState = "idle",
}: {
  draftState?: "idle" | "saving" | "saved" | "error";
}) {
  const {
    project,
    screen,
    newProject,
    loadProject,
    reportOpenError,
    saveProject,
    setProjectName,
    setScreen,
    undo,
    redo,
    past,
    future,
  } = useStore();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [pendingAction, setPendingAction] = useState<
    null | { kind: "new" } | { kind: "open"; json: string }
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleNameClick() {
    setNameValue(project.project.name);
    setEditingName(true);
  }

  function commitName() {
    const trimmed = nameValue.trim();
    if (trimmed) setProjectName(trimmed);
    setEditingName(false);
  }

  function handleOpen() {
    fileInputRef.current?.click();
  }

  const isDirty = projectSnapshot(project) !== useStore((state) => state.savedSnapshot);

  function replaceProject(action: { kind: "new" } | { kind: "open"; json: string }) {
    if (action.kind === "new") newProject();
    else loadProject(action.json);
  }

  function requestReplacement(action: { kind: "new" } | { kind: "open"; json: string }) {
    if (isDirty) setPendingAction(action);
    else replaceProject(action);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") requestReplacement({ kind: "open", json: text });
      else reportOpenError("Could not read the selected project file.");
    };
    reader.onerror = () => reportOpenError("Could not read the selected project file.");
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <header className="flex h-10 items-center gap-2 border-b border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-200">
      {/* Project name */}
      <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
        {editingName ? (
          <input
            autoFocus
            className="rounded bg-neutral-800 px-2 py-0.5 text-sm text-white outline-none ring-1 ring-blue-500"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setEditingName(false);
            }}
          />
        ) : (
          <button
            className="truncate font-medium hover:text-white"
            title="Click to rename"
            onClick={handleNameClick}
          >
            {project.project.name}
          </button>
        )}
      </div>

      {/* Screen tabs */}
      <nav className="flex gap-0.5">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            onClick={() => setScreen(s.id)}
            aria-current={screen === s.id ? "page" : undefined}
            className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${
              screen === s.id
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Undo / redo */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={undo}
          disabled={past.length === 0}
          title="Undo (Cmd+Z)"
          className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↩
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          title="Redo (Cmd+Shift+Z)"
          className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↪
        </button>
      </div>

      {/* Actions */}
      <div className="hidden items-center gap-1 lg:flex">
        <button
          onClick={() => requestReplacement({ kind: "new" })}
          className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          New
        </button>
        <button
          onClick={handleOpen}
          className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          Open
        </button>
        <button
          onClick={saveProject}
          className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          Save
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />
      <span
        className={`hidden text-[10px] xl:inline ${isDirty ? "text-amber-300" : "text-neutral-500"}`}
      >
        {isDirty
          ? draftState === "saved"
            ? "Unsaved changes · local draft saved"
            : draftState === "saving"
              ? "Unsaved changes · saving draft…"
              : draftState === "error"
                ? "Unsaved changes · draft failed"
                : "Unsaved changes"
          : "Downloaded version"}
      </span>
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="replace-title"
        >
          <div className="max-w-sm rounded-lg border border-neutral-600 bg-neutral-900 p-5 shadow-xl">
            <h2 id="replace-title" className="font-semibold text-white">
              Save changes first?
            </h2>
            <p className="mt-2 text-sm text-neutral-300">
              This will replace the current project. Your local recovery draft is not a downloaded
              backup.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                autoFocus
                className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700"
                onClick={() => setPendingAction(null)}
              >
                Cancel
              </button>
              <button
                className="rounded px-3 py-1.5 text-sm text-red-300 hover:bg-neutral-700"
                onClick={() => {
                  replaceProject(pendingAction);
                  setPendingAction(null);
                }}
              >
                Discard changes
              </button>
              <button
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
                onClick={() => {
                  saveProject();
                  replaceProject(pendingAction);
                  setPendingAction(null);
                }}
              >
                Save &amp; continue
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
