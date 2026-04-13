# qwen-proxy — 兼容 OpenAI 的 Qwen 模型代理服务器

支持 opencode、crush、claude code router、roo code、cline 以及任何兼容 OpenAI API 的工具。具备工具调用和流式响应支持。

> **新功能** — 极简终端 UI，完整鼠标支持 — 轻量级，低资源占用
>
> **新功能** — TUI 主题：**dark**（深色）、**light**（浅色）、**amber**（琥珀色）、**contrast**（高对比）。可在 **设置** 中更改或按 **t** 键切换。主题保存到 `~/.local/share/qwen-proxy/config.json`
>
> **新功能** — TUI 选择样式：**solid**（实色）或 **transparent**（透明）。透明模式保持行颜色可见，并使用粗体行 + 左侧强调标记
>
> **新功能** — `coder-model` 现在指向 **Qwen 3.6 Plus**（Qwen 团队更新了别名）。`qwen3.5-plus` 需要 Coding Plan 订阅，无法在 OAuth 账户下使用

[Discord 社区](https://discord.gg/6S7HwCxbMy)

**重要提示：** 用户可能在 130k-150k+ token 上下文时遇到 504 / 超时错误 — 这是 Qwen 上游限制。

无服务器/边缘计算替代方案：[qwen-worker-proxy](https://github.com/aptdnfapt/qwen-worker-proxy)

---

## 快速开始

### 方式 1：npm（全局安装）（推荐）

```bash
npm install -g qwen-proxy
```

```bash
qwen-proxy 

# 然后从 TUI 添加账户，完整鼠标支持
```

或无头模式（后台/服务器模式）：
```bash
qwen-proxy serve --headless
```

将客户端指向 `http://localhost:8080/v1`。API 密钥可以是任意字符串。

---

### 方式 2：Docker（手动构建）

```bash
git clone https://github.com/aptdnfapt/qwen-code-oai-proxy
cd qwen-code-oai-proxy
cp .env.example .env
docker compose up -d
```

容器从主机挂载 `~/.qwen` — 添加的账户会被运行中的容器**无需重启**立即识别。

容器运行时添加账户：
```bash
docker compose exec qwen-proxy node dist/src/cli/qwen-proxy.js auth add myaccount
```

将客户端指向 `http://localhost:8080/v1`。

---

### 方式 3：本地/开发环境

```bash
npm install
npm run auth:add myaccount
qwen-proxy serve
# 或无头模式：
npm run serve:headless
```

---

## CLI 命令

```bash
qwen-proxy serve                  # TUI 仪表板
qwen-proxy serve --headless       # 无头服务器

qwen-proxy auth list
qwen-proxy auth add <account-id>
qwen-proxy auth remove <account-id>
qwen-proxy auth counts
qwen-proxy usage
```

---

## 开发测试辅助

对于新机器回归测试，使用内置的 clean-home 检查而不是临时 shell 探测：

```bash
npm run test:auth-clean-home
npm run test:first-run
npm run test:install-smoke
```

这些脚本使用临时 `HOME` 运行编译后的代码，因此可以模拟新机器而不会触碰真实的 `~/.qwen` 或本地使用数据库。

更多详情：`docs/testing-clean-home.md`

---

## 多账户支持

最简单的添加账户方式是从 TUI — 运行 `qwen-proxy`，进入 **Accounts**（账户）标签页，从那里添加。

也可以通过 CLI 添加：

```bash
qwen-proxy auth add account1
qwen-proxy auth add account2
qwen-proxy auth add account3
```

**轮转工作原理：**
- 请求在所有有效账户间轮询（round-robin）
- Token 在过期前自动刷新
- 认证失败 → 一次刷新尝试 → 轮转到下一个账户
- 临时故障（429、500、超时）→ 轮转到下一个账户，无需冷却期
- 客户端错误（错误负载等）→ 立即返回，不轮转
- `DEFAULT_ACCOUNT` 环境变量 → 优先尝试该账户
- 请求计数在 UTC 午夜重置

**Docker 用户：**
```bash
docker compose exec qwen-proxy node dist/src/cli/qwen-proxy.js auth list
docker compose exec qwen-proxy node dist/src/cli/qwen-proxy.js auth add <account-id>
docker compose exec qwen-proxy node dist/src/cli/qwen-proxy.js auth remove <account-id>
```

---

## 支持的模型

| 模型 ID | 描述 | 最大 Token | 备注 |
|----------|-------------|------------|-------|
| `coder-model` | **推荐** — Qwen 3.6 Plus（别名，Qwen 自动更新） | 65536 | 默认，最适合编程 |
| `qwen3.5-plus` | 别名 → 解析为 `coder-model` | 65536 | 为向后兼容保留 |
| `qwen3.6-plus` | 别名 → 解析为 `coder-model` | 65536 | |
| `qwen3-coder-plus` | Qwen 3 Coder Plus | 65536 | |
| `qwen3-coder-flash` | Qwen 3 Coder Flash | 65536 | 更快，更轻量 |
| `vision-model` | 多模态，支持图像 | 32768 | Token 限制较低，自动钳制 |

> **注意：** `coder-model` 是 Qwen 维护的别名。之前是 Qwen 3.5 Plus，现在更新为 Qwen 3.6 Plus。`qwen3.5-plus` 和 `qwen3.6-plus` 都解析为 `coder-model`。

---

## 支持的端点

- `POST /v1/chat/completions` — 聊天补全（流式 + 非流式）
- `GET /v1/models` — 列出可用模型
- `POST /v1/web/search` — 网络搜索（免费 2000 次/天）
- `GET/POST /mcp` — MCP 服务器（SSE 传输）
- `GET /health` — 健康检查

---

## 使用示例

### JavaScript / Node.js
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'fake-key',
  baseURL: 'http://localhost:8080/v1'
});

