const IMAGE_MODEL_PATTERNS = [
  /\bgemini[-_/]/,
  /\bgpt-(?:4o|4\.1|5)(?:$|[-_/.:])/,
  /\bo[34](?:$|[-_/.:])/,
  /\bclaude-(?:3|3\.5|3\.7|4|5|opus-4|sonnet-4|sonnet-5)/,
  /\bqwen(?:2(?:\.5)?|3)?[-_.]?vl\b/,
  /\bqwen[-_/].*[-_.]?vl\b/,
  /\bglm[-_.]?4v\b/,
  /\bllama[-_.]?3\.2[-_/].*vision\b/,
  /\bllama[-_.]?4\b/,
  /\bpixtral\b/,
  /\bllava\b/,
  /\binternvl\b/,
  /\bminicpm[-_.]?v\b/,
  /\bgrok[-_/].*vision\b/
];

export function modelLikelySupportsImageInput(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return IMAGE_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}
