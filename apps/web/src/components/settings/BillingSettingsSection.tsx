import { Plus, UserRound } from "lucide-react";
import type { AuthUser } from "../../core/cloudAuth";

export type TopUpFeedback = {
  type: "success" | "error";
  message: string;
};

type BillingSettingsSectionProps = {
  authUser?: AuthUser | null;
  topUpAmount: string;
  isTopUpLoading: boolean;
  topUpFeedback: TopUpFeedback | null;
  onTopUpAmountChange(value: string): void;
  onTopUp(): void;
  onLoginRequest?(): void;
};

export function BillingSettingsSection({
  authUser,
  topUpAmount,
  isTopUpLoading,
  topUpFeedback,
  onTopUpAmountChange,
  onTopUp,
  onLoginRequest
}: BillingSettingsSectionProps) {
  return (
    <>
      <div className="settings-row">
        <span>Balance</span>
        <div className="settings-control-stack">
          <span className="settings-capability-chip is-configured">
            {authUser && typeof authUser.balanceUsd === "string"
              ? `$${authUser.balanceUsd}`
              : "Sign in required"}
          </span>
          <span className="settings-hint">
            Managed runs are charged from this prepaid balance by the hosted
            ChatHTML Cloud backend.
          </span>
          {!authUser && onLoginRequest ? (
            <button
              className="settings-small-button"
              type="button"
              onClick={onLoginRequest}
            >
              <UserRound size={14} strokeWidth={2.1} aria-hidden="true" />
              <span>Sign In</span>
            </button>
          ) : null}
        </div>
      </div>

      <label className="settings-row">
        <span>Top Up</span>
        <div className="settings-control-stack">
          <div className="settings-inline-control">
            <input
              value={topUpAmount}
              autoComplete="off"
              disabled={!authUser || isTopUpLoading}
              inputMode="decimal"
              placeholder="10"
              onChange={(event) => onTopUpAmountChange(event.target.value)}
            />
            <button
              className="settings-small-button"
              type="button"
              disabled={!authUser || isTopUpLoading}
              onClick={onTopUp}
            >
              <Plus size={14} strokeWidth={2.1} aria-hidden="true" />
              <span>{isTopUpLoading ? "Adding" : "Top Up"}</span>
            </button>
          </div>
          <span
            className={`settings-hint ${
              topUpFeedback
                ? `settings-env-status ${
                    topUpFeedback.type === "success"
                      ? "is-configured"
                      : "is-missing"
                  }`
                : ""
            }`}
          >
            {topUpFeedback
              ? topUpFeedback.message
              : "Uses the public /api/billing/top-up contract."}
          </span>
        </div>
      </label>
    </>
  );
}
