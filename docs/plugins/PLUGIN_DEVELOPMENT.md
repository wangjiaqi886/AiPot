# 插件系统：机制与开发手册

AiPot 的翻译/识别/TTS 服务可以通过插件扩展。本文是给后续开发者（含 AI 助手）的权威参考，
内容全部来自源码核对与实测。

## 目录与注册

插件**没有注册表**，纯目录扫描：

```
%APPDATA%\AiPot\plugins\<type>\<plugin-name>\
├── info.json            # 必需：清单
├── main.js              # 必需：ES Module 源码
├── icon.svg             # 可选：图标（也支持 png/jpg/webp 或 http/data URL）
└── .aipot-plugin.json   # 可选：安装来源元数据（不影响功能）
```

> 1.3.0 兼容说明：安装元数据文件名从 `.neopot-plugin.json` 改为
> `.aipot-plugin.json`，但**读取时两个名字都认**（新优先，旧的作为
> 兼容回退，见 `pluginInstallerCore.ts` 的 `LEGACY_PLUGIN_METADATA_FILE`）。
> 从 NeoPot 迁移过来的插件目录无需任何手工处理。

- `<type>` ∈ `translate` | `recognize` | `tts`
- `<plugin-name>` 即插件身份，必须与 `info.json` 的 `"name"` 一致
- 扫描实现：`src/main/plugins/installer.ts` 的 `listInstalledPlugins()`

**关键行为**：每次加载都会重新读目录与 `info.json`，但 **`main.js` 由 iframe 沙箱缓存**。
改完插件代码**必须重启 AiPot**（或触发沙箱重建）才生效——这是排查“改了没反应”的第一检查项。

插件默认启用（`getPluginEnabled` 在无配置时返回 `true`）；显式开关存于
`config.json` 的 `plugin:<type>:<name>:enabled`。

## 沙箱运行时

`main.js` 不是普通 Node 脚本，运行在隐藏 iframe 里：

- `sandbox="allow-scripts"`，`nodeIntegration: false`，**没有 Node API**
- 源码以 Blob URL 动态 `import()`，所以必须是合法的 ES Module
- 宿主与插件通过 `postMessage` RPC 通信（`aipot-plugin-rpc`；
  1.3.0 前叫 `neopot-plugin-rpc`，改名后**插件侧代码不用改**——
  通道名只存在于宿主与沙箱模板之间，插件的 `main.js` 不感知）

### 可用的 `utils`

调用签名里拿到的 `options.utils`（以及通过宿主注入的全局工具）：

| 成员                                                  | 说明                                      |
| ----------------------------------------------------- | ----------------------------------------- |
| `utils.http.fetch(url, init)`                         | 走主进程 `net` 模块请求，**无 CORS 限制** |
| `utils.http.Body.json/text/form`                      | 请求体构造器                              |
| `utils.readFile / readTextFile`                       | 读文件（路径受主进程校验）                |
| `utils.run`                                           | 执行二进制（受命令白名单约束）            |
| `utils.openUrl`                                       | 打开外部链接                              |
| `utils.cacheDir / pluginDir / pluginOptions / osType` | 上下文信息                                |
| `utils.log.debug/info/warn/error`                     | 写入主进程日志                            |

**没有** `fetch` 原生流式回调能力：`init.onChunk` 无法跨 `postMessage` 序列化，
会抛 `DataCloneError`。可行写法是先尝试流式、捕获错误后去掉回调重试（见下节示例）。

### 插件配置从哪来

```js
function getConfig(options) {
  return options && options.config ? options.config : {}
}
function getPluginOptions(options) {
  return options && options.utils && options.utils.pluginOptions ? options.utils.pluginOptions : {}
}
```

- `options.config` = 用户在该**服务实例**上填的字段（对应 `info.json` 的 `needs`）
- `options.utils.pluginOptions` = 插件级选项（对应 `info.json` 的 `options`，
  存储键 `plugin_options:<type>:<name>`）

