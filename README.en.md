# Markdown Workbench

A local-first Markdown workspace for reading, editing, and arranging multiple documents. It works with local files directly in the browser, so you can compare and update Markdown without routinely sending document contents away from your device.

[![CI](https://github.com/BruceL017/markdown-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/BruceL017/markdown-workbench/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[简体中文](README.md) | English

## What It Solves

Many online Markdown tools require an upload, while traditional editors can become unnecessarily heavy for focused document work. Markdown Workbench gives writers, developers, researchers, and knowledge workers a quiet browser workbench: open local files, arrange the views you need, then write changes back or download a copy.

Typical use cases include:

- Comparing specifications, technical plans, and meeting notes
- Organizing several Markdown documents that link to one another
- Previewing tables, task lists, fenced code, and local images
- Making lightweight edits to private notes without uploading them to a third-party service

## Features

### Local Files and Privacy

- Open one or many `.md` and `.markdown` files
- Open a folder and recursively discover Markdown documents and local image assets
- Keep document text off application servers and avoid telemetry
- Resolve local images through browser object URLs without uploading them
- Clearly disclose that remote images still contact their third-party hosts

### Multi-Document Workbench

- Manage open and buffered documents from a temporary file drawer
- Split documents to the left, right, top, or bottom on desktop
- Drag documents to workspace edges and resize adjacent panes
- Focus an existing view instead of duplicating the same document
- Switch to a touch-friendly single-pane layout on smaller screens

### Editing and Preview

- A CodeMirror editor with Markdown highlighting, search, replace, and undo/redo
- Instant switching between source and preview modes
- GFM tables, task lists, strikethrough, and automatic links
- Syntax highlighting for fenced code blocks
- Relative local images, document links, and anchor navigation within a workspace
- Sanitized raw HTML that removes scripts, event handlers, and unsafe links

### Saving, Conflicts, and Recovery

- Save with `Ctrl+S` / `Command+S` or the toolbar button
- Write back to explicitly approved files when the File System Access API is available
- Fall back to downloading an edited copy when direct write-back is unavailable
- Detect files changed on disk by another application before overwriting them
- Resolve conflicts by reloading from disk, downloading the draft, or overwriting
- Guard pane closing when a document contains unsaved changes
- Restore drafts, pane layout, theme, and language preferences from IndexedDB
- Clear recovery data and stored file permissions from Privacy and local data settings

### Interface and Accessibility

- Simplified Chinese and English interfaces, initially selected from the browser language
- System, light, and dark themes
- Keyboard-operable core workflows with visible focus states
- WCAG 2.2 AA as the accessibility test baseline
- End-to-end coverage for desktop, mobile, Chromium, Firefox, and WebKit

## How to Use It

1. Open the application and choose **Open files** or **Open folder**.
2. Select a document from the file drawer. On desktop, choose a split direction or drag it to a workspace edge.
3. Switch between **Source** and **Preview** from the pane toolbar.
4. Edit the document, then use the save button or press `Ctrl+S` / `Command+S`.
5. If the file changed on disk, choose whether to reload, download the current draft, or overwrite.
6. When recovery data is no longer needed, open **Privacy and local data** and select **Clear local data**.

The top bar always identifies whether the current browser uses direct save or download save. A downloaded copy is never presented as an original-file write-back.

## Browser Save Behavior

| Browser capability | Opening | Saving |
| --- | --- | --- |
| File System Access API in a secure context | Native file or directory picker | Writes to the original file after permission is granted |
| No File System Access API | Browser file or folder picker | Downloads a new Markdown copy |

Direct write-back always requires an explicit user action. If write permission is denied, the current draft remains available in local recovery storage.

## Privacy Boundaries

| Data | Storage and behavior |
| --- | --- |
| Markdown text | Processed in browser memory and local IndexedDB; not uploaded |
| Local images | Read in the browser and exposed through session-local object URLs |
| Remote images | Send a no-referrer GET request to the third-party image host |
| Drafts and layout | Stored in local IndexedDB and removable by the user |
| File permissions | Managed by the browser for files explicitly selected by the user |
| Telemetry and usage analytics | Not collected |

IndexedDB drafts are for recovery, not a substitute for backups. Important documents should still use version control or another backup strategy.

## Run Locally

Requirements:

- Node.js `^20.19.0`, `^22.13.0`, or `>=24.0.0`
- npm
- No backend service, database, or API key

Clone the repository, install dependencies, and start the development server:

```bash
git clone https://github.com/BruceL017/markdown-workbench.git
cd markdown-workbench
npm ci
npm run dev
```

The terminal prints the local URL. Check and preview a production build with:

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

Production assets are written to `dist/` and can be hosted by any static file service.

Run the browser end-to-end suite with:

```bash
npx playwright install
npm run test:e2e
```

## Technology

- React, TypeScript, and Vite
- CodeMirror 6
- FlexLayout React
- React Markdown, Remark GFM, and Rehype
- Zustand and IndexedDB (`idb`)
- Vitest, Testing Library, Playwright, and axe-core

## Project Principles

- Local first: document contents stay on the device by default
- Transparent capability: original-file write-back and downloaded copies are distinct
- Content first: documents occupy the primary space and tools appear when needed
- Progressive enhancement: core reading and editing remain usable across browser capabilities
- Safe saving: permissions, conflicts, unsaved state, and recovery outcomes remain visible

## GitHub Pages

The repository includes a manually triggered [Deploy to GitHub Pages](.github/workflows/deploy-pages.yml) workflow. Before the first deployment, set **Settings → Pages → Source** to **GitHub Actions**, then run the workflow from `main` on the Actions page. It reads the deployment base path from the Pages configuration and publishes to:

`https://brucel017.github.io/markdown-workbench/`

## License

This project is available under the [MIT License](LICENSE).
