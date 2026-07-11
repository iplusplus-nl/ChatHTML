export function buildCoreSource(
  MATHJAX_SCRIPT_SRC: string,
  hostChannelToken: string,
  hostDocumentEpoch: string
): string {
  const hostChannelTokenLiteral = JSON.stringify(hostChannelToken);
  const hostDocumentEpochLiteral = JSON.stringify(hostDocumentEpoch);
  return `    (() => {
      const HOST_CHANNEL_TOKEN = ${hostChannelTokenLiteral};
      const HOST_DOCUMENT_EPOCH = ${hostDocumentEpochLiteral};
      const postToParent = window.parent.postMessage.bind(window.parent);
      const post = (kind, message, extra = {}) => {
        try {
          postToParent({
            source: "streamui-runtime",
            channelToken: HOST_CHANNEL_TOKEN,
            kind,
            message: String(message || "Unknown runtime event"),
            ...extra
          }, "*");
        } catch {}
      };
      const canScrollInDirection = (element, deltaY, requireScrollableStyle) => {
        if (!(element instanceof Element)) {
          return false;
        }

        if (requireScrollableStyle) {
          const overflowY = getComputedStyle(element).overflowY;
          if (!/^(auto|scroll|overlay)$/.test(overflowY)) {
            return false;
          }
        }

        const maxScrollTop = element.scrollHeight - element.clientHeight;
        if (maxScrollTop <= 1) {
          return false;
        }

        return deltaY < 0
          ? element.scrollTop > 1
          : element.scrollTop < maxScrollTop - 1;
      };
      const canPreviewConsumeWheel = (target, deltaY) => {
        let element = target instanceof Element ? target : target?.parentElement;
        while (element && element !== document.documentElement) {
          if (canScrollInDirection(element, deltaY, true)) {
            return true;
          }
          element = element.parentElement;
        }

        return canScrollInDirection(document.scrollingElement, deltaY, false);
      };
      document.addEventListener("wheel", (event) => {
        const deltaY = Number(event.deltaY) || 0;
        if (!deltaY || event.ctrlKey || canPreviewConsumeWheel(event.target, deltaY)) {
          return;
        }

        post("wheel", "wheel", {
          deltaY,
          deltaMode: event.deltaMode
        });
      }, { passive: true });
      const MATHJAX_SCRIPT_SRC = "${MATHJAX_SCRIPT_SRC}";
      window.MathJax = {
        tex: {
          inlineMath: [["\\\\(", "\\\\)"]],
          displayMath: [["\\\\[", "\\\\]"], ["$$", "$$"]],
          processEscapes: true
        },
        options: {
          skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]
        },
        startup: {
          typeset: false
        }
      };
      const MAX_CAPABILITY_TEXT_CHARS = 1000000;
      const pendingHostCapabilities = new Map();
      let hostCapabilitySequence = 0;
      const createHostCapabilityId = () =>
        "capability-" + Date.now().toString(36) + "-" + (++hostCapabilitySequence).toString(36);
      const postHostCapability = (actionType, payload = {}) => {
        const capabilityId = createHostCapabilityId();
        const request = new Promise((resolve, reject) => {
          pendingHostCapabilities.set(capabilityId, { resolve, reject });
        });
        post("action", actionType, {
          actionType,
          capabilityId,
          ...payload
        });
        return request;
      };
      let scheduledMeasureFrame = 0;
      let mathJaxScriptRequested = false;
      let mathJaxTypesetFrame = 0;
      let mathJaxTypesetting = false;
      let mathJaxTypesetAgain = false;
      const scheduleMeasure = () => {
        if (scheduledMeasureFrame) {
          return;
        }

        scheduledMeasureFrame = requestAnimationFrame(() => {
          scheduledMeasureFrame = 0;
          normalizeExternalLinks();
          measure();
        });
      };
      const bodyContainsMathDelimiters = () => {
        const text = document.body ? document.body.textContent || "" : "";
        return (
          text.includes("\\\\(") ||
          text.includes("\\\\[") ||
          text.includes("$$")
        );
      };
      const isPreviewComplete = () =>
        document.body?.dataset.streamuiActionsEnabled !== "false";
      const ensureMathJax = () => {
        const mathJax = window.MathJax;
        if (mathJax && typeof mathJax.typesetPromise === "function") {
          return true;
        }

        if (mathJaxScriptRequested || !bodyContainsMathDelimiters()) {
          return false;
        }

        mathJaxScriptRequested = true;
        const script = document.createElement("script");
        script.id = "streamui-mathjax";
        script.src = MATHJAX_SCRIPT_SRC;
        script.async = true;
        script.onload = () => scheduleMathTypeset();
        script.onerror = () => post("runtime", "MathJax could not be loaded.");
        document.head.appendChild(script);
        return false;
      };
      const scheduleMathTypeset = () => {
        if (!isPreviewComplete() || !bodyContainsMathDelimiters()) {
          return;
        }

        if (mathJaxTypesetFrame) {
          return;
        }

        mathJaxTypesetFrame = requestAnimationFrame(() => {
          mathJaxTypesetFrame = 0;
          if (!bodyContainsMathDelimiters()) {
            return;
          }

          if (!ensureMathJax()) {
            return;
          }

          const mathJax = window.MathJax;
          if (!mathJax || typeof mathJax.typesetPromise !== "function") {
            return;
          }

          if (mathJaxTypesetting) {
            mathJaxTypesetAgain = true;
            return;
          }

          mathJaxTypesetting = true;
          Promise.resolve(mathJax.typesetPromise([document.body]))
            .catch((error) => {
              const message =
                error && (error.message || error.toString)
                  ? error.message || error.toString()
                  : "MathJax typesetting failed.";
              post("runtime", message);
            })
            .finally(() => {
              mathJaxTypesetting = false;
              scheduleMeasure();
              if (mathJaxTypesetAgain) {
                mathJaxTypesetAgain = false;
                scheduleMathTypeset();
              }
            });
        });
      };
      window.streamuiTypesetMath = scheduleMathTypeset;
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
        if (data.kind === "measure") {
          scheduleMeasure();
          return;
        }

        if (
          data.kind !== "capability-result" ||
          typeof data.capabilityId !== "string"
        ) {
          return;
        }

        const pending = pendingHostCapabilities.get(data.capabilityId);
        if (!pending) {
          return;
        }

        pendingHostCapabilities.delete(data.capabilityId);
        if (data.ok) {
          pending.resolve();
        } else {
          pending.reject(new DOMException(
            String(data.message || "The host rejected this capability request."),
            "NotAllowedError"
          ));
        }
      });
      const bridgedClipboardWriteText = (text) => {
        return postHostCapability("copy", {
          label: "Clipboard write",
          text: String(text ?? "").slice(0, MAX_CAPABILITY_TEXT_CHARS)
        });
      };
      const installClipboardBridge = () => {
        try {
          if (navigator.clipboard) {
            Object.defineProperty(navigator.clipboard, "writeText", {
              configurable: true,
              value: bridgedClipboardWriteText
            });
            Object.defineProperty(navigator.clipboard, "readText", {
              configurable: true,
              value: () => Promise.reject(new DOMException(
                "Clipboard reads are not available inside ChatHTML artifacts.",
                "NotAllowedError"
              ))
            });
            return;
          }
        } catch {}

        try {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: bridgedClipboardWriteText,
              readText: () => Promise.reject(new DOMException(
                "Clipboard reads are not available inside ChatHTML artifacts.",
                "NotAllowedError"
              ))
            }
          });
        } catch {}
      };
      installClipboardBridge();
      const isExtensionNoise = (message = "", filename = "") => {
        const text = String(message || "").toLowerCase();
        const file = String(filename || "").toLowerCase();
        const extensionSource =
          file.includes("zotero") ||
          file.includes("safari-web-extension:") ||
          file.includes("moz-extension:") ||
          file.includes("chrome-extension:") ||
          file.includes("extension://");
        const basename = file.split(/[\\\\/]/).pop() || file;
        const injectedScript =
          basename === "inject.js" || basename === "inject_safari.js";

        if (text.includes("zotero") || text.includes("reportactiveurl")) {
          return true;
        }
        if (extensionSource) {
          return true;
        }
        if (
          injectedScript &&
          (text.includes("sandbox access violation") ||
            text.includes("zotero.connector"))
        ) {
          return true;
        }

        return false;
      };
`;
}
