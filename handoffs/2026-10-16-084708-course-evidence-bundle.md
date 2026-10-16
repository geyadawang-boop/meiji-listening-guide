- Updated: 2026-10-16T08:47:08.5323459-04:00

# Handoff: Meiji 课程学习证据包

- Status: complete（仅本批证据包导出；完整跨产品融合和发布未完成）
- Workspace: F:/BiliSum/integrations/meiji-listening-guide-20261016

## 现在在做什么

本批实现已完成、最终写集已冻结，协调者已对同一源码哈希完成独立验证。保留本地 feature/bilisum-course-evidence-bundle 分支及未提交差异，等待小组后续审查。基线为 main 的 073961c498eb012a127a4508be23d50d7274194d，package 仍为 0.1.85，未冒称新版本已发布。用户要求遵循线程 01a1434f-2a32-7062-a1f6-441312e77e14；已采用短期分支、小范围变更、明确修改清单、验证、兼容与回退记录。

## 已经完成什么

产品源代码由唯一 gpt-6-astra medium writer 实施，root 负责审查、依赖准备、树外验证和交付证据。

CHANGES MADE：
- src/shared/course-evidence.ts：新增纯 builder 和 Markdown 投影；schema 1.0.0，记录实际应用版本、课程/课次、原始语音文本、毫秒字幕/对照/疑点、部分校订覆盖、三类笔记、复用重点的摘要、课件提取文本与页标记/引用、练习来源/答案/作答、SHA-256 与内容修订指纹。verified/uncertain/unavailable 逐项区分，空项不得被标成 verified；没有关联记录的 OCR/画面/知识库引用明确 unavailable。
- src/main/exports.ts：增加 evidence-bundle 的 json/md 格式，集中白名单校验，复用同名预留和失败清理。
- src/main/ipc/desktop.ts：加入 export kind 校验并在目录/文件写入前验证 format，提供课程元信息。
- src/renderer/src/App.tsx：听课笔记页新增“证据包 JSON”“证据包 Markdown”；没有笔记仍可导出当前资料及缺失状态。
- package-lock.json：npm 安装补齐同步记录；与基线结构比较，原有条目版本变化 0、删除 0、新增 130。未修改 package.json 依赖范围。
- docs/changes/2026-10-16-course-evidence-bundle.md：文件、合同、状态、兼容、边界与回退说明。

## 卡在哪里

本批导出功能无阻塞。既有 npm run audit:typescript 仍 exit 1：脚本硬编码 F:/BiliSum/integrations/梅酱的听课指南-副本/resources 与 app.asar；该安装副本不在当前源码工作区，报 ENOENT。没有伪造安装副本，也没有将构建等同安装版语言审查通过。因此不能宣称所有发布检查已通过。

## 下一步做什么

1. 小组审查本地分支差异和变更文档；需要远端 PR/合并/安装包时按用户新指令执行，当前不自行发布。
2. 如准备发布，先在新任务明确安装副本和审查脚本的参数化方案，完成真实安装版审查、版本与附件哈希，再由仓库负责人决定发布。
3. 下一批完整融合需实现有来源绑定的 OCR/画面/知识库引用与统一证据导入适配，分别验收；当前仅输出缺失状态，不等同跨产品数据同步。
4. 真实 B 站、ASR/OCR、模型质量、知识库问答及用户接受仍待独立验收。

## 哪些坑不要踩

- 不直接改 main，不推送、合并或安装至真实用户目录；本轮未执行这些动作。
- 指定 writer 首次模型服务 403 insufficient balance，重试已恢复；不能据历史失败绕过 writer 规则。
- npm 配置的本机代理曾拒绝连接；空串 --proxy= 无效，单次 --proxy=null --https-proxy=null 有效。未改全局配置，不要重复无效长重试。
- 依赖安装 exit 0 不代表 Electron EXE 已就绪：本轮需单独执行已审读的 node_modules/electron/install.js。npm 安装策略提示部分脚本未覆盖；未全局放行。
- main 分支保护此前受 GitHub 私有仓库套餐限制；协作建议不等于服务器强制规则已部署。
- 数据库 schema、真实课程资料、个人账号、BiliSum 产品树均未修改。保留原十二来源、旧需求及用户确认状态；不要把本批局部功能当作全部融合完成。
- 不清理用户数据库，不覆盖旧 handoff，不使用历史通过回执冒充当前树验证。回退本批代码不需要数据库迁移；主动导出的普通文件由用户决定保留。

## 关键文件与验证

环境 Windows，Node v24.18.0 / npm 11.16.0，Electron 42.11.10。

- npm install --proxy=null --https-proxy=null --fetch-retries=0 --fetch-timeout=20000 --no-audit --no-fund：exit 0，622 包；postinstall 重建 Electron SQLite 原生依赖。
- node node_modules/electron/install.js：exit 0。
- npm ci --dry-run --offline --ignore-scripts --no-audit --no-fund：exit 0；仅 dry run，不代表另一台干净机器验证。
- npm run typecheck：exit 0；最终 npm run build 内再次通过。
- npm run build：最终 exit 0，main/preload/renderer 成功；第三方 zod PURE 注释 warning 保留，不阻止构建。
- npm run audit:typescript：最终 exit 1，既有外部副本 ENOENT，未通过。
- git diff --check：exit 0。
- node F:/BiliSum/validation/meiji-evidence-20261016/check-builder.mjs：11 项通过，含 150000 条字幕和独立 SHA-256 复算。
- node F:/BiliSum/validation/meiji-evidence-20261016/check-electron.mjs：6 项通过，真实本地 UI/IPC/文件系统，合成数据目录 F:/BiliSum/validation/meiji-evidence-20261016/runs/1792154751364；进程已由 harness 关闭。
- 最终源码哈希与验证映射：F:/BiliSum/validation/meiji-evidence-20261016/final-verification.json。验证前后五个源/锁文件哈希完全一致。
- 独立回执：同目录 builder-result.json、electron-result.json；UI 截图在上述 run 目录 notes-evidence-export.png。
- 研究和失败恢复记录：F:/BiliSum/research/2026-10-16-082558-meiji-implementation-verification.md。

受控静态/本地测试已通过不等于真实外部服务、全量性能、安装包或用户接受已验证。未提交、未推送、未合并、未生成安装包；未接通两个软件数据库。
