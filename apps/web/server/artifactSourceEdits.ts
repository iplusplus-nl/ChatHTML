export type ArtifactSourceEdit = {
  find?: string;
  target?: "streamui";
  replace: string;
  occurrence?: number;
  note?: string;
};

export type AppliedArtifactSourceEdit = {
  note?: string;
  occurrence?: number;
  findLength: number;
  replaceLength: number;
};

export type RecoveredArtifactSourceEdits = {
  edits: ArtifactSourceEdit[];
  recovery: "none" | "raw_streamui";
};

const MAX_SOURCE_EDITS = 24;
const MAX_NOTE_LENGTH = 240;
const STREAMUI_BLOCK_PATTERN = /<streamui\b[^>]*>[\s\S]*?<\/streamui>/i;
const PROTOCOL_TAGS = ["sessiontitle", "chat", "streamui"] as const;

function boundedTrimmedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function extractArtifactSourceEditJsonText(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parseArtifactSourceEditModelText(value: string): unknown {
  try {
    return JSON.parse(extractArtifactSourceEditJsonText(value));
  } catch {
    return {};
  }
}

export function normalizeArtifactSourceEdits(input: unknown): ArtifactSourceEdit[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const objectInput = input as Partial<ArtifactSourceEdit> & { edits?: unknown };
  const editsInput = Array.isArray(input)
    ? input
    : Array.isArray(objectInput.edits)
      ? objectInput.edits
      : typeof objectInput.replace === "string"
        ? [objectInput]
        : [];
  if (!editsInput.length) {
    return [];
  }

  const edits: ArtifactSourceEdit[] = [];
  for (const item of editsInput) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const edit = item as Partial<ArtifactSourceEdit>;
    const target = edit.target === "streamui" ? edit.target : undefined;
    const find = typeof edit.find === "string" ? edit.find : "";
    if (typeof edit.replace !== "string" || (!find && target !== "streamui")) {
      continue;
    }

    const occurrence =
      typeof edit.occurrence === "number" && Number.isFinite(edit.occurrence)
        ? Math.max(1, Math.round(edit.occurrence))
        : undefined;
    edits.push({
      ...(find ? { find } : {}),
      ...(target ? { target } : {}),
      replace: edit.replace,
      occurrence,
      note: boundedTrimmedString(edit.note, MAX_NOTE_LENGTH) || undefined
    });
    if (edits.length >= MAX_SOURCE_EDITS) {
      break;
    }
  }

  return edits;
}

function extractStreamUiBlockText(value: string): string {
  return STREAMUI_BLOCK_PATTERN.exec(value)?.[0] ?? "";
}

export function recoverArtifactSourceEditsFromModelText(
  rawModelText: string,
  parsed: unknown
): RecoveredArtifactSourceEdits {
  const edits = normalizeArtifactSourceEdits(parsed);
  if (edits.length) {
    return { edits, recovery: "none" };
  }

  const replacement = extractStreamUiBlockText(rawModelText);
  if (!replacement) {
    return { edits: [], recovery: "none" };
  }

  return {
    edits: [
      {
        target: "streamui",
        replace: replacement,
        note: "Recovered complete streamui replacement from model output."
      }
    ],
    recovery: "raw_streamui"
  };
}

function countOccurrences(source: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index <= source.length) {
    const found = source.indexOf(needle, index);
    if (found < 0) {
      break;
    }
    count += 1;
    index = found + needle.length;
  }

  return count;
}

function findOccurrenceIndex(
  source: string,
  needle: string,
  occurrence: number
): number {
  let index = 0;
  let seen = 0;
  while (index <= source.length) {
    const found = source.indexOf(needle, index);
    if (found < 0) {
      return -1;
    }
    seen += 1;
    if (seen === occurrence) {
      return found;
    }
    index = found + needle.length;
  }

  return -1;
}

function findStreamUiBlockRange(source: string): { start: number; end: number } | null {
  const match = STREAMUI_BLOCK_PATTERN.exec(source);
  if (!match || match.index === undefined) {
    return null;
  }
  return { start: match.index, end: match.index + match[0].length };
}

function countProtocolTags(
  source: string,
  tag: (typeof PROTOCOL_TAGS)[number]
): { open: number; close: number } {
  return {
    open: Array.from(source.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))).length,
    close: Array.from(source.matchAll(new RegExp(`</${tag}>`, "gi"))).length
  };
}

function assertProtocolStructurePreserved(source: string, current: string): void {
  for (const tag of PROTOCOL_TAGS) {
    const before = countProtocolTags(source, tag);
    const after = countProtocolTags(current, tag);
    if (before.open !== after.open || before.close !== after.close) {
      throw new Error(
        `The source edits changed the ${tag} protocol block structure.`
      );
    }
  }

  const originalStreamUi = countProtocolTags(source, "streamui");
  if (
    originalStreamUi.open > 0 &&
    originalStreamUi.open === originalStreamUi.close &&
    !findStreamUiBlockRange(current)
  ) {
    throw new Error("The source edits broke the streamui artifact block.");
  }
}

export function applyArtifactSourceEdits(
  source: string,
  edits: ArtifactSourceEdit[]
): { rawStream: string; applied: AppliedArtifactSourceEdit[] } {
  if (!edits.length) {
    throw new Error("The model did not return any source edits.");
  }

  let current = source;
  const applied: AppliedArtifactSourceEdit[] = [];

  edits.forEach((edit, index) => {
    if (edit.target === "streamui") {
      const range = findStreamUiBlockRange(current);
      if (!range) {
        throw new Error(`Edit ${index + 1} could not find the streamui artifact block.`);
      }
      if (!/<streamui\b/i.test(edit.replace) || !/<\/streamui>/i.test(edit.replace)) {
        throw new Error(`Edit ${index + 1} replacement must include a streamui artifact block.`);
      }
      const existing = current.slice(range.start, range.end);
      if (existing === edit.replace) {
        throw new Error(`Edit ${index + 1} does not change the source.`);
      }
      current = current.slice(0, range.start) + edit.replace + current.slice(range.end);
      applied.push({
        note: edit.note,
        findLength: existing.length,
        replaceLength: edit.replace.length
      });
      return;
    }

    const find = edit.find ?? "";
    if (!find) {
      throw new Error(`Edit ${index + 1} has an empty find string.`);
    }
    if (find === edit.replace) {
      throw new Error(`Edit ${index + 1} does not change the source.`);
    }

    const matches = countOccurrences(current, find);
    if (matches === 0) {
      throw new Error(`Edit ${index + 1} did not match the current source.`);
    }
    if (!edit.occurrence && matches > 1) {
      throw new Error(
        `Edit ${index + 1} matched ${matches} places. The model must specify occurrence.`
      );
    }

    const occurrence =
      edit.occurrence && edit.occurrence > matches && matches === 1
        ? 1
        : edit.occurrence ?? 1;
    if (occurrence > matches) {
      throw new Error(
        `Edit ${index + 1} requested occurrence ${occurrence}, but only ${matches} matched.`
      );
    }

    const start = findOccurrenceIndex(current, find, occurrence);
    if (start < 0) {
      throw new Error(`Edit ${index + 1} could not be applied.`);
    }

    current =
      current.slice(0, start) + edit.replace + current.slice(start + find.length);
    applied.push({
      note: edit.note,
      occurrence:
        edit.occurrence && edit.occurrence > matches ? occurrence : edit.occurrence,
      findLength: find.length,
      replaceLength: edit.replace.length
    });
  });

  if (current === source) {
    throw new Error("The source edits did not change the artifact.");
  }
  assertProtocolStructurePreserved(source, current);

  return { rawStream: current, applied };
}
