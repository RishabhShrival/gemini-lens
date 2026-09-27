# Gemini Lens

A browser extension (Chrome / Edge / Firefox) that uses **your own Gemini API key** to:

- **Summarize the current page, PDF or YouTube video**: short, detailed or key points (videos get timestamps)
- **Analyze a GitHub repo**: purpose, tech stack, structure, how to run it, where to start reading, plus a **Mermaid architecture diagram**. **Click a box in the diagram to open that file on GitHub.**
- **On GitHub pages**, the GitHub tab offers context actions:
  - on a file: **Explain this file** (purpose, key parts, how it connects to the rest of the repo)
  - on a pull request: **Review PR** (summary, risks, suggestions, verdict)
  - on an issue: **Issue helper** (likely cause, files likely to change, suggested approach)
- **Export**: copy any answer or download it as `.md`; download diagrams as SVG or PNG
- **Chat about it**: ask follow-up questions about the page, video or repo
- **Explain selected text**: select text, right-click → *Explain with Gemini Lens*

Built with [WXT](https://wxt.dev) + React + TypeScript + [`@google/genai`](https://www.npmjs.com/package/@google/genai), Manifest V3, and the Chrome Side Panel.

## Quick start

```bash
npm install
npm run dev          # opens Chrome with the extension loaded and hot reload on
```

Then:

1. The settings page opens automatically. Paste a key from https://aistudio.google.com/apikey, click **Test key & load models**, then **Save**.
2. Click the toolbar icon to open the side panel.

### Load the prebuilt version instead

`npm run build` → open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `.output/chrome-mv3`.

Firefox: `npm run build:firefox` (loads as a sidebar).

## Project layout

```
entrypoints/
  background.ts        # opens side panel on icon click, right-click menu
  sidepanel/App.tsx    # main UI: page / repo tabs, streaming chat
  options/Options.tsx  # API key, model, GitHub token
lib/
  gemini.ts            # @google/genai streaming + model listing
  page.ts              # reads active tab (Readability) or downloads PDFs
  github.ts            # GitHub page detection; repo / file / PR / issue context; file links
  export.ts            # .md, SVG and PNG downloads
  mermaid-repair.ts    # fixes common Mermaid syntax mistakes from the model
  prompts.ts           # all prompts in one place, easy to tweak
components/Markdown.tsx  # markdown + Mermaid rendering, clickable nodes, answer actions
```

## Notes

- Keys live only in `chrome.storage.local`. Requests go directly from the browser to Google and GitHub; there's no server.
- Without a GitHub token, GitHub allows 60 API requests/hour: about 3–4 repo analyses, or ~15–20 file / PR / issue actions. A read-only fine-grained token raises this to 5,000 and enables private repos.
- The repo analyzer sends the file tree, README and up to 14 key files (manifests, configs, entry points). Adjust `MAX_FILES` / `KEY_FILES` in `lib/github.ts`.
- YouTube summaries work for public videos. Gemini watches the video itself, so long videos take longer and use more tokens.
- Diagram links only point to paths that really exist in the repo's file tree, so made-up paths are ignored.
- Browsers block extensions from reading `chrome://` pages and the Web Store.

## Ideas for next steps

- Let Gemini request more files via function calling (agentic repo exploration)
- Context caching for large repos; saved history; export to Markdown file
