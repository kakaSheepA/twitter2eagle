# X 用户媒体下载器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that collects media while a user manually scrolls an X profile, then downloads original images and highest-bitrate MP4 files into a username folder.

**Architecture:** A document-start bridge captures X timeline payloads and a content script associates them with visible tweet cards. A service worker owns the persistent task store and bounded download queue. The popup controls collection options and renders the active task status.

**Tech Stack:** Manifest V3, vanilla JavaScript ES modules, Chrome extension APIs, Vitest, jsdom.

## Global Constraints

- Support only `https://x.com/*` and `https://twitter.com/*` profile pages in v1.
- The user manually scrolls from newest to oldest; never automate scrolling.
- Images must use X's original-image URL parameter and videos use the highest-bitrate available MP4 variant.
- Download path is `<username>/<YYYY-MM-DD_HH-mm-ss>_<media-index>.<extension>` beneath Chrome's default download directory.
- Tweet IDs are used only internally for identity, de-duplication, and recovery.
- Collection and download state stays in local Chrome storage; do not upload account data, cookies, tweet text, or task records.
- Preserve uncompleted downloads over popup close and browser restart.

---

## File Structure

- `package.json`: test scripts and development dependencies.
- `manifest.json`: extension manifest, permissions, host permissions, worker, popup, and scripts.
- `src/shared/media.js`: pure URL, filename, media-variant, and de-duplication helpers.
- `src/shared/task-store.js`: pure task state reducers and storage adapter.
- `src/background/service-worker.js`: message router and bounded Chrome downloads queue.
- `src/content/page-bridge.js`: main-world fetch/XHR response observer for X GraphQL payloads.
- `src/content/content-script.js`: message bridge, profile/tweet-card observation, and collection filtering.
- `src/popup/popup.html`, `src/popup/popup.css`, `src/popup/popup.js`: task controls and status UI.
- `tests/media.test.js`, `tests/task-store.test.js`, `tests/content-script.test.js`, `tests/service-worker.test.js`, `tests/popup.test.js`: unit tests with mocked browser APIs.

## Task 1: Set up the extension and test runner

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Produces `npm test`, an MV3 manifest, and an empty popup shell used by later tasks.

- [ ] **Step 1: Write the failing manifest test**

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

