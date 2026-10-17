# 梅酱的听课指南

[下载 Windows 程序和源码](https://github.com/mikudeshuo/meiji-listening-guide/releases/latest)。分享此链接即可；下载程序 ZIP 后完整解压，运行「梅酱的听课指南.exe」。公开包不包含个人课程、教材或账号。

Windows x64 桌面应用。业务逻辑、前后端、独立工作进程及现行构建/维护入口使用 TypeScript；界面保持梅酱原有布局和主题。实际版本取 package.json，验收范围及适用边界见 docs/0.1.85版本说明.md。

## 开发

需要 Node.js 24 和 pnpm。依赖由 pnpm-lock.yaml 固定，SQLite 原生模块须使用 Electron ABI：

```sh
pnpm install
pnpm dev
pnpm build
```

开发与构建入口在 macOS/Linux/Windows 均可用（发布产物仍以 Windows 为主）；macOS/Linux 的 lite 安装包由 CI 构建，功能适配现状见 docs/跨平台适配清单.md。

resources 只包含独立 ONNX 模型、NapCat Node 组件和 FFmpeg/FFprobe 及其许可证。它们是必要第三方资源，不能以 TypeScript 源码代替二进制或权重。源码包不含这些大型文件，需恢复同版本组件。PDF 由应用原生 TypeScript 库处理，不需要 Python。

模型连接在设置中填写千问 API 地址与密钥，并分别选择文本和视觉模型；不再提供 ChatGPT/Codex 账号或 DeepSeek 专用入口，也不需要 Codex 连接组件。

## 检查

```sh
pnpm verify
node scripts/audit-language-migration.mts --check
```

`pnpm verify` 即 `pnpm typecheck && pnpm check`：全量类型检查加 Biome 格式检查与 lint，任一失败即不通过；CI 与本地使用同一入口。提交前可先运行 `pnpm check:fix` 自动修复格式与可修复告警，风格配置见 biome.jsonc。

媒体组件离线暂存：`node scripts/media-source-stage.mts <sourceId> <inputDirectory> <stagingRoot>`。来源仅限 `eugeneware-b6.1.1-darwin-arm64` 与 `eugeneware-b6.1.1-linux-x64`；输入目录须恰含锁定表中的四个原名文件。输出必须是系统临时目录规范路径下、尚不存在的 `meiji-media-stage-*` 直接子目录，用户路径及父目录不允许链接。工具不下载、执行或安装；`staged_verified` 只表示完整性与文件头架构通过，许可、对应源码、依赖、签名及真实运行仍待验证，不能作为可分发或可安装结论。

`pnpm verify` 执行静态检查；构建后可手动运行 `pnpm runtime:smoke`，使用隔离合成资料验证系统密钥库、工作进程恢复与设置导航。CI 的三平台运行验证仅手动触发。这些检查不代表真实账号或全部外部站点可用。

## 发布和恢复组件

```sh
pnpm build
pnpm release portable
pnpm release full
pnpm release lite
pnpm release components
pnpm release:source
node scripts/restore-runtime.mts knowledge 同版本组件文件夹
```

portable 为完整目录，full 为完整安装包，lite 为不含可选离线组件的应用，components 为同版本组件。组件恢复逐文件核对大小、SHA256 和版本，不覆盖改动过的文件；其它组件编号为 asr、video。完整发布须重建 EXE，不能只修改 ASAR。实际安装后验证版本、原生后台、运行资源及课程资料不变后才能清理回退文件。

## 代码目录

| 目录 | 职责 |
| --- | --- |
| src/main、src/main/ipc | Electron 主进程、受限原生接口、课程和任务调度 |
| src/renderer、src/preload | React 页面和最小隔离桥接 |
| src/shared | 类型、协议和验证规则 |
| scripts/*.mts | 当前构建、组件恢复、模型维护及验收入口 |
| scripts/*.ts | 保留的 TypeScript 课程维护工具，需按各脚本范围使用，不能当作自动任务批量执行 |
| resources | 原生运行组件及离线模型，不含 Python 或 yt-dlp |
| 历史参考 | 迁移前源码及一次性旧维护脚本的压缩归档，不能作为应用运行入口 |

out 中的 JavaScript 是 TypeScript 的编译产物；第三方 npm 包、WASM、DLL、FFmpeg、Electron、Codex 和模型并非本项目自写语言迁移对象。HTML 是 React 的挂载入口，CSS 是界面样式。

## 资料与登录保护

软件目录的「课程数据」和「资料」属于用户资料；机器登录和设置位于 userData。不要将这些目录、浏览器分区、Cookies 或真实日志上传 GitHub。发布包使用空课程库，首次运行不迁入本机旧资料。

站点登录档案只读取用户主动选择的 Netscape 文件，经 Windows 当前用户 DPAPI 加密保存；仅按 Cookie 域、路径、Secure 和有效期发往所选站点，不发给 CDN、SponsorBlock 或无关站点。界面仅显示档案名与站点，不显示凭据。下载任务可加密保存任务记录，但最终媒体和用户主动保留的来源文件本身不加密。

旧 aria2c 任务设置会明确改用 TypeScript 原生并行分段；不调用 aria2c 或 yt-dlp。旧工作流仅查看和导出，须重新选择当前来源才能建立新任务，不能重放历史模型请求。教材批注需用户在应用内明确保存。

## 清理和许可

只有最终成果写入、回读、哈希及必要页数/时长核对通过，才删除该任务生成的中间视频、图片等；原教材、源文件、独立下载成果和失败恢复材料保留。开发清理按 AGENTS.md。

沿用 AGPL-3.0-only 和第三方许可，详见 LICENSE、NOTICE、THIRD_PARTY_NOTICES.md。SponsorBlock 社区数据使用 CC BY-NC-SA 4.0，并随对应片段计划保留来源及许可；时长不符不执行裁剪。公开仓库及下载：https://github.com/mikudeshuo/meiji-listening-guide/releases/latest 。

