import { useEffect, useState } from "react";
import { useStore } from "./store";
import { TopBar } from "./components/layout/TopBar";
import { LeftPanel } from "./components/layout/LeftPanel";
import { Workspace } from "./components/layout/Workspace";
import { RightSidebar } from "./components/layout/RightSidebar";
import { BottomBar } from "./components/layout/BottomBar";
import { ErrorBanner } from "./components/ui/ErrorBanner";
import { ShortcutsHelp } from "./components/ui/ShortcutsHelp";

export function App() {
  const saveProject = useStore((s) => s.saveProject);
  const setScreen = useStore((s) => s.setScreen);
  const screen = useStore((s) => s.screen);
  const showChrome = screen !== "preview";
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveProject();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault();
        setScreen("export");
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        setShowHelp((v) => !v);
        return;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveProject, setScreen]);

  return (
    <div className="flex h-screen flex-col bg-neutral-900 text-neutral-200">
      <TopBar />
      <ErrorBanner />
      <div className="flex min-h-0 flex-1">
        {showChrome && screen !== "tree" && <LeftPanel />}
        <Workspace />
        {showChrome && <RightSidebar />}
      </div>
      <BottomBar />
      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
