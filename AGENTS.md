# AGENTS.md — 梅酱的听课指南

本文件是仓库级开发约束，适用于所有人和所有 AI 代理。改目录、改样式、写文档前先读这里。
全局规则（GitHub Issue/PR 只生成链接不自动提交）见 `~/.config/opencode/AGENTS.md`。

## 1. 项目速览

- Electron + React 19 桌面应用；TypeScript 全量实现，Biome 做格式与 lint。
- 主进程：`src/main`；预加载桥：`src/preload`；渲染层：`src/renderer`；共享协议与类型：`src/shared`。
- 检查入口：`pnpm verify`（= `pnpm typecheck && pnpm check`），格式化用 `pnpm check:fix`。
- 提交前必须通过 `pnpm verify`；涉及构建产物再跑 `pnpm build`；涉及运行环境再跑 `pnpm runtime:smoke`。

## 2. 目录结构与职责

### 2.1 主进程（DDD，feature-first）

```text
src/main/
  main.ts                  # 组合根/入口，锁定文件名
  app/                     # context 组装、窗口、生命周期、运行时组件、诊断
  ipc/                     # 唯一 IPC 适配层，action 白名单按域拆分
  workers/                 # utilityProcess/子进程入口，文件名与 electron.vite entry key 锁定
  storage/                 # 跨域 SQLite/便携库引导
  library/ documents/      # 文件库、文档解析/导出
  media/{core,jobs,download,transfer,tools,auth,sources,bilibili}/
  asr/ knowledge/ research/ im/{core,qq,weixin}/ learning/{subtitles,video,study}/
  ai/ net/ security/ config/ zhiyun/
```

规则：
- 一个业务域一个目录；域内按 presentation / application / domain / infrastructure 职责落文件，不强制再分文件夹，文件多了再拆。
- 跨域依赖通过 `app/context.ts` 注入的上下文或类型接口，不允许直接 new 其他域的 store/backend。
- 禁止 `index.ts` barrel：worker 入口可能被误引入 Electron 运行时，破坏 `ELECTRON_RUN_AS_NODE` 子进程。
- `workers/` 下任何文件禁止 import `electron`；其依赖子图保持纯净。
- 入口名锁定：`main.ts` 与 6 个 worker 文件名、electron.vite entry key、6 处 `new URL('./*-worker.js', import.meta.url)` 必须一致，改名需同步全部引用。
- `security/worker-crypt.ts` 是工作进程加密协议，不属于 media 域。

### 2.2 渲染层（MVC：视图 + feature 控制器）

```text
src/renderer/
  index.html               # 挂载入口，位置锁定
  src/
    main.tsx               # React 入口，位置锁定（index.html 引用）
    app/                   # App 壳、TitleBar、全局 provider/组合
    features/<域>/         # 页面级组件与域内 hook；一个域一个目录
    ui/                    # 跨域基础组件（WindowPanel、WindowMenuButton、UiParts、图标适配器）
    lib/                   # 无 UI 的纯工具（格式化、invoke 封装等）
    styles/                # 全部 CSS；tailwind.css 为唯一样式入口
    assets/                # 图片等静态资源
```

规则：
- 一个 feature 一个目录，如 `features/chat`、`features/courses`、`features/knowledge`。
- feature 之间不允许 import 对方页面组件；共享展示组件上移到 `ui/`，共享状态上移到 `app/` 的 provider。
  例外白名单（后续重构逐步消除）：`features/bilibili` 可引用 `features/video/SubtitleBatchRecords`；`features/{chat,study,settings}` 可引用 `features/identity` 的 Context/Avatar。
- `App.tsx` 只做应用壳与组合；新功能不得继续往 App.tsx 堆状态（下一阶段已排期拆分）。
- 禁止新增内联样式（`style=`）；样式一律进 `styles/` 或 ui 组件类名。

### 2.3 共享层

`src/shared` 只放类型、协议、纯函数；主进程与渲染层都可依赖，反向禁止。
新增 IPC 动作：先在 `src/shared/types.ts` 补类型，再在对应 `ipc/` handler 注册 action 白名单。

## 3. 路径别名（禁止 `../../`）

跨目录一律用别名，`tsconfig.json` 与 `electron.vite.config.ts` 同步维护：

| 别名 | 目标 | 用途 |
| --- | --- | --- |
| `@shared/*` | `src/shared/*` | 共享类型与纯函数 |
| `@main/*` | `src/main/*` | 主进程内部 |
| `@renderer/*` | `src/renderer/src/*` | 渲染层内部 |

- 同目录文件可继续用 `./Name`；一旦跨目录必须用别名。
- 新增别名时必须同时改 `tsconfig.json` 的 `paths` 和 `electron.vite.config.ts` 对应 target 的 `resolve.alias`。

## 4. 文档与临时文件

- 正式文档放 `docs/`；合规文本放 `docs/legal/`；根目录只允许 `README.md`、`LICENSE`、`NOTICE`、`AGENTS.md` 及构建配置。
- 更新日志在 `docs/CHANGELOG.md`，改动用户可见行为时更新 `Unreleased`。
- 所有临时文档（分析、审查、迁移草稿、生成的大段清单）一律放 `docs/tmp/`，该目录被 `.gitignore` 忽略，不得提交；禁止把临时文档放根目录或 `docs/` 其他位置。
- 合规文件移动时必须同步：`package.json` 的 `build.files`、`scripts/source-package.mts` 白名单、README/NOTICE 中的引用。

## 5. 前端样式规范

### 5.1 令牌与颜色

