export const hostRenderSource = `      const applyHostRenderTheme = (theme) => {
        if (!theme || (theme.mode !== "day" && theme.mode !== "night")) {
          return false;
        }

        const root = document.documentElement;
        const properties = {
          "color-scheme": theme.colorScheme,
          "--streamui-page-bg": theme.pageBg,
          "--streamui-text": theme.text,
          "--streamui-muted": theme.muted,
          "--streamui-link": theme.link,
          "--streamui-button-bg": theme.buttonBg,
          "--streamui-button-text": theme.buttonText,
          "--streamui-secondary-border": theme.secondaryBorder,
          "--streamui-secondary-text": theme.secondaryText
        };
        if (Object.values(properties).some((value) => typeof value !== "string")) {
          return false;
        }

        root.dataset.pageTheme = theme.mode;
        Object.entries(properties).forEach(([name, value]) => {
          root.style.setProperty(name, value);
        });
        return true;
      };
      window.addEventListener("message", (event) => {
        if (!event.isTrusted || event.source !== window.parent) {
          return;
        }

        const data = event.data || {};
        if (
          data.source !== "streamui-host" ||
          data.documentEpoch !== HOST_DOCUMENT_EPOCH ||
          data.kind !== "render" ||
          typeof data.bodyHtml !== "string" ||
          !applyHostRenderTheme(data.theme) ||
          !document.body
        ) {
          return;
        }

        document.body.innerHTML = data.bodyHtml;
        document.body.dataset.streamuiActionsEnabled =
          data.actionsEnabled === true ? "true" : "false";
        scheduleMathTypeset();
        scheduleMeasure();
        scheduleSelectionUiRefresh();
      });
`;
