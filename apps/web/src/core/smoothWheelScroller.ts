const WHEEL_SCROLL_TIME_CONSTANT_MS = 45;
const WHEEL_SCROLL_SETTLE_PX = 1;

type ScrollTarget = Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">;

type FrameScheduler = {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(frameId: number): void;
};

export type SmoothWheelScroller = {
  scrollBy(element: ScrollTarget, deltaY: number): void;
  cancel(): void;
};

function browserFrameScheduler(): FrameScheduler {
  return {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId)
  };
}

export function createSmoothWheelScroller(
  scheduler: FrameScheduler = browserFrameScheduler()
): SmoothWheelScroller {
  let element: ScrollTarget | null = null;
  let destination = 0;
  let frameId: number | null = null;
  let previousTimestamp: number | null = null;

  const maximumScrollTop = (target: ScrollTarget) =>
    Math.max(0, target.scrollHeight - target.clientHeight);
  const clampDestination = (target: ScrollTarget, value: number) =>
    Math.max(0, Math.min(value, maximumScrollTop(target)));

  const reset = () => {
    element = null;
    frameId = null;
    previousTimestamp = null;
  };

  const animate = (timestamp: number) => {
    frameId = null;
    if (!element) {
      return;
    }

    destination = clampDestination(element, destination);
    const remaining = destination - element.scrollTop;
    if (Math.abs(remaining) <= WHEEL_SCROLL_SETTLE_PX) {
      element.scrollTop = destination;
      reset();
      return;
    }

    const elapsed =
      previousTimestamp === null
        ? 16
        : Math.max(1, Math.min(32, timestamp - previousTimestamp));
    previousTimestamp = timestamp;
    const progress = 1 - Math.exp(-elapsed / WHEEL_SCROLL_TIME_CONSTANT_MS);
    const positionBeforeStep = element.scrollTop;
    element.scrollTop += remaining * progress;
    if (element.scrollTop === positionBeforeStep) {
      element.scrollTop = destination;
      reset();
      return;
    }
    frameId = scheduler.requestFrame(animate);
  };

  return {
    scrollBy(target, deltaY) {
      if (!Number.isFinite(deltaY) || deltaY === 0) {
        return;
      }

      if (element !== target) {
        if (frameId !== null) {
          scheduler.cancelFrame(frameId);
        }
        element = target;
        destination = target.scrollTop;
        previousTimestamp = null;
        frameId = null;
      }

      destination = clampDestination(target, destination + deltaY);
      if (frameId === null && destination !== target.scrollTop) {
        frameId = scheduler.requestFrame(animate);
      }
    },
    cancel() {
      if (frameId !== null) {
        scheduler.cancelFrame(frameId);
      }
      reset();
    }
  };
}
