import { useStore } from "../../store";

export function ErrorBanner() {
  const { openError, clearOpenError } = useStore();

  if (!openError) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-red-700 bg-red-950 px-3 py-2 text-sm text-red-300"
    >
      <span className="flex-1">{openError}</span>
      <button
        onClick={clearOpenError}
        className="ml-2 text-red-400 hover:text-red-200"
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
