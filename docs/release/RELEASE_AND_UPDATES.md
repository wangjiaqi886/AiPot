# 发布与更新通道

本仓库是 AiPot 的自建分支（fork）。为了不让官方发版覆盖本地修改，
更新通道已被有意断开。本文记录现状、改动位置，以及将来开源后如何接回。

## 当前状态（1.3.0，私有内测）

| 项                                                  | 状态         |
| --------------------------------------------------- | ------------ |
| `package.json` 的 `version`                         | `1.3.0`      |
| `electron-builder.yml` 的 `publish`                 | **已删除**   |
| 构建产物 `resources/app-update.yml`                 | **不存在**   |
| `updater.ts` 的 `SELF_UPDATE_ENABLED`               | `false`      |
| `autoUpdater.autoDownload` / `autoInstallOnAppQuit` | 均为 `false` |
| `githubApiBaseUrl` / `releasePageUrl`               | 空字符串     |

结果：**不会检测到官方更新，也不会被官方版本覆盖**。
手动点“检查更新”返回 `unsupported`（无更新源），不发请求、不跳转、不下载。

### 为什么需要这样做

`electron-updater` 在 `publish` 配置存在时会写入 `resources/app-update.yml`，
应用启动后按 `check_update` 配置自动检查官方 GitHub Release，
发现新版本会**下载并安装，覆盖本地改动**。自建版必须断开这一点。

### 版本号为什么是 1.3.0

历史：1.2.0 是为了让自建包版本高于当时已装的官方 NeoPot 1.1.10
（NSIS `allowDowngrade` 默认 `false`）。1.3.0 承载**品牌更名 + 性能优化 +
划词修复**这一批不兼容改动（appId 也变了）。后续每次发版都必须
**高于**当前已安装版本。

## 涉及的代码位置

### `src/main/modules/updater.ts`

```ts
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

// 私有自建发行版：绝不允许自动下载/安装更新。
const SELF_UPDATE_ENABLED = false

function getDistributionMode() {
  if (!SELF_UPDATE_ENABLED) {
    // 私有构建：永不提供自更新，只保留手动下载
    return { distribution: 'portable', mode: 'manual-download' }
  }
  // ...原有逻辑（installer / appimage / deb-rpm）
}

async function fetchGithubRelease() {
  if (!githubApiBaseUrl) {
    // 本私有构建未配置更新源
    return null
  }
  // ...原有逻辑
}
```

头部两个常量：

```ts
// 私有分叉阶段禁用更新源。开源后指向自己的仓库即可恢复手动检查。
const githubApiBaseUrl = ''
const releasePageUrl = ''
```

### `electron-builder.yml`

```yaml
# 无 publish 段：自建私有版本不得从官方 GitHub Release 自动更新，
# 否则会覆盖本地修改。分叉开源后再配置更新分发。
```

## 开源后恢复自更新（三步）

1. `src/main/modules/updater.ts`：填入自己的仓库地址

   ```ts
   const githubApiBaseUrl = 'https://api.github.com/repos/<owner>/<repo>/releases'
   const releasePageUrl = 'https://github.com/<owner>/<repo>/releases'
   const SELF_UPDATE_ENABLED = true
   ```

2. `electron-builder.yml` 增加：

   ```yaml
   publish:
     provider: github
     owner: <owner>
     repo: <repo>
   ```

3. 发布时不要再加 `--publish never`，或改用 `electron-builder --publish always`
   并配置 `GH_TOKEN`。首次发布后确认 `resources/app-update.yml` 已生成并指向自己的仓库。

> 若只想保留“手动检查 + 跳转下载页”而不让应用自装，可以只做第 1 步的两个 URL，
> 保持 `SELF_UPDATE_ENABLED = false`。

## 分叉身份需要一并替换的地方

开源为一个独立项目时，下面这些仍指向上游，建议一起改：

| 位置                            | 内容                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `package.json`                  | `name`、`description`、`author`、`repository`                           |
| `electron-builder.yml`          | `appId`（**1.3.0 起已是 `com.aipot.app`**）、`productName`              |
| `src/main/modules/updater.ts`   | 两个 URL 常量                                                           |
| `src/main/modules/updater.ts`   | `openReleasePage()` 的 `allowedHosts: ['github.com']`（换 Host 时同步） |
| `public/icon.*`、`docs/assets/` | 品牌资产（1.3.0 已换 AiPot 图标，见 `branding/`）                       |
| 插件市场地址（若保留）          | 默认仍指上游 `Neopot-releases`，见 `Config/pages/Plugin/marketplace.ts` |

### appId 变更的迁移策略（1.3.0 已执行）

- `appId` 决定安装目录与注册表项：**改了 appId 会被视为另一个应用**，
  不会覆盖旧安装。1.3.0 已从 `com.squirrel.neopot.neopot` 改为
  `com.aipot.app`，因此：
  - NeoPot 的旧安装、桌面快捷方式、自启动项都保留在系统里，互不影响；
  - 用户数据通过**首次启动迁移**继承（`profileMigration.ts`，见
    `architecture/CONFIG_AND_SECRETS.md`），safeStorage 加密密钥除外；
  - 两套应用可并存，但**全局快捷键只能被一个应用注册**，
    同时运行时后启动的一方注册失败并在日志告警。
- 后续**不要再随意改 appId**：再改就是第三个应用，且迁移逻辑只认
  `NeoPot` 这一个旧目录。

## 发版检查清单

- [ ] `package.json` 的 `version` 已递增，且高于已安装版本
- [ ] `pnpm run make` 成功，`dist/` 里有 Setup 与 portable
- [ ] `dist/win-unpacked/resources/bin/AiPotSelectionHelper.exe` 存在（划词核心依赖）
- [ ] 解包确认改动进包（见 `docs/build/BUILD_AND_DEV.md` 的验证小节）
- [ ] 在一台干净机器/干净用户配置下试装（NSIS 静默安装在本机有缺陷）
- [ ] 首次启动迁移生效：`%APPDATA%\AiPot\profile-migration.json` 生成且
      `status=migrated`（或 `skipped`）；迁移机上验证插件列表可见
- [ ] 明确 `publish` 是否仍为禁用状态——**内测阶段必须禁用**
- [ ] 插件与密钥不进包（`app.asar` 只含程序代码），分发说明另附
- [ ] 与 NeoPot 共存测试：确认 AiPot 首启后 NeoPot 不被破坏，
      快捷键冲突只在日志告警、不影响启动

> AI生成
