import { readabilityColorMathSource } from "./readabilityColorMathSource";

export const readabilitySource = String.raw`${readabilityColorMathSource}
      const READABILITY_TEXT_RATIO = 4.5;
      const READABILITY_LARGE_TEXT_RATIO = 3;
      const READABILITY_GRAPHIC_RATIO = 3;
      const READABILITY_DEBOUNCE_MS = 350;
      const READABILITY_MAX_WAIT_MS = 1500;
      const READABILITY_NODE_LIMIT = 1400;
      const READABILITY_FINDING_LIMIT = 12;
      const READABILITY_DECORATIVE_SELECTOR =
        '[aria-hidden="true"], [role="presentation"], [data-streamui-decorative]';
      const READABILITY_INTERNAL_SELECTOR =
        '.streamui-selection-hover, .streamui-selection-selected, .streamui-selection-busy, .streamui-text-selection-toolbar';
      const readabilityColorCache = new Map();
      let readabilityColorContext = null;
      let readabilityAuditTimer = 0;
      let readabilityAuditStartedAt = 0;
      let lastReadabilitySignature = "";

      const cloneReadabilityColor = (color) =>
        color ? { r: color.r, g: color.g, b: color.b, a: color.a } : null;

      const parseRenderedReadabilityColor = (value) => {
        const input = String(value || "").trim();
        if (!input) {
          return null;
        }
        if (readabilityColorCache.has(input)) {
          return cloneReadabilityColor(readabilityColorCache.get(input));
        }

        let color = parseReadabilityColor(input);
        if (
          !color &&
          input.toLowerCase() !== "none" &&
          typeof CSS !== "undefined" &&
          CSS.supports("color", input)
        ) {
          try {
            if (!readabilityColorContext) {
              const canvas = document.createElement("canvas");
              canvas.width = 1;
              canvas.height = 1;
              readabilityColorContext = canvas.getContext("2d", {
                willReadFrequently: true
              });
            }
            const context = readabilityColorContext;
            if (context) {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = input;
              context.fillRect(0, 0, 1, 1);
              const pixel = context.getImageData(0, 0, 1, 1).data;
              color = {
                r: pixel[0],
                g: pixel[1],
                b: pixel[2],
                a: pixel[3] / 255
              };
            }
          } catch {}
        }

        if (readabilityColorCache.size >= 256) {
          readabilityColorCache.clear();
        }
        readabilityColorCache.set(input, cloneReadabilityColor(color));
        return color;
      };

      const isReadabilityExcluded = (element) => {
        if (!(element instanceof Element)) {
          return true;
        }
        return Boolean(
          element.closest(READABILITY_DECORATIVE_SELECTOR) ||
          element.closest(READABILITY_INTERNAL_SELECTOR) ||
          element.closest("script, style, noscript, template, defs, clipPath, mask, pattern, marker")
        );
      };

      const isReadabilityVisible = (element) => {
        if (!(element instanceof Element) || isReadabilityExcluded(element)) {
          return false;
        }
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number.parseFloat(style.opacity || "1") <= 0.01 ||
          effectiveReadabilityOpacity(element) <= 0.01
        ) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0.5 || rect.height > 0.5;
      };

      const readabilityTarget = (element) => {
        if (!(element instanceof Element)) {
          return "unknown";
        }
        const parts = [];
        let current = element;
        for (let depth = 0; current instanceof Element && depth < 4; depth += 1) {
          if (current.id) {
            parts.unshift("#" + String(current.id).slice(0, 100));
            break;
          }
          const classes = Array.from(current.classList || [])
            .filter((name) => !name.startsWith("streamui-selection"))
            .slice(0, 2);
          if (classes.length) {
            parts.unshift(current.localName + "." + classes.join("."));
            break;
          }
          const parent = current.parentElement;
          if (!parent) {
            parts.unshift(current.localName);
            break;
          }
          const siblings = Array.from(parent.children).filter(
            (child) => child.localName === current.localName
          );
          const position = Math.max(1, siblings.indexOf(current) + 1);
          parts.unshift(current.localName + ":nth-of-type(" + position + ")");
          current = parent;
        }
        return parts.join(" > ").slice(0, 300) || element.localName;
      };

      const effectiveReadabilityOpacity = (element) => {
        let opacity = 1;
        let current = element;
        while (current instanceof Element) {
          const value = Number.parseFloat(getComputedStyle(current).opacity || "1");
          if (Number.isFinite(value)) {
            opacity *= Math.min(1, Math.max(0, value));
          }
          current = current.parentElement;
        }
        return opacity;
      };

      const readabilityPageBackground = () =>
        parseRenderedReadabilityColor(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--streamui-page-bg"
          )
        ) || { r: 255, g: 255, b: 255, a: 1 };

      const resolveReadabilityBackdrop = (element) => {
        const chain = [];
        let current = element;
        while (current instanceof Element) {
          chain.push(current);
          current = current.parentElement;
        }
        chain.reverse();

        let color = readabilityPageBackground();
        let uncertain = false;
        let uncertainCompositingGroup = false;
        for (const layer of chain) {
          const style = getComputedStyle(layer);
          const backgroundImage = String(style.backgroundImage || "none");
          const layerOpacity = Number.parseFloat(style.opacity || "1");
          const hasComplexCompositing =
            (Number.isFinite(layerOpacity) && layerOpacity < 0.999) ||
            String(style.mixBlendMode || "normal") !== "normal" ||
            String(style.filter || "none") !== "none" ||
            String(style.backdropFilter || "none") !== "none" ||
            String(style.maskImage || "none") !== "none";
          if (hasComplexCompositing) {
            uncertainCompositingGroup = true;
            uncertain = true;
          }
          if (backgroundImage !== "none") {
            uncertain = true;
          }
          const background = parseRenderedReadabilityColor(style.backgroundColor);
          if (!background || background.a <= 0.001) {
            continue;
          }
          color = compositeReadabilityColor(background, color) || color;
          if (
            background.a >= 0.92 &&
            backgroundImage === "none" &&
            !uncertainCompositingGroup
          ) {
            uncertain = false;
          }
        }
        return { color, uncertain };
      };

      const readabilityPseudoPaintsBackdrop = (element) => {
        for (const pseudo of ["::before", "::after"]) {
          const style = getComputedStyle(element, pseudo);
          const content = String(style.content || "none");
          if (
            content === "none" ||
            content === "normal" ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number.parseFloat(style.opacity || "1") <= 0.01
          ) {
            continue;
          }
          const background = parseRenderedReadabilityColor(style.backgroundColor);
          if (
            (background && background.a > 0.001) ||
            String(style.backgroundImage || "none") !== "none" ||
            String(style.boxShadow || "none") !== "none"
          ) {
            return true;
          }
        }
        return false;
      };

      const readabilityElementPaintsBackdrop = (element) => {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number.parseFloat(style.opacity || "1") <= 0.01
        ) {
          return false;
        }
        const background = parseRenderedReadabilityColor(style.backgroundColor);
        const fill =
          element.namespaceURI === "http://www.w3.org/2000/svg"
            ? parseRenderedReadabilityColor(style.fill)
            : null;
        return Boolean(
          (background && background.a > 0.001) ||
          (fill && fill.a > 0.001) ||
          String(style.backgroundImage || "none") !== "none" ||
          String(style.boxShadow || "none") !== "none" ||
          element.matches("img, canvas, video") ||
          readabilityPseudoPaintsBackdrop(element)
        );
      };

      const hasUnmeasuredReadabilityBackdrop = (element) => {
        let current = element;
        while (current instanceof Element) {
          const currentStyle = getComputedStyle(current);
          if (
            String(currentStyle.boxShadow || "none").includes("inset") ||
            readabilityPseudoPaintsBackdrop(current)
          ) {
            return true;
          }
          current = current.parentElement;
        }

        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || typeof document.elementsFromPoint !== "function") {
          return false;
        }
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));

        let scannedCandidates = 0;
        const candidatePaintsAtPoint = (candidate) => {
          const candidateRect = candidate.getBoundingClientRect();
          return (
            x >= candidateRect.left &&
            x <= candidateRect.right &&
            y >= candidateRect.top &&
            y <= candidateRect.bottom &&
            readabilityElementPaintsBackdrop(candidate)
          );
        };
        current = element;
        for (
          let depth = 0;
          current instanceof Element && current.parentElement && depth < 4;
          depth += 1
        ) {
          const parent = current.parentElement;
          const siblings = Array.from(parent.children).filter(
            (sibling) => sibling !== current && !sibling.contains(element)
          );
          for (const sibling of siblings) {
            scannedCandidates += 1;
            if (scannedCandidates > 80) {
              break;
            }
            if (candidatePaintsAtPoint(sibling)) {
              return true;
            }
          }
          if (scannedCandidates <= 80) {
            for (const sibling of siblings) {
              for (const candidate of Array.from(sibling.children).slice(0, 24)) {
                scannedCandidates += 1;
                if (scannedCandidates > 80) {
                  break;
                }
                if (candidatePaintsAtPoint(candidate)) {
                  return true;
                }
              }
              if (scannedCandidates > 80) {
                break;
              }
            }
          }
          if (scannedCandidates > 80) {
            break;
          }
          current = parent;
        }

        for (const candidate of document.elementsFromPoint(x, y)) {
          if (
            candidate === element ||
            candidate.contains(element) ||
            element.contains(candidate)
          ) {
            continue;
          }
          if (readabilityElementPaintsBackdrop(candidate)) {
            return true;
          }
        }
        return false;
      };

      const isLargeReadabilityText = (style) => {
        const fontSize = Number.parseFloat(style.fontSize || "0");
        const parsedWeight = Number.parseFloat(style.fontWeight || "400");
        const fontWeight = Number.isFinite(parsedWeight)
          ? parsedWeight
          : style.fontWeight === "bold"
            ? 700
            : 400;
        return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      };

      const directReadabilityText = (element) =>
        Array.from(element.childNodes || [])
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" ")
          .slice(0, 120);

      const createReadabilityCollector = () => {
        const groups = new Map();
        let total = 0;
        let truncated = false;
        const add = (finding) => {
          total += 1;
          const ratioKey =
            finding.ratio === null ? "unknown" : finding.ratio.toFixed(2);
          const key = [
            finding.code,
            finding.property,
            ratioKey,
            finding.requiredRatio,
            finding.foreground,
            finding.background
          ].join("|");
          const existing = groups.get(key);
          if (existing) {
            existing.occurrences += 1;
            return;
          }
          if (groups.size < READABILITY_FINDING_LIMIT) {
            groups.set(key, { ...finding, occurrences: 1 });
          } else {
            truncated = true;
          }
        };
        return {
          add,
          result: () => ({
            findings: Array.from(groups.values()),
            total,
            truncated
          })
        };
      };

      const auditReadabilityTextElement = (
        element,
        text,
        collector,
        resolvedStyle
      ) => {
        if (!text || !isReadabilityVisible(element)) {
          return;
        }
        if (element.namespaceURI === "http://www.w3.org/2000/svg") {
          return;
        }
        const style = resolvedStyle || getComputedStyle(element);
        const foreground = parseRenderedReadabilityColor(style.color);
        if (!foreground) {
          return;
        }
        foreground.a *= effectiveReadabilityOpacity(element);
        const backdrop = resolveReadabilityBackdrop(element);
        const requiredRatio = isLargeReadabilityText(style)
          ? READABILITY_LARGE_TEXT_RATIO
          : READABILITY_TEXT_RATIO;
        if (backdrop.uncertain) {
          return;
        }
        const renderedForeground =
          compositeReadabilityColor(foreground, backdrop.color) || foreground;
        const ratio = readabilityContrastRatio(renderedForeground, backdrop.color);
        if (
          ratio !== null &&
          ratio + 0.01 < requiredRatio &&
          !hasUnmeasuredReadabilityBackdrop(element)
        ) {
          collector.add({
            code: "text-contrast",
            target: readabilityTarget(element),
            property: "color",
            ratio,
            requiredRatio,
            foreground: serializeReadabilityColor(renderedForeground),
            background: serializeReadabilityColor(backdrop.color),
            text
          });
        }
      };

      const auditReadabilityText = (collector) => {
        const elements = Array.from(document.body?.querySelectorAll("*") || [])
          .slice(0, READABILITY_NODE_LIMIT);
        for (const element of elements) {
          const text = directReadabilityText(element);
          if (text) {
            auditReadabilityTextElement(element, text, collector);
          }
        }
        const controls = Array.from(
          document.body?.querySelectorAll(
            'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"], input[type="button"], input[type="submit"], input[type="reset"], textarea, select'
          ) || []
        ).slice(0, READABILITY_NODE_LIMIT);
        for (const control of controls) {
          if (control instanceof HTMLSelectElement) {
            const selectedText = String(
              control.selectedOptions[0]?.textContent || ""
            ).trim().slice(0, 120);
            if (selectedText) {
              auditReadabilityTextElement(control, selectedText, collector);
            }
            continue;
          }
          const value = String(control.value || "");
          if (value) {
            auditReadabilityTextElement(
              control,
              control.getAttribute("type") === "password"
                ? "Password text"
                : value.trim().slice(0, 120),
              collector
            );
            continue;
          }
          const placeholder = String(
            control.getAttribute("placeholder") || ""
          ).trim().slice(0, 120);
          if (placeholder) {
            auditReadabilityTextElement(
              control,
              placeholder,
              collector,
              getComputedStyle(control, "::placeholder")
            );
          }
        }
      };

      const auditReadabilityControls = (collector) => {
        const controls = Array.from(
          document.body?.querySelectorAll(
            'button, input:not([type="hidden"]), select, textarea, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"]'
          ) || []
        ).slice(0, READABILITY_NODE_LIMIT);
        for (const control of controls) {
          if (
            !isReadabilityVisible(control) ||
            control.matches(".streamui-button") ||
            control.matches(":disabled, [aria-disabled=\"true\"]") ||
            effectiveReadabilityOpacity(control) < 0.999
          ) {
            continue;
          }
          const style = getComputedStyle(control);
          const nativeInputType =
            control instanceof HTMLInputElement &&
            ![
              "button",
              "submit",
              "reset",
              "text",
              "search",
              "email",
              "url",
              "tel",
              "password",
              "number"
            ].includes(control.type);
          if (
            (nativeInputType && String(style.appearance || "auto") !== "none") ||
            String(style.backgroundImage || "none") !== "none" ||
            String(style.borderImageSource || "none") !== "none" ||
            String(style.mixBlendMode || "normal") !== "normal" ||
            String(style.filter || "none") !== "none" ||
            String(style.backdropFilter || "none") !== "none"
          ) {
            continue;
          }
          const outer = resolveReadabilityBackdrop(control.parentElement);
          if (outer.uncertain) {
            continue;
          }
          const visibleLabel = String(control.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          const labelColor = parseRenderedReadabilityColor(style.color);
          const renderedLabel = labelColor
            ? compositeReadabilityColor(labelColor, outer.color)
            : null;
          const labelRatio = renderedLabel
            ? readabilityContrastRatio(renderedLabel, outer.color) || 1
            : 1;
          const labelRequiredRatio = isLargeReadabilityText(style)
            ? READABILITY_LARGE_TEXT_RATIO
            : READABILITY_TEXT_RATIO;
          if (
            control.matches('button, [role="button"]') &&
            ((visibleLabel && labelRatio + 0.01 >= labelRequiredRatio) ||
              control.querySelector("svg, img"))
          ) {
            continue;
          }
          const surface = parseRenderedReadabilityColor(style.backgroundColor);
          const renderedSurface = surface
            ? compositeReadabilityColor(surface, outer.color)
            : outer.color;
          const surfaceRatio = readabilityContrastRatio(renderedSurface, outer.color) || 1;
          let renderedBorder = null;
          let borderRatio = 1;
          for (const side of ["Top", "Right", "Bottom", "Left"]) {
            const width = Number.parseFloat(style["border" + side + "Width"] || "0");
            const borderStyle = style["border" + side + "Style"];
            if (width < 0.75 || borderStyle === "none" || borderStyle === "hidden") {
              continue;
            }
            const border = parseRenderedReadabilityColor(
              style["border" + side + "Color"]
            );
            const candidate = border
              ? compositeReadabilityColor(border, outer.color)
              : null;
            const candidateRatio = candidate
              ? readabilityContrastRatio(candidate, outer.color) || 1
              : 1;
            if (candidateRatio > borderRatio) {
              renderedBorder = candidate;
              borderRatio = candidateRatio;
            }
          }
          const ratio = Math.max(surfaceRatio, borderRatio);
          if (ratio + 0.01 < READABILITY_GRAPHIC_RATIO) {
            collector.add({
              code: "control-boundary-contrast",
              target: readabilityTarget(control),
              property: borderRatio >= surfaceRatio ? "border-color" : "background-color",
              ratio,
              requiredRatio: READABILITY_GRAPHIC_RATIO,
              foreground: serializeReadabilityColor(
                borderRatio >= surfaceRatio ? renderedBorder : renderedSurface
              ),
              background: serializeReadabilityColor(outer.color),
              text:
                directReadabilityText(control) ||
                String(control.getAttribute("aria-label") || "").slice(0, 120)
            });
          }
        }
      };

      const findReadabilitySvgCanvas = (svg) => {
        const backdrop = resolveReadabilityBackdrop(svg);
        const svgRect = svg.getBoundingClientRect();
        const backgroundShapes = new Set();
        for (const rect of Array.from(svg.querySelectorAll("rect"))) {
          if (rect.closest("svg") !== svg) {
            continue;
          }
          const rectStyle = getComputedStyle(rect);
          if (
            rectStyle.display === "none" ||
            rectStyle.visibility === "hidden" ||
            rect.closest("defs, clipPath, mask, pattern, marker")
          ) {
            continue;
          }
          const rectBounds = rect.getBoundingClientRect();
          if (
            svgRect.width > 0 &&
            svgRect.height > 0 &&
            rectBounds.width >= svgRect.width * 0.85 &&
            rectBounds.height >= svgRect.height * 0.85
          ) {
            const fill = parseRenderedReadabilityColor(rectStyle.fill);
            if (!fill && String(rectStyle.fill || "none") !== "none") {
              backdrop.uncertain = true;
              backgroundShapes.add(rect);
              continue;
            }
            if (fill) {
              fill.a *=
                effectiveReadabilityOpacity(rect) *
                Math.min(1, Math.max(0, Number.parseFloat(rectStyle.fillOpacity || "1")));
            }
            if (fill && fill.a >= 0.9) {
              backdrop.color = compositeReadabilityColor(fill, backdrop.color) || backdrop.color;
              backdrop.uncertain = false;
              backgroundShapes.add(rect);
            }
          }
        }
        for (const visual of Array.from(svg.querySelectorAll("image, foreignObject"))) {
          if (visual.closest("svg") !== svg || !isReadabilityVisible(visual)) {
            continue;
          }
          const visualBounds = visual.getBoundingClientRect();
          if (
            svgRect.width > 0 &&
            svgRect.height > 0 &&
            visualBounds.width >= svgRect.width * 0.85 &&
            visualBounds.height >= svgRect.height * 0.85
          ) {
            backdrop.uncertain = true;
          }
        }
        return { ...backdrop, backgroundShapes };
      };

      const auditReadabilitySvg = (collector) => {
        const graphicsSelector =
          "path, rect, circle, ellipse, line, polyline, polygon, use";
        const svgs = Array.from(document.body?.querySelectorAll("svg") || [])
          .slice(0, 100);
        let visited = 0;
        for (const svg of svgs) {
          if (!isReadabilityVisible(svg) || isReadabilityExcluded(svg)) {
            continue;
          }
          const canvas = findReadabilitySvgCanvas(svg);
          if (canvas.uncertain) {
            continue;
          }
          for (const graphic of Array.from(svg.querySelectorAll(graphicsSelector))) {
            visited += 1;
            if (
              visited > READABILITY_NODE_LIMIT ||
              graphic.closest("svg") !== svg ||
              canvas.backgroundShapes.has(graphic) ||
              !isReadabilityVisible(graphic)
            ) {
              continue;
            }
            const style = getComputedStyle(graphic);
            if (
              String(style.mixBlendMode || "normal") !== "normal" ||
              String(style.filter || "none") !== "none" ||
              String(style.maskImage || "none") !== "none"
            ) {
              continue;
            }
            const opacity = effectiveReadabilityOpacity(graphic);
            const fill = graphic.localName === "line"
              ? null
              : parseRenderedReadabilityColor(style.fill);
            if (fill) {
              fill.a *=
                opacity * Math.min(1, Math.max(0, Number.parseFloat(style.fillOpacity || "1")));
            }
            const renderedFill = fill
              ? compositeReadabilityColor(fill, canvas.color)
              : canvas.color;
            const fillRatio = fill
              ? readabilityContrastRatio(renderedFill, canvas.color)
              : null;
            const fillIsStrong =
              Boolean(fill && fill.a > 0.02) &&
              fillRatio !== null &&
              fillRatio + 0.01 >= READABILITY_GRAPHIC_RATIO;
            const strokeWidth = Number.parseFloat(style.strokeWidth || "0");
            const stroke =
              strokeWidth >= 0.5
                ? parseRenderedReadabilityColor(style.stroke)
                : null;
            if (stroke) {
              stroke.a *=
                opacity * Math.min(1, Math.max(0, Number.parseFloat(style.strokeOpacity || "1")));
              const renderedStroke =
                compositeReadabilityColor(stroke, renderedFill) || stroke;
              const strokeRatio = readabilityContrastRatio(renderedStroke, renderedFill);
              const strokeIsStrong =
                stroke.a > 0.02 &&
                strokeRatio !== null &&
                strokeRatio + 0.01 >= READABILITY_GRAPHIC_RATIO;
              if (
                fillRatio !== null &&
                fill.a > 0.02 &&
                fillRatio + 0.01 < READABILITY_GRAPHIC_RATIO &&
                !strokeIsStrong
              ) {
                collector.add({
                  code: "svg-fill-contrast",
                  target: readabilityTarget(graphic),
                  property: "fill",
                  ratio: fillRatio,
                  requiredRatio: READABILITY_GRAPHIC_RATIO,
                  foreground: serializeReadabilityColor(renderedFill),
                  background: serializeReadabilityColor(canvas.color)
                });
              }
              if (
                stroke.a > 0.02 &&
                strokeRatio !== null &&
                strokeRatio + 0.01 < READABILITY_GRAPHIC_RATIO &&
                !fillIsStrong
              ) {
                collector.add({
                  code: "svg-stroke-contrast",
                  target: readabilityTarget(graphic),
                  property: "stroke",
                  ratio: strokeRatio,
                  requiredRatio: READABILITY_GRAPHIC_RATIO,
                  foreground: serializeReadabilityColor(renderedStroke),
                  background: serializeReadabilityColor(renderedFill)
                });
              }
            } else if (
              fillRatio !== null &&
              fill.a > 0.02 &&
              fillRatio + 0.01 < READABILITY_GRAPHIC_RATIO
            ) {
              collector.add({
                code: "svg-fill-contrast",
                target: readabilityTarget(graphic),
                property: "fill",
                ratio: fillRatio,
                requiredRatio: READABILITY_GRAPHIC_RATIO,
                foreground: serializeReadabilityColor(renderedFill),
                background: serializeReadabilityColor(canvas.color)
              });
            }
          }
          if (visited > READABILITY_NODE_LIMIT) {
            break;
          }
        }
      };

      const formatReadabilityMessage = (report) => {
        if (!report.findings.length) {
          return "Readability audit: clear.";
        }
        const details = report.findings.slice(0, 6).map((finding) => {
          const measured =
            finding.ratio === null ? "indeterminate" : finding.ratio.toFixed(2) + ":1";
          const repeated = finding.occurrences > 1
            ? " across " + finding.occurrences + " matching elements"
            : "";
          return (
            finding.target + " " + finding.property + " is " + measured +
            " (needs " + finding.requiredRatio + ":1)" + repeated
          );
        });
        return (
          "Readability audit found " + report.total +
          " issue" + (report.total === 1 ? "" : "s") + ". " +
          details.join("; ") +
          ". Preserve the palette; adjust local lightness, chroma, opacity, stroke, or backing surface only enough to meet the floor."
        ).slice(0, 1800);
      };

      const runReadabilityAudit = () => {
        if (!isPreviewComplete() || !document.body) {
          return;
        }
        const collector = createReadabilityCollector();
        auditReadabilityText(collector);
        auditReadabilityControls(collector);
        auditReadabilitySvg(collector);
        const report = collector.result();
        const status = report.findings.length ? "issues" : "clear";
        const signature = JSON.stringify({
          status,
          count: report.total,
          findings: report.findings,
          truncated: report.truncated
        });
        if (signature === lastReadabilitySignature) {
          return;
        }
        lastReadabilitySignature = signature;
        post("readability", formatReadabilityMessage(report), {
          version: 1,
          status,
          count: report.total,
          findings: report.findings,
          truncated: report.truncated
        });
      };

      const scheduleReadabilityAudit = () => {
        if (!runtimeDocumentLoaded) {
          return;
        }
        if (!readabilityAuditStartedAt) {
          readabilityAuditStartedAt = Date.now();
        }
        if (readabilityAuditTimer) {
          clearTimeout(readabilityAuditTimer);
        }
        const elapsed = Date.now() - readabilityAuditStartedAt;
        const delay = Math.max(
          0,
          Math.min(READABILITY_DEBOUNCE_MS, READABILITY_MAX_WAIT_MS - elapsed)
        );
        readabilityAuditTimer = setTimeout(() => {
          readabilityAuditTimer = 0;
          readabilityAuditStartedAt = 0;
          if (!isPreviewComplete()) {
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(runReadabilityAudit));
        }, delay);
      };
`;
