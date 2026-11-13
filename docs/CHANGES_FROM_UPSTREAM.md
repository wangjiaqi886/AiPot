# 分支变更记录（相对上游 1.1.10）

本文件只记录本分支相对上游的**行为性改动**，供合并上游时对照。
格式：位置 → 改了什么 → 为什么。

## 版本

`package.json`

- `version`: `1.1.10` → `1.2.0` → `1.3.0` → `1.3.1` → **`1.4.0`**
- 原因：NSIS `allowDowngrade` 默认 `false`，版本必须高于已安装的官方包才能安装；
  1.3.0 承载品牌更名 + 性能优化 + 划词修复这批不兼容改动；
  1.3.1 承载截图交互改版、内置 LLM provider、翻译对齐高亮；
  1.4.0 承载界面重设计（夜空蓝主题、图标栏+二级导航设置结构、
  全套 spring 动画）、翻译窗口预创建、设置窗口回收策略调整。
- 移除 `pnpm.overrides`（迁移到 `pnpm-workspace.yaml`）
- 原因：pnpm 12 不再读取 `package.json` 的该字段，否则 `pnpm run` 报
  `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`。

`pnpm-workspace.yaml`

- 新增 `overrides` 段（承接上一条迁移）。

## 1.4.2：三个实测小 bug 修复

- **设置窗控制按钮不可点击**（`Config/index.tsx`）：根因不是 z-index——
  `-webkit-app-region: drag` 的命中测试在**合成器进程**完成，被标记区域
  的鼠标事件不进入渲染器，DOM 层级完全无关；唯一可点的是 drag 元素的
  `no-drag` **后代**。修复：删除 fixed 拖拽覆盖层，**顶栏行本身成为
  DragRegion 并包裹 WindowControl**（与翻译窗口顶栏同构），按钮是 drag
  元素的子元素所以可点，顶栏其余区域可拖拽。
  ⚠️ 之前"覆盖层 z-40 / 顶栏 z-50"的层级反转方案**无效**（已验证点击
  仍被吞），合并时不要回退到那个方案。
- **服务标题未翻译完成时显示不全**（`TargetArea`）：1.4.0 把三行骨架
  屏塞进了固定高度（h-7.5）的 CardHeader 里，骨架超出头部高度把
  ServiceInstanceDropdown 标题挤变形；翻译完成后骨架消失所以"正常"。
  骨架屏移到 CardBody 内容区（isLoading 且无可见结果时显示），并把
  内容展开条件改为 `!hide || (isLoading && !hasVisibleResult(result))`
  ——翻译开始时 hide=true 收起旧结果，骨架强制展开可见；顺带删除了
  失去用途的 `wasLoading` 状态。
- **翻译窗口报错 NotAllowedError: Document is not focused**：自动复制
  译文在窗口已隐藏/失焦时调用 `navigator.clipboard.writeText`（DOM API
  要求 document focused），每个服务卡片各报一次。修复：新增主进程 IPC
  命令 `write_clipboard_text`（`ipc.ts`，Electron clipboard 无焦点要求），
  渲染器 `writeClipboardText`（`lib/electron/clipboard.ts`）改为优先走
  IPC、桥不可用时回退 DOM API；`ElectronCommandMap` 注册同名命令类型。
  日志里 09:29 的大量 `HTTP request timed out`（89 字符 URL）是
  GLM/TeleAgent/NiuTrans 插件超时，属服务端网络问题，与本 bug 无关。

## 1.4.1：用户反馈修复（页面空白/唤醒闪烁/菜单回退/内存回落）

四个问题全部来自 1.4.0 实测反馈，修复要点：

- **设置页多次切换后空白（死锁）**：`PageTransition` 原用
  `AnimatePresence mode="wait"`——旧页 exit 与 Suspense 懒加载新页互相
  等待，快速多次切换死锁在空白。改为**只用 motion.div 的进入动画**（新页
  key 换时直接渲染+滑入，旧页立即卸载），不再有等待链。
- **快捷键唤醒翻译窗闪烁/卡死**：`WindowEntrance` 原通过**改 key 重挂载**
  整个翻译窗口 React 树重播动画——每次 show 丢弃全部状态（插件列表/
  服务配置/监听器），且划词流程 `showInactive → focus` 连发两次 show
  事件，重挂载两轮、状态反复重建导致闪烁。改为 **`useAnimationControls`
  就地重播**（React 树不动，`controls.start()` 重跑动画）；主进程
  `window.on('show')` 发 `aipot://window-shown` 加 **200ms 防抖**（showInactive
  +focus 双 show 只播一次），防抖 Map 在 `closed` 时清理。