describe('manifest', () => {
  it('declares MV3, downloads and the X host permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['downloads', 'storage']));
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(['https://x.com/*', 'https://twitter.com/*']));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/manifest.test.js`

Expected: FAIL because `package.json` and `manifest.json` do not exist.

- [ ] **Step 3: Add the minimal project files**

```json
{
  "type": "module",
  "scripts": { "test": "vitest" },
  "devDependencies": { "jsdom": "^26.0.0", "vitest": "^3.0.0" }
}
```

Configure `manifest.json` with `manifest_version: 3`, `downloads`, `storage`, `scripting`, X/Twitter and `*.twimg.com` host permissions, a module service worker, document-start content scripts, and `src/popup/popup.html` as `action.default_popup`. Create popup HTML with a status region and disabled control buttons; add basic readable CSS.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm install; npm test -- --run tests/manifest.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add package.json package-lock.json manifest.json src/popup tests/manifest.test.js && git commit -m "chore: scaffold x media downloader extension"`

Expected: If Git has not been initialized, report that fact and do not create a commit.

## Task 2: Implement media normalization and filenames

**Files:**
- Create: `src/shared/media.js`
- Create: `tests/media.test.js`

**Interfaces:**
- Produces `originalImageUrl(url)`, `highestBitrateMp4(variants)`, `mediaKey(tweetId, mediaIndex, url)`, and `downloadFilename(username, createdAt, mediaIndex, extension, collisionIndex)`.

- [ ] **Step 1: Write failing helper tests**

```js
import { describe, expect, it } from 'vitest';
import { downloadFilename, highestBitrateMp4, originalImageUrl } from '../src/shared/media.js';

describe('media helpers', () => {
  it('requests an original image', () => {
    expect(originalImageUrl('https://pbs.twimg.com/media/a?format=jpg&name=small'))
      .toBe('https://pbs.twimg.com/media/a?format=jpg&name=orig');
  });
  it('chooses the largest MP4 bitrate', () => {
    expect(highestBitrateMp4([{ url: 'low.mp4', content_type: 'video/mp4', bitrate: 256000 }, { url: 'high.mp4', content_type: 'video/mp4', bitrate: 2176000 }]))
      .toEqual({ url: 'high.mp4', bitrate: 2176000 });
  });
  it('formats a collision-safe filename', () => {
    expect(downloadFilename('alice', '2026-08-16T14:32:05Z', 2, 'jpg', 1)).toBe('alice/2026-08-16_14-32-05_02_01.jpg');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/media.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement pure helpers**

```js
export function highestBitrateMp4(variants) {
  return variants.filter((v) => v.content_type === 'video/mp4' && Number.isFinite(v.bitrate))
    .sort((a, b) => b.bitrate - a.bitrate)[0] ?? null;
}
```

Use `URL`/`searchParams` in `originalImageUrl`, sanitize path components by replacing Windows-reserved characters, format dates in UTC as `YYYY-MM-DD_HH-mm-ss`, and append the collision index only when it is nonzero.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/media.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/shared/media.js tests/media.test.js && git commit -m "feat: add media URL and filename helpers"`

## Task 3: Add persistent task state and de-duplication

**Files:**
- Create: `src/shared/task-store.js`
- Create: `tests/task-store.test.js`

**Interfaces:**
- Consumes normalized records `{tweetId, mediaIndex, url, kind, createdAt, username}`.
- Produces `createTask(username, options)`, `addMedia(task, record)`, `setItemStatus(task, key, status, error)`, `taskSummary(task)`, `loadTask(username)`, and `saveTask(task)`.

- [ ] **Step 1: Write failing state tests**

```js
import { describe, expect, it } from 'vitest';
import { addMedia, createTask, taskSummary } from '../src/shared/task-store.js';

it('keeps only one copy of a media record', () => {
  const task = createTask('alice', { includeReplies: false, includeReposts: false });
  const record = { key: '1:0:https://pbs.twimg.com/a', tweetId: '1', mediaIndex: 0, kind: 'image' };
  expect(addMedia(addMedia(task, record), record).items).toHaveLength(1);
  expect(taskSummary(addMedia(task, record))).toMatchObject({ total: 1, pending: 1 });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/task-store.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement immutable task reducers and local storage adapter**

Initialize records as `pending`; use a `Map`-like object keyed by media key; persist under `x-media-task:<username>` through `chrome.storage.local`. `taskSummary` must report `total`, `pending`, `downloading`, `completed`, `failed`, and `unavailable` counts.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run tests/task-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/shared/task-store.js tests/task-store.test.js && git commit -m "feat: persist media collection tasks"`

## Task 4: Capture and filter X timeline media

**Files:**
- Create: `src/content/page-bridge.js`
- Create: `src/content/content-script.js`
- Create: `tests/content-script.test.js`

**Interfaces:**
- Consumes `window` fetch/XHR GraphQL JSON and the active task options.
- Produces Chrome runtime messages `{type: 'MEDIA_DISCOVERED', record}` and `{type: 'COLLECTION_WARNING', code}`.

- [ ] **Step 1: Write failing extraction tests**

```js
import { expect, it } from 'vitest';
import { recordsFromTweet } from '../src/content/content-script.js';

it('emits an original image record from an X tweet result', () => {
  const tweet = { rest_id: '10', legacy: { created_at: 'Sat Aug 16 14:32:05 +0000 2026', extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a?format=jpg&name=small' }] } } };
  expect(recordsFromTweet(tweet, 'alice')).toMatchObject([{ tweetId: '10', mediaIndex: 0, kind: 'image' }]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/content-script.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the bridge and content script**

At `document_start`, wrap `fetch` and XHR response handling in the page world. For GraphQL timeline responses, dispatch a custom event containing only parsed tweet result data. In the isolated content script, recursively locate tweet results, classify original/reply/repost records against active task options, turn photo URLs into original image URLs, select MP4 variants, and send deduplicated records to the worker. Emit `unavailable` records for videos without an MP4 variant. On collection start, persist the active flag then reload the tab so top-of-page responses are observable.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/content-script.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/content tests/content-script.test.js && git commit -m "feat: collect media from x timeline responses"`

## Task 5: Build the worker download queue

**Files:**
- Create: `src/background/service-worker.js`
- Create: `tests/service-worker.test.js`

**Interfaces:**
- Consumes `MEDIA_DISCOVERED`, `START_COLLECTION`, `STOP_COLLECTION`, `START_DOWNLOADS`, `RETRY_FAILED`, and `GET_STATUS` messages.
- Produces `chrome.downloads.download({url, filename, conflictAction: 'uniquify'})` calls and `{type: 'TASK_STATUS', summary}` replies.

- [ ] **Step 1: Write failing queue tests**

```js
import { expect, it, vi } from 'vitest';
import { createDownloadRunner } from '../src/background/service-worker.js';

it('downloads pending records and marks a failed item', async () => {
  const download = vi.fn().mockResolvedValue(7);
  const runner = createDownloadRunner({ download, concurrency: 2 });
  const result = await runner.run([{ key: 'a', status: 'pending', url: 'a.jpg', filename: 'alice/a.jpg' }]);
  expect(download).toHaveBeenCalledWith({ url: 'a.jpg', filename: 'alice/a.jpg', conflictAction: 'uniquify', saveAs: false });
  expect(result[0].status).toBe('completed');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/service-worker.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement a concurrency-limited runner and message router**

Use a maximum concurrency of 3. Before each request set item state to `downloading`; when `chrome.downloads.download` resolves set `completed`, and when it rejects set `failed` with the error message. Persist after every state change. Do not enqueue `unavailable` or `completed` records. Include message handlers for status and retrying only failed items.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run tests/service-worker.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/background/service-worker.js tests/service-worker.test.js && git commit -m "feat: add resumable media download queue"`

## Task 6: Connect the popup and complete end-to-end checks

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.css`
- Create: `src/popup/popup.js`
- Modify: `manifest.json`
- Modify: `tests/manifest.test.js`
- Create: `tests/popup.test.js`

**Interfaces:**
- Consumes worker `GET_STATUS` replies and sends worker control messages.
- Produces user-visible options, counts, warnings, and control states.

- [ ] **Step 1: Write a failing popup interaction test**

```js
import { beforeEach, expect, it, vi } from 'vitest';
import { mountPopup } from '../src/popup/popup.js';

beforeEach(() => { document.body.innerHTML = '<input id="replies"><button id="start"></button><output id="status"></output>'; });
it('starts collection with selected filters', async () => {
  const sendMessage = vi.fn().mockResolvedValue({ total: 0 });
  mountPopup({ sendMessage });
  document.querySelector('#replies').checked = true;
  document.querySelector('#start').click();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'START_COLLECTION', options: expect.objectContaining({ includeReplies: true }) }));
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/popup.test.js`

Expected: FAIL because popup module and test fixture IDs are incomplete.

- [ ] **Step 3: Implement popup controls and clear status text**

Add toggles for replies and reposts, buttons for start collection, stop and download, pause/resume, and retry failures. Verify the active tab is an X/Twitter profile before enabling collection. Render summary counts and warnings for login, inaccessible profile, missing refresh, incomplete scrolling, and MP4-unavailable videos. Refresh status whenever the popup opens and after each user action.

- [ ] **Step 4: Run all tests and perform a manual unpacked-extension smoke test**

Run: `npm test -- --run`

Expected: PASS.

Manual check: load the workspace folder via `chrome://extensions` → Developer mode → Load unpacked; open an X profile; start collection; accept one refresh; scroll through media posts; stop and download; verify downloaded names and status counts.

- [ ] **Step 5: Commit**

Run: `git add manifest.json src/popup tests && git commit -m "feat: add media downloader popup workflow"`

## Plan Self-Review

- Spec coverage: Tasks 1-6 cover MV3 setup, manual collection, refresh, original images, highest-bitrate MP4 selection, filters, username/date media names, local recovery, download queue, privacy permissions, warnings, and acceptance tests.
- Placeholder scan: No deferred requirements or ambiguous implementation placeholders remain; unavailable streaming-only video is explicitly excluded from the queue.
- Interface check: timeline records are normalized in Task 4, persisted in Task 3, consumed by Task 5, and displayed by Task 6. The filename helper in Task 2 is used before Task 5 dispatches downloads.
