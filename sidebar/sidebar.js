// Zen AI Sidebar — Sidebar UI Logic
// Handles chat, quick actions, settings, and message streaming

(function () {
  "use strict";

  // ===== State =====
  let conversationHistory = [];
  let currentSelection = "";
  let isStreaming = false;
  let currentRequestId = 0;
  let isEditingShortcut = false;
  let pendingShortcut = "";

  // ===== DOM Elements =====
  const messagesArea = document.getElementById("messagesArea");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const clearBtn = document.getElementById("clearBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const settingsClose = document.getElementById("settingsClose");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const modelSelect = document.getElementById("modelSelect");
  const themeSelect = document.getElementById("themeSelect");
  const toggleKeyVisibility = document.getElementById("toggleKeyVisibility");
  const saveSettingsBtn = document.getElementById("saveSettings");
  const saveStatus = document.getElementById("saveStatus");
  const contextBar = document.getElementById("contextBar");
  const contextText = document.getElementById("contextText");
  const selectionBanner = document.getElementById("selectionBanner");
  const selectionText = document.getElementById("selectionText");
  const selectionDismiss = document.getElementById("selectionDismiss");
  const quickActions = document.getElementById("quickActions");
  const transcriptBtn = document.getElementById("transcriptBtn");
  const importThemeBtn = document.getElementById("importThemeBtn");
  const themeFileInput = document.getElementById("themeFileInput");
  const customThemeGroup = document.getElementById("customThemeGroup");
  const shortcutInput = document.getElementById("shortcutInput");
  const editShortcutBtn = document.getElementById("editShortcutBtn");
  const shortcutHint = document.getElementById("shortcutHint");

  // ===== Init =====
  async function init() {
    await ThemeManager.init();
    loadSettings();
    updateContextBar();
    setupEventListeners();
    loadCustomThemeOptions();
    loadCurrentShortcut();
  }

  // ===== Settings =====
  async function loadSettings() {
    try {
      const result = await browser.storage.local.get([
        "geminiApiKey", "geminiModel", "sidebarTheme", "sidebarLayout"
      ]);
      if (result.geminiApiKey) {
        apiKeyInput.value = result.geminiApiKey;
      }
      if (result.geminiModel) {
        modelSelect.value = result.geminiModel;
      }
      themeSelect.value = result.sidebarTheme || "system";

      // Layout
      const layout = result.sidebarLayout || "default";
      applyLayout(layout);
      updateLayoutButtons(layout);
    } catch (e) {
      console.warn("Could not load settings:", e);
    }
  }

  async function saveSettings() {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const theme = themeSelect.value;
    const activeLayoutBtn = document.querySelector(".layout-option.active");
    const layout = activeLayoutBtn ? activeLayoutBtn.dataset.layoutValue : "default";

    await browser.storage.local.set({
      geminiApiKey: apiKey,
      geminiModel: model,
      sidebarTheme: theme,
      sidebarLayout: layout,
    });

    await ThemeManager.applyTheme(theme);
    applyLayout(layout);

    // Also update the background script's model
    await browser.runtime.sendMessage({
      type: "SET_MODEL",
      model: model,
    }).catch(() => {});

    showSaveStatus("Settings saved", false);
  }

  function showSaveStatus(text, isError) {
    saveStatus.textContent = (isError ? "" : "\u2713 ") + text;
    saveStatus.className = "save-status" + (isError ? " error" : "");
    saveStatus.classList.remove("hidden");
    setTimeout(() => saveStatus.classList.add("hidden"), 2000);
  }

  // ===== Layout =====
  function applyLayout(layout) {
    document.querySelector(".sidebar-container").classList.toggle(
      "layout-mirrored", layout === "mirrored"
    );
  }

  function updateLayoutButtons(activeValue) {
    document.querySelectorAll(".layout-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.layoutValue === activeValue);
    });
  }

  // ===== Custom Themes =====
  async function loadCustomThemeOptions() {
    const customs = await ThemeManager.getCustomThemes();
    customThemeGroup.innerHTML = "";
    for (const theme of customs) {
      const opt = document.createElement("option");
      opt.value = theme.id;
      opt.textContent = theme.name;
      customThemeGroup.appendChild(opt);
    }
    // Re-select current theme in case it's custom
    try {
      const result = await browser.storage.local.get("sidebarTheme");
      if (result.sidebarTheme) themeSelect.value = result.sidebarTheme;
    } catch (e) {}
  }

  // ===== Shortcut =====
  async function loadCurrentShortcut() {
    try {
      const commands = await browser.commands.getAll();
      const cmd = commands.find(c => c.name === "toggle-sidebar");
      if (cmd && cmd.shortcut) {
        shortcutInput.value = cmd.shortcut;
      } else {
        shortcutInput.value = "Not set";
      }
    } catch (e) {
      shortcutInput.value = "Unable to read";
    }
  }

  function startEditingShortcut() {
    isEditingShortcut = true;
    pendingShortcut = "";
    shortcutInput.value = "";
    shortcutInput.readOnly = false;
    shortcutInput.classList.add("editing");
    shortcutInput.focus();
    shortcutHint.classList.remove("hidden");
  }

  function stopEditingShortcut(apply) {
    isEditingShortcut = false;
    shortcutInput.readOnly = true;
    shortcutInput.classList.remove("editing");
    shortcutHint.classList.add("hidden");

    if (apply && pendingShortcut) {
      applyShortcut(pendingShortcut);
    } else {
      loadCurrentShortcut();
    }
  }

  async function applyShortcut(shortcut) {
    try {
      await browser.commands.update({
        name: "toggle-sidebar",
        shortcut: shortcut,
      });
      shortcutInput.value = shortcut;
      showSaveStatus("Shortcut updated", false);
    } catch (e) {
      showSaveStatus("Invalid shortcut. Try Ctrl+Shift+<key>", true);
      loadCurrentShortcut();
    }
  }

  function shortcutKeyHandler(e) {
    if (!isEditingShortcut) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      stopEditingShortcut(false);
      return;
    }
    if (e.key === "Enter") {
      stopEditingShortcut(true);
      return;
    }

    // Build shortcut string from modifiers + key
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push(e.metaKey ? "Command" : "Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const key = e.key;
    // Skip if only modifier keys pressed
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) {
      shortcutInput.value = parts.join("+") + "+...";
      return;
    }

    // Normalize the key
    let normalizedKey = key.length === 1 ? key.toUpperCase() : key;
    // Map some special keys
    const keyMap = {
      "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
      " ": "Space", "Backspace": "Backspace", "Delete": "Delete",
      "Home": "Home", "End": "End", "PageUp": "PageUp", "PageDown": "PageDown",
    };
    if (keyMap[key]) normalizedKey = keyMap[key];

    parts.push(normalizedKey);
    pendingShortcut = parts.join("+");
    shortcutInput.value = pendingShortcut;
  }

  // ===== Context =====
  async function updateContextBar() {
    try {
      const response = await browser.runtime.sendMessage({ type: "GET_CONTEXT" });
      if (response?.pageContext?.meta?.title) {
        contextText.textContent = response.pageContext.meta.title;
        contextBar.title = response.pageContext.meta.url || "";

        // Show/hide transcript button based on URL
        const url = response.pageContext.meta.url || "";
        if (url.includes("youtube.com/watch")) {
          transcriptBtn.classList.remove("hidden");
        } else {
          transcriptBtn.classList.add("hidden");
        }
      } else {
        contextText.textContent = "No page loaded";
        transcriptBtn.classList.add("hidden");
      }
    } catch (e) {
      contextText.textContent = "No page loaded";
      transcriptBtn.classList.add("hidden");
    }
  }

  function updateSelectionBanner(text) {
    if (text && text.length > 0) {
      currentSelection = text;
      const preview = text.length > 60 ? text.substring(0, 60) + "\u2026" : text;
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

  function addTranscriptMessage(transcript, videoTitle) {
    const welcome = messagesArea.querySelector(".welcome-message");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = "message message-ai";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    const titleHtml = videoTitle ? `<h3>Transcript: ${escapeHtml(videoTitle)}</h3>` : "<h3>Transcript</h3>";
    const preHtml = `<pre><code>${escapeHtml(transcript)}</code></pre>`;
    const copyBtnHtml = `<button class="copy-btn" data-copy-text="${escapeAttr(transcript)}">Copy to Clipboard</button>`;

    contentDiv.innerHTML = titleHtml + preHtml + copyBtnHtml;

    div.innerHTML = `<span class="message-label">Zen AI</span>`;
    div.appendChild(contentDiv);
    messagesArea.appendChild(div);
    scrollToBottom();
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

  function escapeAttr(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        summarize: "Summarize this page",
        explain: currentSelection
          ? `Explain: "${currentSelection.substring(0, 50)}${currentSelection.length > 50 ? "\u2026" : ""}"`
          : "Explain this page",
        keypoints: "Extract key points",
        "paper-summary": "Analyze as research paper",
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
      conversationHistory: conversationHistory.slice(-10),
    });

    // Listen for streamed response
    function responseHandler(msg) {
      if (msg.type !== "CHAT_RESPONSE" || msg.requestId !== requestId) return;

      if (msg.error) {
        aiContent.closest(".message").classList.add("message-error");
        if (msg.error === "NO_API_KEY") {
          aiContent.innerHTML =
            'No API key set. Click the <strong>settings</strong> icon to add your Gemini API key.';
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

  // ===== YouTube Transcript =====
  async function requestTranscript() {
    if (isStreaming) return;

    addUserMessage("Get YouTube transcript");
    const aiContent = addAiMessage();

    try {
      const response = await browser.runtime.sendMessage({ type: "YOUTUBE_TRANSCRIPT_REQUEST" });

      // Remove typing indicator
      const typingIndicator = aiContent.querySelector(".typing-indicator");
      if (typingIndicator) typingIndicator.remove();

      if (response?.error) {
        aiContent.closest(".message").classList.add("message-error");
        aiContent.textContent = response.error;
      } else if (response?.transcript) {
        // Replace the AI message with formatted transcript
        aiContent.closest(".message").remove();
        addTranscriptMessage(response.transcript, response.videoTitle);
      } else {
        aiContent.closest(".message").classList.add("message-error");
        aiContent.textContent = "Failed to get transcript.";
      }
    } catch (e) {
      const typingIndicator = aiContent.querySelector(".typing-indicator");
      if (typingIndicator) typingIndicator.remove();
      aiContent.closest(".message").classList.add("message-error");
      aiContent.textContent = "Failed to get transcript: " + e.message;
    }
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
      if (action === "transcript") {
        requestTranscript();
      } else if (action) {
        sendMessage(null, action);
      }
    });

    // Copy button delegation
    messagesArea.addEventListener("click", (e) => {
      const copyBtn = e.target.closest(".copy-btn");
      if (!copyBtn) return;
      const text = copyBtn.dataset.copyText;
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "Copied!";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.textContent = "Copy to Clipboard";
            copyBtn.classList.remove("copied");
          }, 2000);
        });
      }
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
    });

    settingsClose.addEventListener("click", () => {
      settingsModal.classList.add("hidden");
      if (isEditingShortcut) stopEditingShortcut(false);
    });

    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.add("hidden");
        if (isEditingShortcut) stopEditingShortcut(false);
      }
    });

    saveSettingsBtn.addEventListener("click", saveSettings);

    // Toggle API key visibility
    toggleKeyVisibility.addEventListener("click", () => {
      apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
    });

    // Theme select — live preview
    themeSelect.addEventListener("change", () => {
      ThemeManager.applyTheme(themeSelect.value);
    });

    // Layout toggle buttons
    document.querySelectorAll(".layout-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".layout-option").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyLayout(btn.dataset.layoutValue);
      });
    });

    // Import theme
    importThemeBtn.addEventListener("click", () => {
      themeFileInput.click();
    });

    themeFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const theme = await ThemeManager.importTheme(json);
        await loadCustomThemeOptions();
        themeSelect.value = theme.id;
        await ThemeManager.applyTheme(theme.id);
        showSaveStatus("Theme imported: " + theme.name, false);
      } catch (err) {
        showSaveStatus("Import failed: " + err.message, true);
      }
      themeFileInput.value = "";
    });

    // Shortcut editing
    editShortcutBtn.addEventListener("click", () => {
      if (isEditingShortcut) {
        stopEditingShortcut(false);
      } else {
        startEditingShortcut();
      }
    });

    shortcutInput.addEventListener("keydown", shortcutKeyHandler);

    // Selection dismiss
    selectionDismiss.addEventListener("click", () => {
      updateSelectionBanner("");
    });

    // Listen for selection updates from content script
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SELECTION_UPDATE") {
        updateSelectionBanner(msg.selection);
      }
      if (msg.type === "YOUTUBE_NAVIGATION") {
        updateContextBar();
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