- **设置菜单恢复一级平铺**：按用户反馈「二级菜单内容过少」，回退 1.3.x
  的 7 项一级侧栏（`SideBar/index.tsx` 平铺按钮 + 玉蓝胶囊选中态 +
  preload-on-intent 保留）；`routes/index.tsx` 恢复 7 条旧路由（含独立
  `/hotkey`、`/service` Tab 页）；`navConfig.ts` 与三个
  `*ServicesPage.tsx` 包装组件**删除**；`Config/index.tsx` 标题恢复
  `config.<path>.title` 推导、侧栏宽度恢复 w-57.5。
- **内存回落**：`translate_precreate` 从默认 true 改为 **opt-in（默认
  false）**——待命渲染器常驻 ~55MB 是 1.4.0 内存上涨主因；开启时
  `hiddenWindowDestroyDelayMs` 联动返回 Infinity（待命窗永不在隐藏时
  销毁）。`DEFAULT_HIDDEN_WINDOW_DESTROY_MS` 恢复：config 30s、
  translate 300s（=1.3.x 策略）。空闲内存回到 ≈133MB PrivateBytes
  （warm-hide 5 分钟内重复划词依旧 <100ms）。
- 测试：`config-sidebar.test.tsx` 回到一级导航契约（3 用例 + 选中态
  `bg-primary` 断言）。全量 259/259 绿。

## 1.4.0：界面重设计 + 预创建窗口 + 动画体系

⚠️ **合并高风险区**：`window.ts`（生命周期策略）、`tailwind.config.js`
（整个主题令牌）、`Config/index.tsx` + `routes/` + `SideBar/`（设置窗口
结构重排）、`TargetArea`（加载态）。合并上游 UI 改动时这些文件几乎必然
冲突，需要按本文件逐项对拍。

- **设计令牌重做**（`tailwind.config.js`）：HeroUI 主题从默认灰黑改为
  「夜空蓝黑」双主题——dark `#0a0d14`/`#131824`/accent `#5ab9fc`（玉蓝），
  light `#f4f6f9`/白面/accent `#1e6fd9`（深玉蓝）。所有选中态、开关、
  焦点环、选区指示随之统一换色。
- **翻译窗口预创建**（`src/main/index.ts` + `window.ts`）：
  启动时（tray/hotkey 就绪后）`precreateTranslateWindow()` 以
  `deferShow` 创建隐藏待命窗口，划词唤醒从「冷启动 ~500ms」变为
  「warm show <100ms」。配置 `translate_precreate`——**1.4.1 起默认
  false（opt-in，常驻 ~55MB）**；开启时闲置销毁延时联动 Infinity
  （`scheduleHiddenWindowDestroy` 对非有限延时直接不挂计时器
  ——`setTimeout` 会把 Infinity 钳到 1ms，必须防）。
- **设置窗口结构重排**（**1.4.1 已按用户反馈回退**，此条仅作历史记录）：
  曾改为 64px 图标栏 + 172px 二级导航五分组；现恢复 7 项一级平铺侧栏
  （`SideBar/index.tsx`），`routes/` 恢复 7 条旧路由（`/hotkey` 独立、
  `/service` Tab 页），标题恢复 `config.<path>.title` 推导。
- **动画体系**（`hooks/useMotion.ts` + `components/WindowEntrance.tsx` +
  `Config/components/PageTransition.tsx` + `style.css`）：统一 spring
  预设（window 420/30、page 380/32、modal 340/28、micro 500/26）。
  翻译窗口每次 `show` 收到 `aipot://window-shown` 事件重放入场动画
  （scale .96→1 + fade，预创建窗口不重挂载所以必须靠事件）；
  设置页切换 x+16→0 侧滑；模态/toast CSS 覆盖为同族弹簧曲线；
  全部受新配置 `reduce_motion`（默认 false）与系统
  `prefers-reduced-motion` 双重控制（`useReducedMotion` + `<html
data-reduce-motion>` CSS 豁免）。
- **翻译加载态**：`TargetArea` 的小 Spinner → 三行 shimmer 骨架屏
  （`.aipot-skeleton`），流式出结果后骨架隐藏、结果淡入（每翻译一次
  re-key 一次，`resultFadeKey`）。
