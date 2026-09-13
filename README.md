# Tree Style History Viewer

在浏览器中使用树状结构查看浏览历史，按页面来源保留访问上下文。

View browsing history as a tree, following the source of each page so you can recover context quickly.

## 安装 | Install

1. 下载或克隆此仓库。
2. 打开 Chrome 的 `chrome://extensions`，开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本仓库目录。
4. 点击工具栏图标，或使用 `Ctrl+Shift+H`（macOS 为 `Command+Shift+H`）打开历史页。

## 功能 | Features

- 按访问来源构建树状历史。
- 在同一个日历面板中选择起始日期和结束日期，并按标题或网址筛选。
- 快捷范围：今天、昨天、最近 7 天、最近 30 天。
- 折叠/展开节点，搜索时自动保留匹配路径。
- 可隐藏连续重复访问，并复制任意链接。
- 可勾选网址并删除该网址的全部历史记录（删除前会确认）。
- 筛选偏好保存在当前浏览器的扩展页面本地。

## 权限与隐私 | Permissions & privacy

扩展使用 `history` 读取 Chrome 浏览历史，使用 `favicon` 显示网站图标。历史数据只在扩展页面内处理，不会上传服务器，也不会收集账号或浏览内容。

The extension uses Chrome's `history` permission to read browsing history and `favicon` to show site icons. Data is processed locally in the extension page and is never uploaded.

## 已知限制 | Known limits

树状关系依赖 Chrome 提供的 `referringVisitId`；没有来源信息的记录会显示为起点。部分内部页面或特殊网址可能没有标题或图标。

Tree relationships depend on Chrome's `referringVisitId`. Visits without a source are shown as starting points, and some internal or special URLs may not have a title or favicon.

## 发布检查 | Release checklist

- 在 `chrome://extensions` 中重新加载并验证日期、搜索、折叠和快捷范围。
- 检查空结果、无效日期、权限错误和图标加载失败提示。
- 更新 `manifest.json` 的版本号，并保留上一版本作为回滚包。
