import { useEffect } from "react";
import { useStore } from "./store";
import { TopBar } from "./components/layout/TopBar";
import { LeftPanel } from "./components/layout/LeftPanel";
import { Workspace } from "./components/layout/Workspace";
import { RightSidebar } from "./components/layout/RightSidebar";
import { BottomBar } from "./components/layout/BottomBar";
import { ErrorBanner } from "./components/ui/ErrorBanner";

export function App() {
  const saveProject = useStore((s) => s.saveProject);
  const screen = useStore((s) => s.screen);
  const showChrome = screen !== "preview";

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveProject();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveProject]);

  return (
    <div className="flex h-screen flex-col bg-neutral-900 text-neutral-200">
      <TopBar />
      <ErrorBanner />
      <div className="flex min-h-0 flex-1">
        {showChrome && <LeftPanel />}
        <Workspace />
        {showChrome && <RightSidebar />}
      </div>
      <BottomBar />
    </div>
  );
}
