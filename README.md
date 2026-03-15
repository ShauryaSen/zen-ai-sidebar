# Zen AI Sidebar

Extension adding AI sidebar for [Zen Browser](https://zen-browser.app) and Firefox. Ask questions about the page you're viewing, summarize content, and get explanations for highlighted text, using your own Gemini API key.

![Zen AI Demo](assets/demo.gif)

## Features

- **Page-aware AI chat**: automatically reads the current page and uses it as context
- **Text selection detection**: highlight text and ask about it
- **Quick actions**: one-click Summarize, Explain, Key Points, Research Paper summary, and YouTube Transcript export
- **Catppuccin themes**: Latte, Frappe, Macchiato, and Mocha, plus Zen Browser auto-matching and custom theme import
- **Layout flip**: mirror the sidebar layout for left-side use
- **Customizable hotkey**: change the sidebar toggle shortcut from settings
- **Bring your own key**: uses your Gemini API key, no third-party servers

## Install

1. Open `about:debugging#/runtime/this-firefox` in Zen or Firefox
2. Click **"Load Temporary Add-on..."**
3. Select the `manifest.json` file from this repo
4. Toggle the sidebar with **Cmd+Shift+U** (Mac) or **Ctrl+Shift+U** (Windows/Linux)

## Setup

1. Get a Gemini API key from [aistudio.google.com](https://aistudio.google.com/apikey)
2. Open the sidebar → click the **gear icon**
3. Paste your API key → choose a model → **Save**

### Available Models

| Model | Best for |
|-------|----------|
| Gemini 3 Flash | General use (default) |
| Gemini 3.1 Flash Lite | Speed, lower cost |
| Gemini 3.1 Pro | Complex reasoning |

## Themes

Choose from the settings dropdown:

- **System / Light / Dark** — basic themes
- **Zen Browser** — auto-matches your browser theme
- **Catppuccin** — Latte, Frappe, Macchiato, Mocha
- **Custom** — import any theme JSON file

### Custom Theme Format

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "type": "dark",
  "colors": {
    "bg-primary": "#1e1e2e",
    "bg-secondary": "#181825",
    "bg-tertiary": "#313244",
    "bg-input": "#313244",
    "bg-user-msg": "#45475a",
    "text-primary": "#cdd6f4",
    "text-secondary": "#a6adc8",
    "text-muted": "#6c7086",
    "accent": "#89b4fa",
    "accent-light": "rgba(137, 180, 250, 0.1)",
    "border-color": "#45475a",
    "border-light": "#313244",
    "shadow-modal": "0 8px 30px rgba(0,0,0,0.4)"
  }
}
```

## Quick Actions

| Action | Description |
|--------|-------------|
| **Summarize** | Summarize the current page |
| **Explain** | Explain highlighted text or page content |
| **Key Points** | Extract bullet-point key points |
| **Research Paper** | Structured analysis (title, authors, abstract, methodology, findings, limitations, conclusion) — works on arxiv, PubMed, IEEE, and other academic sites |
| **Transcript** | Extract YouTube video transcript with timestamps (appears only on YouTube watch pages) |

## License

MIT
