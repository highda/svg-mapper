import { useStore } from "../../store";

export function BottomBar() {
  const zoom = useStore((s) => s.project.editor?.zoom ?? 1);
  const viewCount = useStore((s) => s.project.views.length);

  return (
    <footer className="flex h-7 items-center gap-4 border-t border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-500">
      <span>Zoom: {Math.round(zoom * 100)}%</span>
      <span>Views: {viewCount}</span>
      <span className="ml-auto">svg-mapper editor</span>
    </footer>
  );
}
