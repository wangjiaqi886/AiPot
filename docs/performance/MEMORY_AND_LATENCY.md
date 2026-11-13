# 内存占用与快捷键唤醒延迟（1.3.0 优化记录）

本文回答两个问题：**为什么 AiPot 后台内存有 300 MB**、
**为什么按快捷键要等约 1 秒窗口才出现**，并记录本分支的全部优化与实测数据。
所有数字来自 2026-11-12 的 Windows 11 实测（RTX 4060 笔记本，1.5x 缩放），
`PrivateBytes` 为进程提交内存，`WorkingSet` 会把共享页算进去，评估用
PrivateBytes 更准。

## 一、问题一：后台内存 300 MB

### 优化前的进程分解（NeoPot 1.2.0，空闲，设置窗口打开）

| 进程                   | 角色           |  WorkingSet |     Private |
| ---------------------- | -------------- | ----------: | ----------: |
| NeoPot.exe（GPU 进程） | 硬件加速/合成  |      167 MB |  **199 MB** |
| NeoPot.exe（主进程）   | Node/主逻辑    |      146 MB |      129 MB |
| NeoPot.exe（渲染进程） | 设置窗口       |      124 MB |       68 MB |
| NeoPot.exe（网络服务） | NetworkService |       48 MB |       13 MB |
| NeoPot.exe（代理解析） | ProxyResolver  |       50 MB |       12 MB |
| **合计**               |                | **~535 MB** | **~421 MB** |

结论：**GPU 进程一家就占 199 MB**，是最大头；其次是被隐藏但一直活着的
设置窗口渲染进程。

### 本分支的优化（全部已落地）

1. **默认关闭硬件加速**（`src/main/index.ts`）。
   `app.disableHardwareAcceleration()` + `disable-gpu` 在 app ready 前调用。
   效果：原来的硬件 GPU 进程（实测 **199 MB**）没了，Chromium 换成
   一个 ~20 MB 的软件合成 GPU 进程（dev 里因为 `in-process-gpu`
   连这个都没有）。AiPot 是文本/OCR 工具，软件合成完全够用；
   需要时在 `config.json` 写 `"hardware_acceleration": true`（或在
   设置→常规里打开开关）重启即可恢复。
   ⚠️ 必须 **同步读配置**（`readHardwareAccelerationPreference()` 直接
   同步读 JSON，会同时读 `%APPDATA%\AiPot` 与旧 `%APPDATA%\NeoPot`
   的 config.json），因为 `disableHardwareAcceleration()` 只能在 ready 前
   调用——不能在这里 `await import('./modules/config')`。
2. **隐藏窗口闲置回收**（`src/main/modules/window.ts`）。
   窗口 `hide` 事件启动倒计时，到点 `window.destroy()` 释放渲染进程；
   `show`/`focus` 取消计时。默认值（可在 config.json 用
   `<label>_window_idle_destroy_seconds` 覆盖，0=立即回收）：

   | 窗口       | 默认保活 | 说明                                                                                     |
   | ---------- | -------- | ---------------------------------------------------------------------------------------- |
   | translate  | 300 s    | 失焦后隐藏而非销毁（`WindowPinning.tsx` 由 `close()` 改为 `hide()`），5 分钟内快捷键秒开 |
   | config     | 30 s     | 关闭到托盘后 30 s 回收；托盘点按需重建（约 500 ms）                                      |
   | recognize  | 120 s    | 同 translate 逻辑                                                                        |
   | screenshot | 5 s      | 用完即回收                                                                               |
   | updater    | 30 s     | 关闭即回收                                                                               |

   ⚠️ `window-all-closed` 必须在 `close_to_tray` 开启时**保持常驻**
   （原版直接 `app.quit()`，否则回收完所有窗口应用就退出了）。

3. **截图窗口不再使用真全屏**：`fullscreen: true` 的全屏切换在
   Windows 上要几百毫秒，还会激活一次合成器；改为无边框 + 显示器
   bounds 的普通窗口（黑色背景），视觉相同。
4. **`spellcheck: false`** 显式关闭拼写检查。
5. **代理按需启用**：`proxy_enable` 为 false 时启动不再调用
   `setProxy({mode:'direct'})`（原实现会常驻一个 ProxyResolver 工具
   进程，约 12 MB）。注意行为变化：关掉应用内代理时**跟随系统代理**，
   不再强制直连——需要直连就在系统层设置。
6. **OCR 包按需加载**（`SourceArea/index.tsx`）：原来
   `import * as recognizeServices` 把 PaddleOCR/onnxruntime 的
   ~11 MB chunk 拉进翻译窗口首屏；改为图像工作流触发时才
   `await import()`。翻译窗口冷启动 JS 体积从 ~11.9 MB 降到 ~1.7 MB。

