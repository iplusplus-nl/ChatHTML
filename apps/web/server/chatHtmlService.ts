import type { NextFunction, Request, RequestHandler, Response } from "express";

export const DEFAULT_CHATHTML_SERVICE_BASE_URL =
  "https://service.aietheia.com/v1";
const SESSION_COOKIE_NAME = "chathtml_service_session";
const MAX_SERVICE_RESPONSE_BYTES = 256 * 1024;

type ServiceUser = {
  id: string;
  email: string;
  role: "admin" | "user";
  balanceUsd?: string;
  balanceMicros?: number;
};

type ServiceAuthSession = {
  user: ServiceUser;
  accessToken: string;
  expiresAt: number;
};

type AuthAvailability = {
  available: boolean;
  requiresInvite: boolean;
  firstUser: boolean;
};

export type ChatHtmlServiceGatewayOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  nodeEnv?: string;
};

class ServiceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ServiceHttpError";
  }
}

function normalizeServiceBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("CHATHTML_SERVICE_BASE_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("CHATHTML_SERVICE_BASE_URL must not contain credentials.");
  }
  return value.replace(/\/+$/, "");
}

function readCookie(req: Request, name: string): string {
  const header = req.get("cookie") ?? "";
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = entry.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{20,256}$/.test(value) ? value : "";
  }
  return "";
}

function sessionCookie(
  token: string,
  expiresAt: number,
  secure: boolean
): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
    `Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000))}`
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function expiredSessionCookie(secure: boolean): string {
  return sessionCookie("", 0, secure);
}

function useSecureCookie(req: Request, nodeEnv: string): boolean {
  return nodeEnv === "production" || req.secure;
}

async function readBoundedJson(response: globalThis.Response): Promise<unknown> {
  if (!response.body) {
    return {};
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_SERVICE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("ChatHTML Service returned too much data.");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("ChatHTML Service returned invalid JSON.");
  }
}

function errorText(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error.slice(0, 500);
  }
  return fallback;
}

async function requireSuccessfulJson(
  response: globalThis.Response,
  fallback: string
): Promise<unknown> {
  const payload = await readBoundedJson(response);
  if (!response.ok) {
    throw new ServiceHttpError(response.status, errorText(payload, fallback));
  }
  return payload;
}

function asAuthSession(payload: unknown): ServiceAuthSession {
  const value = payload as Partial<ServiceAuthSession> | null;
  if (
    !value?.user ||
    typeof value.user.id !== "string" ||
    typeof value.user.email !== "string" ||
    (value.user.role !== "admin" && value.user.role !== "user") ||
    typeof value.accessToken !== "string" ||
    !/^[A-Za-z0-9_-]{20,256}$/.test(value.accessToken) ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt)
  ) {
    throw new Error("ChatHTML Service returned an invalid authentication session.");
  }
  return value as ServiceAuthSession;
}

function asUser(payload: unknown): ServiceUser {
  const value = payload as { user?: ServiceUser } | null;
  if (
    !value?.user ||
    typeof value.user.id !== "string" ||
    typeof value.user.email !== "string" ||
    (value.user.role !== "admin" && value.user.role !== "user")
  ) {
    throw new Error("ChatHTML Service returned an invalid user.");
  }
  return value.user;
}

function asAvailability(payload: unknown): AuthAvailability {
  const value = payload as Partial<AuthAvailability> | null;
  return {
    available: value?.available === true,
    requiresInvite: value?.requiresInvite === true,
    firstUser: value?.firstUser === true
  };
}

function authSummary(user: ServiceUser | null, firstUser = false) {
  return {
    user,
    auth: {
      available: true,
      requiresInvite: false,
      firstUser
    }
  };
}

function sendGatewayError(res: Response, error: unknown): void {
  if (error instanceof ServiceHttpError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    res.status(status).json({ error: error.message });
    return;
  }
  console.error("ChatHTML Service request failed.", error);
  res.status(502).json({ error: "ChatHTML Service is temporarily unavailable." });
}

