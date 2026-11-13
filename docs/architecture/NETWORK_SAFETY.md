# 网络安全与 SSRF 防护

AiPot 的渲染进程与插件不直接联网，所有 HTTP 请求汇聚到主进程的
`src/main/modules/http.ts`，在那里统一做 SSRF（服务端请求伪造）防护。
本文说明它的规则、本次为侧载插件做的扩展，以及维护时的注意事项。

## 请求汇聚点

三个入口，最终都调用 `assertAllowedProviderRequestUrl()`：

| 入口                          | 调用方                    |
| ----------------------------- | ------------------------- |
| `request()`                   | 内置服务（provider 层）   |
| `rendererHttpRequest()`       | 渲染进程/插件的一次性请求 |
| `streamRendererHttpRequest()` | 渲染进程/插件的流式请求   |

```ts
async function assertAllowedProviderRequestUrl(input: string): Promise<URL> {
  const uncheckedUrl = assertPublicHttpUrl(input, { allowPrivateNetwork: true })
  return assertPublicHttpRequestUrl(input, {
    allowPrivateNetwork: isConfiguredPrivateProviderTarget(uncheckedUrl),
  })
}
```

`src/main/modules/networkSafety.ts` 的规则：

1. 只允许 `http:` / `https:`
2. 主机是本地/私有地址（`127.0.0.1`、`::1`、`10.x`、`172.16-31.x`、`192.168.x`、
   `.local` 等）时，只有在 `allowPrivateNetwork` 为真才放行
3. 域名解析后的 IP 若落在被阻断网段（且不是代理合成地址）也拒绝

## 白名单：`configuredProviderOrigins()`

放行私有地址的唯一途径是这个函数返回的 origin 集合。
**只有出现在集合里的 origin 才能访问私有网段。**

### 上游原版

只收集**内置服务**的端点：

- `ollama` → `requestPath`
- `deepl`（`type === 'deeplx'`）→ 自定义 URL
- `lingva` → `custom_url`
- `google` → `custom_url`
- 外加两个默认地址常量（Lingva、Google）

非内置服务（`plugin:*` 实例）**直接被 `continue` 跳过**，因此侧载插件
访问 `127.0.0.1` 一律被拒——这正是本项目最初遇到的
`HTTP request target is not allowed: 127.0.0.1`。

### 本仓库的扩展（2026-11-12）

```ts
if (getServiceSouceType(serviceInstanceKey) === ServiceSourceType.PLUGIN) {
  // 插件可能访问自托管本地网关（如 127.0.0.1 上的签名代理）。
  // 插件实例中配置的任何端点 URL 都视为用户已批准的私有目标。
  for (const fieldName of ['endpoint', 'requestPath', 'baseUrl', 'base_url', 'url']) {
    const value = providerConfig[fieldName]
    if (typeof value === 'string' && value.trim() !== '') {
      addConfiguredOrigin(origins, () => value)
    }
  }
  continue
}
```

**设计取舍**：白名单来自**用户自己填在实例配置里的地址**，等价于用户显式授权，
不构成“任意私有地址可访问”。但如果将来允许插件在运行时自报端点，
需要重新评估——那时攻击面会从“用户配置”扩大到“插件代码”。

## 安全边界与已知限制

| 项           | 现状                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| 重定向       | `redirect: 'manual'`，不自动跟随                                                                              |
| 禁用的请求头 | `host`、`origin`、`connection`、`content-length`、`te`、`transfer-encoding`、`upgrade`、`proxy-authorization` |
| 允许的方法   | `GET/POST/PUT/PATCH/DELETE/HEAD`                                                                              |
| 超时         | 默认 30 秒，上限 10 分钟                                                                                      |
| 请求体       | JSON / text / form，体量上限在主进程侧约束                                                                    |
| DNS 重绑定   | 已解析后校验 IP（`lookup({ all: true })`）                                                                    |

需要注意的地方：

- 白名单按 **origin** 匹配（协议+主机+端口），端口不同要分别登记。
- 私有地址判定与 DNS 解析是两次独立判断，中间存在理论上的 TOCTOU 窗口
  （解析通过后实际连接到别的地址）。Electron `net.fetch` 不做连接后校验。
  对本项目的使用场景（本机网关）风险很低；若将来面向不可信插件，
  建议改为在 socket 层做 IP 校验或在连接前固定解析结果。
- `addOrigin()` 静默忽略非法 URL（因为非法端点会在 provider 构造请求时报错），
  所以白名单里出现“看似登记了但没生效”时，先确认 URL 能被 `new URL()` 解析。

## 维护指引

### 新增私有端点字段名

若插件用别的键名存端点（比如 `serverUrl`），必须在
`configuredProviderOrigins()` 的字段列表里追加，否则该插件仍被拦截。
不要为了省事改成“插件请求任何私有地址都放行”。

### 新增内置私有服务

在 `configuredProviderOrigins()` 的内置分支里增加对应 `serviceName` 的
规范化函数（参考 `normalizeOllamaBaseUrl`），保持只登记 origin。

### 排查顺序

1. 确认错误信息是 `not allowed: <host>`（白名单问题）
   还是 `resolved to a blocked address`（DNS 解析问题）
2. 打印 `configuredProviderOrigins()` 的前后快照，确认目标 origin 是否在其中
3. 确认实例**在**对应的 `*_service_list` 里——白名单只遍历已登记的实例
4. 确认实例配置里端点字段名在受支持列表内

### 测试

相关测试在 `tests/` 下（契约测试可通过 `pnpm test:contracts` 运行）。
修改该函数后至少验证：

- 未登记私有端点 → 被拒
- 已登记私有端点 → 放行
- 公网地址 → 放行且不受影响
- 非法 URL → 明确报错而非静默放行
