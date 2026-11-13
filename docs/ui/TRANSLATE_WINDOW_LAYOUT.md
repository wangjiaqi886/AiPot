# 翻译窗口 UI

记录翻译窗口的布局结构、本次修复的两个缺陷，以及改动时容易踩的点。

## 布局结构

```
Translate (src/renderer/windows/Translate/index.tsx)
└── flex column, h-screen
    ├── 顶栏占位（窗口控制拖拽区）
    └── 主内容区 px-2
        └── display:flex, gap:8px, overflow:hidden      ← 两栏容器
            ├── 左栏 width:50%, overflowY:auto, flex column
            │   ├── SourceArea（源文本卡）
            │   │   └── Card → CardBody → textarea
            │   └── LanguageArea（源语言 / 目标语言）
            └── 右栏 width:50%, overflowY:auto
                └── TargetArea × N（每个启用的翻译服务一张卡）
```

两栏各自独立滚动，`min-width: 0` 防止 flex 子项被内容撑破。

### 高度传递链（关键）

左栏要“源文本卡撑满可用高度”，靠的是一条完整的 flex 链，
**任何一环断开都会退回成“卡片只包住文字 + 下方大片空白”**：

```
两栏容器（display:flex）
└── 左栏 .h-full.flex.flex-col
    └── SourceArea 根 div   .flex .min-h-0 .flex-1 .flex-col   ← 最容易漏
        └── Card            .flex .min-h-0 .flex-1 .flex-col
            ├── CardBody    .flex .min-h-0 .flex-1 .flex-col .overflow-y-auto
            │   └── textarea .w-full .flex-auto .resize-none     ← flex-auto
            └── CardFooter（工具栏）
```

要点：

- **`flex-auto` 而不是 `flex-1`**：textarea 另有 JS 按内容设 `style.height`，
  `flex-auto`（basis=auto）会把它当作基准再拉伸；`flex-1`（basis=0）会丢弃该高度。
- `min-h-0` 必须有，否则 flex 子项的最小高度是内容高度，无法收缩。
- 源文本卡的自动高度逻辑在 `SourceArea`：

  ```ts
  useEffect(() => {
    if (!textAreaRef.current) return
    textAreaRef.current.style.height = '50px'
    textAreaRef.current.style.height = textAreaRef.current.scrollHeight + 'px'
  }, [sourceText])
  ```

### 目标卡片：折叠

`TargetArea` 的折叠按钮切换 `hide`，内容区用 `AnimatePresence` + `motion.div`
做高度动画。折叠时 `hide=true` 会把整个内容区**卸载**（不是 CSS 隐藏）。

## 已修复缺陷

### 1. 左栏下方大片空白

**现象**：源文本卡只有一小条，语言栏下方约 55%–70% 高度是空白。

**根因**：两栏容器里，源文本内容不满列高，而卡片没有 flex 生长；
且 `SourceArea` 根 div 原本没有 flex 类（只有 `hidden` 条件类），
作为 flex 子项只按内容高度存在，内部再 `flex-1` 也无法伸展。

**修复**：补齐上面“高度传递链”中的每一级 `flex min-h-0 flex-1 flex-col`，
CardBody 去掉 `max-h-[40vh]` 改为 `flex-1 + overflow-y-auto`，
textarea 由 `h-full` 改为 `w-full flex-auto`。

**验证**：对窗口做像素扫描，卡片表面颜色在左列从 14% 连续延伸到 98% 高度。

### 2. 折叠后展开，译文消失

**现象**：点折叠 → 再展开，结果区域空白。

**根因**：内容区被 `AnimatePresence` 卸载，`textarea` 重新挂载时带 CSS 类
`h-0`（高度 0）。而设置高度的 effect 依赖是 `[result, resultViewMode]`——
重新挂载后 `result` 没变，effect 不重跑，textarea 就一直保持 0 高度。

**修复**：

```ts
useEffect(() => {
  if (textAreaRef.current !== null) {
    textAreaRef.current.style.height = '0px'
    if (result !== '') {
      textAreaRef.current.style.height = textAreaRef.current.scrollHeight + 'px'
    }
  }
}, [result, resultViewMode, hide]) // ← 加入 hide
```

把 `hide` 加入依赖：展开时 effect 重跑，按新的 `scrollHeight` 恢复高度。

## 改动注意事项

### 与上游同步时优先保留这两处修复

上游 `Translate/index.tsx` 是**单列堆叠**布局（源文本 → 语言栏 → 结果卡纵向排列）。
本仓库改成了两栏。合并上游改动时：