export function createChatHtmlServiceGateway(
  options: ChatHtmlServiceGatewayOptions = {}
) {
  const baseUrl = normalizeServiceBaseUrl(
    options.baseUrl ??
      process.env.CHATHTML_SERVICE_BASE_URL ??
      DEFAULT_CHATHTML_SERVICE_BASE_URL
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";

  const serviceRequest = async (
    path: string,
    init: RequestInit = {}
  ): Promise<globalThis.Response> =>
    fetchImpl(`${baseUrl}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    });

  const loadAvailability = async (): Promise<AuthAvailability> =>
    asAvailability(
      await requireSuccessfulJson(
        await serviceRequest("/auth/status"),
        "Could not load authentication status."
      )
    );

  const handleAuthMe: RequestHandler = async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE_NAME);
    try {
      if (!token) {
        const availability = await loadAvailability();
        res.json(authSummary(null, availability.firstUser));
        return;
      }
      const response = await serviceRequest("/auth/me", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 401) {
        res.setHeader(
          "Set-Cookie",
          expiredSessionCookie(useSecureCookie(req, nodeEnv))
        );
        const availability = await loadAvailability();
        res.json(authSummary(null, availability.firstUser));
        return;
      }
      const user = asUser(
        await requireSuccessfulJson(response, "Could not load the current user.")
      );
      res.json(authSummary(user));
    } catch (error) {
      sendGatewayError(res, error);
    }
  };

  const authAction = (path: "/auth/login" | "/auth/register"): RequestHandler =>
    async (req, res) => {
      try {
        const body =
          req.body && typeof req.body === "object"
            ? (req.body as Record<string, unknown>)
            : {};
        const response = await serviceRequest(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: body.email, password: body.password })
        });
        const session = asAuthSession(
          await requireSuccessfulJson(response, "Authentication failed.")
        );
        res.setHeader(
          "Set-Cookie",
          sessionCookie(
            session.accessToken,
            session.expiresAt,
            useSecureCookie(req, nodeEnv)
          )
        );
        res.status(path === "/auth/register" ? 201 : 200).json(
          authSummary(session.user)
        );
      } catch (error) {
        sendGatewayError(res, error);
      }
    };

  const handleAuthLogout: RequestHandler = async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE_NAME);
    try {
      if (token) {
        const response = await serviceRequest("/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.status !== 401) {
          await requireSuccessfulJson(response, "Could not revoke the session.");
        } else {
          await response.body?.cancel().catch(() => undefined);
        }
      }
      res.setHeader(
        "Set-Cookie",
        expiredSessionCookie(useSecureCookie(req, nodeEnv))
      );
      res.json(authSummary(null));
    } catch (error) {
      res.setHeader(
        "Set-Cookie",
        expiredSessionCookie(useSecureCookie(req, nodeEnv))
      );
      sendGatewayError(res, error);
    }
  };

  const injectManagedApiSettings = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const settings =
      body.apiSettings && typeof body.apiSettings === "object"
        ? (body.apiSettings as Record<string, unknown>)
        : {};
    const managed =
      settings.providerId === "chathtml-cloud" ||
      settings.apiKeySource === "managed";
    if (!managed) {
      next();
      return;
    }
    const token = readCookie(req, SESSION_COOKIE_NAME);
    if (!token) {
      res.status(401).json({ error: "Sign in to use ChatHTML Service." });
      return;
    }
    req.body = {
      ...body,
      apiSettings: {
        ...settings,
        providerId: "custom",
        providerName: "ChatHTML Service",
        baseUrl,
        modelsEndpoint: `${baseUrl}/models`,
        apiKeySource: "manual",
        apiKey: token
      }
    };
    next();
  };

  return {
    handleAuthMe,
    handleAuthLogin: authAction("/auth/login"),
    handleAuthRegister: authAction("/auth/register"),
    handleAuthLogout,
    injectManagedApiSettings
  };
}