const response = await openai.chat.completions.create({
  model: 'coder-model',
  messages: [{ role: 'user', content: '你好！' }]
});

console.log(response.choices[0].message.content);
```

### curl
```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fake-key" \
  -d '{
    "model": "coder-model",
    "messages": [{"role": "user", "content": "你好！"}],
    "temperature": 0.7,
    "max_tokens": 200,
    "reasoning": {"effort": "high"}
  }'
```

> `effort` 可以是 `"high"`、`"medium"`、`"low"` 或 `"none"`（禁用思考）。

### 流式响应
```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fake-key" \
  -d '{
    "model": "coder-model",
    "messages": [{"role": "user", "content": "解释如何在 JavaScript 中反转字符串。"}],
    "stream": true,
    "max_tokens": 300,
    "reasoning": {"effort": "medium"}
  }'
```

---

## 网络搜索 API

免费网络搜索 — 1000 次请求/账户/天：

```bash
curl -X POST http://localhost:8080/v1/web/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fake-key" \
  -d '{"query": "最新的 AI 发展", "page": 1, "rows": 5}'
```

---

## AI Agent 配置

### opencode

添加到 `~/.config/opencode/opencode.json`：

> `effort` 可以是 `"high"`、`"medium"`、`"low"` 或 `"none"`（禁用思考）。在 opencode 中通过 ctrl-t 快捷键更改
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "qwen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "proxy",
      "options": {
        "baseURL": "http://localhost:8080/v1"
      },
      "models": {
        "coder-model": {
          "name": "qwen3.6-plus" ,
           "reasoning": true,
          "modalities": {
          "input": [
            "text",
            "image"
          ],
          "output": [
            "text"
          ]
        },
            "attachment": true,
        "limit": {
          "context": 195000,
          "output": 60000
          }

        }
      }
    }
  }
}
```

### crush

添加到 `~/.config/crush/crush.json`：
```json
{
  "$schema": "https://charm.land/crush.json",
  "providers": {
    "proxy": {
      "type": "openai",
      "base_url": "http://localhost:8080/v1",
      "api_key": "",
      "models": [
        {
          "id": "coder-model",
          "name": "coder-model",
          "cost_per_1m_in": 0.0,
          "cost_per_1m_out": 0.0,
          "cost_per_1m_in_cached": 0,
          "cost_per_1m_out_cached": 0,
          "context_window": 150000,
          "default_max_tokens": 32768
        }
      ]
    }
  }
}
```

