// Zen AI Sidebar — Theme Manager
// Handles theme loading, applying, importing, and Zen Browser detection

const ThemeManager = (function () {
  "use strict";

  const CSS_PROPS = [
    "bg-primary", "bg-secondary", "bg-tertiary", "bg-input", "bg-user-msg",
    "text-primary", "text-secondary", "text-muted",
    "accent", "accent-light",
    "border-color", "border-light",
    "shadow-modal"
  ];

  const BUILTIN_THEMES = [
    "catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"
  ];

  let currentThemeId = "system";
  let themeCache = {};

  // Load a theme JSON file from the extension
  async function fetchTheme(id) {
    if (themeCache[id]) return themeCache[id];
    const url = browser.runtime.getURL(`themes/${id}.json`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load theme: ${id}`);
    const theme = await resp.json();
    themeCache[id] = theme;
    return theme;
  }

  // Clear all inline CSS variable overrides
  function clearInlineTheme() {
    const style = document.documentElement.style;
    for (const prop of CSS_PROPS) {
      style.removeProperty(`--${prop}`);
    }
  }

  // Apply color overrides from a theme object
  function applyColors(colors) {
    const style = document.documentElement.style;
    for (const prop of CSS_PROPS) {
      if (colors[prop]) {
        style.setProperty(`--${prop}`, colors[prop]);
      }
    }
  }

  // Resolve system theme preference
  function getSystemTheme() {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      return "light";
    }
  }

  // Apply a theme by ID
  async function applyTheme(id) {
    currentThemeId = id;
    clearInlineTheme();

    // Basic themes — just set data-theme attribute
    if (id === "system" || id === "light" || id === "dark") {
      const resolved = id === "system" ? getSystemTheme() : id;
      document.documentElement.setAttribute("data-theme", resolved);
      return;
    }

    // Zen auto — handled via messages from background; set data-theme as fallback
    if (id === "zen-auto") {
      document.documentElement.setAttribute("data-theme", getSystemTheme());
      // Request current Zen theme from background
      browser.runtime.sendMessage({ type: "GET_ZEN_THEME" }).catch(() => {});
      return;
    }

    // Builtin Catppuccin themes
    if (BUILTIN_THEMES.includes(id)) {
      try {
        const theme = await fetchTheme(id);
        document.documentElement.setAttribute("data-theme", theme.type);
        applyColors(theme.colors);
      } catch (e) {
        console.warn("Failed to apply theme:", e);
        document.documentElement.setAttribute("data-theme", getSystemTheme());
      }
      return;
    }

    // Custom imported theme — stored in browser.storage.local
    try {
      const result = await browser.storage.local.get("customThemes");
      const custom = (result.customThemes || []).find(t => t.id === id);
      if (custom) {
        document.documentElement.setAttribute("data-theme", custom.type || "dark");
        applyColors(custom.colors);
      } else {
        document.documentElement.setAttribute("data-theme", getSystemTheme());
      }
    } catch (e) {
      document.documentElement.setAttribute("data-theme", getSystemTheme());
    }
  }

  // Apply Zen Browser theme colors (received from background script)
  function applyZenTheme(zenColors) {
    if (currentThemeId !== "zen-auto") return;
    clearInlineTheme();

    // Determine if the Zen theme is dark or light based on frame color
    const frame = zenColors.frame || "#ffffff";
    const isDark = isColorDark(frame);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");

    // Map Zen theme colors to our CSS variables
    const mapping = {};
    if (zenColors.frame) mapping["bg-primary"] = zenColors.frame;
    if (zenColors.toolbar) mapping["bg-secondary"] = zenColors.toolbar;
    if (zenColors.toolbar_field) mapping["bg-input"] = zenColors.toolbar_field;
    if (zenColors.toolbar_field) mapping["bg-tertiary"] = zenColors.toolbar_field;
    if (zenColors.toolbar_text) mapping["text-primary"] = zenColors.toolbar_text;
    if (zenColors.toolbar_field_text) mapping["text-secondary"] = zenColors.toolbar_field_text;
    if (zenColors.popup) mapping["bg-user-msg"] = zenColors.popup;
    if (zenColors.popup_border) mapping["border-color"] = zenColors.popup_border;

    applyColors(mapping);
  }

  // Check if a hex color is dark
  function isColorDark(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }

  // Validate and import a custom theme JSON
  async function importTheme(json) {
    if (!json.id || !json.name || !json.colors) {
      throw new Error("Invalid theme: must have id, name, and colors");
    }
    // Validate that at least some expected color props exist
    const hasColors = CSS_PROPS.some(p => json.colors[p]);
    if (!hasColors) {
      throw new Error("Invalid theme: colors object has no recognized properties");
    }

    const theme = {
      id: json.id,
      name: json.name,
      type: json.type || "dark",
      colors: {}
    };
    for (const prop of CSS_PROPS) {
      if (json.colors[prop]) theme.colors[prop] = json.colors[prop];
    }

    const result = await browser.storage.local.get("customThemes");
    const customs = result.customThemes || [];
    const existing = customs.findIndex(t => t.id === theme.id);
    if (existing >= 0) {
      customs[existing] = theme;
    } else {
      customs.push(theme);
    }
    await browser.storage.local.set({ customThemes: customs });
    return theme;
  }

  // Get list of custom themes
  async function getCustomThemes() {
    const result = await browser.storage.local.get("customThemes");
    return result.customThemes || [];
  }

  // Initialize — load stored theme and apply
  async function init() {
    try {
      const result = await browser.storage.local.get("sidebarTheme");
      const themeId = result.sidebarTheme || "system";
      await applyTheme(themeId);
    } catch (e) {
      document.documentElement.setAttribute("data-theme", "light");
    }

    // Listen for Zen theme updates from background
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === "ZEN_THEME_DETECTED") {
        applyZenTheme(msg.colors);
      }
    });

    // Listen for system theme changes
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (currentThemeId === "system") {
          applyTheme("system");
        }
      });
    } catch (e) {}
  }

  return {
    init,
    applyTheme,
    applyZenTheme,
    importTheme,
    getCustomThemes,
    clearInlineTheme,
    get currentThemeId() { return currentThemeId; }
  };
})();