### 优化后的实测（AiPot 1.3.0 打包版 win-unpacked，实测 2026-11-12）

| 场景                   | 进程分解（Private MB）                                    |        合计 |
| ---------------------- | --------------------------------------------------------- | ----------: |
| 空闲（设置窗口打开）   | 主 86 + 软件合成 GPU 21 + 渲染 55 + 网络 12 + 代理解析 14 | **≈188 MB** |
| 空闲（设置窗口回收后） | 主 86 + 软件合成 GPU 21 + 网络 12 + 代理解析 14           | **≈133 MB** |
| 翻译窗口打开时         | 上表 + 翻译渲染 ~55-75                                    |     ≈250 MB |

> 说明：关闭硬件加速后，**真 GPU 进程（199 MB）没了**，Chromium 会留一个
> 约 20 MB 的**软件合成** `--type=gpu-process`（dev 下因为额外加了
> `in-process-gpu` 完全并进主进程，所以 dev 实测只有 4 个进程）。
> 生产版刻意不用 `in-process-gpu`（GPU 崩溃会带崩主进程），20 MB 换稳定性。
> 代理解析进程来自**系统代理**（PAC/WPAD），不是应用内代理；
> 系统直连时它也不存在。

**"降到 100 MB 以内"在 Electron 41 上做不到**：仅主进程基线就 ~86 MB
（Node 运行时 + 打包主逻辑），再加 Chromium 强制的 NetworkService
（~12 MB）与软件合成 GPU（~20 MB）。能做到的是：空闲（窗口全部回收）
≈133 MB，比原来 ~421 MB **少 ~68%**；设置窗口在时 ≈188 MB，比原来
~421 MB 少 ~55%。想要更激进的内存，只能换框架（Tauri/自绘 UI），
代价是 HeroUI/插件生态全部重写，不在本分支范围。

## 二、问题二：快捷键唤醒 ~1 s

### 根因（旧实现，全部串行）

按 Alt+D 后的旧时序：

```
快捷键回调
└─ readSelectedText()                    ← 串行第一步，700-900 ms
   ├─ powershell UIA 脚本（Add-Type 装配 ~600-900 ms）
   └─ powershell SendKeys ^c（Add-Type System.Windows.Forms ~400-800 ms）
      （还要先 clipboard.writeText(marker) 污染剪贴板）
└─ openWindow('translate')               ← 串行第二步，400-700 ms
   └─ BrowserWindow 创建 + 整个 React bundle 加载 + ready-to-show
      （OCR chunk 也在首屏里，冷启动 JS ~11.9 MB）
```

两个 PowerShell 各自 `Add-Type` 是最大头；窗口关闭即销毁（旧版
blur→close），所以**每次都走冷启动**。OCR 截图还要再加一次
Windows 全屏切换（数百毫秒）。

### 本分支的优化

1. **划词捕获换原生助手** `AiPotSelectionHelper.exe`
   （见 `troubleshooting/SELECTION_CLIPBOARD.md`）：
   keybd_event + 剪贴板序号监听，**捕获只要 ~110-140 ms**
   （实测选中文本时 121 ms），不再有 PowerShell 启动/装配开销。
2. **捕获与窗口加载并行**（`src/main/modules/workflow.ts`）：
   `readSelectedText()` 与 `openWindow('translate', { showInactive: true,
awaitLoad: false })` 同时启动；`sendToWindow` 的事件在渲染器
   ready 前**排队**（`pendingWindowEvents`，本来就有），等
   `rendererReady` 后 flush。
3. **`showInactive` 抢显示不抢焦点**：窗口以"不激活"方式先出现
   （浏览器加载 ~200-500 ms 期间捕获并行完成），捕获结束后再
   `focusWindow()`。这一步**必须**，否则窗口一激活，Ctrl+C 就发给
   了翻译窗口自己。
4. **失焦隐藏保活**：翻译窗口 blur 后 `hide()` 而不是 `close()`，
   5 分钟内重复唤醒基本是瞬时（只有 `show` + `setPosition`）。
5. **~~截图预捕获~~（1.3.1 起移除）**：截图交互已改为**透明直选**
   （QQ/微信截图式），见下节。`prepareScreenshotCapture()` /
   `consumePreparedCapture()` 代码保留但快捷键路径不再调用
   （`workflow.ts` 的 `startScreenshotWorkflow` 不预抓）。
6. **窗口配置批量读取**：渲染器启动改用一次 `config:get-all`
   预热缓存（`initStore`），替代旧版几十个 `config:get` 往返
   （每个 useConfig 一个 IPC，翻译窗口启动时有 ~10 个）。
7. **首屏窗口标签免 IPC**（`App.tsx`）：`window=translate` 直接从
   URL query 读，不再等 `getWindowLabel` 往返后才开始渲染。
8. **`main.tsx` 并行初始化**：`applyConfiguredRendererLogLevel()` 与
   `initEnv()` 并行。

