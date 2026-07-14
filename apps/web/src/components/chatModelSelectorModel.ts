import type { ReasoningEffort } from "../core/apiSettings";

export const CHAT_REASONING_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
}> = [
  { value: "none", label: "" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

function visibleReasoningEffort(
  reasoningEffort: ReasoningEffort
): ReasoningEffort {
  return reasoningEffort === "xhigh" ? "high" : reasoningEffort;
}

export function getChatReasoningLabel(
  reasoningEffort: ReasoningEffort
): string {
  return (
    CHAT_REASONING_OPTIONS.find(
      (option) => option.value === visibleReasoningEffort(reasoningEffort)
    )?.label ?? ""
  );
}

export function getChatReasoningIndex(
  reasoningEffort: ReasoningEffort
): number {
  const index = CHAT_REASONING_OPTIONS.findIndex(
    (option) => option.value === visibleReasoningEffort(reasoningEffort)
  );
  return index >= 0 ? index : 0;
}

export function getViewportHorizontalOffset(
  left: number,
  right: number,
  viewportWidth: number,
  padding = 12
): number {
  return getViewportAxisOffset(left, right, viewportWidth, padding);
}

export function getViewportVerticalOffset(
  top: number,
  bottom: number,
  viewportHeight: number,
  padding = 12
): number {
  return getViewportAxisOffset(top, bottom, viewportHeight, padding);
}

function getViewportAxisOffset(
  start: number,
  end: number,
  viewportSize: number,
  padding: number
): number {
  const availableStart = Math.max(0, padding);
  const availableSize = Math.max(0, viewportSize - availableStart * 2);
  const itemSize = Math.max(0, end - start);
  const maximumStart =
    availableStart + Math.max(0, availableSize - itemSize);
  const desiredStart = Math.min(
    Math.max(start, availableStart),
    maximumStart
  );
  return desiredStart - start;
}
