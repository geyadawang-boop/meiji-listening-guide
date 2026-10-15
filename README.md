# 梅酱的听课指南

开源软件仓库，当前版本 **0.1.83**。通过 [软件下载页面](https://github.com/mikudeshuo/meiji-listening-guide/releases/latest) 下载 Windows 完整程序包，解压后运行「梅酱的听课指南.exe」。

## 隐私与资料

发布包使用空课程库，不含个人课程、教材、课件、字幕、聊天历史、账号或登录状态。此仓库不用于存放个人资料。

## 功能与版本范围

课程和会话管理、视频下载、字幕转写、笔记、课件 PDF、可编辑教材批注、中文知识库、研究工具及工作流。应用逻辑采用 TypeScript，原生桌面界面；FFmpeg、SQLite、ONNX 等为第三方运行资源。当前 SponsorBlock、部分旧下载高级选项尚未接入；部分平台字幕及真实账号完整流程尚未全面验收。

## 开发

Node.js 24，npm ci 后 npm run build。离线模型和原生运行资源体积较大，未提交到 Git；需从同版 Release 提取 resources/asr、resources/codex、resources/knowledge、resources/video。npm run test 执行自动检查。

## 许可证

沿用项目现有 AGPL-3.0-only 和各第三方组件许可证；保留 LICENSE、NOTICE、THIRD_PARTY_NOTICES.md 及程序内许可证。
