# X 媒体下载器下载与滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 X 媒体下载器把扫描和下载分离，解析最高码率 MP4，在一次选择目录后写入媒体，并支持手动或自动滚动扫描。

**Architecture:** 内容脚本从 DOM 与页面网络响应收集媒体，背景脚本持久化任务状态并协调自动滚动。侧边栏负责选择滚动模式、在用户手势下选择目录、直接将获取到的 Blob 写入目录句柄，以及显示分阶段状态和日志。

**Tech Stack:** Manifest V3、原生 ES modules、Chrome Extensions API、File System Access API、Vitest、JSDOM。

## Global Constraints

- 图片 URL 必须使用 `name=orig`，视频只下载 `video/mp4` 中 bitrate 最大的变体。
- 下载流程必须由用户点击触发，并且只在用户选定的目录内创建用户名子目录。
- 下载文件名为 `用户名/日期_序号.扩展名`，不得包含推文 ID。
- 手动与自动滚动互斥；自动滚动可暂停、继续和停止。
- 无可用 MP4、网络与写入错误必须在任务日志和状态中可见。

---

### Task 1: 任务状态与命名模型

**Files:**
- Modify: `src/shared/media.js`
- Modify: `src/shared/task-store.js`
- Modify: `tests/media.test.js`
- Modify: `tests/task-store.test.js`

**Interfaces:**
- Produces: `downloadFilename(username, createdAt, mediaIndex, extension, collisionIndex?)` 只返回日期和序号文件名。
- Produces: 任务字段 `phase`、`scrollMode`、`autoScrollPaused`，以及 `setTaskPhase(task, phase)`。

- [ ] **Step 1: Write the failing tests**

```js
expect(downloadFilename('alice', '2026-08-16T14:32:05Z', 2, 'jpg'))
  .toBe('alice/2026-08-16_02.jpg');
expect(createTask('alice', { scrollMode: 'auto' })).toMatchObject({
  collecting: true, phase: 'scanning', scrollMode: 'auto', autoScrollPaused: false
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/media.test.js tests/task-store.test.js`

Expected: FAIL because the filename retains a time segment and the phase fields do not exist.

- [ ] **Step 3: Implement the minimum model changes**

```js
export function setTaskPhase(task, phase) {
  return { ...task, phase, collecting: phase === 'scanning', updatedAt: new Date().toISOString() };
}
```

Set `scrollMode` to `manual` unless explicitly `auto`; ensure item status remains the source of download counts.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/media.test.js tests/task-store.test.js`

Expected: PASS.

### Task 2: 网络视频解析和自动滚动内容脚本

**Files:**
- Modify: `src/content/page-bridge.js`
- Modify: `src/content/content-script.js`
- Modify: `tests/content-script.test.js`

**Interfaces:**
- Produces: `recordsFromTweet(tweet, username)` with the highest MP4 URL for video media.
- Produces: `autoScrollTick(window, beforeHeight)` returning whether the viewport moved or page height changed.
- Consumes: messages `START_AUTO_SCROLL`, `PAUSE_AUTO_SCROLL`, `RESUME_AUTO_SCROLL`, `STOP_AUTO_SCROLL`.

- [ ] **Step 1: Write failing tests**

```js
expect(recordsFromTweet(videoTweet, 'alice')[0]).toMatchObject({
  kind: 'video', url: 'high.mp4', bitrate: 2176000, status: 'pending'
});
expect(autoScrollTick({ scrollY: 0, innerHeight: 100, scrollBy: vi.fn(), document: { body: { scrollHeight: 500 } } }, 500))
  .toMatchObject({ moved: true, heightChanged: false });
```

- [ ] **Step 2: Run the content test to verify it fails**

Run: `npm test -- --run tests/content-script.test.js`

Expected: FAIL because no auto-scroll helper is exported and the bridge does not observe XHR.

- [ ] **Step 3: Implement minimal discovery and scrolling behavior**

Have the page bridge inspect cloned JSON bodies from both wrapped `fetch` and completed JSON `XMLHttpRequest`s. Keep recursive tweet discovery in the isolated content script, choose highest bitrate MP4, and send an unavailable item only when a network tweet has no MP4 variant. Run one timed scroll tick at a time, tracking three idle rounds before emitting a paused diagnostic.

- [ ] **Step 4: Run the content test to verify it passes**

Run: `npm test -- --run tests/content-script.test.js`

Expected: PASS.

### Task 3: 背景任务编排

**Files:**
- Modify: `src/background/service-worker.js`
- Modify: `tests/service-worker.test.js`

**Interfaces:**
- Consumes: `START_COLLECTION`, `STOP_COLLECTION`, `START_AUTO_SCROLL`, `PAUSE_AUTO_SCROLL`, `RESUME_AUTO_SCROLL`, `STOP_AUTO_SCROLL`.
- Produces: status with `phase`, `scrollMode`, `autoScrollPaused`, logs and summary.
- Consumes: `START_DOWNLOADS` only after the panel has acquired a directory handle.

- [ ] **Step 1: Write failing tests**

```js
expect(collectionStatus({ phase: 'scanning', scrollMode: 'auto', autoScrollPaused: true }))
  .toMatchObject({ collecting: true, phase: 'scanning', autoScrollPaused: true });
