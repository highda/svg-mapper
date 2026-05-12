import { useRef, useState } from "react";
import { useStore, type Screen } from "../../store";

const SCREENS: { id: Screen; label: string }[] = [
  { id: "design", label: "Design" },
  { id: "tree", label: "Tree" },
  { id: "flow", label: "Flow" },
  { id: "preview", label: "Preview" },
  { id: "export", label: "Export" },
];

export function TopBar() {
  const { project, screen, newProject, loadProject, saveProject, setProjectName, setScreen, undo, redo, past, future } =
    useStore();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") loadProject(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <header className="flex h-10 items-center gap-2 border-b border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-200">
      {/* Project name */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
      <div className="flex items-center gap-1">
        <button
          onClick={newProject}
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
    </header>
  );
}
