# X 媒体采集层重构

## 目标

用双通道采集替换现有单一 DOM 选择器：DOM 负责稳定发现推文、图片和视频候选项；页面网络桥接负责从 X GraphQL 的 fetch 与 XHR 响应补全原图和最高码率 MP4。

## 采集通道

- 内容脚本观察 `article[data-testid="tweet"]` 与普通 `article`，以状态链接和 `time[datetime]` 建立推文身份；收集任意 `pbs.twimg.com` 图片、video poster、video src 和媒体链接。
- 主世界桥接同时包装 fetch 和 XMLHttpRequest，在 JSON GraphQL 响应中递归提取 tweet results 与媒体 variants。
- 后台以推文 ID 合并两个通道；DOM 发现即计数，GraphQL 后到时补全下载 URL。视频无 MP4 时保留“待解析/无可用 MP4”状态。

## 可观测性

任务状态统一返回日志和计数：内容脚本连接、主动注入成功或失败、DOM 扫描 tweet 数、图片数、视频数、GraphQL 响应数、媒体上报数及每个错误。侧边栏轮询时必须显示这些日志，不能丢弃字段。

## 验收

1. 已打开的 X 页开始采集时主动注入内容脚本并记录成功日志。
2. 含图片或视频的可见推文会立即增加发现计数。
3. DOM 通道故障、桥接通道故障和后台接收故障能在侧边栏区分。
4. 视频 variant 可用时下载最高码率 MP4；图片下载原图。
