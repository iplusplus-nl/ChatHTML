export const mediaSource = `      const youtubeVideoIdFromEmbed = (value) => {
        try {
          const url = new URL(value, window.location.href);
          if (
            !url.hostname.toLowerCase().endsWith("youtube.com") &&
            !url.hostname.toLowerCase().endsWith("youtube-nocookie.com")
          ) {
            return "";
          }
          const match = url.pathname.match(/\\/embed\\/([A-Za-z0-9_-]{11})/);
          return match ? match[1] : "";
        } catch {
          return "";
        }
      };
      const isYouTubeEmbedUrl = (value) => {
        try {
          const url = new URL(value, window.location.href);
          return (
            (url.hostname.toLowerCase().endsWith("youtube.com") ||
              url.hostname.toLowerCase().endsWith("youtube-nocookie.com")) &&
            url.pathname.includes("/embed/")
          );
        } catch {
          return false;
        }
      };
      const externalSourceUrlNearMedia = (media) => {
        let scope = media?.parentElement || null;
        while (scope && scope !== document.body) {
          const links = Array.from(scope.querySelectorAll("a[href]"))
            .map((anchor) => anchor.getAttribute("href") || "")
            .filter((href) => /^https?:\\/\\//i.test(href));
          if (links.length === 1) {
            return links[0];
          }
          scope = scope.parentElement;
        }
        return "";
      };
      const proxyExternalImage = (image) => {
        if (!image || image.dataset.streamuiImageProxied === "true") {
          return;
        }
        const rawSource = image.getAttribute("src") || "";
        if (!/^https?:\\/\\//i.test(rawSource)) {
          return;
        }
        try {
          const source = new URL(rawSource, document.baseURI);
          if (
            !/^https?:$/.test(source.protocol) ||
            source.origin === window.location.origin ||
            source.pathname === "/api/media-image"
          ) {
            return;
          }
          image.dataset.streamuiImageProxied = "true";
          image.dataset.streamuiImageSource = source.toString();
          image.src = "/api/media-image?url=" + encodeURIComponent(source.toString());
        } catch {
          return;
        }
      };
      const prepareExternalImages = (root) => {
        if (root instanceof HTMLImageElement) {
          proxyExternalImage(root);
        }
        if (root && typeof root.querySelectorAll === "function") {
          root.querySelectorAll("img[src]").forEach(proxyExternalImage);
        }
      };
      const prepareYouTubeIframe = (iframe) => {
        if (
          !iframe ||
          iframe.dataset.streamuiVideoActive === "true" ||
          iframe.dataset.streamuiVideoPrepared === "true"
        ) {
          return;
        }
        const embedSource = iframe.getAttribute("src") || "";
        if (!isYouTubeEmbedUrl(embedSource)) {
          return;
        }
        const videoId = youtubeVideoIdFromEmbed(embedSource);
        const nearbySourceUrl = externalSourceUrlNearMedia(iframe);
        const targetUrl =
          nearbySourceUrl ||
          (videoId ? "https://www.youtube.com/watch?v=" + videoId : "");
        if (!targetUrl) {
          return;
        }
        iframe.dataset.streamuiVideoPrepared = "true";
        const launch = document.createElement("button");
        launch.type = "button";
        launch.className = "streamui-video-launch";
        launch.dataset.streamuiYoutubeId = videoId;
        launch.setAttribute(
          "data-streamui-open-url",
          targetUrl
        );
        launch.setAttribute("data-streamui-label", "External video");
        launch.setAttribute(
          "aria-label",
          "Open video: " + (iframe.getAttribute("title") || "YouTube video")
        );
        const icon = document.createElement("span");
        icon.className = "streamui-video-launch-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "▶";
        const label = document.createElement("span");
        label.className = "streamui-video-launch-label";
        label.textContent = iframe.getAttribute("title") || "Open video on YouTube";
        launch.append(icon, label);
        iframe.replaceWith(launch);
        scheduleMeasure();
      };
      const prepareYouTubeIframes = (root) => {
        if (root instanceof HTMLIFrameElement) {
          prepareYouTubeIframe(root);
        }
        if (root && typeof root.querySelectorAll === "function") {
          root.querySelectorAll("iframe[src]").forEach(prepareYouTubeIframe);
        }
      };
      window.addEventListener("DOMContentLoaded", () => {
        prepareExternalImages(document);
        prepareYouTubeIframes(document);
      });
      new MutationObserver((records) => {
        records.forEach((record) => {
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              prepareExternalImages(node);
              prepareYouTubeIframes(node);
            }
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
`;
