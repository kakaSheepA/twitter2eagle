# Telegram Web K Eagle Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Telegram Web K-only Eagle corner action that imports a clicked, already available ordinary image or video into its type-specific Eagle folder without changing any X/Twitter behavior.

**Architecture:** A Telegram-only content script identifies rendered message media and adds one overlay per media item. Its click handler starts a uniquely named, browser-native download of that already rendered `blob:` or `stream/` resource; a Telegram-only background controller observes the matching Chrome download, imports its completed local file through the existing Native Messaging host, and pushes state updates back to the tab. Telegram state uses namespaced Chrome storage and never reads or updates X task records.

**Tech Stack:** Manifest V3, Chrome `downloads`/`storage`/`runtime` APIs, Vanilla DOM + `MutationObserver`, Node Native Messaging host, Eagle Local API, Vitest + JSDOM.

## Global Constraints

- Support only `https://web.telegram.org/k/*`.
- Support only ordinary loaded images and ordinary loaded videos, including individual items in albums.
- Create or reuse exactly `Telegtam-Picture` and `Telegtam-Video` in Eagle.
- A successful `peerId + messageId + mediaKind` is immutable in `telegramEagle:*` storage and must show “已保存” rather than re-download.
- Do not bypass Telegram download restrictions or process files, GIFs, stickers, voice, video notes, paid, protected, or view-once media.
- Do not modify X/Twitter scanning, download, panel, task storage, folder naming, or Eagle URL-import behavior.
- Do not upload media or Telegram metadata to any remote service.

---

## File Structure

- Create `src/shared/telegram-media.js`: pure Telegram record validation, stable keys, local download names, and Eagle metadata.
- Create `src/content/telegram-content-script.js`: Web K DOM discovery, overlay rendering, click-to-download action, and background status updates.
- Create `src/content/telegram-content.css`: isolated overlay styles under the `telegram-eagle-*` prefix.
- Create `src/background/telegram-eagle.js`: named-folder resolution, pending-download matching, local Native Messaging import, namespaced state transitions, and tab update messages.
- Modify `src/background/service-worker.js`: register Telegram message routing and the one `chrome.downloads` observer; leave X handlers and exports unchanged.
- Modify `native-host/x-media-eagle-host.js`: accept any local image/video item and forward its caller-provided Eagle metadata while preserving the existing X `START`/`CHUNK`/`COMMIT` protocol.
- Modify `manifest.json`: add only the Telegram Web K content-script match, CSS and host permission.
- Create `tests/telegram-media.test.js`, `tests/telegram-content-script.test.js`, and `tests/telegram-eagle.test.js`; extend manifest, native-host and service-worker regression tests.

### Task 1: Define the Telegram media contract

**Files:**
- Create: `src/shared/telegram-media.js`
- Test: `tests/telegram-media.test.js`

**Interfaces:**
- Produces `telegramMediaKey({ peerId, messageId, kind }): string` as `telegram:<peerId>:<messageId>:<kind>`.
- Produces `telegramDownloadFilename(record, requestId): string` as `TelegramEagle/<requestId>-<messageId>.<extension>`.
- Produces `telegramEagleItem(record, localPath): { key, kind, localPath, filename, website?, tags, annotation }`.
- Consumed by the Telegram content script and background controller only.

- [ ] **Step 1: Write failing pure-function tests**

```js
import { expect, it } from 'vitest';
import { telegramDownloadFilename, telegramEagleItem, telegramMediaKey } from '../src/shared/telegram-media.js';

it('uses Telegram peer, message and type for a stable per-media saved key', () => {
  expect(telegramMediaKey({ peerId: '-10042', messageId: '77', kind: 'image' }))
    .toBe('telegram:-10042:77:image');
});

it('keeps temporary browser downloads in the TelegramEagle directory', () => {
  expect(telegramDownloadFilename({ messageId: '77', extension: 'mp4' }, 'request-1'))
    .toBe('TelegramEagle/request-1-77.mp4');
});

it('adds Telegram metadata without an X tag or tweet URL', () => {
  expect(telegramEagleItem({ peerId: '-10042', messageId: '77', kind: 'video', filename: '77.mp4', chatName: 'Example' }, 'C:\\Downloads\\77.mp4'))
    .toMatchObject({ tags: ['Telegram', '视频', 'Example'], annotation: 'Telegram 消息 ID：77' });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module does not exist**

Run: `npm test -- tests/telegram-media.test.js`

Expected: FAIL with a module-not-found error for `src/shared/telegram-media.js`.

- [ ] **Step 3: Implement the minimal pure contract**

```js
export function telegramMediaKey({ peerId, messageId, kind }) {
  if (!peerId || !messageId || !['image', 'video'].includes(kind)) throw new Error('Telegram 媒体标识无效');
  return `telegram:${peerId}:${messageId}:${kind}`;
}

