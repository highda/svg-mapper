import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { TopBar } from "./components/layout/TopBar";
import { LeftPanel } from "./components/layout/LeftPanel";
import { Workspace } from "./components/layout/Workspace";
import { RightSidebar } from "./components/layout/RightSidebar";
import { BottomBar } from "./components/layout/BottomBar";
import { ErrorBanner } from "./components/ui/ErrorBanner";
import { ShortcutsHelp } from "./components/ui/ShortcutsHelp";
import { readDraft, removeDraft, type StoredDraft, writeDraft } from "./lib/draft-storage";
import { projectSnapshot } from "./store";
import { FirstUseGuide } from "./components/ui/FirstUseGuide";

function storageError(error: unknown, fallback: string): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback;
}

export function App() {
  const saveProject = useStore((s) => s.saveProject);
  const setScreen = useStore((s) => s.setScreen);
  const screen = useStore((s) => s.screen);
  const project = useStore((s) => s.project);
  const savedSnapshot = useStore((s) => s.savedSnapshot);
  const restoreDraft = useStore((s) => s.restoreDraft);
  const showChrome = screen !== "preview";
  const [showHelp, setShowHelp] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [recoverableDraft, setRecoverableDraft] = useState<StoredDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draftChecked, setDraftChecked] = useState(false);
  const initialSavedSnapshot = useRef(savedSnapshot);
  const isDirty = projectSnapshot(project) !== savedSnapshot;

  useEffect(() => {
    readDraft()
      .then((draft) => {
        if (draft && projectSnapshot(draft.project) !== initialSavedSnapshot.current) setRecoverableDraft(draft);
      })
      .catch((error: unknown) => setDraftError(storageError(error, "Local draft storage is unavailable.")))
      .finally(() => setDraftChecked(true));
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const timeout = window.setTimeout(() => {
      setDraftState("saving");
      writeDraft(project)
        .then(() => setDraftState("saved"))
        .catch((error: unknown) => {
          setDraftState("error");
          setDraftError(storageError(error, "The local draft could not be saved."));
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [isDirty, project]);

  useEffect(() => {
    if (!draftChecked || isDirty || recoverableDraft) return;
    removeDraft()
      .then(() => setDraftState("idle"))
      .catch((error: unknown) => setDraftError(storageError(error, "The stored draft could not be removed.")));
  }, [draftChecked, isDirty, recoverableDraft]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty || draftState === "saved") return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [draftState, isDirty]);

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
      <TopBar draftState={draftState} />
      <FirstUseGuide />
      {draftError && (
        <div role="alert" className="bg-amber-950 px-3 py-1 text-xs text-amber-200">
          Local recovery unavailable: {draftError} Download the project to protect your work.
        </div>
      )}
      <ErrorBanner />
      {showChrome && screen === "design" && (
        <div className="flex min-h-11 items-center gap-2 border-b border-neutral-700 bg-neutral-900 px-2 lg:hidden" aria-label="Mobile workspace controls">
          <button type="button" className="min-h-9 rounded bg-blue-600 px-3 text-xs font-medium text-white" aria-current="page">Canvas</button>
          <button type="button" className="min-h-9 rounded px-3 text-xs text-neutral-300 hover:bg-neutral-800" onClick={() => setScreen("tree")}>Views &amp; layers</button>
          <button type="button" className="ml-auto min-h-9 rounded px-3 text-xs text-neutral-300 hover:bg-neutral-800" onClick={() => setMobileInspectorOpen(true)}>Inspector</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {showChrome && screen !== "tree" && <LeftPanel />}
        <Workspace />
        {showChrome && <RightSidebar mobileOpen={mobileInspectorOpen} onMobileClose={() => setMobileInspectorOpen(false)} />}
      </div>
      {mobileInspectorOpen && <button type="button" aria-label="Close inspector overlay" className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileInspectorOpen(false)} />}
      <BottomBar />
      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
      {recoverableDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="draft-title">
          <div className="max-w-md rounded-lg border border-neutral-600 bg-neutral-900 p-5 shadow-xl">
            <h2 id="draft-title" className="text-base font-semibold text-white">Recover local draft?</h2>
            <p className="mt-2 text-sm text-neutral-300">
              A draft of “{recoverableDraft.project.project.name}” from {new Date(recoverableDraft.savedAt).toLocaleString()} is stored only in this browser.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700" onClick={() => {
                removeDraft().catch(() => setDraftError("The stored draft could not be removed."));
                setRecoverableDraft(null);
              }}>Discard draft</button>
              <button autoFocus className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500" onClick={() => {
                restoreDraft(recoverableDraft.project);
                setRecoverableDraft(null);
              }}>Restore draft</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
