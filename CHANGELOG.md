# 更新记录

## 未发布

- 移除 ChatGPT 账号及旧 Codex/DeepSeek 生产入口，文本与视觉模型统一使用千问配置；新增字幕分批校订与恢复、PPTX/PDF 文字提取、来源可追溯的 JSON/Markdown 课程导出与知识库检索。
- 修复模型请求重试、视觉候选选择与恢复、课件缓存及非 Windows 组件安装提示。
- 开发流程采用 pnpm、Biome 和 CI；发布支持 Windows 安装包及 macOS/Linux 精简包配置，附分平台 SHA-256 清单。
- 工具链及跨平台发布配置参考 EveSunMaple 的 PR #5（60551c5），按当前千问组件和账号范围适配。macOS/Linux 实机及真实千问服务仍需单独验证。
