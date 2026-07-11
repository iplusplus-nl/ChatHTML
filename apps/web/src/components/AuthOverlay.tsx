import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import {
  login,
  register,
  type AuthSummary
} from "../core/cloudAuth";

type AuthOverlayProps = {
  authSummary: AuthSummary | null;
  isLoading: boolean;
  onAuthChange: (summary: AuthSummary) => void;
  onClose?: () => void;
};

export function AuthOverlay({
  authSummary,
  isLoading,
  onAuthChange,
  onClose
}: AuthOverlayProps) {
  const canRegister = Boolean(authSummary?.auth.available);
  const requiresInvite = Boolean(authSummary?.auth.requiresInvite);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegisterMode = mode === "register";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting || isLoading) {
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      const next = isRegisterMode
        ? await register({ email, password, inviteCode })
        : await login({ email, password });
      onAuthChange(next);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to authenticate."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="auth-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section
        className="auth-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        {onClose ? (
          <button
            className="auth-close-button"
            type="button"
            aria-label="Close sign in"
            onClick={onClose}
          >
            <X size={17} strokeWidth={2.1} aria-hidden="true" />
          </button>
        ) : null}
        <div className="auth-header">
          <span className="auth-brand">ChatHTML Cloud</span>
          <h1 id="auth-title">
            {isRegisterMode ? "Create your account" : "Sign in"}
          </h1>
          <p>
            Use the managed ChatHTML AI service, or switch providers later to
            bring your own API key.
          </p>
        </div>

        {isLoading ? (
          <div className="auth-status">Checking your session...</div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label>
              <span>Email</span>
              <input
                value={email}
                autoComplete="email"
                inputMode="email"
                type="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              <span>Password</span>
              <input
                value={password}
                autoComplete={
                  isRegisterMode ? "new-password" : "current-password"
                }
                type="password"
                minLength={8}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {isRegisterMode && requiresInvite ? (
              <label>
                <span>Invite Code</span>
                <input
                  value={inviteCode}
                  autoComplete="one-time-code"
                  required
                  onChange={(event) => setInviteCode(event.target.value)}
                />
              </label>
            ) : null}
            {error ? <div className="auth-error">{error}</div> : null}
            {isRegisterMode && !canRegister ? (
              <div className="auth-error">
                Registration is currently invite-only.
              </div>
            ) : null}
            <button
              className="auth-primary-button"
              type="submit"
              disabled={isSubmitting || (isRegisterMode && !canRegister)}
            >
              {isSubmitting
                ? "Please wait"
                : isRegisterMode
                  ? "Create Account"
                  : "Sign In"}
            </button>
          </form>
        )}

        {!isLoading ? (
          <div className="auth-mode-switch">
            {isRegisterMode ? (
              <button type="button" onClick={() => setMode("login")}>
                I already have an account
              </button>
            ) : (
              <button
                type="button"
                disabled={!canRegister}
                onClick={() => setMode("register")}
              >
                Create an account
              </button>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
