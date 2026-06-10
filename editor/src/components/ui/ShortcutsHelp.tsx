import { useEffect } from "react";

const SHORTCUTS = [
  { keys: "V", description: "Select tool" },
  { keys: "R", description: "Rectangle tool" },
  { keys: "P", description: "Polygon tool" },
  { keys: "Enter", description: "Confirm polygon" },
  { keys: "Esc", description: "Cancel drawing / deselect" },
  { keys: "Space", description: "Pan (hold)" },
  { keys: "Delete / Backspace", description: "Delete selected area" },
  { keys: "⌘/Ctrl+Z", description: "Undo" },
  { keys: "⌘/Ctrl+⇧+Z", description: "Redo" },
  { keys: "⌘/Ctrl+C", description: "Copy area" },
  { keys: "⌘/Ctrl+V", description: "Paste area" },
  { keys: "⌘/Ctrl+D", description: "Duplicate area" },
  { keys: "⌘/Ctrl+S", description: "Save project" },
  { keys: "⌘/Ctrl+E", description: "Open Export screen" },
  { keys: "+ / =", description: "Zoom in" },
  { keys: "- / _", description: "Zoom out" },
  { keys: "0", description: "Reset zoom" },
  { keys: "?", description: "Show this help" },
];

interface ShortcutsHelpProps {
  onClose: () => void;
}

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-1">
          {SHORTCUTS.map(({ keys, description }) => (
            <li key={keys} className="flex items-center justify-between text-xs">
              <span className="text-neutral-400">{description}</span>
              <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                {keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] text-neutral-600">Click outside or press Esc to close</p>
      </div>
    </div>
  );
}
