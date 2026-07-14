export const measurementSource = `      const HEIGHT_SAFETY_PADDING = 28;
      const HEIGHT_EPSILON = 6;
      const SHRINK_SETTLE_MS = 700;
      const SMALL_SHRINK_PX = 12;
      let lastHeight = 0;
      let pendingShrinkHeight = 0;
      let pendingShrinkStartedAt = 0;
      let pendingShrinkTimer = 0;
      const hasPositionedAncestor = (element, body) => {
        let parent = element.parentElement;
        while (parent && parent !== document.documentElement) {
          if (getComputedStyle(parent).position !== "static") {
            return true;
          }
          if (parent === body) {
            break;
          }
          parent = parent.parentElement;
        }

        return false;
      };
      const isViewportOverlay = (element, body, style) => {
        if (style.position === "fixed") {
          return true;
        }
        if (style.position !== "absolute") {
          return false;
        }

        return !hasPositionedAncestor(element, body);
      };
      const getLayoutBottom = (element, body) => {
        const bodyTop = body.getBoundingClientRect().top;
        const rect = element.getBoundingClientRect();
        return rect.bottom - bodyTop;
      };
      const measureContentHeight = () => {
        const body = document.body;
        if (!body) {
          return 32;
        }

        let maxBottom = body.firstElementChild
          ? 0
          : body.getBoundingClientRect().height;
        body.querySelectorAll("*").forEach((element) => {
          if (
            ["SCRIPT", "STYLE", "TEMPLATE", "LINK", "META", "TITLE"].includes(
              element.tagName
            )
          ) {
            return;
          }

          const rect = element.getBoundingClientRect();
          if (!rect.width && !rect.height) {
            return;
          }

          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "collapse") {
            return;
          }
          if (isViewportOverlay(element, body, style)) {
            return;
          }

          const marginBottom = Number.parseFloat(style.marginBottom) || 0;
          maxBottom = Math.max(
            maxBottom,
            getLayoutBottom(element, body) + marginBottom
          );
        });

        const bodyStyle = getComputedStyle(body);
        const paddingBottom = Number.parseFloat(bodyStyle.paddingBottom) || 0;
        return Math.max(
          32,
          Math.ceil(maxBottom + paddingBottom + HEIGHT_SAFETY_PADDING)
        );
      };
      const clearPendingShrinkTimer = () => {
        if (pendingShrinkTimer) {
          window.clearTimeout(pendingShrinkTimer);
          pendingShrinkTimer = 0;
        }
      };
      const schedulePendingShrinkMeasure = () => {
        if (pendingShrinkTimer || !pendingShrinkStartedAt) {
          return;
        }

        const elapsed = performance.now() - pendingShrinkStartedAt;
        const delay = Math.max(0, SHRINK_SETTLE_MS - elapsed) + 20;
        pendingShrinkTimer = window.setTimeout(() => {
          pendingShrinkTimer = 0;
          measure();
        }, delay);
      };
      const shouldPostHeight = (height, forceShrink = false) => {
        if (!lastHeight) {
          return true;
        }
        if (forceShrink && height < lastHeight) {
          pendingShrinkHeight = 0;
          pendingShrinkStartedAt = 0;
          clearPendingShrinkTimer();
          return true;
        }
        if (height >= lastHeight || lastHeight - height <= SMALL_SHRINK_PX) {
          pendingShrinkHeight = 0;
          pendingShrinkStartedAt = 0;
          clearPendingShrinkTimer();
          return Math.abs(height - lastHeight) > HEIGHT_EPSILON;
        }

        const now = performance.now();
        if (
          !pendingShrinkHeight ||
          Math.abs(height - pendingShrinkHeight) > HEIGHT_EPSILON
        ) {
          pendingShrinkHeight = height;
          pendingShrinkStartedAt = now;
          clearPendingShrinkTimer();
          schedulePendingShrinkMeasure();
          return false;
        }

        if (now - pendingShrinkStartedAt < SHRINK_SETTLE_MS) {
          schedulePendingShrinkMeasure();
          return false;
        }

        clearPendingShrinkTimer();
        return true;
      };
      const measure = (forceShrink = false) => {
        if (!runtimeDocumentLoaded) {
          return;
        }
        const height = measureContentHeight();
        if (height && shouldPostHeight(height, forceShrink)) {
          lastHeight = height;
          pendingShrinkHeight = 0;
          pendingShrinkStartedAt = 0;
          clearPendingShrinkTimer();
          post("resize", "resize", { height });
        }
      };
      const normalizeExternalLinks = () => {
        document.querySelectorAll("a[href]").forEach((anchor) => {
          const href = anchor.getAttribute("href") || "";
          if (/^https?:\\/\\//i.test(href)) {
            anchor.setAttribute("data-streamui-link-bridged", "true");
            anchor.setAttribute("data-streamui-open-url", href);
            anchor.setAttribute("target", "_blank");
            anchor.setAttribute("rel", "noopener noreferrer");
          } else if (anchor.dataset.streamuiLinkBridged === "true") {
            anchor.removeAttribute("data-streamui-link-bridged");
            anchor.removeAttribute("data-streamui-open-url");
          }
        });
      };
      const MAX_ACTION_PROMPT_CHARS = 2000;
      const findPromptAction = (target) => {
        if (!(target instanceof Element)) {
          return null;
        }

        return target.closest("[data-streamui-prompt]");
      };
      const areHostActionsEnabled = () =>
        document.body?.dataset.streamuiActionsEnabled !== "false";
`;
