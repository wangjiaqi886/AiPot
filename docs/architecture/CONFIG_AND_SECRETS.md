# 配置与密钥存储

AiPot 的配置存在 `%APPDATA%\AiPot\config.json`（`electron-store`，文件名为 `config`）。
本文说明结构、密钥加密规则、**1.3.0 的数据迁移**与程序化写入方式。

## 位置（1.3.0 起）

| 内容     | 路径                                                 |
| -------- | ---------------------------------------------------- |
| 配置     | `%APPDATA%\AiPot\config.json`                        |
| 插件     | `%APPDATA%\AiPot\plugins\<type>\<name>\`             |
| 日志     | `%APPDATA%\AiPot\logs\main.log`                      |
| 本地服务 | `http://127.0.0.1:60828`（端口可配置 `server_port`） |

安装目录（`app.asar` 所在）只放程序，**不存配置与插件**。
数据目录由 `app.setName('AiPot')` 决定（`src/main/index.ts`），
与安装目录无关。

## 密钥加密

`src/main/modules/configSecrets.ts`：

- 写入时：若**键路径**匹配敏感关键字，字符串值被 `safeStorage.encryptString()`
  （Windows 上是 DPAPI，绑定当前用户）加密，存成

  ```json
  { "__neopot_secret": true, "version": 1, "encoding": "base64", "value": "...." }
  ```

  ⚠️ 封装键名**故意保留 `__neopot_secret` 不改**：旧配置里的密文就是按
  这个键名序列化的，改名会导致所有已加密 Key 读不出来
  （改名范围见 `branding/RENAME_TO_AIPOT.md` 的"故意保留"清单）。

- 读取时：`decryptSensitiveConfigValue()` 只对上述结构解密；
  **普通字符串原样返回**。
- **解密失败不会抛出**（1.3.0 容错）：解不开的密文返回空字符串，
  主进程日志记一条 `Failed to decrypt a stored secret`。
  这是为了让"从 NeoPot 迁移过来的加密 key"不至于打挂整个设置页——
  对应服务显示"请配置 API Key"，重填一次即可。

敏感关键字（对键名做小写并去掉 `-_ ` 后做包含匹配）：

```
api_key, apikey, auth_key, authkey, secret_key, secretkey,
access_token, accesstoken, refresh_token, refreshtoken, password, token
```

因此 `credential`、`auth` 这类命名**不会**被加密。想被保护就按约定命名。

### 明文注入是合法的

因为读取层对普通字符串直通，可以直接在 `config.json` 里写：

```json
"plugin:plugin-teleagent-translate@w2d71p7yx4n": {
  "endpoint": "http://127.0.0.1:18765",
  "apiKey": "ta-xxxxxxxx",
  "model": "chat-flash"
}
```

程序能正常读取。**用户在 UI 里对该实例点一次保存，会自动重新加密**。

风险：明文在磁盘上可读。不要提交到仓库、不要随构建产物分发。

## NeoPot → AiPot 数据迁移（1.3.0）

`src/main/modules/profileMigration.ts`，在 import config 模块**之前**执行：

