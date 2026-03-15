// Zen AI Sidebar — YouTube SPA Navigation Listener
// Notifies the sidebar when YouTube navigates between pages (SPA)

(function () {
  "use strict";

  window.addEventListener("yt-navigate-finish", () => {
    browser.runtime.sendMessage({
      type: "YOUTUBE_NAVIGATION",
      url: window.location.href,
    }).catch(() => {});
  });
})();
