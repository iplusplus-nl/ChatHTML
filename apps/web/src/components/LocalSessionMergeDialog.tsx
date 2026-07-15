import { CloudUpload, Laptop, LoaderCircle } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useModalFocusTrap } from "./useModalFocusTrap";

export type LocalSessionMergeDialogProps = {
  themeMode: "day" | "night";
  sessionCount: number;
  isMerging: boolean;
  error: string | null;
  onMerge(): void;
  onKeepLocal(): void;
};

export function LocalSessionMergeDialogContent({
  sessionCount,
  isMerging,
  error,
  onMerge,
  onKeepLocal
}: Omit<LocalSessionMergeDialogProps, "themeMode">) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap({ dialogRef });
  const sessionLabel = `${sessionCount} local ${
    sessionCount === 1 ? "session" : "sessions"
  }`;

  return (
    <section
      ref={dialogRef}
      className="auth-choice-dialog local-session-merge-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-session-merge-title"
      aria-describedby="local-session-merge-description"
    >
      <div className="auth-choice-mark" aria-hidden="true">
        CH
      </div>
      <div className="auth-choice-heading">
        <h2 id="local-session-merge-title">
          Save local sessions to your account?
        </h2>
        <p id="local-session-merge-description">
          This browser has {sessionLabel}. You can upload the sessions and their
          files to your private account workspace, or keep them only on this
          device.
        </p>
      </div>

      {error ? (
        <p className="local-session-merge-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="auth-choice-actions">
        <button
          className="auth-choice-primary"
          type="button"
          disabled={isMerging}
          onClick={onMerge}
        >
          {isMerging ? (
            <LoaderCircle
              className="local-session-merge-spinner"
              size={17}
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <CloudUpload size={17} strokeWidth={2} aria-hidden="true" />
          )}
          <span>{isMerging ? "Saving to account…" : `Merge ${sessionLabel}`}</span>
        </button>
        <button
          className="auth-choice-secondary"
          type="button"
          disabled={isMerging}
          onClick={onKeepLocal}
        >
          <Laptop size={17} strokeWidth={2} aria-hidden="true" />
          <span>Keep only on this device</span>
        </button>
      </div>

      <p className="auth-choice-footnote">
        Nothing is removed from this browser unless the account upload finishes
        and every imported message and file is verified. Sessions kept only on
        this device can be lost if browser site data is cleared.
      </p>
    </section>
  );
}

export function LocalSessionMergeDialog({
  themeMode,
  ...props
}: LocalSessionMergeDialogProps) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      className="auth-choice-overlay"
      data-theme={themeMode}
      role="presentation"
    >
      <LocalSessionMergeDialogContent {...props} />
    </div>,
    document.body
  );
}
