import { useStore } from "../../store";
import { DesignScreen } from "../../screens/DesignScreen";
import { FlowScreen } from "../../screens/FlowScreen";
import { PreviewScreen } from "../../screens/PreviewScreen";

export function Workspace() {
  const screen = useStore((s) => s.screen);

  if (screen === "design") {
    return <DesignScreen />;
  }
  if (screen === "flow") {
    return <FlowScreen />;
  }
  if (screen === "preview") {
    return <PreviewScreen />;
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-800 text-neutral-500 text-sm">
      {screen.charAt(0).toUpperCase() + screen.slice(1)} screen — coming soon
    </main>
  );
}
