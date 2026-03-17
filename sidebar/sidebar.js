// Zen AI Sidebar — Sidebar UI Logic
// Handles chat, quick actions, settings, and message streaming

(function () {
  "use strict";

  // ===== State =====
  let conversationHistory = [];
  let currentSelection = "";
  let isStreaming = false;
  let currentRequestId = 0;

  // ===== DOM Elements =====
  const messagesArea = document.getElementById("messagesArea");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const clearBtn = document.getElementById("clearBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const settingsClose = document.getElementById("settingsClose");
  const modelSelect = document.getElementById("modelSelect");
  const saveSettingsBtn = document.getElementById("saveSettings");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const saveStatus = document.getElementById("saveStatus");
  const contextBar = document.getElementById("contextBar");
  const contextText = document.getElementById("contextText");
  const selectionBanner = document.getElementById("selectionBanner");
  const selectionText = document.getElementById("selectionText");
  const selectionDismiss = document.getElementById("selectionDismiss");
  const quickActions = document.getElementById("quickActions");

  // ===== Init =====
  async function init() {
    await loadTheme();
    loadSettings();
    updateContextBar();
    setupEventListeners();
  }

  // ===== Theme =====
  function getSystemTheme() {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      return "light";
    }
  }

  function applyTheme(theme) {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    document.documentElement.setAttribute("data-theme", resolved);
  }

  async function loadTheme() {
    try {
      const result = await browser.storage.local.get("sidebarTheme");
      const theme = result.sidebarTheme || "system";
      applyTheme(theme);
      return theme;
    } catch (e) {
      applyTheme("light");
      return "light";
    }
  }

  function updateThemeButtons(activeValue) {
    document.querySelectorAll(".theme-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeValue === activeValue);
    });
  }

  // ===== Settings =====
  async function loadSettings() {
    try {
      const result = await browser.storage.local.get(["geminiModel", "sidebarTheme"]);
      if (result.geminiModel) {
        // Validate stored model against available options
        const validModels = Array.from(modelSelect.options).map(o => o.value);
        if (validModels.includes(result.geminiModel)) {
          modelSelect.value = result.geminiModel;
        } else {
          // Clear invalid cached model (e.g. from old version)
          modelSelect.value = "";
          await browser.storage.local.set({ geminiModel: "" });
        }
      }
      updateThemeButtons(result.sidebarTheme || "system");
    } catch (e) {
      console.warn("Could not load settings:", e);
      updateThemeButtons("system");
    }
  }

  async function saveSettings() {
    const model = modelSelect.value;
    const activeThemeBtn = document.querySelector(".theme-option.active");
    const theme = activeThemeBtn ? activeThemeBtn.dataset.themeValue : "system";

    await browser.storage.local.set({
      geminiModel: model,
      sidebarTheme: theme,
    });

    applyTheme(theme);

    saveStatus.classList.remove("hidden");
    setTimeout(() => saveStatus.classList.add("hidden"), 2000);
  }

  // ===== Connection Status =====
  async function checkConnectionStatus() {
    try {
      const result = await browser.runtime.sendMessage({ type: "CHECK_NATIVE_HOST" });
      if (result?.connected) {
        statusDot.className = "status-dot connected";
        statusText.textContent = "Connected";
      } else {
        statusDot.className = "status-dot disconnected";
        statusText.textContent = result?.error || "Not connected — run install_host.sh";
      }
    } catch (e) {
      statusDot.className = "status-dot disconnected";
      statusText.textContent = "Could not check status";
    }
  }

  // ===== Context =====
  async function updateContextBar() {
    try {
      const response = await browser.runtime.sendMessage({ type: "GET_CONTEXT" });
      if (response?.pageContext?.meta?.title) {
        contextText.textContent = response.pageContext.meta.title;
        contextBar.title = response.pageContext.meta.url || "";
      } else {
        contextText.textContent = "No page loaded";
      }
    } catch (e) {
      contextText.textContent = "No page loaded";
    }
  }

  function updateSelectionBanner(text) {
    if (text && text.length > 0) {
      currentSelection = text;
      const preview = text.length > 60 ? text.substring(0, 60) + "…" : text;
      selectionText.textContent = `"${preview}"`;
      selectionBanner.classList.remove("hidden");
    } else {
      currentSelection = "";
      selectionBanner.classList.add("hidden");
    }
  }

  // ===== Messages =====
  function addUserMessage(text) {
    // Remove welcome message
    const welcome = messagesArea.querySelector(".welcome-message");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = "message message-user";
    div.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
    messagesArea.appendChild(div);
    scrollToBottom();
  }

  function addAiMessage() {
    const div = document.createElement("div");
    div.className = "message message-ai";
    div.innerHTML = `
      <span class="message-label">Zen AI</span>
      <div class="message-content">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
    return div.querySelector(".message-content");
  }

  function addErrorMessage(text) {
    const div = document.createElement("div");
    div.className = "message message-ai message-error";
    div.innerHTML = `
      <span class="message-label">Error</span>
      <div class="message-content">${escapeHtml(text)}</div>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    });
  }

  // ===== Markdown Rendering =====
  function renderMarkdown(text) {
    if (!text) return "";

    let html = escapeHtml(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Headers
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

    // Unordered lists
    html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Links
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    // Paragraphs — wrap remaining text blocks
    html = html
      .split("\n\n")
      .map((block) => {
        block = block.trim();
        if (!block) return "";
        if (
          block.startsWith("<h") ||
          block.startsWith("<pre") ||
          block.startsWith("<ul") ||
          block.startsWith("<ol") ||
          block.startsWith("<blockquote")
        ) {
          return block;
        }
        return `<p>${block.replace(/\n/g, "<br>")}</p>`;
      })
      .join("");

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Chat Logic =====
  async function sendMessage(text, action = null) {
    if (isStreaming) return;
    if (!text && !action) return;

    isStreaming = true;
    const requestId = ++currentRequestId;

    // Display user message (for typed messages)
    if (text && !action) {
      addUserMessage(text);
      conversationHistory.push({ role: "user", text: text });
    } else if (action) {
      const actionLabels = {
        summarize: "📄 Summarize this page",
        explain: currentSelection
          ? `💡 Explain: "${currentSelection.substring(0, 50)}${currentSelection.length > 50 ? "…" : ""}"`
          : "💡 Explain this page",
        keypoints: "📋 Extract key points",
      };
      addUserMessage(actionLabels[action] || action);
    }

    // Create AI response container
    const aiContent = addAiMessage();
    let fullResponse = "";

    // Clear input
    chatInput.value = "";
    chatInput.style.height = "auto";
    updateSendButton();

    // Send to background script
    browser.runtime.sendMessage({
      type: "CHAT_REQUEST",
      requestId,
      userMessage: text || "",
      action: action,
      conversationHistory: conversationHistory.slice(-10), // Keep last 10 messages
    });

    // Listen for streamed response
    function responseHandler(msg) {
      if (msg.type !== "CHAT_RESPONSE" || msg.requestId !== requestId) return;

      if (msg.error) {
        aiContent.closest(".message").classList.add("message-error");
        if (msg.error === "NATIVE_HOST_ERROR") {
          aiContent.innerHTML =
            'Could not connect to Gemini CLI. Run <strong>install_host.sh</strong> and make sure <code>gemini</code> CLI is installed.';
        } else {
          aiContent.innerHTML = renderMarkdown(msg.message || "An error occurred.");
        }
        isStreaming = false;
        browser.runtime.onMessage.removeListener(responseHandler);
        return;
      }

      if (msg.chunk) {
        // Remove typing indicator on first chunk
        const typingIndicator = aiContent.querySelector(".typing-indicator");
        if (typingIndicator) typingIndicator.remove();

        fullResponse += msg.chunk;
        aiContent.innerHTML = renderMarkdown(fullResponse);
        scrollToBottom();
      }

      if (msg.done) {
        isStreaming = false;
        conversationHistory.push({ role: "model", text: fullResponse });
        browser.runtime.onMessage.removeListener(responseHandler);
      }
    }

    browser.runtime.onMessage.addListener(responseHandler);
  }

  // ===== Event Listeners =====
  function setupEventListeners() {
    // Send button
    sendBtn.addEventListener("click", () => {
      const text = chatInput.value.trim();
      if (text) sendMessage(text);
    });

    // Enter to send (Shift+Enter for newline)
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) sendMessage(text);
      }
    });

    // Auto-resize textarea
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
      updateSendButton();
    });

    // Quick action buttons
    quickActions.addEventListener("click", (e) => {
      const btn = e.target.closest(".action-btn");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action) sendMessage(null, action);
    });

    // Clear conversation / New Chat
    clearBtn.addEventListener("click", () => {
      conversationHistory = [];
      messagesArea.innerHTML = `
        <div class="welcome-message">
          <div class="welcome-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h2>Zen AI</h2>
          <p>Ask questions about the current page, summarize content, or get explanations for highlighted text.</p>
        </div>`;
    });

    // Settings
    settingsBtn.addEventListener("click", () => {
      settingsModal.classList.remove("hidden");
      checkConnectionStatus();
    });

    settingsClose.addEventListener("click", () => {
      settingsModal.classList.add("hidden");
    });

    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) settingsModal.classList.add("hidden");
    });

    saveSettingsBtn.addEventListener("click", saveSettings);

    // Theme toggle buttons
    document.querySelectorAll(".theme-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".theme-option").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyTheme(btn.dataset.themeValue);
      });
    });

    // Selection dismiss
    selectionDismiss.addEventListener("click", () => {
      updateSelectionBanner("");
    });

    // Listen for selection updates from content script
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SELECTION_UPDATE") {
        updateSelectionBanner(msg.selection);
      }
    });

    // Update context when sidebar becomes visible
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        updateContextBar();
      }
    });

    // Periodic context update (every 5 seconds when visible)
    setInterval(() => {
      if (!document.hidden) {
        updateContextBar();
      }
    }, 5000);
  }

  function updateSendButton() {
    sendBtn.disabled = chatInput.value.trim().length === 0;
  }

  // ===== Start =====
  init();
})();
