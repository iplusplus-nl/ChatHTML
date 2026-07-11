export type ArtifactEditReference = {
  kind: "element" | "text";
  key: string;
  selector: string;
  label: string;
  preview: string;
  tagName?: string;
  text?: string;
  html?: string;
};

export type ArtifactEditRequest = {
  source: string;
  prompt: string;
  references: ArtifactEditReference[];
  apiSettings: unknown;
};

export type ArtifactEditRequestFailure = {
  ok: false;
  status: 400 | 413;
  error: string;
};

export type ArtifactEditRequestResult =
  | { ok: true; value: ArtifactEditRequest }
  | ArtifactEditRequestFailure;

const MAX_ARTIFACT_SOURCE_LENGTH = 2_000_000;
const MAX_ARTIFACT_PROMPT_LENGTH = 8_000;
const MAX_ARTIFACT_REFERENCES = 8;

function trimmedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function rawString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

export function normalizeArtifactEditReference(
  input: unknown
): ArtifactEditReference | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const reference = input as Partial<ArtifactEditReference>;
  const kind =
    reference.kind === "element" || reference.kind === "text"
      ? reference.kind
      : null;
  const key = trimmedString(reference.key, 240);
  const selector = trimmedString(reference.selector, 500);
  if (!kind || !key || !selector) {
    return null;
  }

  return {
    kind,
    key,
    selector,
    label: trimmedString(reference.label, 160) || "Reference",
    preview: trimmedString(reference.preview, 500),
    tagName: trimmedString(reference.tagName, 80) || undefined,
    text: trimmedString(reference.text, 2_000) || undefined,
    html: rawString(reference.html, 8_000) || undefined
  };
}

export function normalizeArtifactEditReferences(
  input: unknown
): ArtifactEditReference[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const references: ArtifactEditReference[] = [];
  for (const item of input) {
    const reference = normalizeArtifactEditReference(item);
    if (!reference || seen.has(reference.key)) {
      continue;
    }
    seen.add(reference.key);
    references.push(reference);
    if (references.length >= MAX_ARTIFACT_REFERENCES) {
      break;
    }
  }

  return references;
}

export function normalizeArtifactEditRequest(
  input: unknown
): ArtifactEditRequestResult {
  const body =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim()) {
    return {
      ok: false,
      status: 400,
      error: "Artifact source is required."
    };
  }
  if (source.length > MAX_ARTIFACT_SOURCE_LENGTH) {
    return {
      ok: false,
      status: 413,
      error: "Artifact source is too large to edit safely."
    };
  }

  const prompt = trimmedString(body.prompt, MAX_ARTIFACT_PROMPT_LENGTH);
  if (!prompt) {
    return {
      ok: false,
      status: 400,
      error: "Edit prompt is required."
    };
  }

  const references = normalizeArtifactEditReferences(body.references);
  if (!references.length) {
    return {
      ok: false,
      status: 400,
      error: "At least one artifact reference is required."
    };
  }

  return {
    ok: true,
    value: {
      source,
      prompt,
      references,
      apiSettings: body.apiSettings
    }
  };
}
