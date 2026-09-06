import { useRef, useState } from "react";
import { projectSnapshot, useStore, type Screen } from "../../store";
import { createStarterProject, STARTER_PROJECTS } from "../../lib/starter-projects";

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
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
    setStarterOpen(false);
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
    <header className="relative flex min-h-10 flex-wrap items-center gap-1 border-b border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 lg:flex-nowrap lg:gap-2 lg:px-3 lg:py-0">
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

      <button
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="mobile-project-menu"
        onClick={() => setMobileMenuOpen((open) => {
          if (!open) setNameValue(project.project.name);
          return !open;
        })}
        className="min-h-9 rounded border border-neutral-700 px-3 text-xs font-medium text-neutral-200 hover:bg-neutral-800 lg:hidden"
      >
        Project
      </button>

      {/* Screen tabs */}
      <nav aria-label="Editor screens" className="order-3 flex w-full justify-between gap-0.5 lg:order-none lg:w-auto lg:justify-start">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            onClick={() => setScreen(s.id)}
            aria-current={screen === s.id ? "page" : undefined}
            className={`min-h-9 rounded px-2.5 py-1 text-xs font-medium transition-colors lg:min-h-0 lg:py-0.5 ${
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
      <div className="ml-auto flex items-center gap-0.5 lg:ml-0">
        <button
          onClick={undo}
          disabled={past.length === 0}
          title="Undo (Cmd+Z)"
          aria-label="Undo"
          className="min-h-9 min-w-9 rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30 lg:min-h-0 lg:min-w-0"
        >
          ↩
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
          className="min-h-9 min-w-9 rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30 lg:min-h-0 lg:min-w-0"
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
          onClick={() => setStarterOpen(true)}
          className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          Samples
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
      {mobileMenuOpen && (
        <section
          id="mobile-project-menu"
          aria-label="Project operations"
          className="absolute left-2 right-2 top-12 z-40 rounded-lg border border-neutral-600 bg-neutral-900 p-3 shadow-2xl lg:hidden"
        >
          <div className="mb-3 flex min-w-0 items-center gap-2">
            <input
              aria-label="Project name"
              className="min-h-11 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 text-sm text-white outline-none focus:border-blue-500"
              value={nameValue}
              onChange={(event) => setNameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitName();
                if (event.key === "Escape") setNameValue(project.project.name);
              }}
            />
            <button
              type="button"
              className="min-h-11 rounded px-3 text-sm text-blue-300 hover:bg-neutral-800"
              onClick={commitName}
            >
              Rename
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="min-h-11 rounded bg-neutral-800 text-sm hover:bg-neutral-700" onClick={() => { requestReplacement({ kind: "new" }); setMobileMenuOpen(false); }}>New</button>
            <button className="min-h-11 rounded bg-neutral-800 text-sm hover:bg-neutral-700" onClick={() => { setStarterOpen(true); setMobileMenuOpen(false); }}>Samples</button>
            <button className="min-h-11 rounded bg-neutral-800 text-sm hover:bg-neutral-700" onClick={handleOpen}>Open</button>
            <button className="min-h-11 rounded bg-blue-600 text-sm font-medium text-white hover:bg-blue-500" onClick={() => { saveProject(); setMobileMenuOpen(false); }}>Save</button>
          </div>
          <p className={`mt-2 text-xs ${isDirty ? "text-amber-300" : "text-neutral-500"}`}>
            {isDirty ? "Unsaved changes" : "Downloaded version"}
          </p>
        </section>
      )}
      {starterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="starter-title">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-neutral-600 bg-neutral-900 p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div><h2 id="starter-title" className="text-lg font-semibold text-white">Start a map</h2><p className="mt-1 text-sm text-neutral-400">Everything here stays editable and uses the same Preview and Export as your own project.</p></div>
              <button autoFocus type="button" aria-label="Close starter" className="ml-auto rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800" onClick={() => setStarterOpen(false)}>✕</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" className="rounded-lg border border-neutral-700 p-4 text-left hover:border-blue-500 hover:bg-neutral-800" onClick={() => { requestReplacement({ kind: "new" }); setStarterOpen(false); }}>
                <strong className="text-white">Blank map</strong><span className="mt-1 block text-xs text-neutral-400">Import your own plan and draw from scratch.</span>
              </button>
              <button type="button" className="rounded-lg border border-neutral-700 p-4 text-left hover:border-blue-500 hover:bg-neutral-800" onClick={handleOpen}>
                <strong className="text-white">Open project</strong><span className="mt-1 block text-xs text-neutral-400">Continue from an editable JSON file.</span>
              </button>
              {STARTER_PROJECTS.map((starter) => (
                <button key={starter.id} type="button" className="rounded-lg border border-neutral-700 p-4 text-left hover:border-blue-500 hover:bg-neutral-800" onClick={() => { requestReplacement({ kind: "open", json: JSON.stringify(createStarterProject(starter.id)) }); setStarterOpen(false); }}>
                  <strong className="text-white">{starter.name}</strong><span className="mt-1 block text-xs text-neutral-400">{starter.description}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-neutral-500">Tip: pick a sample, select a highlighted place, change its details or action, then open Preview.</p>
          </div>
        </div>
      )}
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