```

- [ ] **Step 2: Run the worker test to verify it fails**

Run: `npm test -- --run tests/service-worker.test.js`

Expected: FAIL because no phase-aware status helper exists.

- [ ] **Step 3: Implement minimal phase-aware orchestration**

On `START_COLLECTION`, initialize the chosen mode and scan first screen; if automatic, instruct the content script to start. On stop, stop automatic scrolling and set `phase: 'scan_complete'`; never call downloads there. Persist all status transitions and append explicit logs.

- [ ] **Step 4: Run the worker test to verify it passes**

Run: `npm test -- --run tests/service-worker.test.js`

Expected: PASS.

### Task 4: 目录写入下载器

**Files:**
- Modify: `src/panel/panel.js`
- Modify: `src/shared/media.js`
- Modify: `tests/panel.test.js`
- Modify: `tests/media.test.js`

**Interfaces:**
- Produces: `writeMediaFile(directory, item, fetchImpl)` which creates the username subdirectory and writes a Blob.
- Consumes: `window.showDirectoryPicker()` from an explicit panel click.

- [ ] **Step 1: Write failing tests**

```js
expect(primaryButton({ phase: 'scan_complete', total: 2 }))
  .toEqual({ label: '选择文件夹并开始下载', disabled: false, action: 'CHOOSE_FOLDER_AND_DOWNLOAD' });
```

- [ ] **Step 2: Run panel tests to verify they fail**

Run: `npm test -- --run tests/panel.test.js`

Expected: FAIL because `scan_complete` currently starts a new task.

- [ ] **Step 3: Implement direct directory writing**

Keep the directory handle in panel memory for the current run. On the primary user click, call `showDirectoryPicker({ mode: 'readwrite' })`, then process pending URL items with bounded concurrency: fetch the URL, create `username` via `getDirectoryHandle`, create the file via `getFileHandle`, write the blob, and report each item result to the background script. Report unsupported API and picker cancellation as visible status/log messages without starting the queue.

- [ ] **Step 4: Run panel and media tests to verify they pass**

Run: `npm test -- --run tests/panel.test.js tests/media.test.js`

Expected: PASS.

### Task 5: 侧边栏控制、回归与手工验收

**Files:**
- Modify: `src/panel/panel.html`
- Modify: `src/panel/panel.css`
- Modify: `src/panel/panel.js`
- Modify: `tests/panel.test.js`

- [ ] **Step 1: Write failing tests for phase labels and automatic pause action**

```js
expect(primaryButton({ phase: 'scanning', scrollMode: 'auto', autoScrollPaused: false }))
  .toEqual({ label: '停止扫描', disabled: false, action: 'STOP_SCAN' });
expect(autoScrollButton({ phase: 'scanning', scrollMode: 'auto', autoScrollPaused: true }))
  .toEqual({ label: '继续自动滚动', action: 'RESUME_AUTO_SCROLL' });
```

- [ ] **Step 2: Run panel tests to verify they fail**

Run: `npm test -- --run tests/panel.test.js`

Expected: FAIL because the dedicated automatic scroll action and labels do not exist.

- [ ] **Step 3: Implement the phase-based panel**

Add mutually exclusive manual/automatic radio controls. Render exactly one primary action per phase, a secondary pause/resume button only while automatic scanning, retry only for failed writes, and clear Chinese status copy that distinguishes scan count from download progress.

- [ ] **Step 4: Run the full automated suite**

Run: `npm test -- --run`

Expected: PASS with no test failures.

- [ ] **Step 5: Perform manual Chrome verification**

Reload the unpacked extension, open an X profile, verify manual scan, automatic pause/resume/stop, directory picker, original image output, a highest-bitrate MP4 output, and failure logging.
