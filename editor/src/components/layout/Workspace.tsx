import { useStore } from "../../store";
import { DesignScreen } from "../../screens/DesignScreen";
import { FlowScreen } from "../../screens/FlowScreen";
import { PreviewScreen } from "../../screens/PreviewScreen";
import { ExportScreen } from "../../screens/ExportScreen";
import { LeftPanel } from "./LeftPanel";

export function Workspace() {
  const screen = useStore((s) => s.screen);

  if (screen === "design") {
    return <DesignScreen />;
  }
  if (screen === "tree") {
    return (
      <main
        aria-label="Views and layers workspace"
        className="flex min-w-0 flex-1 overflow-hidden bg-neutral-900"
      >
        <LeftPanel workspace />
      </main>
    );
  }
  if (screen === "flow") {
    return <FlowScreen />;
  }
  if (screen === "preview") {
    return <PreviewScreen />;
  }
  if (screen === "export") {
    return <ExportScreen />;
  }

  return null;
}
