import { apiUrl } from "../api/appUrl";

export type AuthUser = {
  id: string;
  email: string;
  role: "admin" | "user";
  balanceUsd?: string;
  balanceMicros?: number;
  spentInWindowUsd?: string;
  usageLimitUsd?: string;
  remainingUsd?: string;
  usageWindowHours?: number;
  retryAfterSeconds?: number;
};

export type AuthAvailability = {
  available: boolean;
  requiresInvite: boolean;
  firstUser: boolean;
};

export type AuthSummary = {
  user: AuthUser | null;
  auth: AuthAvailability;
};

async function readJson<T>(
  response: Response,
  fallback: string
): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : `${fallback} failed with HTTP ${response.status}.`
    );
  }

  return payload as T;
}

export async function loadAuthSummary(): Promise<AuthSummary> {
  const response = await fetch(apiUrl("/auth/me"), {
    credentials: "same-origin"
  });
  return readJson<AuthSummary>(response, "Authentication status load");
}

export async function logout(): Promise<AuthSummary> {
  const response = await fetch(apiUrl("/auth/logout"), {
    method: "POST",
    credentials: "same-origin"
  });

  return readJson<AuthSummary>(response, "Logout");
}

export async function downloadAccountExport(): Promise<void> {
  const response = await fetch(apiUrl("/account/export"), {
    credentials: "same-origin"
  });
  if (!response.ok) {
    await readJson(response, "Account export");
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "chathtml-account-export.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function deleteAccount(): Promise<void> {
  const response = await fetch(apiUrl("/account"), {
    method: "DELETE",
    credentials: "same-origin"
  });
  await readJson(response, "Account deletion");
}

export async function generateRecoveryCode(): Promise<string> {
  const response = await fetch(apiUrl("/auth/recovery-code"), {
    method: "POST",
    credentials: "same-origin"
  });
  const payload = await readJson<{ recoveryCode?: unknown }>(
    response,
    "Recovery-code generation"
  );
  if (typeof payload.recoveryCode !== "string" || !payload.recoveryCode) {
    throw new Error("The Service returned an invalid recovery code.");
  }
  return payload.recoveryCode;
}
