# 构建与开发环境

本文记录本仓库自建版本的完整构建流程、已知环境坑与验证方法。
所有命令在 Windows + PowerShell/Git Bash 下验证过（2026-11-12，AiPot 1.3.0）。

## 环境事实

| 项目             | 值                                                        | 说明                                                                                      |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 源码根           | `D:\AiPot-master`                                         | 修改一律在此进行（1.3.1 从 `D:\NeoPot-master` 改名而来，部署目录是 `D:\AiPot`，两者不同） |
| Node             | v24.22.1（要求 `>=24`）                                   | `package.json` 的 `engines`                                                               |
| pnpm             | **12.16.1**                                               | Git Bash 里不在 PATH，用完整路径 `"D:/nodejs/node_global/pnpm.cmd"`                       |
| Electron         | 41.10.3                                                   | 随依赖安装                                                                                |
| electron-builder | 26.15.3                                                   |                                                                                           |
| .NET 编译器      | `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` | 划词 helper 用，缺了会自动跳过（fallback 到 PowerShell 捕获）                             |
| 入口             | `out/main/index.cjs`                                      | electron-vite 产物                                                                        |

## 标准流程

```bash
cd "D:/AiPot-master"
"D:/nodejs/node_global/pnpm.cmd" install --no-frozen-lockfile
"D:/nodejs/node_global/pnpm.cmd" run make
```

`make` 实际执行（**1.3.0 新增第一步**）：

```
node .scripts/build-selection-helper.mjs   # csc 编译 resources/win/AiPotSelectionHelper.cs
  && node .scripts/clean-release-output.mjs
  && electron-vite build                  # out/main out/preload out/renderer
  && electron-builder --win --publish never
```

单独跑 `pnpm build` 只做 electron-vite 编译（产出 `out/`），不出安装包；
`pnpm build:helper` 只编译划词助手。类型检查：`pnpm typecheck`。

产物在 `dist/`：

| 文件                           | 用途                                       |
| ------------------------------ | ------------------------------------------ |
| `AiPot-Setup-1.3.1.exe`        | NSIS 安装包（交互式向导）                  |
| `AiPot-1.3.1-portable-x64.exe` | 便携版自解压                               |
| `win-unpacked/`                | 未打包的完整目录（**部署最可靠**，见下文） |

`win-unpacked/resources/bin/AiPotSelectionHelper.exe` 是划词捕获助手
（electron-builder `extraResources` 从 `resources/bin/` 带入）；
**这个文件缺失时划词会退化成 PowerShell 路径，慢且更容易失败**。

## 环境坑（按踩到顺序）

### 1. pnpm 12 不再读取 `package.json` 的 `pnpm.overrides`

pnpm 12 会把 overrides 搬到 `pnpm-workspace.yaml`，否则 `pnpm run` 直接以
`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` 失败。本仓库已迁移，
`pnpm-workspace.yaml` 里同时保留了 `allowBuilds` 与 `overrides` 两段。
若上游同步了新 overrides，记得两边只看 `pnpm-workspace.yaml`。

### 2. `--frozen-lockfile` 会因 overrides 位置变化而失败

先跑一次 `pnpm install --no-frozen-lockfile` 让 lockfile 重新对齐，
之后才可冻结安装。

### 3. pnpm 的构建脚本需要批准

`pnpm approve-builds --all` 之后 `electron` 的 postinstall 才会下载二进制，
确认方式：`node_modules/electron/dist/electron.exe` 存在。

### 4. PowerShell 5.1 改写非 ASCII 文本会把 UTF-8 中文写成乱码

`Get-Content -Raw` 默认按 ANSI 读，`Set-Content -Encoding UTF8` 还会加
BOM——**任何含中文/日文/阿拉伯文的文件（i18n JSON、README、含中文
字面量的测试）一旦这样改就永久乱码**，且本仓库没有 git 历史。
必须用 Python（`open(p,'rb').read().decode('utf-8-sig')` →
`open(p,'w',encoding='utf-8',newline='\n').write(...)`）或编辑器改。
本分支 2026-11-12 曾因此损坏 12 个语言文件与两个测试文件，
是从上游 `shirumesu/NeoPot`（分支 `master`，注意不是 main）的
raw 文件按原始字节数恢复的。

### 5. Git Bash 路径转换破坏外部命令参数

现象：`taskkill /IM AiPot.exe /F` 被 Git Bash 改写成
`C:/Program Files/Git/IM`。凡是以 `/` 开头的开关（`/IM`、`/S`、`/D=`）
都要改用 PowerShell 调用，或加 `MSYS_NO_PATHCONV=1`。

### 6. NSIS 静默安装不可靠（旧版本实测）

`/S` 静默安装曾出现**只复制了 `resources/app.asar`、没有复制 exe 与
DLL**，退出码 0 但安装不完整。交互式向导在旧版未卸载时会弹
"Failed to uninstall old application files.: 2"。

**1.3.0 起 appId 改为 `com.aipot.app`**：AiPot 对系统是全新应用，
不会去卸载/升级 NeoPot，上面旧坑大概率不会再触发；
但对外分发前仍务必在干净机器上试装一次。

