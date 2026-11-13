# NeoPot → AiPot 改名记录（1.3.0）

本分支从 1.3.0 起品牌更名为 **AiPot**。本文记录改名涉及的全部位置、
**故意保留旧名的地方**（兼容性优先），以及图标资产。

## 已改动的标识

| 类别             | 旧值                                                      | 新值                                 | 位置                                                                                                   |
| ---------------- | --------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 包名             | `neopot`                                                  | `aipot`                              | `package.json` `name`                                                                                  |
| 产品名           | `NeoPot`                                                  | `AiPot`                              | `package.json` `productName`、`index.html` `<title>`、托盘 tooltip、About 页                           |
| appId            | `com.squirrel.neopot.neopot`                              | `com.aipot.app`                      | `electron-builder.yml`、`src/main/modules/appIdentity.ts` `APP_USER_MODEL_ID`                          |
| 安装包名         | `NeoPot-Setup-*.exe` 等                                   | `AiPot-Setup-*.exe` 等               | `electron-builder.yml` `artifactName`、`.scripts/check-release-artifacts.mjs`                          |
| 可执行文件       | `NeoPot.exe`                                              | `AiPot.exe`                          | electron-builder 按 `productName` 生成                                                                 |
| 用户数据目录     | `%APPDATA%\NeoPot`                                        | `%APPDATA%\AiPot`                    | `app.setName('AiPot')`（`src/main/index.ts`）；启动时自动迁移，见下                                    |
| 渲染协议         | `neopot://main_window/...`                                | `aipot://main_window/...`            | `src/main/modules/rendererProtocol.ts` `RENDERER_SCHEME`、preload 可信来源判断                         |
| 预加载桥         | `window.neoPot`                                           | `window.aiPot`                       | `src/preload/index.ts` `exposeInMainWorld`、`src/shared/types/electron-api.d.ts`、全部 renderer 调用点 |
| 窗口事件         | `neopot://focus` 等                                       | `aipot://focus` 等                   | `src/main/modules/window.ts`、`WindowPinning.tsx` 等                                                   |
| store 事件       | `neopot:store-*`                                          | `aipot:store-*`                      | `src/renderer/lib/config/store.ts`、相关测试                                                           |
| 插件沙箱通道     | `neopot-plugin-rpc` 等                                    | `aipot-plugin-rpc` 等                | `src/renderer/lib/plugin/invoke_plugin.ts`（宿主与沙箱两端同步改，无外部契约）                         |
| 沙箱标记         | `__neopot_utils` / `__neopot_callback` / `__neopot_entry` | `__aipot_*`                          | 同上                                                                                                   |
| 划词剪贴板标记   | `__NEOPOT_SELECTION_*`                                    | `__AIPOT_SELECTION_*`                | `src/main/modules/selection.ts`（仅兜底路径使用）                                                      |
| 自启动参数       | `--neopot-start-hidden`                                   | `--aipot-start-hidden`               | `src/main/modules/autoStart.ts`                                                                        |
| 插件安装元数据   | `.neopot-plugin.json`                                     | `.aipot-plugin.json`（读时兼容旧名） | `pluginInstallerCore.ts` `PLUGIN_METADATA_FILE` + `installer.ts` 回退读取                              |
| 插件下载临时目录 | `%TEMP%\neopot-plugin-*`                                  | `%TEMP%\aipot-plugin-*`              | `src/main/plugins/installer.ts`                                                                        |
| SnipDo 扩展      | `neopot.json/ps1`                                         | `aipot.json/ps1`                     | `.scripts/snipdo/`                                                                                     |
| 测试环境变量     | `NEOPOT_E2E_ROOT`                                         | `AIPOT_E2E_ROOT`                     | `tests/e2e/*`                                                                                          |
| 类名             | `NeoPotError(Payload)`、`NeoPotElectronApi`               | `AiPot*`                             | `src/main/modules/ipc.ts`、`src/shared/types/electron-api.d.ts`                                        |

## 故意保留旧名的地方（改了会出兼容问题）

1. **密钥封装标记 `__neopot_secret`**（`src/main/modules/configSecrets.ts`）。
   旧 config.json 里的密文就是按这个键名序列化的；改名会导致所有已加密
   API Key 读不出来。代码内已加注释说明。
2. **上游仓库/插件市场链接**保持指向
   `github.com/shirumesu/NeoPot`、`Neopot-releases`：
   AiPot 没有独立仓库，About 页与 README 的链接仍指上游。
3. **源码目录名已改为 `D:\AiPot-master`**（1.3.1，原 `D:\NeoPot-master`）。
   注意：部署安装目录约定为 `D:\AiPot`（win-unpacked 覆盖），**不要**
   把源码目录直接命名为 `D:\AiPot`，两者不能是同一个目录。
   改名后需重跑 `pnpm install --no-frozen-lockfile` 重建 node_modules
   链接，并清空 `out/` 构建缓存。
4. **上游 README 截图**（`docs/assets/readme/`）仍是 NeoPot 界面，仅作历史参考。

## 用户数据迁移

- `src/main/modules/profileMigration.ts`：首次启动时把
  `%APPDATA%\NeoPot` 里的 `config.json`、`plugins/`、`history.db`、
  `legacy-backup/`、`migration.json` 复制到 `%APPDATA%\AiPot`，
  写入 `profile-migration.json` 标记，**不复制** Chromium 缓存/锁文件。
- 已存在 `%APPDATA%\AiPot\config.json` 时跳过并写 `skipped` 标记，
  绝不覆盖新配置。
- **密钥注意**：`safeStorage` 密文绑定原 profile（OSCrypt key 存在
  原 `Local State` 里），迁移过来的加密密钥**解不开**。读取端已做
  容错（返回空字符串 + 日志告警），用户需在设置里重填一次 API Key；
  明文注入的配置不受影响。详见
  `architecture/CONFIG_AND_SECRETS.md` 的"密钥加密"一节。

## appId 变更的后果

- AiPot 会被系统视为**另一个应用**：不会覆盖 NeoPot 安装，
  NSIS 也因此不受旧安装的 `allowDowngrade` 限制。
- 桌面快捷方式、开始菜单、注册表项按 `com.aipot.app` 重新登记；
  NeoPot 的自启动项仍指向 `NeoPot.exe`，需要的话在 AiPot 设置里
  重新开启自启动。
- 两个应用可以同时运行（单实例锁按 userData 目录区分），
  但全局快捷键会**注册冲突**——后启动的一方注册失败并在日志中告警。

## 图标资产

- `public/icon.png`（1024）、`public/icon.ico`（16–256 全档）、
  `public/icon-256.png`、`public/icon.svg` 均为 AiPot 新标（紫色渐变
  圆角底 + 白锅 + 青色 A + 星芒）。
- 生成脚本：`resources/icon/make_aipot_icon.py`（仓库内；PIL 绘制，4 倍超采样抗锯齿），
  如需微调可改后重跑，输出直接覆盖 `public/`。
- exe 图标取自 `public/icon.ico`；窗口图标与托盘取 `public/icon.png`
  （托盘会先 `resize` 到 32px 保证清晰）。
- 平台 AIGC 生成的图片自带"AI生成"水印，不宜直接做应用图标，
  因此最终图标为程序绘制，非生成图。

> AI生成
