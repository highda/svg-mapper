import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { TopBar } from "./components/layout/TopBar";
import { LeftPanel } from "./components/layout/LeftPanel";
import { Workspace } from "./components/layout/Workspace";
import { RightSidebar } from "./components/layout/RightSidebar";
import { BottomBar } from "./components/layout/BottomBar";
import { ErrorBanner } from "./components/ui/ErrorBanner";
import { ShortcutsHelp } from "./components/ui/ShortcutsHelp";
import { CorruptDraftError, readDraft, removeDraft, type StoredDraft, writeDraft } from "./lib/draft-storage";
import { projectSnapshot } from "./store";
import { FirstUseGuide } from "./components/ui/FirstUseGuide";
import { ModalDialog } from "./components/ui/ModalDialog";
import { isEditableTarget, isModalOpen } from "./lib/shortcut-guard";

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
  const [corruptDraft, setCorruptDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [draftChecked, setDraftChecked] = useState(false);
  const initialSavedSnapshot = useRef(savedSnapshot);
  const restoreDraftRef = useRef<HTMLButtonElement>(null);
  const currentSnapshot = projectSnapshot(project);
  const isDirty = currentSnapshot !== savedSnapshot;

  // Recovery is tied to the exact document that was durably written (#166):
  // "saved" means the stored draft equals the current snapshot, never a flag
  // left over from an earlier write. Removing or discarding the draft starts a
  // new epoch so a write still in flight cannot mark anything saved.
  const [durableSnapshot, setDurableSnapshot] = useState<string | null>(null);
  const durableRef = useRef<string | null>(null);
  const epochRef = useRef(0);
  // The ref (read by the unload guard) resets at once; the status follows when removal settles.
  const discardStoredDraft = useCallback((failure: string): Promise<void> => {
    epochRef.current += 1;
    durableRef.current = null;
    return removeDraft()
      .catch(() => setDraftError(failure))
      .finally(() => setDurableSnapshot(null));
  }, []);

  useEffect(() => {
    readDraft()
      .then((draft) => {
        if (draft && projectSnapshot(draft.project) !== initialSavedSnapshot.current) setRecoverableDraft(draft);
      })
      .catch((error: unknown) => {
        if (error instanceof CorruptDraftError) setCorruptDraft(error.message);
        else setDraftError(storageError(error, "Local draft storage is unavailable."));
      })
      .finally(() => setDraftChecked(true));
  }, []);

  useEffect(() => {
    // Never overwrite a draft the user has not resolved yet (recoverable or corrupt).
    if (!isDirty || !draftChecked || recoverableDraft || corruptDraft) return;
    if (currentSnapshot === durableRef.current) return;
    const timeout = window.setTimeout(() => {
      const epoch = epochRef.current;
      setPendingWrites((count) => count + 1);
      writeDraft(project)
        .then(() => {
          if (epoch !== epochRef.current) return;
          durableRef.current = currentSnapshot;
          setDurableSnapshot(currentSnapshot);
          setWriteError(null);
        })
        .catch((error: unknown) => {
          if (epoch === epochRef.current) setWriteError(storageError(error, "The local draft could not be saved."));
        })
        .finally(() => setPendingWrites((count) => count - 1));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [isDirty, project, currentSnapshot, draftChecked, recoverableDraft, corruptDraft]);

  useEffect(() => {
    if (!draftChecked || isDirty || recoverableDraft || corruptDraft) return;
    void discardStoredDraft("The stored draft could not be removed.");
  }, [draftChecked, isDirty, recoverableDraft, corruptDraft, discardStoredDraft]);

  useEffect(() => {
    // Reads the store at unload time, so an edit made after the last render is still protected.
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      const state = useStore.getState();
      const snapshot = projectSnapshot(state.project);
      if (snapshot === state.savedSnapshot || snapshot === durableRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  const draftState: "idle" | "saving" | "saved" | "error" = !isDirty
    ? "idle"
    : currentSnapshot === durableSnapshot
      ? "saved"
      : writeError
        ? "error"
        : pendingWrites > 0
          ? "saving"
          : "idle";
  const recoveryError = draftError ?? writeError;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.isComposing || isEditableTarget(e)) return;
      // An open dialog owns the keyboard; "?" may only close the help dialog itself.
      const helpOpen = document.querySelector('[data-dialog="shortcuts-help"]') !== null;
      if (isModalOpen() && !(helpOpen && e.key === "?")) return;

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
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setShowHelp((v) => !v);
        return;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveProject, setScreen]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900 text-neutral-200">
      <TopBar draftState={draftState} />
      <FirstUseGuide />
      {recoveryError && (
        <div role="alert" className="bg-amber-950 px-3 py-1 text-xs text-amber-200">
          Local recovery unavailable: {recoveryError} Download the project to protect your work.
        </div>
      )}
      {corruptDraft && (
        <div role="alert" className="flex flex-wrap items-center gap-2 bg-amber-950 px-3 py-1 text-xs text-amber-200">
          <span>{corruptDraft} It is kept until you discard it; new changes are not saved locally meanwhile, so download the project to protect your work.</span>
          <button type="button" className="rounded px-2 py-0.5 text-amber-100 underline hover:bg-amber-900" onClick={() => {
            void discardStoredDraft("The stored draft could not be removed.").then(() => setCorruptDraft(null));
          }}>Discard stored draft</button>
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
      <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} />
      {/* Recovery needs an explicit choice: Escape and outside clicks do nothing (#174). */}
      <ModalDialog
        open={recoverableDraft !== null}
        title="Recover local draft?"
        description={recoverableDraft && <>A draft of “{recoverableDraft.project.project.name}” from {new Date(recoverableDraft.savedAt).toLocaleString()} is stored only in this browser.</>}
        initialFocusRef={restoreDraftRef}
      >
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700" onClick={() => {
            void discardStoredDraft("The stored draft could not be removed.");
            setRecoverableDraft(null);
          }}>Discard draft</button>
          <button ref={restoreDraftRef} type="button" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500" onClick={() => {
            if (recoverableDraft) restoreDraft(recoverableDraft.project);
            setRecoverableDraft(null);
          }}>Restore draft</button>
        </div>
      </ModalDialog>
    </div>
  );
}