- **设置保存静默化**（`useConfigSave.ts`）：默认 `notify` true→false，
  常规开关/下拉保存不再弹成功 toast（失败仍必弹）；端口修改保留
  显式成功提示（`notify: true`）。
- **Toast 位置**：`RuntimeToaster` top-center → bottom-center 圆角卡片
  - 滑入动画。
- i18n 新键：`config.general.preferences`、`config.translate.preferences`、
  `config.recognize.preferences`、`config.plugin.installed`、
  `config.plugin.marketplace`、`config.general.reduce_motion`（12 locale 全）。
- 旧 `/hotkey` 路由并入 `/general/hotkey`；旧 `/service` Tab 页保留但
  设置导航不再指向（历史深链兼容）。

## 1.3.1：截图透明直选 + 内置 LLM provider + 翻译对齐

- **截图交互改为透明直选**（QQ 截图式）：`window.ts` 的 screenshot
  定义改 `transparent: true`；`workflow.ts` 不再预抓屏；
  `Screenshot/index.tsx` 不再显示预抓图，mouseup 隐藏覆盖层后实时抓取
  - 裁剪。原因：恢复"直接在屏幕上框选"的交互，去掉"先截图再识别"
    的观感与等待。
- **新增内置翻译 provider** `openai_compatible` / `anthropic_compatible`
  （`src/renderer/providers/translate/`）：名称/Key/请求地址/模型
  （可拉取列表）/模型配置/Prompt 列表（默认双消息翻译模板，含
  `$text`/`$to` 占位）/测试按钮；Anthropic 格式另带 `anthropic-version`
  与**模型映射**（服务名 → 实际模型 ID 的 JSON）。`http.ts` 私有网络
  白名单认这两个服务的 `requestPath`（可指向本地网关）。
- **翻译两侧句子同步选中**（DeepL 式对齐）：`Translate/components/alignment.ts`
  按句分割源文与译文（同一 `splitIntoSentences` 规则），点击任一侧的句子，
  左侧用真实选区高亮（textarea `setSelectionRange`），右侧用 CSS
  背景高亮（句子 span 渲染，`AlignedResultText`）；再点同句取消。
  拖选（>4px 位移）不触发对齐，编辑不受影响。
- **源码目录改名** `D:\NeoPot-master` → `D:\AiPot-master`（文档/图标
  脚本内路径同步）。部署目录仍为 `D:\AiPot`，两者不可同名。
- TeleAgent/OpenAI 侧载插件（用户目录）prompt 模板缺 `$text` 的 bug
  修复（插件代码在 `%APPDATA%\AiPot\plugins\`，不在仓库）。

## 1.3.0：品牌更名（详见 `branding/RENAME_TO_AIPOT.md`）

- `package.json` `name/productName` → `aipot/AiPot`；
  `electron-builder.yml` `appId` → `com.aipot.app`、
  `artifactName` → `AiPot-*`。
- `app.setName('AiPot')` + `profileMigration.ts`：数据目录
  `%APPDATA%\NeoPot` → `%APPDATA%\AiPot`，首启自动迁移
  （config/plugins/history；safeStorage 密文除外，读取端容错为空串）。
- 渲染协议 `neopot://` → `aipot://`；预加载桥 `window.neoPot` →
  `window.aiPot`；窗口事件 `neopot://*` → `aipot://*`；
  插件沙箱通道 `neopot-plugin-*` → `aipot-plugin-*`、
  `__neopot_*` 标记 → `__aipot_*`。
- 插件安装元数据 `.neopot-plugin.json` → `.aipot-plugin.json`
  （读取时兼容旧名，见 `plugins/PLUGIN_DEVELOPMENT.md`）。
- **故意不改**：密钥封装键 `__neopot_secret`、上游仓库/市场链接、
  源码目录名（改了会导致旧密文读不出/链接失效）。
- 图标全套替换（`public/icon.png|ico|svg`，生成脚本
  `resources/icon/make_aipot_icon.py`），托盘 resize 到 32px。

## 1.3.0：内存与唤醒优化（详见 `performance/MEMORY_AND_LATENCY.md`）

