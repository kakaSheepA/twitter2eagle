# X Media Downloader Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the transient popup with a persistent side panel and collect visible X media through DOM observation.

**Architecture:** A classic content script observes tweet `article` nodes and sends normalized image records to the existing worker. A side-panel page controls the state machine and polls worker summaries.

**Tech Stack:** Manifest V3, vanilla JS, Chrome Side Panel API, MutationObserver, Vitest/jsdom.

## Global Constraints

- The panel remains open while the user manually scrolls X.
- Images are collected from visible tweet DOM nodes and use `name=orig`.
- The primary button is exclusive: start, stop-and-download, downloading, or start-new-task.

---

### Task 1: Add DOM media collection

**Files:**
- Modify: `src/content/content-script.js`
- Modify: `tests/content-script.test.js`

- [ ] **Step 1: Write failing test**

```js
expect(recordsFromArticle(article, 'alice')).toMatchObject([{ kind: 'image', tweetId: '99' }]);
```

- [ ] **Step 2: Verify red**

Run: `npm test -- --run tests/content-script.test.js`

Expected: FAIL because `recordsFromArticle` is absent.

- [ ] **Step 3: Implement**

Extract tweet status ID from `/status/<digits>`, timestamp from `time[datetime]`, and media images from `img[src*="twimg.com/media"]`; observe new `article` nodes and send `MEDIA_DISCOVERED` for each record while collection is active.

- [ ] **Step 4: Verify green**

Run: `npm test -- --run tests/content-script.test.js`

Expected: PASS.

### Task 2: Replace popup with stateful side panel

**Files:**
- Modify: `manifest.json`
- Create: `src/panel/panel.html`
- Create: `src/panel/panel.js`
- Create: `src/panel/panel.css`
- Create: `tests/panel.test.js`

- [ ] **Step 1: Write failing test**

```js
expect(primaryButton({ collecting: true, downloading: 0 })).toEqual({ label: '停止采集并下载', disabled: false });
```

- [ ] **Step 2: Verify red**

Run: `npm test -- --run tests/panel.test.js`

Expected: FAIL because `primaryButton` is absent.

- [ ] **Step 3: Implement**

Declare `side_panel.default_path`, configure `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`, render options and one primary button, and map its action to `START_COLLECTION`, `STOP_COLLECTION` then `START_DOWNLOADS`, or reset. Poll `GET_STATUS` every second while open.

- [ ] **Step 4: Verify green**

Run: `npm test -- --run tests/panel.test.js`

Expected: PASS.

### Task 3: Verify integration

- [ ] **Step 1: Run complete suite**

Run: `npm test -- --run`

Expected: PASS.

- [ ] **Step 2: Validate extension assets**

Run: `node --check src/content/content-script.js; node --check src/panel/panel.js; node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`

Expected: exit code 0.