export function telegramDownloadFilename({ messageId, extension }, requestId) {
  return `TelegramEagle/${requestId}-${messageId}.${extension === 'mp4' ? 'mp4' : 'jpg'}`;
}
```

Implement `telegramEagleItem` with tags `['Telegram', kind === 'video' ? '视频' : '图片', chatName]`, omit empty values, retain an available public message URL as `website`, and use `Telegram 消息 ID：<messageId>` plus available caption as `annotation`.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npm test -- tests/telegram-media.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/shared/telegram-media.js tests/telegram-media.test.js
git commit -m "feat: define Telegram Eagle media contract"
```

### Task 2: Make the Native Messaging local import type-neutral

**Files:**
- Modify: `native-host/x-media-eagle-host.js`
- Test: `tests/native-host.test.js`

**Interfaces:**
- Consumes native `START`, `CHUNK`, `COMMIT` frames where every item may have `{ key, kind, localPath, filename, website?, tags?, annotation? }`.
- Produces the existing `COMPLETE` frame with `{ imported, deduplicated, failed }`.
- Existing X image `START` messages remain valid and keep their current Eagle payload.
- Telegram background will submit local paths for both `kind: 'image'` and `kind: 'video'`.

- [ ] **Step 1: Add failing protocol regression tests**

```js
it('imports an externally downloaded Telegram video with caller metadata', async () => {
  const item = { key: 'telegram:1:2:video', kind: 'video', localPath: path, filename: '2.mp4', tags: ['Telegram', '视频'], annotation: 'Telegram 消息 ID：2' };
  expect(await commitJob({ folderId: 'folder-1', items: [item] }, fetchImpl)).toEqual({ imported: 1, deduplicated: 0, failed: [] });
  expect(fetchImpl).toHaveBeenCalledWith('http://localhost:41595/api/item/addFromPaths', expect.objectContaining({ body: expect.stringContaining('Telegram 消息 ID：2') }));
});

it('continues to build the existing X image payload when no caller metadata is supplied', async () => {
  const item = { key: 'x:1', kind: 'image', url: 'https://pbs.twimg.com/a.jpg', filename: 'a.jpg', tweetId: '1' };
  expect(await commitJob({ folderId: 'folder-1', username: 'alice', items: [item] }, fetchImpl)).toMatchObject({ imported: 1 });
});
```

- [ ] **Step 2: Run the native-host tests and confirm the Telegram video case fails**

Run: `npm test -- tests/native-host.test.js`

Expected: FAIL because `commit()` filters all items to `kind === 'image' && item.url`.

- [ ] **Step 3: Generalize only the local-path branch**

```js
async function commitJob(job, fetchImpl = fetch) {
  const items = job.items.filter((item) => item?.localPath);
  const complete = await runPool(items, join(tmpdir(), 'x-media-eagle', job.taskId || randomUUID()));
  return submitEaglePaths(complete, job.folderId, fetchImpl);
}
async function submitEaglePaths(entries, folderId, fetchImpl) {
  const response = await fetchImpl('http://localhost:41595/api/item/addFromPaths', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId, items: entries.complete.map(payloadItem) }) });
  if (!response.ok) throw new Error(`Eagle HTTP ${response.status}`);
  return { imported: entries.complete.length, deduplicated: 0, failed: entries.failures };
}
const payloadItem = ({ item, path }) => ({
  path,
  name: safeFilename(item.filename),
  ...(item.website ? { website: item.website } : {}),
  ...(Array.isArray(item.tags) ? { tags: item.tags.filter(Boolean) } : {}),
  ...(item.annotation ? { annotation: item.annotation } : {})
});
```

Keep the existing X URL-download path and its generated `X` metadata for legacy items without `localPath`. Preserve deletion of only temporary/external files after Eagle has accepted the import.
Make `commit()` call `commitJob(job)` and export it with `module.exports = { downloadOne, commitJob }` for the protocol test.

- [ ] **Step 4: Run the focused tests and the X suite**

Run: `npm test -- tests/native-host.test.js tests/eagle.test.js`

Expected: PASS; existing X native import semantics remain unchanged.

- [ ] **Step 5: Commit the protocol change**

```bash
git add native-host/x-media-eagle-host.js tests/native-host.test.js
git commit -m "feat: allow local Eagle video imports"
```

