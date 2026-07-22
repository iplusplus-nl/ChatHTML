import { Palette, Sparkles } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useModalFocusTrap } from "./useModalFocusTrap";

export type PopArtOnboardingDialogProps = {
  themeMode: "day" | "night";
  onAccept(): void;
  onDecline(): void;
};

export function PopArtOnboardingDialogContent({
  onAccept,
  onDecline
}: Omit<PopArtOnboardingDialogProps, "themeMode">) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap({ dialogRef });

  return (
    <section
      ref={dialogRef}
      className="auth-choice-dialog pop-art-onboarding-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pop-art-onboarding-title"
      aria-describedby="pop-art-onboarding-description"
    >
      <div className="auth-choice-mark" aria-hidden="true">
        CH
      </div>
      <div className="auth-choice-heading">
        <h2 id="pop-art-onboarding-title">Try Pop Art Style?</h2>
        <p id="pop-art-onboarding-description">
          Add a bold, colorful Pop Art direction to the interfaces ChatHTML
          creates for you. You can edit or remove it later in Settings →
          Personal → User Preference Prompt.
        </p>
      </div>

      <div className="auth-choice-actions">
        <button
          className="auth-choice-primary"
          type="button"
          onClick={onAccept}
        >
          <Sparkles size={17} strokeWidth={2} aria-hidden="true" />
          <span>Try Pop Art Style</span>
        </button>
        <button
          className="auth-choice-secondary"
          type="button"
          onClick={onDecline}
        >
          <Palette size={17} strokeWidth={2} aria-hidden="true" />
          <span>Not now</span>
        </button>
      </div>

      <p className="auth-choice-footnote">
        Choosing Pop Art adds <strong>- In Pop Art style</strong> to your User
        Preference Prompt. It does not change existing conversations.
      </p>
    </section>
  );
}

export function PopArtOnboardingDialog({
  themeMode,
  ...props
}: PopArtOnboardingDialogProps) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="auth-choice-overlay"
      data-theme={themeMode}
      role="presentation"
    >
      <PopArtOnboardingDialogContent {...props} />
    </div>,
    document.body
  );
}
