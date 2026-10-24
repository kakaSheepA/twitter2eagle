# Complete Media Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reset panel sessions, capture any number of delayed images, and download HLS playlists when MP4 is unavailable.

**Architecture:** Content-script media extraction gains HLS variants and ancestor rescans; service worker resets active state; panel resets on load. Existing task items and direct directory writing remain the single source of truth.

**Tech Stack:** Manifest V3, ES modules, Vitest, JSDOM.

## Global Constraints

- Do not limit images per post.
- HLS downloads are `.m3u8` playlists only, not MP4 conversion.
- Opening the panel starts a new empty session without deleting files.

### Task 1: Test and add HLS records

**Files:** `tests/content-script.test.js`, `src/content/content-script.js`, `src/background/service-worker.js`

- [ ] Write a test where a tweet contains only an `application/x-mpegURL` variant and expect `{ kind: 'hls', extension: 'm3u8', url }`.
- [ ] Run `npm test -- --run tests/content-script.test.js` and verify failure.
- [ ] Return HLS records after the MP4 check, and update syndication resolution to return HLS only when no MP4 exists.
- [ ] Re-run the focused test and verify pass.

### Task 2: Test and fix arbitrary and delayed image discovery

**Files:** `tests/content-script.test.js`, `src/content/content-script.js`

- [ ] Write tests for a single article with 8 `twimg.com/media` images and expect 8 unique records.
- [ ] Run the focused test and verify failure only for the missing observer helper.
- [ ] Add `articleFromAddedNode(node)` that returns `node.closest('article')` or its parent article; use it from MutationObserver and schedule a debounced visible rescan after scrolling.
- [ ] Re-run the focused test and verify pass.

### Task 3: Reset session when panel opens

**Files:** `tests/service-worker.test.js`, `src/background/service-worker.js`, `src/panel/panel.js`

- [ ] Write a test for `emptyStatus()` returning idle state with zero media.
- [ ] Run worker test and verify failure.
- [ ] Handle `RESET_SESSION` by stopping current auto-scroll, removing `x-media-active`, and returning the empty status. Send it once before the panel's initial refresh.
- [ ] Re-run worker and panel tests and verify pass.

### Task 4: Full verification

- [ ] Run `npm test -- --run` and `node --check` on changed JavaScript files.
- [ ] Reload the unpacked extension, open the side panel, scan a multi-image post, and verify an HLS item saves an `.m3u8` file.
