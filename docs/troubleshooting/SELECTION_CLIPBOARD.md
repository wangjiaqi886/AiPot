# 划词翻译"未将选中文本写入剪贴板"修复记录（1.3.0）

## 现象

选中文字按划词快捷键，翻译窗口显示
`translate.selection_capture.copy_timeout`（"当前应用未将选中文本写入剪贴板。"）。
部分应用必现，部分应用偶现。

## 根因（旧实现 `src/main/modules/selection.ts`）

Windows 下旧版同时起**两个 PowerShell**（UIA 读选区 + SendKeys 复制），
复制路径本身有三个坑：

1. **先污染剪贴板再复制**：旧代码先 `clipboard.writeText(marker)`
   写入一个随机标记，再发 Ctrl+C，轮询剪贴板是否离开标记值。
   写剪贴板会让部分应用（尤其浏览器内核的编辑器）丢失/刷新选区状态，
   也可能让目标应用把 Ctrl+C 处理成"复制标记失败"。
2. **`SendKeys.SendWait('^c')` 发给了谁不确定**：PowerShell 以
   `windowsHide` 启动，但 `System.Windows.Forms.SendKeys` 是往
   **当前前台窗口**发；如果焦点被任何东西（包括我们自己刚弹的窗口、
   控制台宿主）抢走，Ctrl+C 就发给了错误窗口，复制自然"超时"。
   旧代码没有任何 `GetForegroundWindow`/`SetForegroundWindow` 保护。
3. **检测靠"值 != 标记"**：应用若复制的恰好是空串或延迟提交
   （delayed rendering），轮询就判定超时。剪贴板序号
   `GetClipboardSequenceNumber()` 才是可靠的"是否被写入"信号。

另外两个 PowerShell 各要 `Add-Type`（UIAutomationClient/Forms），
**700-900 ms 启动开销**也是唤醒慢的主因（见
`performance/MEMORY_AND_LATENCY.md`）。

## 修复设计

### 主路径：原生助手 `AiPotSelectionHelper.exe`

- 源码：`resources/win/AiPotSelectionHelper.cs`（.NET Framework 4.x，
  `csc.exe` 编译，构建脚本 `.scripts/build-selection-helper.mjs`，
  已挂进 `pnpm run make`；产物经 `extraResources` 放进安装目录
  `resources/bin/`）。
- 流程（约 110-140 ms）：
  1. `GetForegroundWindow()` 记下**按下快捷键瞬间的**前台窗口；
  2. `AttachThreadInput` + `SetForegroundWindow` 确保 Ctrl+C 发给
     正确窗口（这一步就是为了根因 2）；
  3. `keybd_event` 发 Ctrl+C（无 Add-Type、无 Forms 装配）；
  4. 轮询 `GetClipboardSequenceNumber()` 变化后读
     `CF_UNICODETEXT`（不写标记，根因 1/3 都不存在）；
  5. 把用户原来的剪贴板文本**还原**回去，选区文本从 stdout 输出；
  6. 失败再退回 UIA TextPattern（独立 STA 线程，700 ms 超时兜底）。
- 退出码：`0`=有文本（stdout UTF-8），`2`=无选区，`3`=异常。
  Electron 侧把 2 映射为 `empty`，其余走兜底。
- 主进程查找路径：`process.resourcesPath/bin`（打包后）→
  `app.getAppPath()/resources/bin` → `cwd()/resources/bin`（开发）。
- 捕获期间复用原有的 `selectionClipboardCaptureDepth` 机制暂停
  剪贴板监听，并刷新 baseline，避免"复制选区"被监听再次触发翻译。

### 兜底路径（helper 缺失/被杀软拦时）

PowerShell 版本做了同样的改进（`WINDOWS_COPY_COMMAND`）：
P/Invoke `keybd_event` + `SetForegroundWindow` + 剪贴板序号监听，
**不再写标记**；UIA 脚本保留（`AiPotForegroundWindow` 类名同步改名）。
复制成功后同样还原用户原剪贴板文本。
UIA 与复制兜底仍并行竞速（复制路径给 80 ms 让 UIA 先试，UIA 成功则
abort 复制，避免无谓地碰剪贴板——行为与上游一致，单测覆盖）。