同一个插件可以被实例化多次（每个实例一份 `config`），实例 key 形如
`plugin:<name>@<9位随机>`。

## 清单 `info.json`

```jsonc
{
  "plugin_type": "translate", // 或 recognize / tts
  "name": "plugin-my-translate", // 必须与目录名一致
  "display": "My Translate", // 界面显示名
  "version": "0.1.0",
  "author": "...",
  "description": "...",
  "icon": "icon.svg",
  "homepage": "https://...",
  "language": { "auto": "Auto", "zh_cn": "Simplified Chinese" /* ... */ },
  "needs": [
    /* 服务实例级配置字段，界面自动渲染表单 */
  ],
  "options": [
    /* 插件级配置，见上 */
  ],
  "hotkeys": [
    {
      "key": "open_homepage",
      "display": "Open Homepage",
      "default": "",
      "handler": "openHomepage",
    },
  ],
}
```

### `language` 字段是语言映射表，不是展示文案

平台的内部语言码（`zh_cn`、`en`、`ja`…）映射到**该服务商认识的语言值**。
调用时插件收到的是**映射后的值**：

- 翻译插件：`translate(text, from, to, options)` 中的 `from`/`to` 已是映射值
- 识别插件：`language === 'auto'` 表示“只识别原文”，其余值表示“识别并翻译到该语言”

若用户选择的语言不在 `language` 表里，平台直接报“不支持该语言”，**不会调用插件**。
所以表要覆盖所有你想支持的语言。

### `needs` 支持的控件类型

| `type`   | 渲染                                                      |
| -------- | --------------------------------------------------------- |
| `input`  | 文本框（**密钥类字段名会被 DPAPI 加密存储**，见安全文档） |
| `select` | 下拉框，`options` 为 `{值: 显示名}`                       |

密钥判定是**按字段名关键字**：包含 `api_key`/`apikey`/`secret`/`token`/`password`
等的键会被自动加密（`src/main/modules/configSecrets.ts`）。

## 三种插件契约

### 翻译

```js
async function translate(text, from, to, options = {}) {
  /* 返回译文字符串 */
}
export { translate, openHomepage }
```

- `text`：待译文本（已 trim）
- `from` / `to`：**已映射**的语言值
- `options.detect`：检测到的源语言
- `options.setResult(partial)`：可选，推流式部分结果（有则界面边下边显示）
- 返回值：字符串即最终译文

### 识别（OCR / 图像翻译）

```js
async function recognize(imageBase64, language, options = {}) {
  /* 返回文本 */
}
export { recognize, openHomepage }
```

- `imageBase64`：PNG 的 base64（**不带** `data:` 前缀），需要自己拼 data URL
- `language`：`'auto'` = 仅 OCR；其他 = OCR + 翻译到该语言
- 超时：**识别窗口**（`Recognize/TextArea`）有 30 秒硬超时
  （`RECOGNIZE_TIMEOUT_MS = 30000`）；**翻译窗口的截图翻译流程**
  （`Translate/SourceArea`）不套这个超时，只受插件内部 `timeoutMs` 约束

### TTS

```js
async function speak(text, language, options = {}) {
  /* 返回音频 */
}
```

TTS 插件本项目未深入使用，契约以 `src/renderer/providers/tts` 为准。

## 完整示例：调用本地网关的翻译插件

这是本仓库实际使用的 `plugin-teleagent-translate` 精简版，
覆盖了流式兜底、`reasoning_effort` 抑制思考、错误可诊断三个要点：

