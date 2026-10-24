# X 媒体下载器媒体列表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧边栏提供独立批量下载按钮以及按可下载状态分类的媒体列表，并支持链接打开和逐项下载。

**Architecture:** 保持任务的 `items` 为唯一媒体数据源；后台暴露项目列表，面板通过纯函数分类和渲染。批量与单项下载共用目录写入及逐项状态消息，只是传入的项目集合不同。

**Tech Stack:** Manifest V3、原生 ES modules、File System Access API、Vitest、JSDOM。

## Global Constraints

- 扫描主按钮只能开始或停止扫描，绝不触发下载。
- 批量下载只处理有 URL 且处于待下载状态的项目，并只选择一次目录。
- 单项下载每次必须选择目录。
- 不可下载 Tab 只显示 `unavailable`，并显示原因且不提供下载按钮。
- 所有 URL 均用安全的外链锚点在新标签页打开。

---

### Task 1: 媒体分类与下载目标选择

**Files:**
- Modify: `src/panel/panel.js`
- Modify: `tests/panel.test.js`

**Interfaces:**
- Produces: `mediaTabs(items)`，返回 `{ downloadable, unavailable }`。
- Produces: `downloadTargets(items, key?)`，批量返回可下载 pending 项，单项返回匹配且可下载的项目。

- [ ] **Step 1: Write failing tests**

```js
expect(mediaTabs([{ key: 'a', url: 'a.jpg', status: 'pending' }, { key: 'b', status: 'unavailable' }]))
  .toMatchObject({ downloadable: [{ key: 'a' }], unavailable: [{ key: 'b' }] });
expect(downloadTargets([{ key: 'a', url: 'a.jpg', status: 'pending' }, { key: 'b', url: 'b.jpg', status: 'completed' }]))
  .toEqual([{ key: 'a', url: 'a.jpg', status: 'pending' }]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/panel.test.js`

Expected: FAIL because the classifier and target selector do not exist.

- [ ] **Step 3: Implement minimal pure helpers**

```js
export function mediaTabs(items = []) {
  return { downloadable: items.filter((item) => item.status !== 'unavailable'), unavailable: items.filter((item) => item.status === 'unavailable') };
}
```

`downloadTargets` must additionally require a URL and `status === 'pending'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/panel.test.js`

Expected: PASS.

### Task 2: 独立批量与单项目录下载

**Files:**
- Modify: `src/panel/panel.js`
- Modify: `tests/panel.test.js`

**Interfaces:**
- Produces: `downloadSelected(directory, items, sendMessage)`，逐项发送下载状态并写入文件。
- Consumes: `window.showDirectoryPicker({ mode: 'readwrite' })` 在批量或单项按钮点击时调用。

- [ ] **Step 1: Write failing test**

```js
await downloadSelected(directory, [{ key: 'a', url: 'a.jpg', username: 'alice', filename: 'alice/a.jpg' }], sendMessage, fetchImpl);
expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DOWNLOAD_ITEM_STATUS', key: 'a', status: 'completed' }));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/panel.test.js`

Expected: FAIL because `downloadSelected` does not exist.

- [ ] **Step 3: Implement shared downloader**

`downloadSelected` sends `BEGIN_DIRECTORY_DOWNLOAD` once for the chosen group, marks each selected item downloading, calls `writeMediaFile`, then sends completed or failed. The batch click obtains all pending targets; each item click obtains only its own target.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/panel.test.js`

Expected: PASS.

### Task 3: 列表 Tab 和独立下载区

**Files:**
- Modify: `src/panel/panel.html`
- Modify: `src/panel/panel.css`
- Modify: `src/panel/panel.js`
- Modify: `tests/panel.test.js`

**Interfaces:**
- Consumes: `GET_TASK_ITEMS` returning `{ items }`.
- Produces: a DOM list in `#media-list`, Tab buttons `#tab-downloadable` and `#tab-unavailable`, and `#batch-download`.

- [ ] **Step 1: Write failing render test**

```js
expect(renderMediaList([{ key: 'a', kind: 'video', url: 'https://video.twimg.com/a.mp4', status: 'pending' }], 'downloadable'))
  .toContain('打开链接');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/panel.test.js`

Expected: FAIL because no list renderer exists.

- [ ] **Step 3: Implement panel controls and renderer**

Render escaped text with DOM nodes, use anchors with `target="_blank"` and `rel="noreferrer"`, show dates/status/reason, and use `data-download-key` for item action delegation. Keep batch download separate from primary scan control.

- [ ] **Step 4: Run full suite**

Run: `npm test -- --run`

Expected: PASS with no test failures.

- [ ] **Step 5: Manual Chrome verification**

Reload the unpacked extension, finish a scan, verify both Tabs, each open link, single-item folder choice and batch folder choice.