### helper 报 empty 时的二次兜底（1.3.1 新增）

helper 的 Ctrl+C 与快速 UIA 探测失败时返回 `empty`。但 `empty` 有两种
含义：**真无选区**，或**该应用不理会 Ctrl+C 且只应答完整 UIA 扫描**
（WPF/Qt/部分 Electron 编辑器）。1.3.1 起 `readWindowsSelectedText` 在
helper 返回 `empty` 后不再直接终结，而是再起一轮 PowerShell UIA
（更深的焦点元素树 + 整窗口 TextPattern 扫描）与剪贴板兜底的并行竞速；
两条都失败才把 `empty` 报给渲染层。真无选区的场景多花约 1-1.6 s
（异常路径），有选区但应用"高冷"的场景从必现失败变为成功。

### 焦点保护：`showInactive`

并行化之后**翻译窗口的显示方式必须改**：如果窗口一创建就 `show()+focus()`，
它自己就成了前台窗口，helper 的 Ctrl+C 就发给翻译窗口了
（= 复制出来的永远是空，反向复现这个 bug）。
所以划词路径用 `openWindow('translate', { showInactive: true })` 先
不激活地显示，捕获完成后才 `focusWindow('translate')`。

## 仍然无解的场景（记录给后续排查）

- **管理员权限应用**：源应用以管理员运行而 AiPot 不是时，
  Windows UIPI 禁止向其注入键盘事件，Ctrl+C 和 SendInput 都无效；
  UIA 也拿不到。只能右键"以管理员身份运行" AiPot。
- 不支持 Ctrl+C 语义也不暴露 TextPattern 的控件（部分游戏、
  自绘富文本）属于能力缺失，不是 bug。
- 部分终端把 Ctrl+C 解释为中断：复制需要在终端里显式选中
  （终端的复制快捷键不是 Ctrl+C 时同样无解）。

## 验证方法

1. 构建：`pnpm run make`（会先编译 helper，
   `resources/bin/AiPotSelectionHelper.exe`）。
2. 直接测 helper（找一个有选区的前台窗口）：

   ```powershell
   $p = Start-Process 'resources\bin\AiPotSelectionHelper.exe' -PassThru `
     -RedirectStandardOutput out.txt -Wait
   # out.txt 内容即选中文本；无选区时约 1.1 s 后退出码 2
   ```

   实测：WinForms TextBox 全选 → **121 ms** 返回选中文本。

3. 端到端：`log_level=debug` 后按划词快捷键，日志应出现
   `method=windows-selection-helper`；若出现
   `windows-uia-selection`/`windows-clipboard-fallback`，说明 helper
   没跑起来（检查安装目录 `resources\bin\` 是否存在、杀软是否拦截）。
4. 单测：`tests/unit/main-selection.unit.test.ts` 覆盖
   "UIA 成功时中止复制兜底"等竞速行为（注意：单测里 mock 了
   `node:fs` 的 `existsSync` 强制走 PowerShell 兜底路径，
   helper 的行为由打包冒烟测试覆盖）。

## 踩坑记录

- `execFile` 对非零退出码会 **throw**：helper 的 `2`（无选区）要按
  `error.code === 2` 识别成 `empty`，不要当失败。
- `csc` 默认按 C# 老版本编译，`Add-Type` 的内联 C# 里
  `out` 参数、字符串内嵌双引号转义容易写错；
  `resources/win/AiPotSelectionHelper.cs` 是独立文件，
  别把它内联进 PowerShell。
- WinExe（GUI 子系统）`Console.OpenStandardOutput()` 只在 stdout 被
  重定向时有意义；Electron 的 `execFile` 天然重定向，正常工作。
  用 PowerShell `& $exe` 手工测试时可能拿不到退出码，用
  `Start-Process -RedirectStandardOutput -Wait` 测。
- `keybd_event` 发 'C' 的 scan code 传 0 没问题；
  不要改用 `SendKeys`（等价于回到老实现）。
- helper 的 UIA 部分可能被个别应用挂住，所以放在
  `IsBackground=true` 的 STA 线程 + `Join(700ms)` 超时，
  主线程不会跟着挂。

> AI生成