### Task 3: Build Web K media discovery and the isolated corner control

**Files:**
- Create: `src/content/telegram-content-script.js`
- Create: `src/content/telegram-content.css`
- Test: `tests/telegram-content-script.test.js`

**Interfaces:**
- Consumes DOM `data-peer-id` and `data-mid` from `.bubble`, plus media elements `img.media-photo` and `video.media-video`.
- Produces a `TELEGRAM_REGISTER_DOWNLOAD` message with `{ requestId, record, filename }` and a browser download named by `telegramDownloadFilename(record, requestId)`.
- Consumes `TELEGRAM_SAVE_STATE` messages with `{ key, state: 'saving' | 'saved' | 'failed', error? }`.

- [ ] **Step 1: Write failing JSDOM tests for supported nodes and albums**

```js
it('creates one image record from a normal Web K photo bubble', () => {
  document.body.innerHTML = '<div class="bubble photo" data-peer-id="-1001" data-mid="9"><img class="media-photo" src="blob:https://web.telegram.org/a"></div>';
  expect(recordsFromTelegramRoot(document)).toMatchObject([{ peerId: '-1001', messageId: '9', kind: 'image' }]);
});

it('uses an album item data-mid so each album image receives a distinct key', () => {
  document.body.innerHTML = '<div class="bubble photo is-album" data-peer-id="-1001" data-mid="9"><div class="album-item" data-mid="10"><img class="media-photo" src="blob:https://web.telegram.org/a"></div></div>';
  expect(recordsFromTelegramRoot(document)[0].messageId).toBe('10');
});

it('does not create controls for documents, GIFs, protected media, video notes or unloaded media', () => {
  document.body.innerHTML = '<div class="bubble document" data-peer-id="-1" data-mid="1"></div><div class="bubble photo is-protected" data-peer-id="-1" data-mid="2"><img class="media-photo" src="blob:https://web.telegram.org/a"></div><div class="bubble video" data-peer-id="-1" data-mid="3"><video class="media-video"></video></div>';
  expect(recordsFromTelegramRoot(document)).toEqual([]);
});
```

- [ ] **Step 2: Run the focused tests and confirm the imports fail**

Run: `npm test -- tests/telegram-content-script.test.js`

Expected: FAIL with a module-not-found error for `src/content/telegram-content-script.js`.

- [ ] **Step 3: Implement discovery, rendering and one-click download**

```js
export function recordsFromTelegramRoot(root) {
  return [...root.querySelectorAll('.bubble[data-peer-id][data-mid], .album-item[data-mid]')]
    .flatMap((node) => recordFromTelegramMediaNode(node) ? [recordFromTelegramMediaNode(node)] : []);
}

new MutationObserver((mutations) => {
  mutations.forEach(({ addedNodes }) => addedNodes.forEach((node) => mountTelegramControls(node)));
}).observe(document.documentElement, { childList: true, subtree: true });
```

Render only one `.telegram-eagle-control` per record. On a user click, generate `requestId`, post `TELEGRAM_REGISTER_DOWNLOAD`, create a temporary `<a>` with the loaded image/video `currentSrc`, `download = telegramDownloadFilename(record, requestId)`, click it synchronously, and remove it. The handler must never fetch media itself, alter Telegram messages, or click Telegram controls. Use a closed visual state for saved media and an error tooltip for failed media.

- [ ] **Step 4: Run the focused content-script test**

Run: `npm test -- tests/telegram-content-script.test.js`

Expected: PASS, including no duplicate overlay after a second mutation pass.

- [ ] **Step 5: Commit the content UI**

```bash
git add src/content/telegram-content-script.js src/content/telegram-content.css tests/telegram-content-script.test.js
git commit -m "feat: add Telegram Web K Eagle controls"
```

### Task 4: Implement Telegram-only download tracking, Eagle folders and dedup state

**Files:**
- Create: `src/background/telegram-eagle.js`
- Modify: `src/background/service-worker.js`
- Test: `tests/telegram-eagle.test.js`
- Test: `tests/service-worker.test.js`

**Interfaces:**
- Consumes `TELEGRAM_REGISTER_DOWNLOAD` with `{ requestId, record, filename }`.
- Consumes Chrome `DownloadItem` notifications and matches only paths containing `TelegramEagle/<requestId>-`.
- Produces `TELEGRAM_SAVE_STATE` to the originating tab and `telegramEagle:saved`/`telegramEagle:pending` storage records.
- Uses `ensureEagleNamedFolder('Telegtam-Picture' | 'Telegtam-Video')` and `importTelegramLocalItem(item, folderId)`.