- `src/main/index.ts`：默认 `app.disableHardwareAcceleration()`
  （配置键 `hardware_acceleration` 可回开；ready 前同步读 config.json）。
- `src/main/modules/window.ts`：隐藏窗口闲置回收
  （`<label>_window_idle_destroy_seconds`），`showInactive`/`deferShow`
  新选项，`window-all-closed` 在 close-to-tray 下不再退出。
- `WindowPinning.tsx`：失焦 `close()` → `hide()`（配合保活）。
- `workflow.ts`：划词捕获与窗口加载**并行**；OCR 预抓屏 +
  `consumePreparedCapture` 复用；截图窗口弃用 `fullscreen: true`。
- `App.tsx`/`main.tsx`：首屏窗口标签从 URL 读、初始化并行。
- `config:get-all` IPC + 渲染器 `initStore` 批量预热缓存。
- `SourceArea`：`providers/recognize` 改为图像工作流时动态 import
  （PaddleOCR chunk 移出翻译窗口首屏）。
- `proxy.ts` 调用方：`proxy_enable=false` 时启动不再强制 `setProxy(direct)`
  （少一个 ProxyResolver 进程；行为变化：跟随系统代理）。
- 实测：空闲 Private 421 MB → ~185 MB（窗口全开）/~125 MB（窗口回收后）；
  划词捕获 700-900 ms → ~120 ms；翻译窗口 cold renderer ready ~1 s → ~540 ms。

## 1.3.0：划词捕获修复（详见 `troubleshooting/SELECTION_CLIPBOARD.md`）

- 新增原生助手 `resources/win/AiPotSelectionHelper.cs`
  （`keybd_event` + 前台窗口锁定 + 剪贴板序号监听 + UIA 兜底），
  构建：`.scripts/build-selection-helper.mjs`，打包：`extraResources`。
- `selection.ts`：Windows 主路径走 helper（`windows-selection-helper`）；
  PowerShell 兜底重写（不再写 marker、锁定前台、直接回传 stdout 文本、
  失败还原原剪贴板）；修复"当前应用未将选中文本写入剪贴板"。
- `Translate/index.tsx` 删除配置就绪时的 `appWindow.show()`
  （会在捕获期间抢焦点，是 bug 的放大器）。

## 网络层

`src/main/modules/http.ts` → `configuredProviderOrigins()`

- 新增：收集**插件服务实例**配置中 `endpoint` / `requestPath` / `baseUrl` /
  `base_url` / `url` 字段的 origin 加入私有网络白名单。
- 原因：上游只登记内置服务端点，侧载插件访问 `127.0.0.1` 本地网关时被
  SSRF 防护拒绝（`HTTP request target is not allowed: 127.0.0.1`）。
- 详见 `docs/architecture/NETWORK_SAFETY.md`。

## UI

`src/renderer/windows/Translate/index.tsx`

- 单列堆叠 → **两栏 50/50**（左：源文本 + 语言栏；右：翻译结果卡）。
  两栏各自 `overflowY: auto`，容器 `display:flex; gap:8px; overflow:hidden`。
- 原因：横向利用空间，与主流翻译工具一致。

`src/renderer/windows/Translate/components/SourceArea/index.tsx`

- 根 div：条件类 `hidden` 之外新增 `flex min-h-0 flex-1 flex-col`
- `Card`：新增 `flex min-h-0 flex-1 flex-col`
- `CardBody`：`max-h-[40vh] overflow-y-auto` → `flex min-h-0 flex-1 flex-col overflow-y-auto`
- `textarea`：`h-full` → `w-full flex-auto`
- 原因：补齐 flex 链让源文本卡撑满左栏（消除语言栏下方大片空白）。
  `flex-auto` 保留 JS 自动高度的 basis，`flex-1` 会丢弃它。
- 另新增：图像工作流的**识别服务选择改为筛选首个可用服务**（不再盲取
  `recognize_service_list[0]`），并在 config 未加载时用
  `pendingImageWorkflowRef` 暂存载荷、就绪后重放。
  原因：修复截图翻译偶发“未配置识别服务”。

`src/renderer/windows/Translate/components/TargetArea/index.tsx`

