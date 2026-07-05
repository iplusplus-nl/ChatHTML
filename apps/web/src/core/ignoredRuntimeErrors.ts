import type { RenderError } from "../runtime/streamui/types";

type RuntimeEventLike = Pick<RenderError, "kind" | "message"> & {
  filename?: string;
};

export function isIgnoredRuntimeError(error: RuntimeEventLike): boolean {
  const message = String(error.message || "").toLowerCase();
  const filename = String(error.filename || "").toLowerCase();
  const combined = `${message} ${filename}`;
  const extensionSource =
    combined.includes("safari-web-extension:") ||
    combined.includes("moz-extension:") ||
    combined.includes("chrome-extension:") ||
    combined.includes("extension://");

  if (combined.includes("zotero") || combined.includes("reportactiveurl")) {
    return true;
  }

  if (
    error.kind === "security" &&
    (message === "browser permission apis are not allowed in chathtml artifacts." ||
      message === "browser permission apis are not allowed in streamui artifacts.")
  ) {
    return true;
  }

  if (
    extensionSource &&
    (combined.includes("sandbox access violation") ||
      combined.includes("undefined is not an object"))
  ) {
    return true;
  }

  return false;
}
