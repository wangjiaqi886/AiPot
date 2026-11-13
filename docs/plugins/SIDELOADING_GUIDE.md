# 侧载插件适配指南

“侧载”指不在官方插件市场里、由本地目录直接安装的插件。本仓库自建版本用的三个插件
（TeleAgent 翻译、GLM 视觉 OCR、TeleAgent 视觉 OCR）都是侧载的。
本文记录侧载时的适配要点与常见故障对应关系。

> **1.3.0 迁移说明**：数据目录已从 `%APPDATA%\NeoPot` 换成
> `%APPDATA%\AiPot`，首启自动把整个 `plugins/` 目录复制过去
> （`profileMigration.ts`），侧载插件与 `config.json` 里的实例键、
> 白名单登记都会原样生效。插件本身**不需要任何修改**：
> 安装元数据旧名 `.neopot-plugin.json` 仍可读，
> 沙箱 RPC 通道改名也不影响插件 `main.js`。
> 唯一例外：safeStorage 加密的 API Key 迁移后读不出来，需重填一次
> （明文注入的不受影响，见"明文密钥"一节）。

## 侧载安装步骤

1. 在 `%APPDATA%\AiPot\plugins\<type>\` 下新建目录，名称即插件名
   （如 `translate\plugin-teleagent-translate\`）
2. 放入 `info.json`、`main.js`、可选 `icon.svg`
3. **重启 AiPot**（沙箱缓存 `main.js`，不重启不生效）
4. 打开设置 → 服务 → 添加，选择该插件，生成一个服务实例
5. 在实例上填写 API Key / 端点等 `needs` 字段
6. 在「翻译服务 / 文字识别服务」列表里启用该实例

> 第 5、6 步产生的是 `config.json` 里的实例键
> （`plugin:<name>@<随机>`）与 `translate_service_list` / `recognize_service_list`
> 条目。也可以直接编辑 `config.json`（见下节“程序化预置”）。

## 程序化预置（免手工点击）

`config.json` 位于 `%APPDATA%\AiPot\config.json`。需要写入三部分：

```jsonc
{
  // 1) 实例配置：键名是 plugin:<插件名>@<任意9位随机>
  "plugin:plugin-teleagent-translate@w2d71p7yx4n": {
    "endpoint": "http://127.0.0.1:18765",
    "apiKey": "<local_api_key>",
    "model": "chat-flash",
    "stream": "true",
  },
  // 2) 启用列表里登记实例
  "translate_service_list": ["deepl", "google", "plugin:plugin-teleagent-translate@w2d71p7yx4n"],
  // 3) 识别服务同理
  "recognize_service_list": ["local_model", "plugin:plugin-glm-vision-ocr@4aim35biwzq"],
}
```

### 明文密钥可以直接写入（重要但需知情）

配置读取层 `decryptSensitiveConfigValue()` 只对形如
`{ "__neopot_secret": true, "version": 1, "encoding": "base64", "value": "..." }`
（封装键名**保留 `__neopot_secret` 不改**，原因见
`branding/RENAME_TO_AIPOT.md`；1.3.0 起解不开的密文会读成空串并记
`Failed to decrypt a stored secret` 日志）的对象做 DPAPI 解密；
**普通字符串原样返回**。因此在 `config.json` 里直接写明文
`apiKey` 是合法的，程序能读到。

代价与建议：

- 明文在磁盘上是可读的。用户下次在 UI 里保存该实例时，程序会**自动重新加密**，
  明文随之消失。
- 这台机器的 `config.json` 里曾用此方式注入过 teleagent 的本地网关 key。
  若要彻底归一为密文态，在 UI 里对该实例点一次“保存”即可。
- **不要把含明文 key 的 `config.json` 提交到仓库或发给别人。**

## 关键适配点

### 1. 私有网段端点需要登记（否则被拦）

AiPot 主进程对渲染进程/插件的 HTTP 请求做 SSRF 防护，
`127.0.0.1`、`192.168.*`、`10.*` 等默认被拒。侧载插件若访问本地服务
（如签名网关、Ollama 之类），**必须让端点进入白名单**。

自建版本已扩展为：自动收集**插件服务实例**配置中的
`endpoint` / `requestPath` / `baseUrl` / `base_url` / `url` 字段的 origin。
详见 `docs/architecture/NETWORK_SAFETY.md`。

若你新增了别的字段名来存端点，记得同步扩展
`src/main/modules/http.ts` 的 `configuredProviderOrigins()`。

### 2. 语言映射表要覆盖全部目标语言

平台先查 `info.json` 的 `language` 表，**键不存在就直接报错、不调用插件**。
侧载常见故障“不支持该语言”多半是表缺键，而不是插件逻辑问题。

### 3. 密钥字段命名决定是否加密

字段名含 `api_key`/`apikey`/`secret`/`token`/`password` 等关键字会被自动加密；
用 `credential`、`auth` 这类名字则**不会**加密。想被保护就按约定命名。

### 4. 超时

- 识别插件：平台侧硬超时 **30 秒**
- HTTP：`init.timeoutMs` 上限 10 分钟，建议显式设置

OCR / 视觉模型 30 秒可能偏紧，插件内不要做多轮重试。

### 5. 结果格式

翻译返回 `string`；识别返回 `string`。返回对象会被 `String()` 化，
只有内置服务支持富结果结构（发音、释义等）。

## 三个侧载插件的情况（本仓库现状）

| 插件                          | 位置                 | 端点                                                    | 密钥来源                       |
| ----------------------------- | -------------------- | ------------------------------------------------------- | ------------------------------ |
| `plugin-teleagent-translate`  | `plugins/translate/` | `http://127.0.0.1:18765/v1/chat/completions`            | 本地签名网关的 `local_api_key` |
| `plugin-teleagent-vision-ocr` | `plugins/recognize/` | 同上，模型 `vision-standard`                            | 同上                           |
| `plugin-glm-vision-ocr`       | `plugins/recognize/` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | BigModel API Key               |

