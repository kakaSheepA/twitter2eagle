# Telegram Web K：单媒体保存至 Eagle 设计

## 目标

在 `https://web.telegram.org/k/` 的已加载普通图片和普通视频上显示轻量 Eagle 角标。用户点击后，将该单个媒体保存至 Eagle；图片保存到 `Telegtam-Picture`，视频保存到 `Telegtam-Video`。同一媒体成功保存后显示“已保存”，再次点击不重复导入。

## 范围

- 仅支持 Telegram Web K，不支持 Web A、Telegram 桌面端或移动端。
- 仅支持普通图片、普通视频与相册中的图片/视频单项。
- 首次使用时，自动在当前 Eagle 资料库创建或复用 `Telegtam-Picture` 与 `Telegtam-Video` 文件夹。
- 为条目写入 `Telegram`、`图片`或`视频`标签，以及可安全获取的聊天/频道名称、消息 ID、时间和公开消息链接（如存在）。
- 使用 Telegram Web K 自身允许的下载流程；不绕过下载限制，也不处理一次性、受保护、付费或尚未加载的媒体。

## 非范围

- 不修改 X/Twitter 的扫描、下载、面板、任务、文件夹规则或 Eagle URL 导入行为。
- 不批量扫描或批量导入 Telegram 历史消息。
- 不支持文件附件、GIF、贴纸、语音、视频消息、链接预览或相册整组一键保存。
- 不上传媒体、聊天内容或元数据到第三方服务。

## 关键事实与决策

Telegram Web K 画面中的普通图片实际使用 `blob:` URL；普通视频使用需 Telegram 会话上下文的 `stream/...` URL。因此不能把网页 URL 直接交给 Eagle，也不能依赖现有 X 的 URL 导入链路。

选定链路为：

1. 内容脚本识别已渲染的 Telegram 媒体消息并添加角标。
2. 用户点击角标后，扩展调用 Telegram Web K 已提供的该媒体下载操作。
3. 后台监听并匹配本次下载，取得 Chrome 下载完成后的本地文件路径。
4. 通过已安装的 Native Messaging 助手，将本地文件导入 Eagle 指定文件夹。
5. 导入成功后写入独立 Telegram 存储记录并更新角标状态。

这条链路只使用用户已有 Telegram 会话可下载的文件；Telegram 未提供下载能力时，界面应显示明确的不支持原因。

## 模块边界与隔离

- `src/telegram/`：新增 Telegram Web K 内容脚本、DOM 媒体识别、角标组件与 Telegram 专用元数据解析。
- `src/shared/telegram-media.js`：纯函数，生成媒体唯一键、文件名、Eagle 条目元数据和类型判断。
- `src/background/telegram-eagle.js`：Telegram 专用保存编排，包括下载匹配、文件夹确保、本地导入及状态回传。
- `src/shared/eagle-client.js`：新增且仅容纳通用 Eagle 本机 API 与本地导入调用；现有 X 模块保持既有对外接口与行为。
- Chrome storage 使用 `telegramEagle:*` 前缀；键为 `peerId + messageId + mediaKind`。不得读写 X 的任务或状态键。
- `manifest.json` 只增添 Telegram Web K 的匹配项与必要的最小权限，不更改 X 的匹配、脚本、权限语义或面板入口。

## 交互与状态

- 默认：媒体右上角显示 Eagle 角标，悬停说明“保存到 Eagle”。
- 保存中：角标禁用，显示进度或加载态。
- 成功：显示“已保存”，禁用再次导入。
- 失败：恢复可点击，显示失败原因；用户可重试。
- 不支持：不显示角标；下载流程被 Telegram 拒绝时，角标恢复可点击并显示失败原因。

相册必须按单项添加角标和唯一键；不能因一项保存而误标整组已保存。

## 错误处理

- Eagle 未打开、API 不可用或 Native Messaging 助手不存在：阻止保存并说明所需操作。
- Telegram 下载控件不存在、被限制或下载取消/失败：不创建 Eagle 条目，不写成功去重记录。
- Chrome 下载路径不可用或本地导入失败：保留可重试状态，清晰报告失败阶段。
- Telegram DOM 结构无法识别：静默不注入，控制台记录可诊断信息，不影响页面本身。

## 验收与测试

- X 页面不加载 Telegram 内容脚本；全部既有 X 测试仍通过。
- Web K 普通图片、普通视频和相册单项各能显示一个角标。
- 图片保存至 `Telegtam-Picture`，视频保存至 `Telegtam-Video`；文件夹不存在时只创建一次。
- 成功保存后，同一 `peerId + messageId + mediaKind` 显示“已保存”且不再次下载或导入。
- 下载、Eagle 或本地助手失败时不误标成功，且用户可重试。
- 不可下载、一次性或非目标媒体不会被保存或绕过权限。