- [ ] **Step 1: Add failing controller tests**

```js
it('routes a completed Telegram image download to Telegtam-Picture and then marks its key saved', async () => {
  const controller = createTelegramEagleController({ storage, ensureFolder, importLocalItem, sendToTab, removeDownloadFile });
  await controller.register({ requestId: 'r1', tabId: 4, record: { key: 'telegram:-1:7:image', kind: 'image' }, filename: 'TelegramEagle/r1-7.jpg' });
  await controller.onDownloadChanged({ id: 12, state: { current: 'complete' } }, { id: 12, filename: 'C:\\Downloads\\TelegramEagle\\r1-7.jpg' });
  expect(ensureFolder).toHaveBeenCalledWith('Telegtam-Picture');
  expect(sendToTab).toHaveBeenCalledWith(4, expect.objectContaining({ key: 'telegram:-1:7:image', state: 'saved' }));
});

it('does not start another download for an already saved Telegram key', async () => {
  await storage.set({ 'telegramEagle:saved': { 'telegram:-1:7:image': { savedAt: '2026-08-18T00:00:00.000Z' } } });
  await expect(controller.register({ requestId: 'r2', tabId: 4, record: { key: 'telegram:-1:7:image', kind: 'image' }, filename: 'TelegramEagle/r2-7.jpg' })).resolves.toEqual({ state: 'saved' });
  expect(importLocalItem).not.toHaveBeenCalled();
});

it('removes the temporary Chrome file and reports failure when Eagle import fails', async () => {
  importLocalItem.mockRejectedValue(new Error('Eagle 未打开'));
  await controller.onDownloadChanged({ id: 12, state: { current: 'complete' } }, { id: 12, filename: 'C:\\Downloads\\TelegramEagle\\r1-7.jpg' });
  expect(removeDownloadFile).toHaveBeenCalledWith(12);
  expect(sendToTab).toHaveBeenCalledWith(4, expect.objectContaining({ state: 'failed', error: 'Eagle 未打开' }));
});
```

- [ ] **Step 2: Run the Telegram controller tests and confirm they fail**

Run: `npm test -- tests/telegram-eagle.test.js`

Expected: FAIL with a module-not-found error for `src/background/telegram-eagle.js`.

- [ ] **Step 3: Implement the controller with bounded request state**

```js
export function createTelegramEagleController({ storage, ensureFolder, importLocalItem, sendToTab, removeDownloadFile }) {
  const pending = new Map();
  const completeTelegramDownload = async (delta, item) => {
    if (delta.state?.current !== 'complete') return;
    const requestId = /TelegramEagle[\\/](.+?)-/.exec(item.filename)?.[1];
    const request = pending.get(requestId);
    if (!request) return;
    try {
      const folder = await ensureFolder(request.record.kind === 'video' ? 'Telegtam-Video' : 'Telegtam-Picture');
      await importLocalItem(request.record, item.filename, folder.id);
      const saved = (await storage.get('telegramEagle:saved'))['telegramEagle:saved'] ?? {};
      await storage.set({ 'telegramEagle:saved': { ...saved, [request.record.key]: { savedAt: new Date().toISOString() } } });
      await sendToTab(request.tabId, { type: 'TELEGRAM_SAVE_STATE', key: request.record.key, state: 'saved' });
    } catch (error) {
      await removeDownloadFile(item.id).catch(() => {});
      await sendToTab(request.tabId, { type: 'TELEGRAM_SAVE_STATE', key: request.record.key, state: 'failed', error: error.message });
    } finally { pending.delete(requestId); }
  };
  return {
    async register({ requestId, tabId, record, filename }) {
      const saved = (await storage.get('telegramEagle:saved'))['telegramEagle:saved'] ?? {};
      if (saved[record.key]) return { state: 'saved' };
      pending.set(requestId, { requestId, tabId, record, filename, createdAt: Date.now() });
      await storage.set({ 'telegramEagle:pending': Object.fromEntries(pending) });
      await sendToTab(tabId, { type: 'TELEGRAM_SAVE_STATE', key: record.key, state: 'saving' });
      return { state: 'saving' };
    },
    async onDownloadCreated(item) { return item; },
    async onDownloadChanged(delta, item) { return completeTelegramDownload(delta, item); }
  };
}
```

Create/lookup the folder based only on `record.kind`: `image` → `Telegtam-Picture`, `video` → `Telegtam-Video`. Use `chrome.downloads.search({ id })` to resolve the completed absolute filename; call `chrome.downloads.removeFile(id)` on any import failure and allow the native host to remove a successfully imported temporary file. Prune pending requests older than 60 seconds and never consume another browser download whose path does not include a registered request ID.