`plugin-glm-vision-ocr` 的默认模型是 `glm-5.3-flash`。
**不要默认用 `glm-4.5v`**：它不在 GLM Coding Plan 资源包内，会返回
`HTTP 429 {"code":"1113","message":"余额不足或无可用资源包"}`。
`glm-5.3-flash` / `glm-5.3-flashx` 在资源包内且有视觉能力。

## 故障对照表

| 错误                                              | 根因                                 | 处理                                                                |
| ------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `HTTP request target is not allowed: 127.0.0.1`   | SSRF 白名单未含该私有端点            | 扩展 `configuredProviderOrigins()` 或把端点写进实例配置的受支持字段 |
| `HTTP 429 {"code":"1113"}`                        | 模型不在资源包内                     | 换成 `glm-5.3-flash` 等包内模型                                     |
| `未配置翻译服务` / `未配置识别服务`               | 实例未登记、插件未加载、或语言表缺键 | 查 `*_service_list`、重启、核对 `language`                          |
| `TeleAgent gateway returned no translatable text` | 响应不是预期结构                     | 插件错误信息里带出原始响应片段，据此定位                            |
| `DataCloneError`                                  | `init.onChunk` 无法跨沙箱序列化      | 去掉回调按整包重试                                                  |
| 调用无反应 / 结果不变                             | 沙箱缓存旧 `main.js`                 | 重启 AiPot                                                          |

## 分发注意

插件放在 `%APPDATA%\AiPot\plugins\`，**不在安装包里**（`app.asar` 只有程序代码）。
所以：

- 覆盖安装新版不会丢插件，也不会带走 key
- 把 exe 拷给别人 = 只有程序，没有你的插件与配置
- 要分发整套，需要另外打包 `plugins/` 目录并说明安装位置与密钥填写方式

> AI生成
