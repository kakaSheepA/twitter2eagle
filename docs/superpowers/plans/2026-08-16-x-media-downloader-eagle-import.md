# X 媒体下载器 Eagle 导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow scanned X media to be imported into the locally open Eagle library with its owning tweet as the source URL.

**Architecture:** A shared mapper constructs safe Eagle payloads from media records. The service worker owns all localhost API calls and task-status updates. The side panel renders Eagle availability, folder selection, and per-item or batch actions using the existing message protocol.

**Tech Stack:** Manifest V3, vanilla ES modules, Chrome service worker, Eagle local HTTP API, Vitest.

## Global Constraints

- Eagle source URL must be `https://x.com/i/status/<tweetId>`.
- Direct image and MP4 resources are imported as files; HLS playlists are excluded in this phase.
- Do not import locally downloaded HLS MP4 files in this phase.
- Keep Eagle access restricted to `http://localhost:41595/*`.

---

### Task 1: Create Eagle payload mapping

**Files:**
- Create: `src/shared/eagle.js`
- Test: `tests/eagle.test.js`

- [x] Write failing tests for tweet source URL, resource type tags, and HLS exclusion.
- [x] Run `npm test -- tests/eagle.test.js` and verify failure.
- [x] Implement payload mapping functions.
- [x] Run `npm test -- tests/eagle.test.js` and verify pass.

### Task 2: Add service-worker Eagle API messages

**Files:**
- Modify: `manifest.json`
- Modify: `src/background/service-worker.js`
- Modify: `tests/manifest.test.js`
- Modify: `tests/service-worker.test.js`

- [x] Write failing tests for localhost permission and the Eagle import message contract.
- [x] Run targeted tests and verify failure.
- [x] Implement health, folder listing, and isolated batch import handlers.
- [x] Run targeted tests and verify pass.

### Task 3: Add panel controls and wire actions

**Files:**
- Modify: `src/panel/panel.html`
- Modify: `src/panel/panel.css`
- Modify: `src/panel/panel.js`
- Modify: `tests/panel.test.js`

- [x] Write failing rendering tests for Eagle actions.
- [x] Run `npm test -- tests/panel.test.js` and verify failure.
- [x] Implement panel rendering and message calls.
- [x] Run the complete test suite and verify pass.