- 颜色/圆角/阴影只能使用 `styles/upstream-tokens.css` 里的 CSS 变量；禁止硬编码色值（含 `#fff`、`rgba()`）。
- 唯一主色为 `--blue`。禁止再引入“聊天蓝/设置蓝”等第二主色；域内强调色必须走令牌。
- 浅色/深色都通过 `[data-theme="light|dark"]` 控制；主题三态（浅色/深色/跟随系统）一律使用 `ui/ThemePicker`（HeroUI `ToggleButtonGroup` 卡片选择器，位于 设置 → 界面与主题），自动模式由应用层解析系统偏好后仍写入 `data-theme`，CSS 内不得新增 `prefers-color-scheme` 分支；新样式必须两主题目检。

### 5.2 HeroUI 与 Tailwind

- 组件体系为 HeroUI v3（`@heroui/react` + `@heroui/styles`）+ Tailwind 4；样式入口只有 `styles/tailwind.css`，按需选择性导入组件样式。
- 样式层顺序固定：`@layer legacy, theme, base, components, utilities;`。legacy 为旧样式，只减不增；新样式走 HeroUI 组件或 utilities 层。`styles/` 文件固定为 5 个：`tailwind.css`（唯一样式入口）、`upstream-tokens.css`（调色板令牌）、`legacy.css`（待淘汰的产品级样式，只减不增）、`chat.css` / `panel.css`（components 层：聊天与窗口/侧栏覆盖）。
- 交互控件使用 HeroUI React 组件（`Button`、`Input`、`TextArea`、`ToggleButtonGroup`、`Modal` 等）；表单控件禁止再写原生 `<input>`/`<textarea>`/`<select>`（下拉统一用 `ui/SelectField` 包装的 HeroUI `Select`）；弹窗统一通过 `ui/UiParts` 的 `Modal`（内部为 HeroUI `Modal`）；BEM 类只作为组件内部样式与形态覆盖（`@layer components`），不得与 React 组件在同一个控件上混写。
- 整页功能窗口一律使用 `ui/WindowPanel.tsx` + `ui/WindowMenuButton`：统一 220px 左菜单、内容区 32/40 间距与页头节奏；禁止再手写 `learning-window` 壳。
- 设置类界面统一挂在 `features/settings/SettingsHub`（左菜单分区）；新增设置项必须加为 Hub 的一个分区，禁止再往 rail 或侧栏加散装入口。
- 二级功能窗口统一由 `app/AppWindows.tsx` 按 modal 状态挂载，禁止再往 `App.tsx` 内联整页窗口；确认弹窗统一用 `ui/ConfirmDialog`，提示消息统一用 `ui/AlertBox`（内部均为 HeroUI 组件，禁止新增 `className="alert"` 旧式提示）。
- HeroUI 语义变量（`--accent`、`--danger`、`--surface`、`--default` 等）统一在 `styles/tailwind.css` 映射到现有调色板，禁止在组件里另起色值。
- 不允许 `!important`；不允许覆盖 HeroUI 组件内部结构；需要变体时用官方 variant/props。
- 禁止裸标签选择器（`button {}`、`input {}` 等）；样式必须挂在类名上。

### 5.3 按钮层级（强制）

- 只用 HeroUI `Button` 组件，不再新增原生 `button` + BEM 的写法；导航类控件（rail、课程树、tabs、输入区圆形按钮）暂时保留 legacy 类名，下一阶段迁移：
  - 主操作：`variant="primary"`，**每个视图/面板只允许一个**；卡片内、列表行内禁止主按钮。
  - 常规操作：`variant="tertiary"`；次要/工具条操作：`variant="ghost"`。
  - 危险操作（删除/清空/断开）：行内用 `variant="danger-soft"`，确认对话框用 `variant="danger"`，且必须有二次确认；禁止用普通按钮承载危险操作，禁止 `window.confirm`。
  - 图标按钮：`isIconOnly` + `variant="ghost"`，必须带 `aria-label`；纯文字按钮不加图标。
  - 尺寸：默认 `size="sm"`；重要独立 CTA 可用默认 md；禁止自定义 padding/高度。
  - form 内提交按钮必须显式 `type="submit"`（HeroUI `Button` 默认 `type="button"`）。
- 所有按钮必须具备 hover / focus-visible / disabled 四态；禁用态用 `isDisabled`。
- 间距/布局用 utilities 或容器类，不得给按钮加 `margin` 覆盖。

### 5.4 图标

- 只用 `lucide-react`；常用语义名经 `ui/StudyIcon.tsx` 适配导出，页面不得再手写 SVG path。
- 尺寸档位：14 / 16 / 18 / 20 / 28(rail)；线宽跟随默认或现有 rail 规则，禁止逐图标调线宽。
- 品牌与吉祥物例外（`assets/` 图片、`ui/brand/` 下的品牌矢量）必须登记来源与许可；新增第三方图标集视为依赖新增，需先改本文件。

### 5.5 层级与浮层

- z-index 只允许 10 的倍数：标题栏 100，侧栏浮层 200，modal/overlay 900，toast/alert 1000。
- 固定定位元素必须在 `styles/` 内声明并对标题栏高度（`--titlebar-height`）做偏移。

## 6. 检查清单（提交/交付前）

1. `pnpm verify` 通过。
2. 改动涉及界面：两套主题各走一遍受影响页面，确认按钮层级、危险操作、空态/错误态。
3. 改动涉及主进程/worker：`pnpm build` 且 `out/main/` 下 7 个入口文件仍平铺存在。
4. 改动涉及文档/合规：同步 `package.json`、`scripts/source-package.mts` 与 README/NOTICE 引用。
5. 新增目录或规则变化时，更新本文件。
