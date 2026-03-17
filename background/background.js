// Zen AI Sidebar — Background Script
// Orchestrates communication via Native Messaging to Gemini CLI

(function () {
  "use strict";

  const NATIVE_HOST_NAME = "dev.shauryasen.zen_ai_sidebar";

  // Get page content from active tab's content script
  async function getPageContext() {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tabs || tabs.length === 0) return null;

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: "GET_PAGE_CONTENT",
      });
      return response;
    } catch (e) {
      console.warn("Could not get page content:", e.message);
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
      `You are Zen AI, an intelligent assistant running inside a browser sidebar extension. ` +
      `You are invoked via the Gemini CLI in non-interactive mode from a workspace at ~/.zen-ai/brain/. ` +
      `Your primary purpose is to help users understand, summarize, and interact with web content, ` +
      `but you are also a capable general-purpose assistant. ` +
      `Be concise, helpful, and direct. Use markdown formatting in your responses.\n\n` +
      `IMPORTANT CONTEXT ABOUT YOUR ENVIRONMENT:\n` +
      `- You are running inside a browser sidebar, NOT in a terminal or code editor.\n` +
      `- Your workspace directory (~/.zen-ai/brain/) is a persistent folder for your use. It is NOT a code project.\n` +
      `- The user may or may not have a webpage open. If no page context is provided below, ` +
      `just respond to their question directly as a general assistant.\n` +
      `- Do NOT attempt to read files, list directories, or use filesystem tools unless the user explicitly asks you to.\n` +
      `- Do NOT be confused by the lack of project files in your workspace — that is expected.`;

    if (pageContext) {
      systemPrompt += `\n\n--- CURRENT PAGE CONTEXT ---`;
      systemPrompt += `\nTitle: ${pageContext.meta?.title || "Unknown"}`;
      systemPrompt += `\nURL: ${pageContext.meta?.url || "Unknown"}`;
      if (pageContext.meta?.description) {
        systemPrompt += `\nDescription: ${pageContext.meta.description}`;
      }
      systemPrompt += `\n\nPage Content:\n${pageContext.content}`;
      systemPrompt += `\n--- END PAGE CONTEXT ---`;
    } else {
      systemPrompt += `\n\n[No webpage is currently loaded. Respond as a general-purpose assistant.]`;
    }

    if (selection) {
      systemPrompt += `\n\n--- HIGHLIGHTED TEXT ---\n${selection}\n--- END HIGHLIGHTED TEXT ---`;
    }

    return systemPrompt;
  }

  // Build a full prompt string from system prompt, conversation history, and user message
  function buildFullPrompt(systemPrompt, conversationHistory, userMessage) {
    let fullPrompt = `[System Instructions]\n${systemPrompt}\n\n`;

    if (conversationHistory.length > 0) {
      fullPrompt += `[Conversation History]\n`;
      for (const msg of conversationHistory) {
        const role = msg.role === "user" ? "User" : "Assistant";
        fullPrompt += `${role}: ${msg.text}\n\n`;
      }
    }

    fullPrompt += `[Current User Message]\n${userMessage}`;
    return fullPrompt;
  }

  // Send request to Gemini CLI via Native Messaging
  function sendToGeminiCLI(fullPrompt, model, requestId) {
    let port;
    try {
      port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (e) {
      browser.runtime.sendMessage({
        type: "CHAT_RESPONSE",
        requestId,
        error: "NATIVE_HOST_ERROR",
        message:
          "Could not connect to the Gemini CLI bridge. Please run install_host.sh first.",
      }).catch(() => {});
      return;
    }

    // Listen for responses
    port.onMessage.addListener((msg) => {
      if (msg.requestId !== requestId) return;

      if (msg.error) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          error: msg.error,
          message: msg.message,
        }).catch(() => {});
        port.disconnect();
        return;
      }

      if (msg.thinking !== undefined) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          thinking: msg.thinking,
        }).catch(() => {});
      }

      if (msg.chunk) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          chunk: msg.chunk,
          done: false,
        }).catch(() => {});
      }

      if (msg.done) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          done: true,
        }).catch(() => {});
        port.disconnect();
      }
    });

    // Handle disconnect/errors
    port.onDisconnect.addListener(() => {
      if (port.error) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          error: "NATIVE_HOST_ERROR",
          message: `Native host disconnected: ${port.error.message}. Run install_host.sh to set up the Gemini CLI bridge.`,
        }).catch(() => {});
      }
    });

    // Send the prompt
    port.postMessage({
      prompt: fullPrompt,
      model: model || null,
      requestId: requestId,
    });
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

    if (message.type === "CHAT_REQUEST") {
      handleChatRequest(message, sender);
      return false; // Response sent via streaming messages
    }

    if (message.type === "GET_CONTEXT") {
      handleGetContext().then(sendResponse);
      return true;
    }

    if (message.type === "CHECK_NATIVE_HOST") {
      checkNativeHost().then(sendResponse);
      return true;
    }

    return false;
  });

  async function handleGetContext() {
    const pageContext = await getPageContext();
    const selection = await getSelection();
    return { pageContext, selection };
  }

  // Quick check to see if native host is available
  async function checkNativeHost() {
    return new Promise((resolve) => {
      try {
        const port = browser.runtime.connectNative(NATIVE_HOST_NAME);
        // If we get here without error, the host is available
        port.onMessage.addListener(() => {});
        port.onDisconnect.addListener(() => {
          if (port.error) {
            resolve({ connected: false, error: port.error.message });
          }
        });
        // Send a ping
        port.postMessage({ type: "ping", requestId: "ping" });
        // Give it a moment, then assume connected
        setTimeout(() => {
          port.disconnect();
          resolve({ connected: true });
        }, 500);
      } catch (e) {
        resolve({ connected: false, error: e.message });
      }
    });
  }

  async function handleChatRequest(message) {
    const { userMessage, action, conversationHistory = [] } = message;
    const requestId = message.requestId;

    try {
      // Get model from storage
      const stored = await browser.storage.local.get("geminiModel");
      const model = stored.geminiModel || null;

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
      }

      // Build full prompt for CLI
      const fullPrompt = buildFullPrompt(systemPrompt, conversationHistory, finalMessage);

      // Send to Gemini CLI via Native Messaging
      sendToGeminiCLI(fullPrompt, model, requestId);
    } catch (error) {
      browser.runtime.sendMessage({
        type: "CHAT_RESPONSE",
        requestId,
        error: "API_ERROR",
        message: error.message,
      }).catch(() => {});
    }
  }
})();
