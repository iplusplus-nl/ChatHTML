export const actionSource = `      const findCapabilityAction = (target) => {
        if (!(target instanceof Element)) {
          return null;
        }

        return target.closest(
          "[data-streamui-copy],[data-streamui-copy-target],[data-streamui-download],[data-streamui-download-target],[data-streamui-open-url]"
        );
      };
      const findTargetText = (selector) => {
        if (!selector) {
          return "";
        }

        try {
          const target = document.querySelector(selector);
          if (!target) {
            return "";
          }
          if ("value" in target && typeof target.value === "string") {
            return target.value;
          }
          return target.textContent || "";
        } catch {
          return "";
        }
      };
      const getCapabilityLabel = (element) => {
        return (
          element.getAttribute("data-streamui-label") ||
          element.textContent ||
          ""
        ).trim().slice(0, 200);
      };
      const getCapabilityText = (element, attributeName, targetAttributeName) => {
        const direct = element.getAttribute(attributeName);
        const targetText = findTargetText(element.getAttribute(targetAttributeName));
        return String(targetText || direct || "")
          .slice(0, MAX_CAPABILITY_TEXT_CHARS);
      };
      const postCapabilityAction = (trigger) => {
        const label = getCapabilityLabel(trigger);

        if (
          trigger.hasAttribute("data-streamui-copy") ||
          trigger.hasAttribute("data-streamui-copy-target")
        ) {
          post("action", "copy", {
            actionType: "copy",
            label,
            text: getCapabilityText(
              trigger,
              "data-streamui-copy",
              "data-streamui-copy-target"
            )
          });
          return true;
        }

        if (
          trigger.hasAttribute("data-streamui-download") ||
          trigger.hasAttribute("data-streamui-download-target")
        ) {
          post("action", "download", {
            actionType: "download",
            filename: trigger.getAttribute("data-streamui-filename") || "",
            label,
            mimeType: trigger.getAttribute("data-streamui-mime-type") || "",
            text: getCapabilityText(
              trigger,
              "data-streamui-download",
              "data-streamui-download-target"
            )
          });
          return true;
        }

        if (trigger.hasAttribute("data-streamui-open-url")) {
          post("action", "open-url", {
            actionType: "open-url",
            label,
            url: String(trigger.getAttribute("data-streamui-open-url") || "")
              .trim()
              .slice(0, 2000)
          });
          return true;
        }

        return false;
      };
      const isActionDisabled = (element) => {
        return (
          element.getAttribute("aria-disabled") === "true" ||
          element.getAttribute("disabled") !== null ||
          Boolean(element.disabled)
        );
      };
      const markActionPending = (element) => {
        const pendingText = element.getAttribute("data-streamui-pending");
        element.setAttribute("aria-busy", "true");
        element.setAttribute("aria-disabled", "true");
        if ("disabled" in element) {
          try {
            element.disabled = true;
          } catch {}
        }
        if (pendingText && typeof element.textContent === "string") {
          element.textContent = pendingText;
        }
      };
      document.addEventListener("pointermove", (event) => {
        if (!selectionModeEnabled) {
          return;
        }

        updateSelectionHover(findSelectableElement(event.target));
      }, true);
      document.addEventListener("pointerleave", () => {
        hideSelectionHover();
      }, true);
      document.addEventListener("selectionchange", () => {
        requestAnimationFrame(updateTextSelectionToolbar);
      });
      document.addEventListener("keyup", () => {
        requestAnimationFrame(updateTextSelectionToolbar);
      });
      document.addEventListener("mouseup", () => {
        requestAnimationFrame(updateTextSelectionToolbar);
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          hideTextSelectionToolbar();
          if (selectionModeEnabled) {
            exitSelectionMode();
          }
        }
      }, true);
      document.addEventListener("click", (event) => {
        if (!event.isTrusted) {
          return;
        }
        if (!selectionModeEnabled) {
          return;
        }
        if (isInternalSelectionElement(event.target)) {
          return;
        }

        const element = findSelectableElement(event.target);
        if (!element) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          exitSelectionMode();
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const payload = createSelectionPayload("element", element);
        if (!payload) {
          return;
        }

        postSelectionPayload(payload);
        setSelectionModeEnabled(false);
        post("selection-mode-change", "selection-mode-change", {
          enabled: false
        });
      }, true);
      document.addEventListener("click", (event) => {
        if (!event.isTrusted) {
          return;
        }
        const capabilityTrigger = findCapabilityAction(event.target);
        if (capabilityTrigger) {
          if (!areHostActionsEnabled()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          if (isActionDisabled(capabilityTrigger)) {
            return;
          }

          event.preventDefault();
          postCapabilityAction(capabilityTrigger);
          return;
        }

        const trigger = findPromptAction(event.target);
        if (!trigger) {
          return;
        }

        if (!areHostActionsEnabled()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        const label = (
          trigger.getAttribute("data-streamui-label") ||
          trigger.textContent ||
          ""
        ).trim();
        const prompt = (
          trigger.getAttribute("data-streamui-prompt") ||
          label
        ).trim().slice(0, MAX_ACTION_PROMPT_CHARS);

        if (!prompt || isActionDisabled(trigger)) {
          return;
        }

        event.preventDefault();
        markActionPending(trigger);
        post("action", prompt, {
          actionType: "prompt",
          prompt,
          label: label.slice(0, 200)
        });
      }, true);
`;