In `service-worker.js`, add Telegram routing before the existing X serialized task handler:

```js
if (message.type === 'TELEGRAM_REGISTER_DOWNLOAD') {
  telegramEagle.register({ ...message, tabId: sender.tab?.id }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
}
```

Register exactly one `chrome.downloads.onCreated` and one `chrome.downloads.onChanged` listener at module load, forwarding only Telegram-named downloads to the controller. Do not alter `runSerialized`, `activeTask`, or any `IMPORT_EAGLE_*` X message handling.

- [ ] **Step 4: Run focused and X regression tests**

Run: `npm test -- tests/telegram-eagle.test.js tests/service-worker.test.js tests/eagle.test.js`

Expected: PASS; existing X download and Eagle tests remain green.

- [ ] **Step 5: Commit the Telegram controller**

```bash
git add src/background/telegram-eagle.js src/background/service-worker.js tests/telegram-eagle.test.js tests/service-worker.test.js
git commit -m "feat: import Telegram media into Eagle"
```

### Task 5: Register only Telegram Web K and perform end-to-end regression verification

**Files:**
- Modify: `manifest.json`
- Modify: `tests/manifest.test.js`
- Modify: `README.md` if present; otherwise create `docs/telegram-eagle.md`

**Interfaces:**
- Adds an isolated content-script declaration matching only `https://web.telegram.org/k/*` with `src/content/telegram-content-script.js` and `src/content/telegram-content.css`.
- Keeps the existing X content-script declarations byte-for-byte unchanged.

- [ ] **Step 1: Add a failing manifest isolation test**

```js
it('registers Telegram controls only for Web K and preserves the X script declarations', () => {
  const telegram = manifest.content_scripts.find((entry) => entry.matches.includes('https://web.telegram.org/k/*'));
  expect(telegram).toEqual(expect.objectContaining({ js: ['src/content/telegram-content-script.js'], css: ['src/content/telegram-content.css'] }));
  expect(manifest.content_scripts.filter((entry) => entry.matches.includes('https://x.com/*'))).toHaveLength(2);
});
```

- [ ] **Step 2: Run the manifest test and confirm it fails**

Run: `npm test -- tests/manifest.test.js`

Expected: FAIL because no Telegram Web K content-script declaration exists.

- [ ] **Step 3: Add the minimal manifest entry and user guide**

```json
{
  "matches": ["https://web.telegram.org/k/*"],
  "js": ["src/content/telegram-content-script.js"],
  "css": ["src/content/telegram-content.css"],
  "run_at": "document_idle"
}
```

Add `https://web.telegram.org/k/*` to `host_permissions`. Document prerequisites: Eagle open, Native Messaging host installed, reload extension after update; explain the two target folders, one-item click flow, supported media, and no-repeat behavior.

- [ ] **Step 4: Run automated verification and manual acceptance**

Run: `npm test`

Expected: PASS for the full suite, including all existing X tests.

Manual acceptance in Telegram Web K:

1. Reload the unpacked extension at `chrome://extensions` and open Eagle.
2. Open a chat containing a normal loaded image and click its Eagle corner control.
3. Confirm one item appears in `Telegtam-Picture`, then verify the control says “已保存” after DOM rerender/reload.
4. Repeat with a normal MP4 video and confirm one item appears in `Telegtam-Video`.
5. Open `https://x.com/` and verify the X popup, side panel, scanning and Eagle buttons continue to work unchanged.

- [ ] **Step 5: Commit final integration**

```bash
git add manifest.json tests/manifest.test.js docs/telegram-eagle.md
git commit -m "feat: register Telegram Web K Eagle save"
```

## Plan Self-Review

- **Spec coverage:** Tasks 1–4 cover single-image/video identity, Telegram-only controls, temporary local-file import, `Telegtam-*` folder routing, retryable failures, and dedup. Task 5 covers Web K-only registration, guide, full X regression and manual verification. Non-target media is explicitly excluded in Task 3.
- **Placeholder scan:** No `TODO`/`TBD` markers, unspecified error handling, or cross-task “same as above” shortcuts remain.
- **Type consistency:** `record.key` always comes from `telegramMediaKey`; content emits `TELEGRAM_REGISTER_DOWNLOAD`; background emits `TELEGRAM_SAVE_STATE`; both use `requestId`, `record`, and `filename`; the native host accepts `localPath` fields from `telegramEagleItem`.