### 7. 本机部署约定（win-unpacked 全量覆盖）

```powershell
# 1) 关闭正在运行的 AiPot（如无）
Stop-Process -Name AiPot -Force -ErrorAction SilentlyContinue
# 2) 安装目录自选（如 D:\AiPot），全量覆盖
Copy-Item 'D:\AiPot-master\dist\win-unpacked\*' 'D:\AiPot\' -Recurse -Force
```

验证：`(Get-Item 'D:\AiPot\AiPot.exe').VersionInfo.FileVersion`。

### 8. `pnpm run test`（完整门禁）在本机不可用（2026-11-12 实测）

`.scripts/test/run-all.mjs` 用 `spawnSync(node.exe, [npm_execpath, 'run', ...])`
调用各步骤；本机 pnpm 是 `D:/nodejs/node_global/pnpm.cmd`（批处理 shim），
node.exe 无法直接执行 `.cmd`，第一步 Format 即报
`ERR_UNKNOWN_FILE_EXTENSION` 后退出。**这是环境 shim 问题，不是代码问题**。
等效验证（全部可用）：

```bash
"D:/nodejs/node_global/pnpm.cmd" run format:check   # Format
"D:/nodejs/node_global/pnpm.cmd" run lint           # Lint
"D:/nodejs/node_global/pnpm.cmd" run typecheck      # Typecheck
"D:/nodejs/node_global/pnpm.cmd" run test:fast      # vitest 全量
"D:/nodejs/node_global/pnpm.cmd" run test:contracts # 静态契约
"D:/nodejs/node_global/pnpm.cmd" run make           # Build（含 helper 编译）
```

若要用回完整门禁，需让 `npm_execpath` 指向可被 node 直接执行的入口
（如全局 `pnpm` 的 `.cjs` 本体），或改 `run-all.mjs` 在 win32 下用
`shell: true` 调用。e2e（Playwright）另需显示环境，服务器会话跑不了。

## 首次启动会发生什么（1.3.0）

- `app.setName('AiPot')` → 用户数据目录变为 `%APPDATA%\AiPot`。
- 首次启动自动从 `%APPDATA%\NeoPot` 迁移 `config.json`、`plugins/`、
  `history.db`、`legacy-backup/`（写 `profile-migration.json` 标记；
  新目录已有 config 时跳过）。详见 `architecture/CONFIG_AND_SECRETS.md`。
- **迁移过来的 safeStorage 加密密钥读不出来**（OSCrypt key 绑定原
  profile）：日志会出现 `Failed to decrypt a stored secret`，对应服务
  显示"请配置 API Key"，去设置里重填一次即可；明文注入的 key 不受影响。
- 与 NeoPot 同时运行时，全局快捷键会注册失败（日志 `Global shortcut
registration failed`），属预期。

## 验证方法

### 版本与内容核验

```powershell
# 构建产物版本
(Get-Item 'D:\AiPot-master\dist\win-unpacked\AiPot.exe').VersionInfo.FileVersion

# 划词 helper 是否进包
Test-Path 'D:\AiPot-master\dist\win-unpacked\resources\bin\AiPotSelectionHelper.exe'

# asar 里确认为程序代码、不含插件与配置
cd dist\win-unpacked\resources; npx asar list app.asar | Select-Object -First 20

# 确认改动进了包（特征串）
npx asar extract app.asar ..\unpack-check
Select-String -Path '..\unpack-check\out\main\*.cjs' -Pattern 'AiPotSelectionHelper' -SimpleMatch | Select-Object -First 3
Select-String -Path '..\unpack-check\out\renderer\assets\*.js' -Pattern 'aipot-plugin-rpc' -SimpleMatch | Select-Object -First 3
```

### 运行时验证

AiPot 自带本地 HTTP 服务（默认端口 **60828**，可配 `server_port`），
可编程触发工作流：

| 路由                                   | 作用                     |
| -------------------------------------- | ------------------------ |
| `POST /translate`（body=文本）         | 文本翻译                 |
| `GET /selection_translate`             | 划词翻译（可用来量耗时） |
| `POST /ocr_translate?screenshot=false` | 图像翻译（读截图缓存）   |
| `GET /config`                          | 打开设置窗               |

日志在 `%APPDATA%\AiPot\logs\main.log`。**成功路径只写 `debug` 级**，
默认 `log_level=info` 时看不到——把 `config.json` 的 `log_level` 临时改
`debug` 可看到：

```
[debug] Window ready. window=translate openMs=230
[debug] Window renderer ready. window=translate readyMs=537
[debug] Selection translation capture finished. durationMs=111 ok=true method=windows-selection-helper
[debug] Translation requested. service=...
[debug] Translation completed. ... outputLength=11 durationMs=3763
```

验证完记得改回 `info`。

性能指标的解读与阈值见 `performance/MEMORY_AND_LATENCY.md`。

## 内存与磁盘

- `node_modules` 约 1.4 GB，`dist/` 约 230 MB（两个安装包各 ~117 MB）。
- 划词 helper 仅 8 KB（csc 直编）。
- 清理：`node .scripts/clean-release-output.mjs` 或直接删 `dist/`。

> AI生成
