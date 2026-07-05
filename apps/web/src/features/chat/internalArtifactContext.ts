const STREAMUI_ARTIFACT_CONTEXT_START =
  /^\s*\[StreamUI (?:internal )?artifact(?: context)?\s+artifact-[^\]]+\]/i;
const STREAMUI_ARTIFACT_CONTEXT_BLOCK =
  /(^|\n)\s*\[StreamUI (?:internal )?artifact(?: context)?\s+artifact-[^\]]+\][\s\S]*?(?=\n{2,}|$)/gi;
const STREAMUI_ARTIFACT_CONTEXT_HINT =
  /Source hash:|Visible text summary:|Structure summary:|Style summary:|Editable summary:/i;

export function isInternalArtifactContextText(value: string): boolean {
  const text = value.trim();

  return (
    STREAMUI_ARTIFACT_CONTEXT_START.test(text) &&
    STREAMUI_ARTIFACT_CONTEXT_HINT.test(text)
  );
}

export function stripInternalArtifactContextText(value: string): string {
  if (!value.trim()) {
    return "";
  }

  if (isInternalArtifactContextText(value)) {
    return "";
  }

  return value
    .replace(STREAMUI_ARTIFACT_CONTEXT_BLOCK, (match, prefix: string) =>
      STREAMUI_ARTIFACT_CONTEXT_HINT.test(match) ? prefix : match
    )
    .trim();
}
