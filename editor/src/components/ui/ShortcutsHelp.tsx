import { DialogClose, ModalDialog } from "./ModalDialog";

const SHORTCUTS = [
  { keys: "V", description: "Select tool" },
  { keys: "R", description: "Rectangle tool" },
  { keys: "P", description: "Polygon tool" },
  { keys: "C", description: "Circle tool" },
  { keys: "G", description: "Toggle snap to grid" },
  { keys: "F", description: "Zoom to fit selection / canvas" },
  { keys: "Enter", description: "Confirm polygon" },
  { keys: "M", description: "Marker tool" },
  { keys: "Esc", description: "Cancel drawing or drag / release the picked point / deselect" },
  { keys: "Space", description: "Pan (hold)" },
  { keys: "Delete / Backspace", description: "Delete selected area (or the picked polygon point)" },
  { keys: "Arrows / Shift+Arrows", description: "Nudge the picked polygon point by 1 / 10 (grid step while snapping)" },
  { keys: "⌘/Ctrl+Z", description: "Undo" },
  { keys: "⌘/Ctrl+Shift+Z", description: "Redo" },
  { keys: "⌘/Ctrl+C", description: "Copy area" },
  { keys: "⌘/Ctrl+V", description: "Paste area" },
  { keys: "⌘/Ctrl+D", description: "Duplicate area" },
  { keys: "⌘/Ctrl+S", description: "Save project" },
  { keys: "⌘/Ctrl+E", description: "Open Export screen" },
  { keys: "+ / =", description: "Zoom in" },
  { keys: "- / _", description: "Zoom out" },
  { keys: "0", description: "Reset zoom" },
  { keys: "Alt+↑ / Alt+↓", description: "Move the focused tree area backward / forward" },
  { keys: "← / → on a panel edge", description: "Resize the tree or inspector" },
  { keys: "Enter on a panel edge", description: "Hide or show that panel" },
  { keys: "?", description: "Show or hide this help" },
];

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  return (
    <ModalDialog
      open={open}
      onDismiss={onClose}
      closeOnOutsideClick
      dialogId="shortcuts-help"
      title="Keyboard shortcuts"
      titleClassName="text-sm font-semibold text-neutral-100"
      description="Shortcuts work on the Design canvas when focus is not in a text field."
      descriptionClassName="mt-1 text-[11px] text-neutral-500"
      overlayClassName="bg-black/60"
      className="relative max-w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
    >
      <DialogClose
        aria-label="Close keyboard shortcuts"
        className="absolute right-4 top-4 rounded px-1.5 text-xs text-neutral-500 hover:text-neutral-300"
      >
        ✕
      </DialogClose>
      <ul className="mt-3 space-y-1">
        {SHORTCUTS.map(({ keys, description }) => (
          <li key={keys} className="flex items-center justify-between text-xs">
            <span className="text-neutral-400">{description}</span>
            <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
              {keys}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] text-neutral-600">Press Esc or ? or click outside to close</p>
    </ModalDialog>
  );
}
