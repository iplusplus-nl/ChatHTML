export const readabilityColorMathSource = String.raw`
      const parseReadabilityColor = (value) => {
        const input = String(value || "").trim().toLowerCase();
        if (!input || input === "none") {
          return null;
        }
        if (input === "transparent") {
          return { r: 0, g: 0, b: 0, a: 0 };
        }

        const clamp = (number, minimum = 0, maximum = 1) =>
          Math.min(maximum, Math.max(minimum, number));
        const parseAlpha = (part) => {
          const text = String(part ?? "1").trim();
          const number = Number.parseFloat(text);
          return Number.isFinite(number)
            ? clamp(text.endsWith("%") ? number / 100 : number)
            : 1;
        };
        const parseChannel = (part) => {
          const text = String(part ?? "").trim();
          const number = Number.parseFloat(text);
          if (!Number.isFinite(number)) {
            return null;
          }
          return clamp(text.endsWith("%") ? number * 2.55 : number, 0, 255);
        };

        const hex = input.match(/^#([0-9a-f]{3,8})$/i);
        if (hex) {
          let digits = hex[1];
          if (digits.length === 3 || digits.length === 4) {
            digits = digits
              .split("")
              .map((digit) => digit + digit)
              .join("");
          }
          if (digits.length === 6 || digits.length === 8) {
            return {
              r: Number.parseInt(digits.slice(0, 2), 16),
              g: Number.parseInt(digits.slice(2, 4), 16),
              b: Number.parseInt(digits.slice(4, 6), 16),
              a:
                digits.length === 8
                  ? Number.parseInt(digits.slice(6, 8), 16) / 255
                  : 1
            };
          }
        }

        const rgb = input.match(/^rgba?\((.*)\)$/i);
        if (rgb) {
          const parts = rgb[1]
            .replace(/\s*\/\s*/g, " ")
            .split(/[\s,]+/)
            .filter(Boolean);
          if (parts.length >= 3) {
            const channels = parts.slice(0, 3).map(parseChannel);
            if (channels.every((channel) => channel !== null)) {
              return {
                r: channels[0],
                g: channels[1],
                b: channels[2],
                a: parseAlpha(parts[3])
              };
            }
          }
        }

        const srgb = input.match(/^color\(srgb\s+(.+)\)$/i);
        if (srgb) {
          const parts = srgb[1]
            .replace(/\s*\/\s*/g, " ")
            .split(/\s+/)
            .filter(Boolean);
          if (parts.length >= 3) {
            const channels = parts.slice(0, 3).map((part) => {
              const number = Number.parseFloat(part);
              return Number.isFinite(number)
                ? clamp(part.endsWith("%") ? number / 100 : number) * 255
                : null;
            });
            if (channels.every((channel) => channel !== null)) {
              return {
                r: channels[0],
                g: channels[1],
                b: channels[2],
                a: parseAlpha(parts[3])
              };
            }
          }
        }

        return null;
      };

      const compositeReadabilityColor = (foreground, background) => {
        if (!foreground || !background) {
          return null;
        }
        const foregroundAlpha = Math.min(1, Math.max(0, foreground.a));
        const backgroundAlpha = Math.min(1, Math.max(0, background.a));
        const alpha =
          foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);
        if (alpha <= 0) {
          return { r: 0, g: 0, b: 0, a: 0 };
        }
        return {
          r:
            (foreground.r * foregroundAlpha +
              background.r * backgroundAlpha * (1 - foregroundAlpha)) /
            alpha,
          g:
            (foreground.g * foregroundAlpha +
              background.g * backgroundAlpha * (1 - foregroundAlpha)) /
            alpha,
          b:
            (foreground.b * foregroundAlpha +
              background.b * backgroundAlpha * (1 - foregroundAlpha)) /
            alpha,
          a: alpha
        };
      };

      const readabilityRelativeLuminance = (color) => {
        const channel = (value) => {
          const normalized = Math.min(255, Math.max(0, value)) / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };
        return (
          0.2126 * channel(color.r) +
          0.7152 * channel(color.g) +
          0.0722 * channel(color.b)
        );
      };

      const readabilityContrastRatio = (first, second) => {
        if (!first || !second) {
          return null;
        }
        const firstLuminance = readabilityRelativeLuminance(first);
        const secondLuminance = readabilityRelativeLuminance(second);
        const lighter = Math.max(firstLuminance, secondLuminance);
        const darker = Math.min(firstLuminance, secondLuminance);
        return (lighter + 0.05) / (darker + 0.05);
      };

      const serializeReadabilityColor = (color) => {
        if (!color) {
          return null;
        }
        const round = (value) => Math.round(value);
        const alpha = Math.round(color.a * 1000) / 1000;
        return alpha >= 0.999
          ? "rgb(" + round(color.r) + ", " + round(color.g) + ", " + round(color.b) + ")"
          : "rgba(" + round(color.r) + ", " + round(color.g) + ", " + round(color.b) + ", " + alpha + ")";
      };
`;
