# 千问视觉路由与旧连接清理

本批为 0.1.85 候选源码收尾，未安装、发布或操作真实课程库。

## 本批修改

- `QwenSettings.tsx`：视觉默认仍为 `qwen3-vl-plus`，增加协调者已核实的 `qwen3.8-max`、`qwen3.7-plus` 候选，保留自定义视觉模型 ID；文本模型列表不会自动作为视觉候选列表。沿用已验收的设置导航。
- `App.tsx`、`CoursePanels.tsx`：默认模型显示为 `qwen3.8-flash`，字幕及课件说明改为本地提取文字、嵌入图片后交千问分批校订。
- `Study.tsx`：移除没有接入的 Codex 定时任务提示，改为手动检查与保存划线的实际流程。
- `VisualAnalysis.tsx`：即使已经输出部分成果，存在未完成帧时也能继续识别；保留打开原成果入口，提示画面会发送至所选千问视觉模型。
- `main.ts`、`ipc/learning.ts`、`video-ppt.ts`：对齐 Api.chat 参数，移除旧连接的 fast 参数。
- `settings.ts`、`documents.ts`：修复存储配置及 JSZip 元数据类型，保留课件解压尺寸检查；`ipc/research.ts` 移除旧模型名称回退。
- 删除无生产引用的 Codex/DeepSeek 连接与设置源码、旧 API 编辑器、旧登录浏览器及旧课件适配器。旧加密设置字段、许可和历史资源保留。
- `package.json`、`scripts/runtime-manifest.mts`、`resources/runtime-manifest.json`：不再打包或展示 Codex 连接组件；保留知识库、ASR、视频组件及其原哈希记录。

## 验证与边界

本批 `npm run typecheck` 退出 0；该检查启动于最后视觉续传 UI 补丁之前，最终构建与实际界面回归由协调者在冻结后统一执行。协调者此前报告领域回归 13/13、证据导出 6 项通过；此处不将这些结果冒充本批重新执行。

模型列表与本地测试不代表真实账号权限、配额和生产视觉质量已验收。真实服务验证、最终测试回执和用户确认以协调者最终交付为准。扫描 PDF OCR、PPTX 完整页面渲染、视频全时段覆盖仍未因此实现。
