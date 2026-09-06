import { useState } from "react";
import { useStore } from "../../store";

export function FirstUseGuide() {
  const [open, setOpen] = useState(true);
  const { project, screen } = useStore();
  if (!open) return null;
  const hasBackground = project.views.some((view) => view.background);
  const hasHotspot = project.views.some((view) => view.layers.some((layer) => layer.areas.length));
  const hasAction = project.views.some((view) => view.layers.some((layer) => layer.areas.some((area) => area.action.type !== "none")));
  const steps = [
    ["Add a background", hasBackground, "Import an image or SVG in Design."],
    ["Draw a hotspot", hasHotspot, "Use Rectangle, Circle, Polygon, or Marker."],
    ["Choose an action", hasAction, "Select the hotspot, then choose its action in Inspector."],
    ["Try Preview", screen === "preview" || screen === "export", "Test keyboard, touch, links, and details."],
    ["Prepare export", screen === "export", "Resolve validation, save the editable project, then download the static ZIP."],
  ] as const;
  return (
    <aside aria-label="First map checklist" className="border-b border-blue-800 bg-blue-950/70 px-3 py-2 text-xs text-blue-100">
      <div className="flex items-center gap-2">
        <strong className="text-sm">Your first map</strong>
        <span className="text-blue-300">{steps.filter(([, done]) => done).length}/{steps.length} steps</span>
        <button type="button" className="ml-auto rounded px-2 py-1 text-blue-200 hover:bg-blue-900" onClick={() => setOpen(false)}>Skip guide</button>
      </div>
      <ol className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {steps.map(([label, done, hint], index) => <li key={label} title={hint} className={`min-w-fit rounded border px-2 py-1 ${done ? "border-emerald-700 bg-emerald-950 text-emerald-200" : "border-blue-800"}`}>{done ? "✓" : index + 1} {label}</li>)}
      </ol>
    </aside>
  );
}
