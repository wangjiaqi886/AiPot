# 项目文档

本目录是 AiPot（由 NeoPot 更名而来的自建分支）的开发文档。上游的 README 与
截图资产仍在 `docs/assets/readme/`（截图内容仍是旧版 NeoPot 界面，仅供参考）。
本文档面向后续开发者与 AI 助手，记录本分支的**构建流程、插件机制、架构约束、
UI 改动、性能优化、划词捕获与发布策略**。

## 目录

| 目录                                                         | 内容                                                   | 读者             |
| ------------------------------------------------------------ | ------------------------------------------------------ | ---------------- |
| [`build/`](build/BUILD_AND_DEV.md)                           | 构建环境、标准流程、环境坑、验证方法                   | 第一次接手的人   |
| [`branding/`](branding/RENAME_TO_AIPOT.md)                   | NeoPot→AiPot 改名清单、兼容性例外、图标资产            | 动品牌/标识的人  |
| [`plugins/`](plugins/PLUGIN_DEVELOPMENT.md)                  | 插件系统机制与开发手册（**最常用**）                   | 写插件的人       |
| [`plugins/`](plugins/SIDELOADING_GUIDE.md)                   | 侧载插件安装、预置、故障对照表                         | 装本地插件的人   |
| [`architecture/`](architecture/NETWORK_SAFETY.md)            | SSRF 防护与私有端点白名单                              | 改网络层的人     |
| [`architecture/`](architecture/CONFIG_AND_SECRETS.md)        | 配置结构、密钥加密规则、数据迁移                       | 改配置/密钥的人  |
| [`performance/`](performance/MEMORY_AND_LATENCY.md)          | 内存占用与快捷键唤醒延迟的分析与优化（**1.3.0 新增**） | 改性能的人       |
| [`troubleshooting/`](troubleshooting/SELECTION_CLIPBOARD.md) | 划词"未写入剪贴板"根因与原生助手设计（**1.3.0 修复**） | 排查划词问题的人 |
| [`ui/`](ui/TRANSLATE_WINDOW_LAYOUT.md)                       | 翻译窗口布局、修复记录、窗口保活策略                   | 改界面的人       |
| [`release/`](release/RELEASE_AND_UPDATES.md)                 | 版本号、appId 变更、更新通道禁用与恢复                 | 发版的人         |

## 快速上手

```bash
cd "D:/AiPot-master"
"D:/nodejs/node_global/pnpm.cmd" install --no-frozen-lockfile
"D:/nodejs/node_global/pnpm.cmd" run make
```

`make` 会先编译 `resources/win/AiPotSelectionHelper.cs`（划词捕获原生助手），
再走 electron-vite + electron-builder。产物在 `dist/`。本机部署约定用
`win-unpacked` 覆盖安装（NSIS 静默安装在本机有缺陷，详见 `build/BUILD_AND_DEV.md`）。

## 本分支当前状态

- 版本 **1.4.2**（上游 1.1.10）
- 品牌：**AiPot**（appId `com.aipot.app`，安装包 `AiPot-Setup-*.exe`，
  渲染协议 `aipot://`，全局桥 `window.aiPot`）；首次启动自动从
  `%APPDATA%\NeoPot` 迁移配置与插件（见 `architecture/CONFIG_AND_SECRETS.md`）
- 性能：GPU 进程默认关闭、配置一次性批量读取、设置窗隐藏 30s 回收，
  空闲约 131 MB；`translate_precreate` **默认关**（开启后翻译窗常驻
  待命、划词 warm-show <100ms，代价 ~55MB，见 `performance/`）
- 划词：新增原生助手 `AiPotSelectionHelper.exe`（约 120 ms 捕获），
  修复"当前应用未将选中文本写入剪贴板"；helper 报 empty 时再起一轮
  UIA/剪贴板并行兜底（1.3.1，见 `troubleshooting/`）
- 截图：**透明直选**（QQ 截图式，1.3.1），直接在屏幕上框选后实时抓取
  （见 `performance/`）
- 翻译服务：内置 `openai_compatible` / `anthropic_compatible` 两个
  LLM 格式 provider（模型列表拉取、模型映射、Prompt 可编辑、测试按钮，
  1.3.1，见 `plugins/`）
- 翻译窗口：点击句子**左右两栏同步选中**对齐（DeepL 式，1.3.1）
- **界面：1.4.x 全量重设计**——夜空蓝黑双主题（dark accent 玉蓝
  `#5ab9fc` / light `#1e6fd9`）、设置窗口**一级 7 项平铺菜单**（1.4.1
  按用户反馈回退二级导航）、统一 spring 动画（窗口入场/页面侧滑/
  模态/toast/骨架屏）、`reduce_motion` 开关
  （见 `CHANGES_FROM_UPSTREAM.md` 1.4.0–1.4.2 节）
- 自动更新已断开，不与上游 Release 联动（见 `release/`）
- 翻译窗口为**两栏布局**（上游为单列），含两处 UI 修复（见 `ui/`）
- HTTP 白名单扩展为**允许插件实例配置的私有端点**（见 `architecture/`）

## 给 AI 助手的阅读顺序

1. `build/BUILD_AND_DEV.md` — 先确认能构建、能部署、能看日志
2. `branding/RENAME_TO_AIPOT.md` — 哪些标识改了、哪些**故意没改**（密钥封装标记等）
3. `plugins/PLUGIN_DEVELOPMENT.md` — 改插件前必读，尤其是"沙箱缓存需重启"
4. `architecture/CONFIG_AND_SECRETS.md` — 数据目录变成 `%APPDATA%\AiPot` 后的迁移与密钥注意事项
5. `performance/MEMORY_AND_LATENCY.md` — 改窗口生命周期/内存前必读
6. `troubleshooting/SELECTION_CLIPBOARD.md` — 划词不工作时的排查路径
7. `architecture/NETWORK_SAFETY.md` — 插件访问本地服务被拦时的唯一解法
8. `ui/TRANSLATE_WINDOW_LAYOUT.md` — 改界面前读，注意 Tailwind 类名必须已存在于编译产物
9. `release/RELEASE_AND_UPDATES.md` — 发版前读，确认更新通道仍为禁用

## 维护本文档

改动了构建流程、品牌标识、插件契约、网络白名单、窗口生命周期、
划词捕获或发布策略时，**同步更新对应文档**。文档里的每个数字
（版本号、端口、超时、耗时、内存）都来自实测，改动后请重新核对。

> AI生成