### 截图交互：透明直选（1.3.1）

1.3.0 曾用"预抓全屏图 + 截图窗口以图为背景"的冻结式交互；用户反馈
希望回到"直接在屏幕上框选"的方式。1.3.1 起：

- `windowDefinitions.screenshot` 改为 `transparent: true`（无背景色），
  窗口即开即用，无图片加载等待；
- 渲染器收到 `capture_screenshot` 即 `show()`，用户在**真实屏幕**上
  拖框（蓝色半透明矩形只是选区指示）；
- mouseup：先 `hide()` 等完成，再走 `screenshot` 命令**实时抓取**
  显示器，`cut_image` 裁剪——覆盖层已隐藏，不会拍到自己；
- 因此快捷键到可框选的延迟 = 透明窗口创建 + 渲染器加载（~200-500 ms），
  比冻结式少一次 desktopCapturer 全屏抓取（~100-300 ms），且不再有
  "先看到截图"的观感。

注意：多显示器下坐标换算与旧版一致（`calculateCropRect` 未动）；
hide 之后闲置 5 s 销毁的窗口生命周期也未变。

### 实测数据（dev 构建，日志 `log_level=debug`）

| 指标                                |                         旧版 |                                        AiPot 1.3.0 |
| ----------------------------------- | ---------------------------: | -------------------------------------------------: |
| 划词捕获耗时（有选区，helper）      |   700-900 ms（PowerShell×2） |                                     **111-142 ms** |
| 划词捕获（无选区，需等 UIA 兜底）   |                       ~1.3 s |                    ~920 ms（无选区本身是异常路径） |
| 翻译窗口 cold：ready-to-show        |                   500-900 ms |                         **230 ms**（`openMs=230`） |
| 翻译窗口 cold：renderer ready       |                         ~1 s |                        **537 ms**（`readyMs=537`） |
| 翻译窗口 warm（5 分钟内再按）       | 与 cold 相同（旧版销毁重建） |                         **<100 ms**（show + 定位） |
| 划词端到端（选区 → 文本送达渲染器） |                   ~1.3-1.5 s | **~540 ms**（142 捕获 + 491 渲染器就绪，并行重叠） |

日志验证（把 `config.json` 的 `log_level` 改 `debug`）：

```
[debug] Selection translation workflow requested.
[debug] Window ready. window=translate openMs=230
[debug] Window renderer ready. window=translate readyMs=537
[debug] Selection translation capture finished. durationMs=111 ok=true method=windows-selection-helper
[debug] Flushing queued window events. window=translate count=1
```

## 三、复测方法

1. 构建并部署（见 `build/BUILD_AND_DEV.md`）。
2. `config.json` 设 `"log_level": "debug"`，重启。
3. 内存：`Get-Process AiPot | Select Id, @{n='MB';e={$_.PrivateMemorySize64/1MB}}`
   （按进程角色看命令行：无 `--type` 是主进程，`--type=renderer` 是窗口）。
   旧 GPU 进程的识别特征是 `--type=gpu-process`。
4. 延迟：看 `%APPDATA%\AiPot\logs\main.log` 里的
   `Selection translation capture finished. durationMs=...`、
   `Window ready ... openMs=...`、
   `Window renderer ready ... readyMs=...`。
   也可以走本地服务触发（避免人工按表）：
   `curl "127.0.0.1:60828/selection_translate"`。

## 四、改窗口生命周期时的注意事项（踩坑记录）

- `disableHardwareAcceleration()` 只能在 `app.whenReady()` 前调，
  所以读配置要**同步**、迁移要在 import config 模块**之前**。
- 隐藏窗口 destroy 之前必须判断 `isVisible()`，否则用户点托盘
  "打开设置"（show）与计时器竞争时会把刚 show 的窗口销毁。
- `close` 与 `destroy` 的区别：config 窗口 `close` 被拦截转为 hide
  （close_to_tray），计时器里必须用 `destroy()` 才真正释放，
  且 `destroy()` 不触发 `close` 事件、只触发 `closed`。
- 回收窗口会让 `window-all-closed` 触发——务必确认
  `close_to_tray !== false` 时 return 而不是 quit。
- `showInactive` 不抢焦点，但 `setAlwaysOnTop(true)` 照常生效，
  翻译窗口 300 ms 后要还回去（与原有 `showWindowInForeground` 逻辑一致）。
- 渲染器里**不要**再自行 `appWindow.show()`（旧版
  `Translate/index.tsx` 会在配置就绪时 show），那会在捕获期间抢焦点；
  显示权统一收归主进程。
- 截图窗口 `deferShow` 后，渲染器必须在图片 `onLoad` 里自己 show，
  否则异常分支（截图失败）窗口永远不出来——两处都保留了 show 调用。

> AI生成
