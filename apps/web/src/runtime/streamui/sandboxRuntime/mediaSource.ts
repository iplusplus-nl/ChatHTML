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
      const prepareYouTubeIframe = (iframe) => {
        if (
          !iframe ||
          iframe.dataset.streamuiVideoActive === "true" ||
          iframe.dataset.streamuiVideoPrepared === "true"
        ) {
          return;
        }
        const videoId = youtubeVideoIdFromEmbed(iframe.getAttribute("src") || "");
        if (!videoId) {
          return;
        }
        iframe.dataset.streamuiVideoPrepared = "true";
        const launch = document.createElement("button");
        launch.type = "button";
        launch.className = "streamui-video-launch";
        launch.dataset.streamuiYoutubeId = videoId;
        launch.setAttribute(
          "aria-label",
          "Play video: " + (iframe.getAttribute("title") || "YouTube video")
        );
        const icon = document.createElement("span");
        icon.className = "streamui-video-launch-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "▶";
        const label = document.createElement("span");
        label.className = "streamui-video-launch-label";
        label.textContent = iframe.getAttribute("title") || "Play video";
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
      document.addEventListener("click", (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) {
          return;
        }
        const launch = event.target.closest("[data-streamui-youtube-id]");
        if (!launch) {
          return;
        }
        const videoId = launch.getAttribute("data-streamui-youtube-id") || "";
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
          return;
        }
        event.preventDefault();
        const iframe = document.createElement("iframe");
        iframe.src =
          "https://www.youtube-nocookie.com/embed/" +
          videoId +
          "?autoplay=1&rel=0";
        iframe.title = launch.getAttribute("aria-label") || "YouTube video";
        iframe.allow =
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.className = "streamui-video-active";
        iframe.dataset.streamuiVideoActive = "true";
        launch.replaceWith(iframe);
        scheduleMeasure();
      });
      window.addEventListener("DOMContentLoaded", () => {
        prepareYouTubeIframes(document);
      });
      new MutationObserver((records) => {
        records.forEach((record) => {
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              prepareYouTubeIframes(node);
            }
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
`;
