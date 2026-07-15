# Markdown Workbench

一个本地优先的 Markdown 阅读、编辑与多文档工作台。它直接在浏览器中处理本地文件，让你并排查看、编辑和整理多篇 Markdown，同时尽量不让文档内容离开当前设备。

[![CI](https://github.com/BruceL017/markdown-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/BruceL017/markdown-workbench/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

简体中文 | [English](README.en.md)

## 它解决什么问题

常见的在线 Markdown 工具需要先上传内容，传统编辑器又容易变成过于庞大的开发环境。Markdown Workbench 面向写作者、开发者、研究者和知识工作者，提供一张安静的浏览器工作台：打开本地文件，按需要分栏，修改后写回原文件或下载副本。

适合这些场景：

- 对照阅读需求文档、技术方案和会议记录
- 同时整理多篇互相引用的 Markdown 文档
- 临时预览带表格、任务列表、代码块和本地图片的内容
- 在不把私人笔记上传到第三方服务的前提下完成轻量编辑

## 主要功能

### 本地文件与隐私

- 打开一个或多个 `.md`、`.markdown` 文件
- 打开整个文件夹，并递归发现其中的 Markdown 与本地图片资源
- 文档正文不上传到服务器，也不使用遥测
- 本地图片通过浏览器对象 URL 解析，不需要上传
- 清楚提示远程图片仍会向图片所在的第三方服务器发起请求

### 多文档工作台

- 文件抽屉统一管理已打开和暂存的文档
- 在桌面端向左、右、上、下分栏打开文档
- 支持拖动文档到工作区边缘停靠，并拖动分隔线调整窗格尺寸
- 同一文档不会在多个窗格中重复打开，已有视图会被直接聚焦
- 小屏设备自动使用更适合触控操作的单窗格布局

### 编辑与预览

- 基于 CodeMirror 的 Markdown 编辑器，支持语法高亮、搜索、替换与撤销重做
- 源码和预览模式可随时切换
- 支持 GFM 表格、任务列表、删除线和自动链接
- 支持围栏代码块语法高亮
- 支持同一工作区内的相对图片、文档链接和锚点跳转
- 允许安全的原始 HTML，同时过滤脚本、事件处理器和危险链接

### 保存、冲突与恢复

- 支持 `Ctrl+S` / `Command+S` 和界面保存按钮
- 浏览器支持 File System Access API 时，可在明确授权后写回原文件
- 不支持直接写回时，自动降级为下载编辑后的副本
- 保存前检测磁盘文件是否被其他程序修改
- 冲突发生时可选择重新载入磁盘版本、下载当前草稿或覆盖原文件
- 关闭含未保存修改的窗格前提供保存、放弃或取消选项
- 使用 IndexedDB 恢复草稿、窗格布局、主题和语言偏好
- 可在“隐私与本地数据”中清除全部浏览器恢复数据和已保存权限

### 界面与可访问性

- 简体中文与英文界面，可自动跟随首次访问时的浏览器语言
- 跟随系统、浅色和深色三种主题
- 核心流程支持键盘操作并提供清晰的焦点状态
- 以 WCAG 2.2 AA 为测试基线
- 覆盖桌面、移动端以及 Chromium、Firefox、WebKit 的端到端测试

## 怎么使用

1. 打开应用，选择“打开文件”或“打开文件夹”。
2. 从文件抽屉点击文档；桌面端也可以选择分栏方向或拖到工作区边缘。
3. 在窗格工具栏中切换“源码”和“预览”。
4. 编辑内容后点击保存按钮，或按 `Ctrl+S` / `Command+S`。
5. 如果原文件已在磁盘上发生变化，根据提示选择重新载入、下载副本或覆盖。
6. 不再需要恢复记录时，打开“隐私与本地数据”，选择“清除本地数据”。

顶部状态会明确显示当前是“直接保存”还是“下载保存”，不会把下载副本伪装成原文件写回。

## 浏览器保存方式

| 浏览器能力 | 打开方式 | 保存方式 |
| --- | --- | --- |
| 支持 File System Access API，且运行在安全上下文 | 系统文件或文件夹选择器 | 获得写入授权后保存到原文件 |
| 不支持 File System Access API | 浏览器文件或文件夹选择器 | 下载新的 Markdown 副本 |

直接写回始终需要用户主动授权。即使浏览器拒绝写入权限，当前草稿也会继续保留在本地恢复数据中。

## 隐私边界

| 数据 | 存放与行为 |
| --- | --- |
| Markdown 正文 | 在浏览器内存和本机 IndexedDB 中处理，不上传 |
| 本地图片 | 仅在当前浏览器会话中读取并生成本地对象 URL |
| 远程图片 | 会向图片的第三方地址发送无 Referer 的 GET 请求 |
| 草稿与布局 | 保存在本机 IndexedDB，可由用户随时清除 |
| 文件权限 | 由浏览器管理，仅针对用户明确选择的本地文件 |
| 遥测与使用分析 | 不收集 |

IndexedDB 草稿用于意外恢复，不等同于正式备份。重要文档仍应使用版本管理或其他备份方案。

## 本地运行

需要以下环境：

- Node.js `^20.19.0`、`^22.13.0` 或 `>=24.0.0`
- npm
- 无需后端服务、数据库或 API Key

克隆仓库、安装依赖并启动开发服务器：

```bash
git clone https://github.com/BruceL017/markdown-workbench.git
cd markdown-workbench
npm ci
npm run dev
```

终端会输出本地访问地址。检查并预览生产构建：

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

生产构建输出到 `dist/`，可部署到任意静态文件托管服务。

运行浏览器端到端测试：

```bash
npx playwright install
npm run test:e2e
```

## 技术栈

- React、TypeScript、Vite
- CodeMirror 6
- FlexLayout React
- React Markdown、Remark GFM、Rehype
- Zustand、IndexedDB (`idb`)
- Vitest、Testing Library、Playwright、axe-core

## 项目原则

- 本地优先：文件内容默认留在设备上
- 能力透明：明确区分原文件写回和下载副本
- 内容优先：让文档占据主要空间，工具只在需要时出现
- 渐进增强：浏览器能力不同，但核心阅读和编辑流程保持可用
- 安全保存：权限、冲突、未保存状态和恢复结果始终可见

## License

本项目采用 [MIT License](LICENSE)。
