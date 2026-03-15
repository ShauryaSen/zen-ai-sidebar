// Zen AI Sidebar — Background Script
// Orchestrates communication and makes Gemini API calls

(function () {
  "use strict";

  const GEMINI_MODEL = "gemini-3-flash-preview";
  const API_BASE =
    "https://generativelanguage.googleapis.com/v1beta/models";

  // Zen theme state
  let cachedZenColors = null;

  // Get API key from storage
  async function getApiKey() {
    const result = await browser.storage.local.get("geminiApiKey");
    return result.geminiApiKey || null;
  }

  // Get page content from active tab's content script
  async function getPageContext() {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tabs || tabs.length === 0) return null;

      const url = tabs[0].url || "";

      // Arxiv PDF pages — content scripts can't inject into PDFs,
      // so fetch the abstract page directly from the background script
      const arxivPdfMatch = url.match(/arxiv\.org\/pdf\/([^/?#]+)/);
      if (arxivPdfMatch) {
        const arxivId = arxivPdfMatch[1].replace(/\.pdf$/, "");
        return await fetchArxivAbstract(arxivId);
      }

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: "GET_PAGE_CONTENT",
      });
      return response;
    } catch (e) {
      console.warn("Could not get page content:", e.message);
      return null;
    }
  }

  // Fetch and parse an arxiv abstract page directly
  async function fetchArxivAbstract(arxivId) {
    try {
      const absUrl = `https://arxiv.org/abs/${arxivId}`;
      const resp = await fetch(absUrl);
      if (!resp.ok) throw new Error("Failed to fetch arxiv page");
      const html = await resp.text();

      // Parse fields with regex (no DOMParser in background scripts)
      const extract = (pattern) => {
        const m = html.match(pattern);
        return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
      };

      const title = extract(/<meta\s+name="citation_title"\s+content="([^"]+)"/i)
        || extract(/<h1 class="title mathjax">(?:<span[^>]*>[^<]*<\/span>\s*)?([^<]+)/i);
      const authors = extract(/<meta\s+name="citation_authors"\s+content="([^"]+)"/i)
        || extract(/<div class="authors">(?:<span[^>]*>[^<]*<\/span>\s*)?(.+?)<\/div>/is);
      const abstractMatch = html.match(/<blockquote class="abstract mathjax">(?:<span[^>]*>[^<]*<\/span>\s*)?([\s\S]*?)<\/blockquote>/i);
      const abstract = abstractMatch
        ? abstractMatch[1].replace(/<[^>]*>/g, "").trim()
        : "";
      const subjects = extract(/<td class="tablecell subjects">(?:<span[^>]*>)?([\s\S]*?)<\/td>/i);

      const parts = [];
      if (title) parts.push(`Title: ${title}`);
      if (authors) parts.push(`Authors: ${authors}`);
      if (abstract) parts.push(`Abstract: ${abstract}`);
      if (subjects) parts.push(`Subjects: ${subjects}`);

      const content = parts.join("\n\n") || "Could not parse arxiv page.";

      return {
        content,
        meta: {
          title: title || `arxiv:${arxivId}`,
          url: absUrl,
          description: abstract.substring(0, 200),
        },
      };
    } catch (e) {
      console.warn("Failed to fetch arxiv abstract:", e);
      return null;
    }
  }

  // Get selection from active tab
  async function getSelection() {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tabs || tabs.length === 0) return "";

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: "GET_SELECTION",
      });
      return response?.selection || "";
    } catch (e) {
      return "";
    }
  }

  // Build system prompt with page context
  function buildSystemPrompt(pageContext, selection) {
    let systemPrompt =
      `You are Zen AI, an intelligent assistant embedded in the user's browser sidebar. ` +
      `You help users understand, summarize, and interact with web content. ` +
      `Be concise, helpful, and direct. Use markdown formatting in your responses.`;

    if (pageContext) {
      systemPrompt += `\n\n--- CURRENT PAGE CONTEXT ---`;
      systemPrompt += `\nTitle: ${pageContext.meta?.title || "Unknown"}`;
      systemPrompt += `\nURL: ${pageContext.meta?.url || "Unknown"}`;
      if (pageContext.meta?.description) {
        systemPrompt += `\nDescription: ${pageContext.meta.description}`;
      }
      systemPrompt += `\n\nPage Content:\n${pageContext.content}`;
      systemPrompt += `\n--- END PAGE CONTEXT ---`;
    }

    if (selection) {
      systemPrompt += `\n\n--- HIGHLIGHTED TEXT ---\n${selection}\n--- END HIGHLIGHTED TEXT ---`;
    }

    return systemPrompt;
  }

  // Stream response from Gemini API
  async function streamGeminiResponse(apiKey, systemPrompt, userMessage, conversationHistory, sendChunk) {
    const url = `${API_BASE}/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Build contents array with conversation history
    const contents = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      });
    }

    // Add current user message
    contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullResponse += text;
              sendChunk(text);
            }
          } catch (e) {
            // Partial JSON, skip
          }
        }
      }
    }

    return fullResponse;
  }

  // ===== Zen Browser Theme Detection =====
  function initZenThemeDetection() {
    try {
      if (!browser.theme) return;

      // Get initial theme
      browser.theme.getCurrent().then((theme) => {
        if (theme && theme.colors) {
          cachedZenColors = theme.colors;
          broadcastZenTheme(theme.colors);
        }
      }).catch(() => {});

      // Listen for theme changes
      if (browser.theme.onUpdated) {
        browser.theme.onUpdated.addListener((updateInfo) => {
          if (updateInfo.theme && updateInfo.theme.colors) {
            cachedZenColors = updateInfo.theme.colors;
            broadcastZenTheme(updateInfo.theme.colors);
          }
        });
      }
    } catch (e) {
      // theme API not available
    }
  }

  function broadcastZenTheme(colors) {
    browser.runtime.sendMessage({
      type: "ZEN_THEME_DETECTED",
      colors: colors,
    }).catch(() => {});
  }

  // ===== YouTube Transcript (relayed to content script, AI fallback) =====
  async function handleTranscriptRequest() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) {
        return { error: "No active tab found." };
      }
      const url = tabs[0].url || "";
      if (!url.includes("youtube.com/watch")) {
        return { error: "Not a YouTube video page." };
      }
      // Relay to content script — it runs on the YouTube page with full
      // cookie/session access, which is required for fetching transcript XML
      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: "GET_YOUTUBE_TRANSCRIPT",
      });

      // If content script found no captions, fall back to Gemini AI transcription
      if (response?.noCaptions) {
        return await aiTranscribe(response.videoUrl, response.videoTitle);
      }

      return response;
    } catch (e) {
      return { error: "Could not get transcript. Make sure you're on a YouTube video page." };
    }
  }

  // Use Gemini to transcribe a YouTube video when no captions exist
  async function aiTranscribe(videoUrl, videoTitle) {
    try {
      const apiKey = await getApiKey();
      if (!apiKey) {
        return { error: "No API key set. Add your Gemini API key in settings to use AI transcription." };
      }

      const result = await browser.storage.local.get("geminiModel");
      const model = result.geminiModel || GEMINI_MODEL;
      const apiUrl = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

      const body = {
        contents: [{
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: "video/mp4",
                fileUri: videoUrl,
              },
            },
            {
              text: "Transcribe the spoken audio in this video. Output ONLY the transcript text with timestamps in this format:\n[M:SS] spoken text here\n\nDo not add summaries, commentary, or descriptions. Just the spoken words with timestamps.",
            },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
        },
      };

      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Gemini API error (${resp.status}): ${errText}`);
      }

      const data = await resp.json();
      const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!transcript) {
        return { error: "AI transcription returned no result." };
      }

      return {
        transcript: transcript,
        entries: transcript.split("\n").filter(l => l.trim()).length,
        videoTitle: videoTitle || "",
        aiGenerated: true,
      };
    } catch (e) {
      return { error: "AI transcription failed: " + e.message };
    }
  }

  // ===== Academic Paper Detection =====
  async function checkIsAcademicPaper() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) return false;
      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: "IS_ACADEMIC_PAPER",
      });
      return response?.isPaper || false;
    } catch (e) {
      return false;
    }
  }

  // Handle messages from sidebar
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SELECTION_CHANGED") {
      // Forward selection changes to sidebar
      browser.runtime
        .sendMessage({
          type: "SELECTION_UPDATE",
          selection: message.selection,
        })
        .catch(() => {});
      return false;
    }

    if (message.type === "YOUTUBE_NAVIGATION") {
      // Forward YouTube navigation events to sidebar
      browser.runtime
        .sendMessage({
          type: "YOUTUBE_NAVIGATION",
          url: message.url,
        })
        .catch(() => {});
      return false;
    }

    if (message.type === "CHAT_REQUEST") {
      handleChatRequest(message, sender);
      return false; // Response sent via streaming messages
    }

    if (message.type === "GET_CONTEXT") {
      handleGetContext().then(sendResponse);
      return true;
    }

    if (message.type === "GET_ZEN_THEME") {
      if (cachedZenColors) {
        broadcastZenTheme(cachedZenColors);
      }
      return false;
    }

    if (message.type === "YOUTUBE_TRANSCRIPT_REQUEST") {
      handleTranscriptRequest().then(sendResponse);
      return true;
    }

    return false;
  });

  async function handleGetContext() {
    const pageContext = await getPageContext();
    const selection = await getSelection();
    return { pageContext, selection };
  }

  async function handleChatRequest(message) {
    const { userMessage, action, conversationHistory = [] } = message;
    const requestId = message.requestId;

    try {
      const apiKey = await getApiKey();
      if (!apiKey) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          error: "NO_API_KEY",
          message: "Please set your Gemini API key in the sidebar settings.",
        });
        return;
      }

      // Get page context
      const pageContext = await getPageContext();
      const selection = await getSelection();
      const systemPrompt = buildSystemPrompt(pageContext, selection);

      // Determine user message based on action
      let finalMessage = userMessage;
      if (action === "summarize") {
        finalMessage =
          "Please provide a comprehensive summary of this page's content. Highlight the key points and main takeaways.";
      } else if (action === "explain") {
        if (selection) {
          finalMessage = `Please explain the following highlighted text in detail:\n\n"${selection}"`;
        } else {
          finalMessage = "Please explain the main concepts on this page in simple terms.";
        }
      } else if (action === "keypoints") {
        finalMessage =
          "Extract and list the key points from this page as a bullet-point list. Be specific and actionable.";
      } else if (action === "paper-summary") {
        finalMessage =
          "Analyze this page as a research paper. Extract and present:\n\n" +
          "## Title\n## Authors\n## Abstract\n## Methodology\n" +
          "## Key Findings\n## Limitations\n## Conclusion\n\n" +
          "If this is not a research paper, summarize the content using the above structure where applicable.";
      }

      // Stream response
      await streamGeminiResponse(
        apiKey,
        systemPrompt,
        finalMessage,
        conversationHistory,
        (chunk) => {
          browser.runtime.sendMessage({
            type: "CHAT_RESPONSE",
            requestId,
            chunk,
            done: false,
          }).catch(() => {});
        }
      );

      // Signal completion
      browser.runtime.sendMessage({
        type: "CHAT_RESPONSE",
        requestId,
        done: true,
      }).catch(() => {});
    } catch (error) {
      browser.runtime.sendMessage({
        type: "CHAT_RESPONSE",
        requestId,
        error: "API_ERROR",
        message: error.message,
      }).catch(() => {});
    }
  }

  // ===== Toggle Sidebar via Custom Command =====
  browser.commands.onCommand.addListener((command) => {
    if (command === "toggle-sidebar") {
      browser.sidebarAction.toggle();
    }
  });

  // Initialize Zen theme detection on startup
  initZenThemeDetection();
})();