```js
function getHttp(options) {
  const http = options && options.utils ? options.utils.http : null
  if (http && typeof http.fetch === 'function') return http
  return {
    fetch: globalThis.fetch.bind(globalThis),
    Body: {
      json: (d) => JSON.stringify(d),
      text: (d) => String(d),
    },
  }
}

function sseText(raw) {
  let text = ''
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const p = t.slice(5).trim()
    if (!p || p === '[DONE]') continue
    let ev
    try {
      ev = JSON.parse(p)
    } catch {
      continue
    }
    const c = ev.choices && ev.choices[0]
    if (c && c.delta && typeof c.delta.content === 'string') text += c.delta.content
    else if (c && c.message && typeof c.message.content === 'string') text += c.message.content
  }
  return text
}

async function translate(text, from, to, options = {}) {
  const cfg = options.config || {}
  const http = getHttp(options)
  const body = {
    model: cfg.model || 'chat-flash',
    messages: [
      { role: 'system', content: 'You are a translation engine. Return only the translation.' },
      { role: 'user', content: `Translate into ${to}:\n\n${text}` },
    ],
    stream: true,
    reasoning_effort: 'low', // 抑制不必要的思考开销
  }
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: http.Body.json(body),
    responseType: 2, // 2 = 文本（用于解析 SSE）
    timeoutMs: 120000,
  }
  if (typeof options.setResult === 'function') {
    init.onChunk = (_chunk, acc) => {
      const partial = sseText(acc)
      if (partial) options.setResult(partial)
    }
  }

  let res
  try {
    res = await http.fetch(cfg.endpoint, init)
  } catch (e) {
    // 沙箱无法跨 postMessage 传递回调：去掉后按整包重试
    if (/clone|DataClone/i.test(String(e && e.message))) {
      const retry = { ...init }
      delete retry.onChunk
      res = await http.fetch(cfg.endpoint, retry)
    } else throw e
  }
  if (res && res.ok === false) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

  const raw = typeof res.data === 'string' ? res.data : await res.text()
  const out = sseText(raw)
  if (!out) throw new Error(`No text. raw[${typeof raw}]: ${String(raw).slice(0, 300)}`)
  return out.trim()
}

export { translate }
```

**要点**：

- `responseType: 2` 主进程会返回整包文本；`data` 可能就是字符串，也可能需 `text()`
- 解析 SSE 时**不要**假定只有 `delta`，兼容 `message.content` 更稳
- 错误信息里带上原始响应片段，能让下次排查少走很多弯路
- **Prompt 模板必须含 `$text`**：默认模板只是"翻译指令"，不含待译文本；
  自定义 prompt 若漏了 `$text`，模型收不到原文，只会返回空话
  （2026-11 TeleAgent 插件的真实事故）

## 内置 LLM 格式 provider（1.3.1 新增，非插件）

如需接 OpenAI/Anthropic 格式的模型，**不必再写插件**。内置两个翻译
provider：`openai_compatible`（`/v1/chat/completions`）与
`anthropic_compatible`（`/v1/messages`，带模型映射与 `anthropic-version`
头）。配置界面提供：名称、API Key、请求地址、模型（可从 `/v1/models`
拉取列表）、温度/最大 token/额外参数、可编辑的 Prompt 列表（默认
双消息翻译模板，`$text`/`$to`/`$from`/`$detect` 占位）、测试按钮。
源码在 `src/renderer/providers/translate/<name>/`，走的是内置 provider
路径（非插件沙箱），支持流式。私有端点（本地网关）通过在实例配置里
填 `requestPath` 即可放行（白名单逻辑见 `architecture/NETWORK_SAFETY.md`）。

## 调试清单

| 现象                                 | 先查什么                                             |
| ------------------------------------ | ---------------------------------------------------- |
| 改了代码没变化                       | 沙箱缓存 → 重启 AiPot                                |
| “未配置翻译/识别服务”                | 语言映射表缺键；或插件名与目录名不一致               |
| `HTTP request target is not allowed` | 目标为私有网段且未登记，见架构文档                   |
| 调用成功但结果为空                   | 打开 `log_level=debug`；插件抛错信息是否带出原始响应 |
| `DataCloneError`                     | `init.onChunk` 不可序列化，用上文的降级重试          |

> AI生成
