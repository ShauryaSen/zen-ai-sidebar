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
    // Site-specific extraction for known academic sites
    const url = window.location.href;

    // ArXiv abstract pages — extract structured content
    if (url.includes("arxiv.org/abs/")) {
      return extractArxivAbstract();
    }

    // ArXiv HTML papers
    if (url.includes("arxiv.org/html/")) {
      return extractFromSelectors([
        ".ltx_page_content",
        "article",
        ".ltx_document",
      ]);
    }

    // ArXiv PDF pages — can't extract, provide guidance
    if (url.includes("arxiv.org/pdf/")) {
      const match = url.match(/arxiv\.org\/pdf\/([^/?#]+)/);
      const id = match ? match[1].replace(".pdf", "") : "";
      return id
        ? `[This is a PDF page. Content cannot be extracted directly. The abstract page is at: https://arxiv.org/abs/${id}]`
        : "[This is a PDF page. Content cannot be extracted directly.]";
    }

    // General extraction
    const source = document.querySelector("article") ||
      document.querySelector('[role="main"]') ||
      document.querySelector("main") ||
      document.querySelector("#content") ||
      document.body;

    if (!source) return "";

    return extractText(source);
  }

  // ArXiv abstract page extraction
  function extractArxivAbstract() {
    const parts = [];

    const title = document.querySelector(".title.mathjax");
    if (title) parts.push("Title: " + title.textContent.replace(/^Title:\s*/i, "").trim());

    const authors = document.querySelector(".authors");
    if (authors) parts.push("Authors: " + authors.textContent.replace(/^Authors:\s*/i, "").trim());

    const abstract = document.querySelector(".abstract.mathjax");
    if (abstract) parts.push("Abstract: " + abstract.textContent.replace(/^Abstract:\s*/i, "").trim());

    const subjects = document.querySelector(".subjects");
    if (subjects) parts.push("Subjects: " + subjects.textContent.replace(/^Subjects:\s*/i, "").trim());

    const comments = document.querySelector(".metatable .comments");
    if (comments) parts.push("Comments: " + comments.textContent.trim());

    // Also grab any extra content on the page
    const extra = document.querySelector("#content-inner");
    if (extra && parts.length === 0) {
      return extractText(extra);
    }

    return parts.join("\n\n") || extractText(document.body);
  }

  // Extract from a prioritized list of selectors
  function extractFromSelectors(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return extractText(el);
    }
    return extractText(document.body);
  }

  // Generic text extraction from a DOM element
  function extractText(source) {
    const clone = source.cloneNode(true);
    const removeTags = ["script", "style", "nav", "footer", "header", "aside", "noscript", "iframe"];
    removeTags.forEach((tag) => {
      clone.querySelectorAll(tag).forEach((el) => el.remove());
    });

    let text = clone.innerText || clone.textContent || "";
    text = text.replace(/\n{3,}/g, "\n\n").trim();

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

  // Detect if current page is an academic paper
  function isAcademicPaper() {
    const url = window.location.href.toLowerCase();

    // Check URL patterns
    const academicDomains = [
      "arxiv.org",
      "doi.org",
      "pubmed.ncbi.nlm.nih.gov",
      "ieee.org",
      "acm.org",
      "semanticscholar.org",
      "scholar.google.com",
      "biorxiv.org",
      "medrxiv.org",
      "ssrn.com",
      "researchgate.net",
      "nature.com/articles",
      "science.org/doi",
      "springer.com/article",
      "wiley.com/doi",
    ];

    const isAcademicUrl = academicDomains.some(domain => url.includes(domain));

    // Check for citation meta tags
    const hasCitationMeta = !!(
      document.querySelector('meta[name="citation_title"]') ||
      document.querySelector('meta[name="citation_author"]') ||
      document.querySelector('meta[name="citation_doi"]') ||
      document.querySelector('meta[name="dc.type"][content="article" i]')
    );

    return isAcademicUrl || hasCitationMeta;
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

      case "IS_ACADEMIC_PAPER":
        sendResponse({ isPaper: isAcademicPaper() });
        return true;

      default:
        return false;
    }
  });
})();
