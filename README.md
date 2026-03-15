# Zen AI Sidebar

An AI-powered browser sidebar for [Zen Browser](https://zen-browser.app) and Firefox. Ask questions about the page you're viewing, summarize content, and get explanations for highlighted text, using your own gemini API key.

## Features

- **Page-aware AI chat**: automatically reads the current page and uses it as context
- **Text selection detection**: highlight text and ask about it
- **Quick actions**: one-click Summarize, Explain, and Key Points
- **Bring your own key**: uses your Gemini API key, no third-party servers

## Install

1. Open `about:debugging#/runtime/this-firefox` in Zen or Firefox
2. Click **"Load Temporary Add-on..."**
3. Select the `manifest.json` file from this repo
4. Toggle the sidebar with **Cmd+Shift+B** (Mac) or **Ctrl+Shift+B** (Windows/Linux)

I'm submitting it as an addon to mozilla right now so you can check that later.

## Setup

1. Get a Gemini API key from [aistudio.google.com](https://aistudio.google.com/apikey)
2. Open the sidebar → click the **⚙ gear icon**
3. Paste your API key → choose a model → **Save**

### Available Models

| Model | Best for |
|-------|----------|
| Gemini 2.5 Flash | General use (default) |
| Gemini 2.5 Flash Lite | Speed, lower cost |
| Gemini 2.5 Pro | Complex reasoning |


## License

MIT
