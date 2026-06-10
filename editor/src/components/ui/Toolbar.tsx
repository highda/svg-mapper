import { useStore, type Tool } from "../../store";

interface ToolButton {
  id: Tool;
  label: string;
  shortcut: string;
  title: string;
}

const TOOLS: ToolButton[] = [
  { id: "select", label: "↖", shortcut: "V", title: "Select (V)" },
  { id: "rect", label: "▭", shortcut: "R", title: "Rectangle (R)" },
  { id: "polygon", label: "⬡", shortcut: "P", title: "Polygon (P)" },
  { id: "circle", label: "○", shortcut: "C", title: "Circle (C)" },
];

export function Toolbar() {
  const { activeTool, setActiveTool } = useStore();

  return (
    <div className="flex flex-col items-center gap-1 border-r border-neutral-700 bg-neutral-900 px-1 py-2">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.title}
          onClick={() => setActiveTool(t.id)}
          className={`flex h-8 w-8 items-center justify-center rounded text-sm font-medium transition-colors ${
            activeTool === t.id
              ? "bg-blue-600 text-white"
              : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