1. `%APPDATA%\AiPot\config.json` 已存在 → 跳过（写 `skipped` 标记），**绝不覆盖**。
2. 否则复制 `%APPDATA%\NeoPot\` 下的
   `config.json`、`plugins/`、`history.db`、`legacy-backup/`、`migration.json`，
   写 `profile-migration.json` 标记。
   Chromium 的缓存/锁文件（`Cache`、`Local State`、`GPUCache`、
   `SingletonLock`…）**不复制**。
3. 若迁移来的 config 里有 `__neopot_secret` 密文，打一条 warn：
   **这些密钥读不出来**。safeStorage 的 OSCrypt key 存放在旧 profile 的
   `Local State` 里且绑定原 profile，换目录后无法解密（实测已验证：
   尝试把旧 key 写入新 `Local State` 也无效——Chromium 在我们的 JS 跑
   之前已经生成了自己的 key）。明文注入的 key 不受影响。
4. 想保留密钥的替代做法：**把 config.json 里的密钥改成明文**再启动
   （回到上面的"明文注入"），或启动后在设置页重填。

## 主要键结构

```jsonc
{
  // 服务实例列表
  "translate_service_list": ["deepl", "google", "plugin:<name>@<id>"],
  "recognize_service_list": ["local_model", "plugin:<name>@<id>"],
  "tts_service_list": ["lingva"],

  // 单个实例的配置（键名即实例 key）
  "plugin:plugin-teleagent-translate@w2d71p7yx4n": {
    "endpoint": "http://127.0.0.1:18765",
    "apiKey": "<密文或明文>",
    "model": "chat-flash",
    "stream": "true",
  },
  "deepl": { "enable": false },

  // 插件级选项（对应 info.json 的 options）
  "plugin_options:translate:plugin-chatglm-translate": {
    "defaultModel": "glm-5.3-flash",
    "baseUrl": "https://open.bigmodel.cn/api/anthropic",
  },

  // 插件启用开关（不存在 = 启用）
  "plugin:translate:plugin-teleagent-translate:enabled": true,

  // 语言与行为
  "translate_source_language": "auto",
  "translate_target_language": "zh_cn",
  "translate_auto_copy": "source",
  "translate_close_on_blur": true, // 默认 true，未设置时生效
  "recognize_language": "auto",

  // 性能与窗口生命周期（1.3.0 新增，未设置时用代码默认值）
  "hardware_acceleration": false, // true=开 GPU 进程（+100~200MB），重启生效
  "translate_window_idle_destroy_seconds": 300, // 隐藏后保活时长；0=立即回收
  "config_window_idle_destroy_seconds": 30,
  "recognize_window_idle_destroy_seconds": 120,
  "screenshot_window_idle_destroy_seconds": 5,
  "updater_window_idle_destroy_seconds": 30,

  // 热键
  "hotkey_selection_translate": "Alt+D",
  "hotkey_ocr_translate": "Alt+C",
  "hotkey_ocr_recognize": "Alt+X",

  // 诊断
  "log_level": "info", // 调 debug 可看插件调用细节与耗时日志
}
```

实例 key 格式：`plugin:<插件名>@<9位随机>`（内置服务没有 `@` 后缀，
如 `deepl`、`local_model`）。解析逻辑在 `src/shared/serviceInstance.ts`。

## 程序化读写

**推荐**（应用运行中）：通过 UI 或本地服务让主进程写，避免与运行中的
`electron-store` 争抢文件。主进程写入走 `setConfig()`，会自动加密并发广播
（`config:changed` 事件，广播到所有渲染器）。

**离线编辑**：先关闭 AiPot，再改 `config.json`，保存为 **UTF-8（无 BOM）**。
注意该文件由 `electron-store` 维护，键顺序与格式会被重写，不要依赖 diff。
⚠️ 别用 Windows PowerShell 5.1 的 `Get-Content`/`Set-Content` 改这个文件——
中文/密文注释会被写成乱码（见 `build/BUILD_AND_DEV.md` 环境坑 4）。

**读取**：

- 渲染器 `config:get`（单键）；
- 渲染器 `config:get-all`（**1.3.0 新增**，一次取全部键，`initStore`
  用来预热缓存，替代逐键 IPC 往返）；
- 主进程 `getConfig(key)` 返回已解密明文；`getRedactedConfig(key)`
  对顶层敏感键返回 `"********"`（服务实例配置不是顶层敏感键，
  嵌套的 apiKey 会被解密返回——插件调用需要明文）。

## 迁移与备份

- 备份配置：复制 `config.json`（含密文；换机器/换用户后 DPAPI 无法解密，需重新填 key）
- 备份插件：复制整个 `plugins/` 目录
- 迁移到新机器：两者一起带过去；密钥需重新输入（DPAPI 绑定用户账户）
- NeoPot → AiPot：首次启动自动迁移（见上），密钥部分按"明文注入"或重填处理

## 常见问题

| 现象                                       | 原因                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| 实例在列表里但报“未配置”                   | 实例配置键缺失，或插件未加载（语言表为空）                                |
| 迁移后某服务报“请配置 API Key”             | 该 key 原来是 safeStorage 密文，换了 profile 解不开；重填一次（或改明文） |
| 日志刷 `Failed to decrypt a stored secret` | 同上，每次读都会记 warn，重填/改明文后消失                                |
| 密文换用户后读不出                         | DPAPI 绑定原用户/机器，需重填                                             |
| 改了 config.json 不生效                    | 应用运行中覆盖了文件；关闭后再改                                          |
| 语言/行为配置看似无效                      | 部分键在未经 UI 保存时不存在，代码里走默认值                              |
| 开了 `hardware_acceleration` 内存暴涨      | GPU 进程回来了（正常现象），不需要 GPU 就关掉                             |

> AI生成