- 若上游重构了 `Translate/index.tsx`，需要重新套用两栏结构
- `SourceArea` / `TargetArea` 中的 flex 类与 `hide` 依赖要保留
- 合并后按“验证方法”复查一次

### 样式类名必须存在于编译后的 CSS

Tailwind 只生成构建时出现过的类。`flex`、`flex-1`、`flex-auto`、`min-h-0`、
`h-full`、`w-full`、`overflow-y-auto` 本项目都已在用，可以安全使用；
若引入新类（如 `basis-1/2`），先确认编译后的
`out/renderer/assets/index-*.css` 里有对应规则，否则会被静默忽略。

### 隐藏相关配置

| 配置键                                  | 作用                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `translate_close_on_blur`               | 失焦后**隐藏**窗口（默认 **true**）。1.3.0 起由关闭改为隐藏：窗口保活（默认 5 分钟）让快捷键秒开，到点由主进程销毁回收内存 |
| `translate_window_idle_destroy_seconds` | 翻译窗口隐藏后保活秒数，默认 300；设 0 = 立即回收                                                                          |
| `translate_hide_window`                 | 翻译时隐藏窗口                                                                                                             |
| `hide_source`                           | 隐藏源文本区                                                                                                               |
| `hide_language`                         | 隐藏语言栏（两栏布局下左栏只剩源文本）                                                                                     |

`translate_close_on_blur` 默认开启时，**截图验证窗口很困难**——
切换焦点窗口就会隐藏它。自动化截图前先把它设为 `false`，验证后恢复
（或直接删除该键回到默认）。**Escape 键和窗口关闭按钮仍是真的关闭**
（销毁窗口），只有 blur 是隐藏。

## 窗口生命周期（1.3.0）

- 显示权收归主进程（`src/main/modules/window.ts`）：
  - `showWindowInForeground`：show + focus（原逻辑，翻译窗口加
    alwaysOnTop 300ms 再还原）。
  - `showWindowInactive`：**show 但不抢焦点**——划词工作流专用，
    防止窗口激活后 Ctrl+C 发给翻译窗口自己（见
    `troubleshooting/SELECTION_CLIPBOARD.md`）。
  - ⚠️ 渲染器里**不要**再自行 `appWindow.show()`。旧版
    `Translate/index.tsx` 会在配置就绪时 show，会在捕获期间抢焦点，
    已删除；`SourceArea` 的 `showWorkflowWindow`（文本送达之后调用）
    保留。
- 隐藏即启动闲置回收计时（`hide` 事件），`show`/`focus` 取消；
  到点 `window.destroy()`。各窗口默认时长与注意点见
  `performance/MEMORY_AND_LATENCY.md`。
- 截图窗口（`Screenshot`）：`deferShow` 模式打开，渲染器在图片
  `onLoad` 里自己 show（异常分支也 show）；不再使用
  `fullscreen: true`（Windows 全屏切换要数百毫秒），改为
  无边框 + 显示器 bounds + 黑底。截屏预抓由主进程
  `prepareScreenshotCapture` 完成，渲染器的 `screenshot` 命令直接
  消费预抓结果（3 s 内有效），避免二次抓屏与"拍到自己的黑窗"。
- `SourceArea` 对 `providers/recognize` 改为**图像工作流触发时动态
  import**：静态导入会把 PaddleOCR 的 ~11 MB chunk 拉进翻译窗口首屏
  （见 `performance/MEMORY_AND_LATENCY.md`）。改动图像工作流时注意
  `recognizeServiceMap` 现在是 `handleNewText` image 分支内的局部变量。

## 验证方法

1. **日志**（最可靠）：`config.json` 里 `log_level` 设为 `debug`，触发翻译后看
   `Translation completed ... outputLength=N durationMs=M`，以及窗口侧的
   `Window ready ... openMs=` / `Window renderer ready ... readyMs=`。
2. **像素扫描**：截取窗口后统计卡片表面颜色（深色主题约 `rgb(40,40,40)`）
   在左右两列各行的覆盖率，判断两栏是否都有内容、左栏是否撑满。
3. **本地服务触发**：`POST http://127.0.0.1:60828/translate`（body 为文本）、
   `GET /selection_translate`（划词路径）。
4. 视觉模型读图只能作定性参考：本项目的实测中，视觉模型对窗口截图
   多次给出自相矛盾的描述（把翻译窗口认成设置窗口），几何结论要以像素扫描为准。

> AI生成
