// Zen AI Sidebar — Sidebar UI Logic
// Handles chat, quick actions, settings, message streaming, and persistent history

(function () {
  "use strict";

  // ===== State =====
  let conversationHistory = []; // {role, text} array for API context
  let messages = [];            // {role, text, html?} array for display persistence
  let currentConvoId = null;
  let currentSelection = "";
  let isStreaming = false;
  let currentRequestId = 0;
  let isEditingShortcut = false;
  let pendingShortcut = "";
  const MAX_CONVERSATIONS = 50;

  // ===== DOM Elements =====
  const messagesArea = document.getElementById("messagesArea");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const clearBtn = document.getElementById("clearBtn");
  const historyBtn = document.getElementById("historyBtn");
  const historyPanel = document.getElementById("historyPanel");
  const historyClose = document.getElementById("historyClose");
  const historyList = document.getElementById("historyList");
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
    await restoreLastConversation();
  }

  // ===== Conversation Persistence =====
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  }

  // Get the conversation index (list of {id, title, updatedAt, messageCount})
  async function getConvoIndex() {
    const result = await browser.storage.local.get("convoIndex");
    return result.convoIndex || [];
  }

  async function saveConvoIndex(index) {
    await browser.storage.local.set({ convoIndex: index });
  }

  // Save the current conversation to storage
  async function saveCurrentConversation() {
    if (messages.length === 0) return;

    if (!currentConvoId) {
      currentConvoId = generateId();
    }

    // Derive title from first user message
    const firstUser = messages.find(m => m.role === "user");
    const title = firstUser
      ? firstUser.text.substring(0, 80)
      : "New conversation";

    // Save conversation data
    await browser.storage.local.set({
      [`convo_${currentConvoId}`]: {
        id: currentConvoId,
        messages: messages,
        conversationHistory: conversationHistory,
      },
    });

    // Update index
    const index = await getConvoIndex();
    const existing = index.findIndex(c => c.id === currentConvoId);
    const entry = {
      id: currentConvoId,
      title: title,
      updatedAt: Date.now(),
      messageCount: messages.length,
    };
    if (existing >= 0) {
      index[existing] = entry;
    } else {
      index.unshift(entry);
    }
    // Trim old conversations
    while (index.length > MAX_CONVERSATIONS) {
      const old = index.pop();
      await browser.storage.local.remove(`convo_${old.id}`);
    }
    await saveConvoIndex(index);

    // Track which convo is active
    await browser.storage.local.set({ activeConvoId: currentConvoId });
  }

  // Load a conversation by ID
  async function loadConversation(id) {
    const result = await browser.storage.local.get(`convo_${id}`);
    const data = result[`convo_${id}`];
    if (!data) return false;

    currentConvoId = id;
    messages = data.messages || [];
    conversationHistory = data.conversationHistory || [];

    // Rebuild the DOM
    renderMessages();

    await browser.storage.local.set({ activeConvoId: id });
    return true;
  }

  // Restore the last active conversation on sidebar open
  async function restoreLastConversation() {
    try {
      const result = await browser.storage.local.get("activeConvoId");
      if (result.activeConvoId) {
        const loaded = await loadConversation(result.activeConvoId);
        if (loaded) return;
      }
    } catch (e) {}
    // No conversation to restore — show welcome
    showWelcome();
  }

  // Render all messages from the messages array
  function renderMessages() {
    if (messages.length === 0) {
      showWelcome();
      return;
    }
    messagesArea.innerHTML = "";
    for (const msg of messages) {
      if (msg.role === "user") {
        const div = document.createElement("div");
        div.className = "message message-user";
        div.innerHTML = `<div class="message-content">${escapeHtml(msg.text)}</div>`;
        messagesArea.appendChild(div);
      } else if (msg.role === "ai") {
        const div = document.createElement("div");
        div.className = "message message-ai";
        div.innerHTML = `<span class="message-label">Zen AI</span><div class="message-content">${msg.html || renderMarkdown(msg.text)}</div>`;
        messagesArea.appendChild(div);
      } else if (msg.role === "error") {
        const div = document.createElement("div");
        div.className = "message message-ai message-error";
        div.innerHTML = `<span class="message-label">Error</span><div class="message-content">${escapeHtml(msg.text)}</div>`;
        messagesArea.appendChild(div);
      } else if (msg.role === "transcript") {
        addTranscriptMessage(msg.text, msg.videoTitle, msg.aiGenerated);
      }
    }
    scrollToBottom();
  }

  function showWelcome() {
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
  }

  // Start a new conversation
  function startNewConversation() {
    currentConvoId = null;
    conversationHistory = [];
    messages = [];
    showWelcome();
  }

  // Delete a conversation
  async function deleteConversation(id) {
    await browser.storage.local.remove(`convo_${id}`);
    const index = await getConvoIndex();
    const filtered = index.filter(c => c.id !== id);
    await saveConvoIndex(filtered);

    if (currentConvoId === id) {
      startNewConversation();
    }
  }

  // ===== History Panel =====
  async function openHistoryPanel() {
    const index = await getConvoIndex();
    historyList.innerHTML = "";

    if (index.length === 0) {
      historyList.innerHTML = '<div class="history-empty">No conversations yet</div>';
    } else {
      for (const convo of index) {
        const item = document.createElement("div");
        item.className = "history-item" + (convo.id === currentConvoId ? " active" : "");

        const age = formatAge(convo.updatedAt);

        item.innerHTML = `
          <div class="history-item-content">
            <div class="history-item-title">${escapeHtml(convo.title)}</div>
            <div class="history-item-meta">${convo.messageCount} messages &middot; ${age}</div>
          </div>
          <button class="history-item-delete" title="Delete">&times;</button>
        `;

        // Load conversation on click
        item.querySelector(".history-item-content").addEventListener("click", async () => {
          await loadConversation(convo.id);
          historyPanel.classList.add("hidden");
        });

        // Delete button
        item.querySelector(".history-item-delete").addEventListener("click", async (e) => {
          e.stopPropagation();
          await deleteConversation(convo.id);
          await openHistoryPanel(); // refresh list
        });

        historyList.appendChild(item);
      }
    }

    historyPanel.classList.remove("hidden");
  }

  function formatAge(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
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

    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push(e.metaKey ? "Command" : "Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const key = e.key;
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) {
      shortcutInput.value = parts.join("+") + "+...";
      return;
    }

    let normalizedKey = key.length === 1 ? key.toUpperCase() : key;
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
    const welcome = messagesArea.querySelector(".welcome-message");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = "message message-user";
    div.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
    messagesArea.appendChild(div);
    scrollToBottom();

    messages.push({ role: "user", text });
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

  function addTranscriptMessage(transcript, videoTitle, aiGenerated) {
    const welcome = messagesArea.querySelector(".welcome-message");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = "message message-ai";

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    const label = aiGenerated ? "Transcript (AI-generated)" : "Transcript";
    const titleHtml = videoTitle ? `<h3>${label}: ${escapeHtml(videoTitle)}</h3>` : `<h3>${label}</h3>`;
    const noteHtml = aiGenerated ? `<p class="transcript-note">Transcribed by Gemini.</p>` : "";
    const preHtml = `<pre><code>${escapeHtml(transcript)}</code></pre>`;

    contentDiv.innerHTML = titleHtml + noteHtml + preHtml;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy to Clipboard";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(transcript).then(() => {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy to Clipboard";
          copyBtn.classList.remove("copied");
        }, 2000);
      }).catch(() => {
        copyBtn.textContent = "Copy failed";
        setTimeout(() => {
          copyBtn.textContent = "Copy to Clipboard";
        }, 2000);
      });
    });
    contentDiv.appendChild(copyBtn);

    div.innerHTML = `<span class="message-label">Zen AI</span>`;
    div.appendChild(contentDiv);
    messagesArea.appendChild(div);
    scrollToBottom();

    messages.push({ role: "transcript", text: transcript, videoTitle, aiGenerated: !!aiGenerated });
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    });
  }

  // ===== Markdown Rendering =====
  function renderMarkdown(text) {
    if (!text) return "";

    // Extract LaTeX blocks and code blocks before escaping to preserve them
    const placeholders = [];
    let processed = text;

    // Protect code blocks first
    processed = processed.replace(/```(\w*)\n([\s\S]*?)```/g, (match) => {
      const id = placeholders.length;
      placeholders.push({ type: "codeblock", raw: match });
      return `\x00PLACEHOLDER_${id}\x00`;
    });

    // Protect inline code
    processed = processed.replace(/`([^`]+)`/g, (match) => {
      const id = placeholders.length;
      placeholders.push({ type: "inlinecode", raw: match });
      return `\x00PLACEHOLDER_${id}\x00`;
    });

    // Protect display LaTeX ($$...$$)
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
      const id = placeholders.length;
      try {
        const rendered = katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
        placeholders.push({ type: "latex", html: rendered });
      } catch (e) {
        placeholders.push({ type: "latex", html: escapeHtml(tex) });
      }
      return `\x00PLACEHOLDER_${id}\x00`;
    });

    // Protect inline LaTeX ($...$) — avoid matching currency like $5
    processed = processed.replace(/\$([^\s$](?:[^$]*[^\s$])?)\$/g, (_, tex) => {
      const id = placeholders.length;
      try {
        const rendered = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
        placeholders.push({ type: "latex", html: rendered });
      } catch (e) {
        placeholders.push({ type: "latex", html: escapeHtml(tex) });
      }
      return `\x00PLACEHOLDER_${id}\x00`;
    });

    // Protect \[...\] display math
    processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => {
      const id = placeholders.length;
      try {
        const rendered = katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
        placeholders.push({ type: "latex", html: rendered });
      } catch (e) {
        placeholders.push({ type: "latex", html: escapeHtml(tex) });
      }
      return `\x00PLACEHOLDER_${id}\x00`;
    });

    // Protect \(...\) inline math
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => {
      const id = placeholders.length;
      try {
        const rendered = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
        placeholders.push({ type: "latex", html: rendered });
      } catch (e) {
        placeholders.push({ type: "latex", html: escapeHtml(tex) });
      }
      return `\x00PLACEHOLDER_${id}\x00`;
    });

    let html = escapeHtml(processed);

    // Restore code blocks
    html = html.replace(/\x00PLACEHOLDER_(\d+)\x00/g, (_, idx) => {
      const p = placeholders[parseInt(idx)];
      if (p.type === "codeblock") {
        const match = p.raw.match(/```(\w*)\n([\s\S]*?)```/);
        return `<pre><code>${escapeHtml(match[2].trim())}</code></pre>`;
      }
      if (p.type === "inlinecode") {
        const match = p.raw.match(/`([^`]+)`/);
        return `<code>${escapeHtml(match[1])}</code>`;
      }
      if (p.type === "latex") {
        return p.html;
      }
      return p.raw;
    });

    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

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
          block.startsWith("<blockquote") ||
          block.startsWith("<span class=\"katex")
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
      const label = actionLabels[action] || action;
      addUserMessage(label);
      conversationHistory.push({ role: "user", text: label });
    }

    const aiContent = addAiMessage();
    let fullResponse = "";

    chatInput.value = "";
    chatInput.style.height = "auto";
    updateSendButton();

    browser.runtime.sendMessage({
      type: "CHAT_REQUEST",
      requestId,
      userMessage: text || "",
      action: action,
      conversationHistory: conversationHistory.slice(-10),
    });

    function responseHandler(msg) {
      if (msg.type !== "CHAT_RESPONSE" || msg.requestId !== requestId) return;

      if (msg.error) {
        aiContent.closest(".message").classList.add("message-error");
        if (msg.error === "NO_API_KEY") {
          aiContent.innerHTML =
            'No API key set. Click the <strong>settings</strong> icon to add your Gemini API key.';
          messages.push({ role: "error", text: "No API key set." });
        } else {
          const errText = msg.message || "An error occurred.";
          aiContent.innerHTML = renderMarkdown(errText);
          messages.push({ role: "error", text: errText });
        }
        isStreaming = false;
        saveCurrentConversation();
        browser.runtime.onMessage.removeListener(responseHandler);
        return;
      }

      if (msg.chunk) {
        const typingIndicator = aiContent.querySelector(".typing-indicator");
        if (typingIndicator) typingIndicator.remove();

        fullResponse += msg.chunk;
        aiContent.innerHTML = renderMarkdown(fullResponse);
        scrollToBottom();
      }

      if (msg.done) {
        isStreaming = false;
        conversationHistory.push({ role: "model", text: fullResponse });
        messages.push({ role: "ai", text: fullResponse });
        saveCurrentConversation();
        browser.runtime.onMessage.removeListener(responseHandler);
      }
    }

    browser.runtime.onMessage.addListener(responseHandler);
  }

  // ===== YouTube Transcript =====
  let isTranscriptLoading = false;

  async function requestTranscript() {
    if (isStreaming || isTranscriptLoading) return;
    isTranscriptLoading = true;

    addUserMessage("Get YouTube transcript");
    conversationHistory.push({ role: "user", text: "Get YouTube transcript" });
    const aiContent = addAiMessage();

    try {
      const response = await browser.runtime.sendMessage({ type: "YOUTUBE_TRANSCRIPT_REQUEST" });

      const typingIndicator = aiContent.querySelector(".typing-indicator");
      if (typingIndicator) typingIndicator.remove();

      if (response?.error) {
        aiContent.closest(".message").classList.add("message-error");
        aiContent.textContent = response.error;
        messages.push({ role: "error", text: response.error });
      } else if (response?.transcript) {
        aiContent.closest(".message").remove();
        addTranscriptMessage(response.transcript, response.videoTitle, response.aiGenerated);
      } else {
        aiContent.closest(".message").classList.add("message-error");
        aiContent.textContent = "Failed to get transcript.";
        messages.push({ role: "error", text: "Failed to get transcript." });
      }
    } catch (e) {
      const typingIndicator = aiContent.querySelector(".typing-indicator");
      if (typingIndicator) typingIndicator.remove();
      aiContent.closest(".message").classList.add("message-error");
      aiContent.textContent = "Failed to get transcript: " + e.message;
      messages.push({ role: "error", text: "Failed to get transcript: " + e.message });
    } finally {
      isTranscriptLoading = false;
    }

    saveCurrentConversation();
  }

  // ===== Event Listeners =====
  function setupEventListeners() {
    sendBtn.addEventListener("click", () => {
      const text = chatInput.value.trim();
      if (text) sendMessage(text);
    });

    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) sendMessage(text);
      }
    });

    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
      updateSendButton();
    });

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

    // New Chat — save current, start fresh
    clearBtn.addEventListener("click", () => {
      if (messages.length > 0) {
        saveCurrentConversation();
      }
      startNewConversation();
    });

    // History panel
    historyBtn.addEventListener("click", () => {
      if (historyPanel.classList.contains("hidden")) {
        openHistoryPanel();
      } else {
        historyPanel.classList.add("hidden");
      }
    });
    historyClose.addEventListener("click", () => {
      historyPanel.classList.add("hidden");
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

    toggleKeyVisibility.addEventListener("click", () => {
      apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
    });

    themeSelect.addEventListener("change", () => {
      ThemeManager.applyTheme(themeSelect.value);
    });

    document.querySelectorAll(".layout-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".layout-option").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyLayout(btn.dataset.layoutValue);
      });
    });

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

    editShortcutBtn.addEventListener("click", () => {
      if (isEditingShortcut) {
        stopEditingShortcut(false);
      } else {
        startEditingShortcut();
      }
    });

    shortcutInput.addEventListener("keydown", shortcutKeyHandler);

    selectionDismiss.addEventListener("click", () => {
      updateSelectionBanner("");
    });

    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SELECTION_UPDATE") {
        updateSelectionBanner(msg.selection);
      }
      if (msg.type === "YOUTUBE_NAVIGATION") {
        updateContextBar();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        updateContextBar();
      }
    });

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
