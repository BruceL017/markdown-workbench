<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Markdown Workbench
description: A calm, local-first workspace for reading and editing Markdown.
---

# Design System: Markdown Workbench

## Overview

**Creative North Star: "The Quiet Workbench"**

界面像一张整理干净的工作台：内容直接放在眼前，工具只在需要时出现。整体采用克制的产品界面语法，参考 GitHub Markdown 的阅读清晰度、VS Code 的停靠心智模型，以及 Notion 对内容空间的尊重。

设计变化度为 3，动效强度为 2，信息密度为 6。系统拒绝重型 IDE 外壳、装饰性玻璃拟态、AI 紫渐变和无意义动画。

**Key Characteristics:**

- 内容区域占据绝大部分视口。
- 海港蓝只用于主操作、选择与焦点。
- 信息紧凑但不拥挤，层级依靠间距、字重和细边框。
- 动效只解释抽屉、状态变化和直接操作反馈。

## Colors

采用 Restrained 策略：中性表面承载内容，低饱和海港蓝的占比不超过每个界面的 10%。实现时以 OKLCH 作为唯一颜色源。

**The One Accent Rule.** 海港蓝是唯一装饰性强调色。成功、警告与错误色只表达真实状态。

## Typography

采用单一系统无衬线字体栈处理界面，CodeMirror 和代码块使用系统等宽字体。产品标签使用固定字号，不使用营销页面式流体大标题。

**The Reading First Rule.** Markdown 正文保持 65-75ch 的舒适行长；工具栏与文件树可以更紧凑，但不得牺牲可读性。

## Elevation

默认使用平面与色调分层。阴影只用于临时文件抽屉、对话框和浮层，帮助说明它们位于文档上方；静态窗格不使用卡片阴影。

**The Flat By Default Rule.** 常驻界面依靠背景层级与 1px 边框组织，不用悬浮卡片堆叠。

## Components

控件采用熟悉的产品界面形态：按钮与字段使用紧凑内边距和清晰焦点环，窗格标题保持单行，图标来自同一图标家族。抽屉以短促的位移动画进入；键盘触发的高频操作立即响应，不等待动画。

## Do's and Don'ts

### Do:

- **Do** 让文档内容始终拥有最高视觉优先级。
- **Do** 明确显示未保存、权限、冲突和兼容保存状态。
- **Do** 使用 150-250ms 的状态动效，并支持减少动态效果。
- **Do** 在桌面和移动端保持相同的按钮、字段与反馈语言。

### Don't:

- **Don't** 做完整 IDE 式重型外壳，不复制 VS Code 的活动栏和密集状态栏。
- **Don't** 使用 AI 紫渐变、霓虹发光、装饰性玻璃拟态或无意义动画。
- **Don't** 用卡片堆叠掩盖层级，也不把空状态写成营销落地页。
- **Don't** 隐藏浏览器权限差异，不把下载副本假装成原文件保存。
- **Don't** 收集文档、使用数据或遥测。
