import type { StreamUiPromptAction } from "../../runtime/streamui/types";

export type PreviewPromptActionPayload = {
  capabilityId?: string;
  label?: string;
  message?: string;
  prompt?: string;
};

export function dispatchPreviewPromptAction(
  payload: PreviewPromptActionPayload,
  onAction: (action: StreamUiPromptAction) => void,
  onSettled: (capabilityId: string) => void
): void {
  const prompt = String(payload.prompt || payload.message || "").trim();
  const label = String(payload.label || "").trim();
  const capabilityId =
    typeof payload.capabilityId === "string" ? payload.capabilityId : "";

  try {
    if (prompt) {
      onAction({
        type: "prompt",
        prompt: prompt.slice(0, 2000),
        ...(capabilityId ? { capabilityId } : {}),
        ...(label ? { label: label.slice(0, 200) } : {})
      });
    }
  } finally {
    if (capabilityId) {
      onSettled(capabilityId);
    }
  }
}
