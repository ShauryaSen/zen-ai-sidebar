// Zen AI Sidebar — Content Script
// Injected into every page to extract text and detect selections

(function () {
  "use strict";

  // Track current selection
  let currentSelection = "";

  // Listen for selection changes
  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text !== currentSelection) {
      currentSelection = text;
      // Notify sidebar about selection change
      browser.runtime.sendMessage({
        type: "SELECTION_CHANGED",
        selection: currentSelection,
      }).catch(() => {
        // Sidebar may not be open — ignore
      });
    }
  });

  // Extract clean page text
  function getPageContent() {
    // Try to get the article/main content first
    const article = document.querySelector("article") ||
      document.querySelector('[role="main"]') ||
      document.querySelector("main");

    const source = article || document.body;
    if (!source) return "";

    // Clone and remove script/style/nav elements
    const clone = source.cloneNode(true);
    const removeTags = ["script", "style", "nav", "footer", "header", "aside", "noscript", "iframe"];
    removeTags.forEach((tag) => {
      clone.querySelectorAll(tag).forEach((el) => el.remove());
    });

    // Get text, collapse whitespace
    let text = clone.innerText || clone.textContent || "";
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    // Cap at ~15000 chars to stay within API limits
    if (text.length > 15000) {
      text = text.substring(0, 15000) + "\n\n[Content truncated...]";
    }

    return text;
  }

  // Get page metadata
  function getPageMeta() {
    return {
      title: document.title || "",
      url: window.location.href,
      description: document.querySelector('meta[name="description"]')?.content || "",
    };
  }

  // Handle messages from background/sidebar
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "GET_PAGE_CONTENT":
        const content = getPageContent();
        const meta = getPageMeta();
        sendResponse({ content, meta });
        return true;

      case "GET_SELECTION":
        sendResponse({ selection: currentSelection });
        return true;

      default:
        return false;
    }
  });
})();
