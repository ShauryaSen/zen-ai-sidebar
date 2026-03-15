// Zen AI Sidebar — YouTube Transcript Extraction
// Content script for YouTube watch pages
// Runs on the page itself so fetch() includes YouTube session cookies

(function () {
  "use strict";

  function decodeXmlEntities(text) {
    return text
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\n/g, " ");
  }

  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  // Extract caption tracks from ytInitialPlayerResponse in page scripts
  function getCaptionTracks() {
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent;
      if (!text.includes("ytInitialPlayerResponse")) continue;

      // Match the player response JSON — use a greedy match up to the closing };
      const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var\s|<\/script)/s);
      if (!match) continue;

      try {
        const data = JSON.parse(match[1]);
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        const title = data?.videoDetails?.title || "";
        if (tracks && tracks.length > 0) {
          return { tracks, title };
        }
      } catch (e) {
        // Try alternate: search for captionTracks directly
      }
    }

    // Fallback: search for captionTracks in any script
    for (const script of document.querySelectorAll("script")) {
      const text = script.textContent;
      const match = text.match(/"captionTracks":\s*(\[.+?\])/s);
      if (match) {
        try {
          const tracks = JSON.parse(match[1]);
          if (tracks && tracks.length > 0) {
            return { tracks, title: document.title.replace(/ - YouTube$/, "") };
          }
        } catch (e) {}
      }
    }

    return null;
  }

  // Fetch and parse transcript XML
  async function fetchTranscriptXml(baseUrl) {
    const resp = await fetch(baseUrl);
    if (!resp.ok) throw new Error("Failed to fetch transcript");
    const xml = await resp.text();
    if (!xml || xml.length === 0) throw new Error("Empty transcript response");

    // Parse with DOMParser (available in content scripts)
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const textElements = doc.querySelectorAll("text");

    const entries = [];
    for (const el of textElements) {
      const start = parseFloat(el.getAttribute("start"));
      const dur = parseFloat(el.getAttribute("dur") || "0");
      const text = decodeXmlEntities(el.textContent || "").trim();
      if (text) {
        entries.push({ start, dur, text });
      }
    }
    return entries;
  }

  // Fallback: scrape transcript from DOM (when transcript panel is open)
  function extractFromDOM() {
    const segments = document.querySelectorAll("ytd-transcript-segment-renderer");
    if (segments.length === 0) return null;

    const entries = [];
    for (const seg of segments) {
      const timeEl = seg.querySelector(".segment-timestamp");
      const textEl = seg.querySelector(".segment-text");
      if (timeEl && textEl) {
        const timeStr = timeEl.textContent.trim();
        const text = textEl.textContent.trim();
        const parts = timeStr.split(":").map(Number);
        let start = 0;
        if (parts.length === 3) start = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) start = parts[0] * 60 + parts[1];
        entries.push({ start, dur: 0, text });
      }
    }
    return entries.length > 0 ? entries : null;
  }

  // Main transcript extraction
  async function getTranscript() {
    const captionData = getCaptionTracks();

    if (captionData) {
      const { tracks, title } = captionData;
      // Prefer English
      const track = tracks.find(t => t.languageCode === "en")
        || tracks.find(t => t.languageCode?.startsWith("en"))
        || tracks[0];

      if (track?.baseUrl) {
        try {
          const entries = await fetchTranscriptXml(track.baseUrl);
          if (entries.length > 0) {
            const formatted = entries.map(e => `[${formatTime(e.start)}] ${e.text}`).join("\n");
            return {
              transcript: formatted,
              entries: entries.length,
              videoTitle: title || document.title.replace(/ - YouTube$/, ""),
            };
          }
        } catch (e) {
          console.warn("Transcript XML fetch failed:", e);
          // Fall through to DOM fallback
        }
      }
    }

    // Fallback: try DOM scraping
    const domEntries = extractFromDOM();
    if (domEntries && domEntries.length > 0) {
      const formatted = domEntries.map(e => `[${formatTime(e.start)}] ${e.text}`).join("\n");
      return {
        transcript: formatted,
        entries: domEntries.length,
        videoTitle: document.title.replace(/ - YouTube$/, ""),
      };
    }

    // No captions found — signal to use AI transcription fallback
    return {
      noCaptions: true,
      videoTitle: document.title.replace(/ - YouTube$/, ""),
      videoUrl: window.location.href,
    };
  }

  // Handle messages from background script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_YOUTUBE_TRANSCRIPT") {
      getTranscript().then(sendResponse);
      return true;
    }
    return false;
  });

  // Handle SPA navigation on YouTube
  window.addEventListener("yt-navigate-finish", () => {
    browser.runtime.sendMessage({
      type: "YOUTUBE_NAVIGATION",
      url: window.location.href,
    }).catch(() => {});
  });
})();
