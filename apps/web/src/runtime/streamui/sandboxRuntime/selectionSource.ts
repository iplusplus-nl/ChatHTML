export const selectionSource = `      const MAX_SELECTION_PREVIEW_CHARS = 360;
      const MAX_SELECTION_TEXT_CHARS = 2000;
      const MAX_SELECTION_HTML_CHARS = 12000;
      const selectionSkipTags = new Set([
        "HTML",
        "BODY",
        "HEAD",
        "SCRIPT",
        "STYLE",
        "TEMPLATE",
        "LINK",
        "META",
        "TITLE"
      ]);
      let selectionModeEnabled = false;
      let selectionHoverTarget = null;
      let selectedSelectionTargets = [];
      let busySelectionTargets = [];
      let hoverOverlay = null;
      let selectedOverlayLayer = null;
      let busyOverlayLayer = null;
      let textSelectionToolbar = null;
      let textSelectionRange = null;
      let textSelectionPayload = null;
      let textSelectionToolbarPointerDown = false;

      const compactSelectionText = (value) =>
        String(value || "").replace(/\\s+/g, " ").trim();
      const truncateSelectionText = (value, limit) =>
        compactSelectionText(value).slice(0, limit);
      const isSafeCssIdentifier = (value) =>
        /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(String(value || ""));
      const isInternalSelectionElement = (element) =>
        Boolean(
          element?.closest?.(
            ".streamui-selection-hover,.streamui-selection-selected,.streamui-selection-busy,.streamui-text-selection-toolbar"
          )
        );
      const OVERSIZED_SELECTION_EDGE_TOLERANCE = 32;
      const OVERSIZED_SELECTION_AREA_RATIO = 0.86;
      const coversIframeViewport = (rect) => {
        const viewportWidth = Math.max(
          1,
          document.documentElement?.clientWidth || window.innerWidth
        );
        const viewportHeight = Math.max(
          1,
          document.documentElement?.clientHeight || window.innerHeight
        );
        return (
          rect.left <= 1 &&
          rect.top <= 1 &&
          rect.width >= viewportWidth - 2 &&
          rect.height >= viewportHeight - 2
        );
      };
      const isOversizedSelectionTarget = (element) => {
        if (!(element instanceof Element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const viewportWidth = Math.max(
          1,
          document.documentElement?.clientWidth || window.innerWidth
        );
        const viewportHeight = Math.max(
          1,
          document.documentElement?.clientHeight || window.innerHeight
        );
        const visibleLeft = Math.max(0, rect.left);
        const visibleTop = Math.max(0, rect.top);
        const visibleRight = Math.min(viewportWidth, rect.right);
        const visibleBottom = Math.min(viewportHeight, rect.bottom);
        const visibleWidth = Math.max(0, visibleRight - visibleLeft);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visibleAreaRatio =
          (visibleWidth * visibleHeight) / (viewportWidth * viewportHeight);
        const nearlyFullWidth =
          rect.left <= OVERSIZED_SELECTION_EDGE_TOLERANCE &&
          rect.right >= viewportWidth - OVERSIZED_SELECTION_EDGE_TOLERANCE;
        const nearlyFullHeight =
          rect.top <= OVERSIZED_SELECTION_EDGE_TOLERANCE &&
          rect.bottom >= viewportHeight - OVERSIZED_SELECTION_EDGE_TOLERANCE;

        return (
          coversIframeViewport(rect) ||
          (nearlyFullWidth && nearlyFullHeight) ||
          (visibleAreaRatio >= OVERSIZED_SELECTION_AREA_RATIO &&
            visibleWidth >= viewportWidth * 0.75 &&
            visibleHeight >= viewportHeight * 0.75)
        );
      };
      const isElementVisibleForSelection = (element) => {
        if (!(element instanceof Element) || selectionSkipTags.has(element.tagName)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
          return false;
        }
        if (isOversizedSelectionTarget(element)) {
          return false;
        }

        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const findSelectableElement = (target) => {
        let element =
          target instanceof Element
            ? target
            : target?.parentElement instanceof Element
              ? target.parentElement
              : null;

        while (element && element !== document.body) {
          if (
            !isInternalSelectionElement(element) &&
            isElementVisibleForSelection(element)
          ) {
            return element;
          }
          element = element.parentElement;
        }

        return null;
      };
      const getNthOfType = (element) => {
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === element.tagName) {
            index += 1;
          }
          sibling = sibling.previousElementSibling;
        }
        return index;
      };
      const hasSameTagSibling = (element) => {
        const parent = element.parentElement;
        if (!parent) {
          return false;
        }

        return Array.from(parent.children).some(
          (child) => child !== element && child.tagName === element.tagName
        );
      };
      const getElementSelector = (element) => {
        if (!(element instanceof Element) || !document.body?.contains(element)) {
          return "";
        }

        const parts = [];
        let current = element;
        while (current && current !== document.body) {
          const tagName = current.tagName.toLowerCase();
          let part = tagName;
          const id = current.getAttribute("id") || "";

          if (id && isSafeCssIdentifier(id)) {
            part += "#" + id;
            return part;
          }

          const classNames = Array.from(current.classList || [])
            .filter(
              (className) =>
                isSafeCssIdentifier(className) &&
                !className.startsWith("streamui-selection")
            )
            .slice(0, 2);
          if (classNames.length) {
            part += "." + classNames.join(".");
          }
          if (!classNames.length || hasSameTagSibling(current)) {
            part += ":nth-of-type(" + getNthOfType(current) + ")";
          }
          parts.unshift(part);
          current = current.parentElement;
        }

        return parts.length ? "body > " + parts.join(" > ") : "";
      };
      const getElementLabel = (element) => {
        const tagName = element.tagName.toLowerCase();
        const id = element.getAttribute("id");
        const classNames = Array.from(element.classList || [])
          .filter(
            (className) =>
              !className.startsWith("streamui-selection") &&
              isSafeCssIdentifier(className)
          )
          .slice(0, 2);
        return (
          tagName +
          (id && isSafeCssIdentifier(id) ? "#" + id : "") +
            (classNames.length ? "." + classNames.join(".") : "")
        );
      };
      const textHiddenTags = new Set([
        "SCRIPT",
        "STYLE",
        "TEMPLATE",
        "NOSCRIPT"
      ]);
      const isElementHiddenForSelectionText = (element, root) => {
        let current = element;
        while (current && current instanceof Element && current !== root.parentElement) {
          if (
            textHiddenTags.has(current.tagName) ||
            current.getAttribute("aria-hidden") === "true" ||
            isInternalSelectionElement(current)
          ) {
            return true;
          }

          const style = getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse"
          ) {
            return true;
          }

          if (current === root) {
            break;
          }
          current = current.parentElement;
        }

        return false;
      };
      const normalizeCssGeneratedText = (value) => {
        const content = String(value || "").trim();
        if (!content || content === "none" || content === "normal") {
          return "";
        }

        return content
          .replace(/^["']|["']$/g, "")
          .replace(/\\\\A/g, " ")
          .replace(/\\\\0000a/gi, " ");
      };
      const isDomLikeSelectionLabel = (value) =>
        /^[a-z][a-z0-9-]*(?:[#.:\[][^\s]*)?$/i.test(compactSelectionText(value));
      const getSelectionPreviewFromHtml = (html) => {
        if (!html) {
          return "";
        }

        const template = document.createElement("template");
        template.innerHTML = String(html || "");
        template.content
          .querySelectorAll("script,style,template,noscript,[aria-hidden='true']")
          .forEach((node) => node.remove());

        const root = template.content.firstElementChild;
        if (!root) {
          return truncateSelectionText(
            template.content.textContent,
            MAX_SELECTION_PREVIEW_CHARS
          );
        }

        const controlValue =
          "value" in root && typeof root.value === "string" ? root.value : "";
        const text =
          controlValue ||
          root.getAttribute("aria-label") ||
          root.getAttribute("title") ||
          root.textContent ||
          "";
        return truncateSelectionText(text, MAX_SELECTION_PREVIEW_CHARS);
      };
      const getPseudoElementText = (element) =>
        compactSelectionText(
          normalizeCssGeneratedText(getComputedStyle(element, "::before").content) +
            " " +
            normalizeCssGeneratedText(getComputedStyle(element, "::after").content)
        );
      const getVisibleElementText = (element) => {
        if (!(element instanceof Element)) {
          return "";
        }

        const parts = [];
        const pushText = (value) => {
          const text = compactSelectionText(value);
          if (!text) {
            return;
          }
          parts.push(text);
        };

        pushText(getPseudoElementText(element));

        const elementWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode(node) {
              return node instanceof Element &&
                !isElementHiddenForSelectionText(node, element)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            }
          }
        );
        let elementNode = elementWalker.nextNode();
        while (elementNode) {
          pushText(getPseudoElementText(elementNode));
          elementNode = elementWalker.nextNode();
        }

        const walker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const text = compactSelectionText(node.nodeValue);
              const parent = node.parentElement;
              if (!text || !parent) {
                return NodeFilter.FILTER_REJECT;
              }

              return isElementHiddenForSelectionText(parent, element)
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        let node = walker.nextNode();
        while (node) {
          pushText(node.nodeValue);
          if (parts.join(" ").length >= MAX_SELECTION_PREVIEW_CHARS) {
            break;
          }
          node = walker.nextNode();
        }

        if (!parts.length && typeof element.textContent === "string") {
          pushText(element.textContent);
        }

        return truncateSelectionText(parts.join(" "), MAX_SELECTION_PREVIEW_CHARS);
      };
      const getElementPreview = (element) => {
        if ("value" in element && typeof element.value === "string") {
          return truncateSelectionText(element.value, MAX_SELECTION_PREVIEW_CHARS);
        }

        const visibleText = getVisibleElementText(element);
        const htmlText = getSelectionPreviewFromHtml(element.outerHTML || "");
        const accessibleText =
          visibleText ||
          htmlText ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("alt") ||
          element.textContent ||
          element.getAttribute("src") ||
          "";
        return truncateSelectionText(accessibleText, MAX_SELECTION_PREVIEW_CHARS);
      };
      const resolveSelectedTarget = (target) => {
        if (!target || typeof target.selector !== "string") {
          return null;
        }

        try {
          const element = document.querySelector(target.selector);
          if (element) {
            return element;
          }

          const legacyIdSelector = /^body\s*>\s*([a-z][a-z0-9-]*#[a-zA-Z_-][a-zA-Z0-9_-]*)$/i.exec(
            target.selector
          );
          return legacyIdSelector ? document.querySelector(legacyIdSelector[1]) : null;
        } catch {
          return null;
        }
      };
      const createSelectionOverlay = (className) => {
        if (!document.body) {
          return null;
        }

        const overlay = document.createElement("div");
        overlay.className = className;
        document.body.appendChild(overlay);
        return overlay;
      };
      const placeSelectionOverlay = (overlay, element) => {
        if (!overlay || !(element instanceof Element)) {
          return;
        }

        const rect = element.getBoundingClientRect();
        if (
          rect.width < 1 ||
          rect.height < 1 ||
          rect.bottom < 0 ||
          rect.right < 0 ||
          rect.top > window.innerHeight ||
          rect.left > window.innerWidth
        ) {
          overlay.style.display = "none";
          return;
        }

        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        overlay.style.display = "block";
        overlay.style.left = left + "px";
        overlay.style.top = top + "px";
        overlay.style.width =
          Math.max(1, Math.min(rect.width, window.innerWidth - left)) + "px";
        overlay.style.height =
          Math.max(1, Math.min(rect.height, window.innerHeight - top)) + "px";
      };
      const hideSelectionHover = () => {
        selectionHoverTarget = null;
        if (hoverOverlay) {
          hoverOverlay.style.display = "none";
        }
      };
      const updateSelectionHover = (element) => {
        if (!selectionModeEnabled || !element) {
          hideSelectionHover();
          return;
        }

        selectionHoverTarget = element;
        if (!hoverOverlay) {
          hoverOverlay = createSelectionOverlay("streamui-selection-hover");
        }
        placeSelectionOverlay(hoverOverlay, element);
      };
      const renderSelectedSelectionTargets = () => {
        if (!document.body) {
          return;
        }

        if (!selectedOverlayLayer) {
          selectedOverlayLayer = document.createElement("div");
          selectedOverlayLayer.setAttribute("aria-hidden", "true");
          document.body.appendChild(selectedOverlayLayer);
        }

        selectedOverlayLayer.replaceChildren();
        selectedSelectionTargets.forEach((target) => {
          const element = resolveSelectedTarget(target);
          if (!element || isOversizedSelectionTarget(element)) {
            return;
          }

          const overlay = createSelectionOverlay("streamui-selection-selected");
          if (!overlay) {
            return;
          }
          selectedOverlayLayer.appendChild(overlay);
          placeSelectionOverlay(overlay, element);
        });
      };
      const renderBusySelectionTargets = () => {
        if (!document.body) {
          return;
        }

        if (!busyOverlayLayer) {
          busyOverlayLayer = document.createElement("div");
          busyOverlayLayer.setAttribute("aria-hidden", "true");
          document.body.appendChild(busyOverlayLayer);
        }

        busyOverlayLayer.replaceChildren();
        busySelectionTargets.forEach((target) => {
          const element = resolveSelectedTarget(target);
          if (!element || isOversizedSelectionTarget(element)) {
            return;
          }

          const overlay = createSelectionOverlay("streamui-selection-busy");
          if (!overlay) {
            return;
          }
          busyOverlayLayer.appendChild(overlay);
          placeSelectionOverlay(overlay, element);
        });
      };
      const createSelectionPayload = (kind, element, selectedText = "") => {
        if (!(element instanceof Element) || isOversizedSelectionTarget(element)) {
          return null;
        }

        const selector = getElementSelector(element);
        if (!selector) {
          return null;
        }

        const normalizedText = truncateSelectionText(
          selectedText,
          MAX_SELECTION_TEXT_CHARS
        );
        const preview =
          kind === "text"
            ? normalizedText
            : getElementPreview(element);
        const key =
          kind +
          ":" +
          selector +
          (kind === "text" ? ":" + normalizedText.slice(0, 160) : "");
        const payload = {
          kind,
          key,
          selector,
          label:
            kind === "text"
              ? "Text in " + getElementLabel(element)
              : getElementLabel(element),
          preview: preview || getElementLabel(element),
          tagName: element.tagName.toLowerCase(),
          html: String(element.outerHTML || "").slice(0, MAX_SELECTION_HTML_CHARS)
        };

        if (normalizedText) {
          payload.text = normalizedText;
        }

        return payload;
      };
      const postSelectionPayload = (payload) => {
        if (!payload || !areHostActionsEnabled()) {
          return;
        }

        post("selection", "selection", { selection: payload });
      };
      const setSelectionModeEnabled = (enabled) => {
        selectionModeEnabled = Boolean(enabled) && areHostActionsEnabled();
        if (document.body) {
          document.body.dataset.streamuiSelectionMode = selectionModeEnabled
            ? "true"
            : "false";
        }
        if (!selectionModeEnabled) {
          hideSelectionHover();
        }
      };
      const exitSelectionMode = () => {
        setSelectionModeEnabled(false);
        post("selection-mode-change", "selection-mode-change", {
          enabled: false
        });
      };
      const hideTextSelectionToolbar = () => {
        textSelectionRange = null;
        textSelectionPayload = null;
        if (textSelectionToolbar) {
          textSelectionToolbar.style.display = "none";
        }
      };
      const hasActiveTextSelection = () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
          return Boolean(truncateSelectionText(selection.toString(), 80));
        }
        return Boolean(
          textSelectionPayload &&
            textSelectionToolbar &&
            textSelectionToolbar.style.display !== "none"
        );
      };
      const ensureTextSelectionToolbar = () => {
        if (textSelectionToolbar) {
          return textSelectionToolbar;
        }
        if (!document.body) {
          return null;
        }

        textSelectionToolbar = document.createElement("div");
        textSelectionToolbar.className = "streamui-text-selection-toolbar";
        textSelectionToolbar.setAttribute("role", "toolbar");
        textSelectionToolbar.setAttribute("aria-label", "Preview selection");
        textSelectionToolbar.innerHTML =
          '<span class="streamui-text-selection-preview"></span>' +
          '<button type="button" data-selection-kind="text">Reference</button>';
        const holdTextSelectionForToolbarClick = () => {
          textSelectionToolbarPointerDown = true;
          window.setTimeout(() => {
            textSelectionToolbarPointerDown = false;
          }, 600);
        };
        textSelectionToolbar.addEventListener("pointerdown", (event) => {
          holdTextSelectionForToolbarClick();
          event.preventDefault();
          event.stopPropagation();
        });
        textSelectionToolbar.addEventListener("mousedown", (event) => {
          holdTextSelectionForToolbarClick();
          event.preventDefault();
          event.stopPropagation();
        });
        textSelectionToolbar.addEventListener("click", (event) => {
          if (!event.isTrusted) {
            return;
          }
          const button = event.target?.closest?.("[data-selection-kind]");
          if (!button) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          const kind = button.getAttribute("data-selection-kind") || "text";
          let payload = null;
          if (textSelectionRange) {
            const commonNode = textSelectionRange.commonAncestorContainer;
            const owner = findSelectableElement(commonNode);
            const selectedText = textSelectionRange.toString();
            if (owner) {
              payload = createSelectionPayload(kind, owner, selectedText);
            }
          }
          if (!payload && kind === "text") {
            payload = textSelectionPayload;
          }
          postSelectionPayload(payload);
          window.getSelection()?.removeAllRanges();
          textSelectionToolbarPointerDown = false;
          hideTextSelectionToolbar();
        });
        document.body.appendChild(textSelectionToolbar);
        return textSelectionToolbar;
      };
      const updateTextSelectionToolbar = () => {
        if (!areHostActionsEnabled()) {
          hideTextSelectionToolbar();
          return;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount < 1 || selection.isCollapsed) {
          if (textSelectionToolbarPointerDown && textSelectionPayload) {
            return;
          }
          hideTextSelectionToolbar();
          return;
        }

        const selectedText = truncateSelectionText(
          selection.toString(),
          MAX_SELECTION_TEXT_CHARS
        );
        if (!selectedText) {
          if (textSelectionToolbarPointerDown && textSelectionPayload) {
            return;
          }
          hideTextSelectionToolbar();
          return;
        }

        const range = selection.getRangeAt(0).cloneRange();
        if (!document.body?.contains(range.commonAncestorContainer)) {
          if (textSelectionToolbarPointerDown && textSelectionPayload) {
            return;
          }
          hideTextSelectionToolbar();
          return;
        }
        const owner = findSelectableElement(range.commonAncestorContainer);
        const payload = owner
          ? createSelectionPayload("text", owner, selectedText)
          : null;
        if (!payload) {
          if (textSelectionToolbarPointerDown && textSelectionPayload) {
            return;
          }
          hideTextSelectionToolbar();
          return;
        }

        const rect =
          Array.from(range.getClientRects()).find(
            (item) => item.width > 0 && item.height > 0
          ) || range.getBoundingClientRect();
        if (!rect || (rect.width < 1 && rect.height < 1)) {
          hideTextSelectionToolbar();
          return;
        }

        const toolbar = ensureTextSelectionToolbar();
        if (!toolbar) {
          return;
        }

        textSelectionRange = range;
        textSelectionPayload = payload;
        textSelectionToolbarPointerDown = false;
        const preview = toolbar.querySelector(".streamui-text-selection-preview");
        if (preview) {
          preview.textContent = selectedText;
        }
        toolbar.style.display = "flex";
        const toolbarRect = toolbar.getBoundingClientRect();
        const left = Math.min(
          Math.max(8, rect.right - toolbarRect.width),
          Math.max(8, window.innerWidth - toolbarRect.width - 8)
        );
        const top =
          rect.top - toolbarRect.height - 8 >= 8
            ? rect.top - toolbarRect.height - 8
            : Math.min(rect.bottom + 8, window.innerHeight - toolbarRect.height - 8);
        toolbar.style.left = left + "px";
        toolbar.style.top = Math.max(8, top) + "px";
      };
      window.addEventListener("message", (event) => {
        if (!event.isTrusted || event.source !== window.parent) {
          return;
        }
        const data = event.data || {};
        if (
          data.source !== "streamui-host" ||
          data.documentEpoch !== HOST_DOCUMENT_EPOCH
        ) {
          return;
        }
        if (data.kind === "selection-mode") {
          setSelectionModeEnabled(Boolean(data.enabled));
          renderSelectedSelectionTargets();
          return;
        }

        if (data.kind === "selection-targets") {
          selectedSelectionTargets = Array.isArray(data.targets)
            ? data.targets
                .filter(
                  (target) =>
                    target &&
                    typeof target.selector === "string" &&
                    (target.kind === "element" || target.kind === "text")
                )
                .slice(0, 16)
            : [];
          renderSelectedSelectionTargets();
          return;
        }

        if (data.kind === "selection-busy-targets") {
          busySelectionTargets = Array.isArray(data.targets)
            ? data.targets
                .filter(
                  (target) =>
                    target &&
                    typeof target.selector === "string" &&
                    (target.kind === "element" || target.kind === "text")
                )
                .slice(0, 16)
            : [];
          renderBusySelectionTargets();
        }
      });
`;
