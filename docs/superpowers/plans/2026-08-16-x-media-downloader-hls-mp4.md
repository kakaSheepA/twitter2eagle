# X 媒体下载器 HLS 转 MP4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 X 的 HLS `.m3u8` 视频在本地重封装为单个 MP4 文件。

**Architecture:** `src/shared/hls.js` 解析播放清单、选择最高码率变体和拒绝加密流。面板 Worker 下载并用本地打包的 mux.js 将 TS 分片变为 fMP4；面板保有目录权限并顺序写入 Worker 返回的数据，后台继续只管理状态。

**Tech Stack:** Manifest V3、原生 Worker、File System Access API、mux.js、Vitest。

## Global Constraints

- 不上传媒体或使用第三方转码服务。
- 有直接 MP4 URL 的媒体保持当前下载逻辑。
- HLS 使用最高带宽变体，输出 `.mp4`。
- 含 `#EXT-X-KEY` 的加密清单必须失败并显示原因。

---

### Task 1: HLS 清单解析

**Files:**
- Create: `src/shared/hls.js`
- Test: `tests/hls.test.js`

**Interfaces:**
- Produces: `parsePlaylist(text, baseUrl)`，返回 `{ type: 'master'|'media', variants, segments }`。
- Produces: `selectHighestVariant(variants)`，按 `BANDWIDTH` 返回最高项。

- [ ] **Step 1: 写失败测试**

```js
expect(selectHighestVariant(parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900\nhigh.m3u8', 'https://video.twimg.com/a/master.m3u8').variants).url)
  .toBe('https://video.twimg.com/a/high.m3u8');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/hls.test.js`

Expected: FAIL，因为模块不存在。

- [ ] **Step 3: 最小实现**

解析 `#EXT-X-STREAM-INF`、媒体 URI、`#EXTINF`，将相对 URI 用 `new URL(uri, baseUrl)` 绝对化；发现 `#EXT-X-KEY` 时抛出 `不支持加密 HLS 视频`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/hls.test.js`

Expected: PASS。

### Task 2: 本地封装 Worker

**Files:**
- Create: `src/panel/hls-worker.js`
- Create: `src/vendor/mux.js`
- Modify: `package.json`
- Test: `tests/hls.test.js`

**Interfaces:**
- Consumes: `{ type: 'DOWNLOAD_HLS', url, requestId }`。
- Produces: `{ type: 'HLS_PROGRESS', requestId, completed, total }`、`{ type: 'HLS_COMPLETE', requestId, chunks }`、`{ type: 'HLS_ERROR', requestId, error }`。

- [ ] **Step 1: 写失败测试**

```js
expect(outputExtension({ kind: 'hls', extension: 'm3u8' })).toBe('mp4');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/panel.test.js`

Expected: FAIL，因为 HLS 仍保留 `m3u8` 扩展名。

- [ ] **Step 3: 最小实现**

将 `mux.js` 的浏览器构建产物固定打包到 `src/vendor/mux.js`；Worker 下载 master/media playlist，顺序处理 TS 分片并通过 mux.js 输出 MP4 fragment，逐段回传并报告进度。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/panel.test.js`

Expected: PASS。

### Task 3: 目录写入与状态

**Files:**
- Modify: `src/panel/panel.js`
- Modify: `src/panel/panel.html`
- Modify: `src/panel/panel.css`
- Test: `tests/panel.test.js`

**Interfaces:**
- Consumes: `downloadSelected(directory, items)` 与 HLS Worker 消息。
- Produces: HLS 项以 MP4 文件名写入已选择的用户名目录；媒体卡片显示百分比进度。

- [ ] **Step 1: 写失败测试**

```js
expect(downloadTargets([{ key: 'hls', kind: 'hls', url: 'master.m3u8', status: 'pending' }]))
  .toEqual([expect.objectContaining({ key: 'hls' })]);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/panel.test.js`

Expected: FAIL，直到 HLS 下载路由被实现。

- [ ] **Step 3: 最小实现**

在 `downloadSelected` 中按 `item.kind === 'hls'` 调用 Worker；创建 `.mp4` 文件句柄并顺序写入完成的 MP4 块；进度消息更新列表状态；任何错误调用既有 `DOWNLOAD_ITEM_STATUS` 记录失败原因。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/panel.test.js`

Expected: PASS。

### Task 4: 全量验证

- [ ] **Step 1: 运行完整测试与语法检查**

Run: `npm test; node --check src/shared/hls.js; node --check src/panel/hls-worker.js; node --check src/panel/panel.js`

Expected: 全部测试通过，三个脚本均可由 Node 解析。
