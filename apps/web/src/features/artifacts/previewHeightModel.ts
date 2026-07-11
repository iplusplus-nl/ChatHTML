export const PREVIEW_HEIGHT_EPSILON = 6;
export const PREVIEW_HEIGHT_SHRINK_SETTLE_MS = 700;

const MIN_PREVIEW_HEIGHT = 32;
const SMALL_SHRINK_PX = 12;

export type PendingPreviewHeightShrink = {
  height: number;
  startedAt: number;
};

export type PreviewHeightDecision = {
  height: number;
  pending: PendingPreviewHeightShrink | null;
  scheduleStartedAt: number | null;
};

function changedHeight(currentHeight: number, nextHeight: number): number {
  return Math.abs(nextHeight - currentHeight) > PREVIEW_HEIGHT_EPSILON
    ? nextHeight
    : currentHeight;
}

export function applyPreviewHeightMeasurement(
  currentHeight: number,
  pending: PendingPreviewHeightShrink | null,
  measuredHeight: number,
  now: number
): PreviewHeightDecision {
  const nextHeight = Math.max(MIN_PREVIEW_HEIGHT, Math.ceil(measuredHeight));

  if (
    nextHeight >= currentHeight ||
    currentHeight - nextHeight <= SMALL_SHRINK_PX
  ) {
    return {
      height: changedHeight(currentHeight, nextHeight),
      pending: null,
      scheduleStartedAt: null
    };
  }

  if (
    !pending ||
    Math.abs(pending.height - nextHeight) > PREVIEW_HEIGHT_EPSILON
  ) {
    return {
      height: currentHeight,
      pending: { height: nextHeight, startedAt: now },
      scheduleStartedAt: now
    };
  }

  if (now - pending.startedAt < PREVIEW_HEIGHT_SHRINK_SETTLE_MS) {
    return {
      height: currentHeight,
      pending,
      scheduleStartedAt: pending.startedAt
    };
  }

  return {
    height: changedHeight(currentHeight, nextHeight),
    pending: null,
    scheduleStartedAt: null
  };
}

export function settlePendingPreviewHeight(
  currentHeight: number,
  pending: PendingPreviewHeightShrink | null,
  now: number
): PreviewHeightDecision {
  if (!pending) {
    return {
      height: currentHeight,
      pending: null,
      scheduleStartedAt: null
    };
  }

  if (now - pending.startedAt < PREVIEW_HEIGHT_SHRINK_SETTLE_MS) {
    return {
      height: currentHeight,
      pending,
      scheduleStartedAt: pending.startedAt
    };
  }

  return {
    height: changedHeight(currentHeight, pending.height),
    pending: null,
    scheduleStartedAt: null
  };
}