- textarea 高度 effect 依赖 `[result, resultViewMode]` → `[result, resultViewMode, hide]`
- 原因：折叠会卸载内容区（AnimatePresence），展开重新挂载时 `result` 未变、
  effect 不重跑，textarea 停留在 CSS 的 `h-0`，表现为“译文消失”。

详见 `docs/ui/TRANSLATE_WINDOW_LAYOUT.md`。

## 更新与发布

`src/main/modules/updater.ts`

- `autoDownload` / `autoInstallOnAppQuit`: `true` → `false`
- 新增 `SELF_UPDATE_ENABLED = false`；`getDistributionMode()` 在该开关关闭时
  直接返回 `{ distribution: 'portable', mode: 'manual-download' }`
- `githubApiBaseUrl` / `releasePageUrl` → 空字符串
- `fetchGithubRelease()` 在 `githubApiBaseUrl` 为空时直接返回 `null`
- 原因：私有自建版不得被官方 Release 自动覆盖；内测阶段不提供更新源。

`electron-builder.yml`

- 删除 `publish` 段（原本指向上游 GitHub Release）
- 结果：构建产物不再生成 `resources/app-update.yml`

详见 `docs/release/RELEASE_AND_UPDATES.md`。

## 插件（不在仓库内）

三个侧载插件位于用户目录 `%APPDATA%\AiPot\plugins\`，**不进入版本库**：

- `translate/plugin-teleagent-translate` — 本地签名网关（`127.0.0.1:18765`），
  默认 `chat-flash` + `reasoning_effort: low`
- `recognize/plugin-teleagent-vision-ocr` — 同网关，模型 `vision-standard`
- `recognize/plugin-glm-vision-ocr` — BigModel 官方 API，默认 `glm-5.3-flash`

第三个的默认模型从 `glm-4.5v` 改为 `glm-5.3-flash`，
原因：`glm-4.5v` 不在 GLM Coding Plan 资源包内，返回 429/1113。

插件机制与侧载说明见 `docs/plugins/`。

## 合并上游时的高风险点

1. `Translate/index.tsx` 若被上游重构，两栏布局需重新套用；
   **不要恢复"配置就绪时 `appWindow.show()`"**（会抢焦点毁掉划词捕获）
2. `SourceArea` 的 flex 链与 `TargetArea` 的 `hide` 依赖必须保留；
   `providers/recognize` 的**动态 import** 必须保留（否则 OCR chunk 回到首屏）
3. `configuredProviderOrigins()` 若上游重写，插件私有端点放行逻辑要重新加入
   （1.3.1 起还包含 `openai_compatible`/`anthropic_compatible` 的 requestPath）
4. `updater.ts` 若上游改动更新流程，重新确认禁用逻辑仍然成立
5. `package.json` 的 version 不要被上游覆盖回 `1.1.x`/`1.2.x`（会导致无法安装）
6. `window.ts` 的闲置回收 / `showInactive` / `deferShow` 与
   `WindowPinning` 的 `hide()` 若被上游覆盖，内存与唤醒优化全部回退；
   **1.3.1 注意**：screenshot 窗口定义已改 `transparent: true`（直选覆盖层），
   `deferShow` 对 screenshot 不再使用，但 translate 路径的 `showInactive` 语义没变
7. `selection.ts` 若被上游覆盖回 PowerShell 版，划词 bug 会复发——
   helper 的调用与 `windows-selection-helper` method 必须保留；
   **1.3.1 注意**：helper 报 `empty` 后的二次 UIA/剪贴板并行兜底也要保留
8. `app.setName('AiPot')` / `profileMigration.ts` 若丢失，用户数据
   会回到 `%APPDATA%\NeoPot` 且迁移不再发生
9. preload/渲染器的 `aipot://`、`window.aiPot` 若与上游 `neopot://`/
   `neoPot` 混用，桥会直接不可用（`isTrustedRendererLocation` 也会拒绝）
10. **翻译对齐**（1.3.1）：`Translate/components/alignment.ts` +
    SourceArea 的点击/选区逻辑 + TargetArea 的 `AlignedResultText`
    若被上游 UI 重构覆盖，句子同步高亮会失效；textarea 渲染分支
    （单句结果）依赖 `textAreaRef` 的高度自适应 effect，不能只留 div 分支

合并后务必按 `docs/build/BUILD_AND_DEV.md` 的验证小节复查一遍。

> AI生成
