# X 媒体下载器紧凑 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 默认使用自动滚动，并将侧栏改造为紧凑的任务导向界面。

**Architecture:** 保持 `panel.js` 中的既有元素 ID 与消息协议；HTML 增加语义容器和状态计数节点，JS 只负责将当前任务状态投影到新节点，CSS 提供卡片、按钮、标签页及可折叠日志视觉层。扫描和下载后台逻辑不变。

**Tech Stack:** Manifest V3、原生 HTML/CSS、ES modules、Vitest + JSDOM。

## Global Constraints

- 默认滚动方式必须为 `auto`，但用户可切换至 `manual`。
- 保留 `#primary`、`#auto-scroll`、`#batch-download`、媒体 Tab、日志和列表的既有行为。
- 不增加依赖，不改动下载协议、文件命名或后台消息类型。

---

### Task 1: 默认自动滚动

**Files:**
- Modify: `src/panel/panel.html`
- Test: `tests/popup.test.js`

**Interfaces:**
- Consumes: `input[name="scroll-mode"]` 的值由 `panel.js` 发送给 `START_COLLECTION`。
- Produces: 新面板初始状态中自动滚动选项为选中状态。

- [ ] **Step 1: 写失败测试**

```js
it('defaults the panel scroll choice to automatic', () => {
  expect(readFileSync('src/panel/panel.html', 'utf8'))
    .toMatch(/name="scroll-mode" value="auto" checked/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/popup.test.js`

Expected: FAIL，因为当前 `manual` 选项带有 `checked`。

- [ ] **Step 3: 最小实现**

将 `checked` 从 `manual` radio 移到 `auto` radio，保持其余 input ID 与 name 不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/popup.test.js`

Expected: PASS。

### Task 2: 任务导向侧栏布局

**Files:**
- Modify: `src/panel/panel.html`
- Modify: `src/panel/panel.css`
- Modify: `src/panel/panel.js`
- Test: `tests/panel.test.js`

**Interfaces:**
- Consumes: `status` 对象的 `phase`、`total`、`pending`、`completed`、`unavailable`、`logs` 字段。
- Produces: `task-state`、`stat-total`、`stat-pending`、`stat-completed`、`stat-unavailable`、`diagnostics` 节点；`render()` 更新它们。

- [ ] **Step 1: 写失败测试**

```js
it('renders compact task statistics from the current status', () => {
  expect(taskStateView({ phase: 'scanning', total: 12, pending: 9, completed: 2, unavailable: 1 }))
    .toEqual({ label: '扫描中', total: 12, pending: 9, completed: 2, unavailable: 1 });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/panel.test.js`

Expected: FAIL，因为 `taskStateView` 尚未导出。

- [ ] **Step 3: 最小实现**

在 `panel.js` 导出 `taskStateView(status)`，按 `scanning`、`downloading`、`complete`、空闲转换短状态标签并返回计数；在 `render()` 中更新统计节点。HTML 使用品牌行、状态卡、设置卡、下载卡和 `details#diagnostics`，CSS 提供窄栏响应式卡片层级、强调主按钮和不挤压列表的诊断日志。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/panel.test.js`

Expected: PASS，且既有下载列表测试全部保持通过。

### Task 3: 全量验证

**Files:**
- Verify: `manifest.json`
- Verify: `src/panel/panel.js`
- Test: `tests/*.test.js`

- [ ] **Step 1: 运行完整测试与语法检查**

Run: `npm test; node --check src/panel/panel.js; Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null`

Expected: 所有测试通过，面板脚本语法有效，扩展清单 JSON 有效。