### Claude Code Router
```json
{
  "LOG": false,
  "Providers": [
    {
      "name": "qwen-code",
      "api_base_url": "http://localhost:8080/v1/chat/completions/",
      "api_key": "any-string",
      "models": ["coder-model"],
      "transformer": {
        "use": [
          ["maxtoken", {"max_tokens": 32768}],
          "enhancetool",
          "cleancache"
        ]
      }
    }
  ],
  "Router": {
    "default": "qwen-code,coder-model"
  }
}
```

### Roo Code / Kilo Code / Cline

1. 进入设置 → 选择 OpenAI Compatible
2. 设置 URL：`http://localhost:8080/v1`
3. API 密钥：任意随机字符串
4. 模型：`coder-model`
5. 禁用流式复选框（Roo Code / Kilo Code）
6. 最大输出：`32000`
7. 上下文窗口：最高 300k（但超过 150k 会变慢）

### MCP（网络搜索工具）

添加到 `~/.config/opencode/config.json`：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "qwen-web-search": {
      "type": "remote",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

如果没有设置 API 密钥，省略 `headers`。也适用于其他 MCP 客户端。

---

## API 密钥认证

```bash
# 单个密钥
API_KEY=your-secret-key

# 多个密钥
API_KEY=key1,key2,key3
```

支持的请求头：
- `Authorization: Bearer your-secret-key`
- `X-API-Key: your-secret-key`

如果未配置 API 密钥，则不需要认证。

---

## 配置

通过环境变量或 `.env` 文件设置：

| 变量 | 默认值 | 描述 |
|----------|---------|-------------|
| `PORT` | `8080` | 服务器端口 |
| `HOST` | `localhost` | 绑定地址（Docker 使用 `0.0.0.0`） |
| `API_KEY` | — | 逗号分隔的认证密钥 |
| `DEFAULT_ACCOUNT` | — | 优先使用的账户 |
| `LOG_LEVEL` | `error-debug` | `off` / `error` / `error-debug` / `debug` |
| `MAX_DEBUG_LOGS` | `20` | 保留的最大请求调试目录数 |
| `QWEN_PROXY_HOME` | `~/.local/share/qwen-proxy` | 覆盖运行时数据目录 |
| `QWEN_PROXY_LOG_DIR` | — | 覆盖日志目录 |

兼容别名：`DEBUG_LOG=true` → `LOG_LEVEL=debug`，`LOG_FILE_LIMIT` → `MAX_DEBUG_LOGS`

`.env` 示例：
```bash
LOG_LEVEL=debug
MAX_DEBUG_LOGS=10
API_KEY=your-secret-key
DEFAULT_ACCOUNT=my-primary-account
```

端口和主机也可以从 TUI 设置屏幕更改，并自动保存到 `config.json`。

---

## 存储

| 路径 | 内容 |
|------|----------|
| `~/.qwen/oauth_creds_<id>.json` | 账户凭证 |
| `~/.local/share/qwen-proxy/usage.db` | 请求 + Token 使用（SQLite） |
| `~/.local/share/qwen-proxy/config.json` | 端口、主机、日志级别、自动启动 |
| `~/.local/share/qwen-proxy/log/` | 错误日志 |

---

## 健康检查

```bash
curl http://localhost:8080/health
```

返回服务器状态、账户验证、Token 过期信息、请求计数。

---

## 使用追踪

```bash
qwen-proxy usage
# 或
npm run usage
npm run tokens
```

显示每日 Token 使用量、缓存命中、每个账户的请求计数。也可在 TUI 使用屏幕查看。

---

## 运行时日志级别

无需重启即可实时更改：
```bash
# 查看当前级别
GET /runtime/log-level

# 更改
POST /runtime/log-level
{"level": "debug"}

# 更改但不持久化
POST /runtime/log-level
{"level": "error", "persist": false}
```
