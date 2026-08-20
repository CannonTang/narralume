# 配置

配置分成两层：产品界面中的渠道、模型和岗位派任，决定“这个项目怎样调用模型”；服务端环境变量决定“Server、数据库、备份和网络怎样运行”。先完成界面配置，再根据运行方式补充环境变量，排查会简单很多。

## 界面配置：从渠道到默认模型

打开“设置”，展开“渠道与模型管理”，按以下顺序操作：

1. **新建模型渠道**：填写渠道名称、协议、`Base URL` 和密钥。密钥字段也接受 `env:NAME`，表示从运行 Server 的环境变量读取，不把密钥写进数据库。
2. **新建模型**：填写上游模型名、上下文上限和输出上限。这里的模型名必须是上游实际接受的值；产品内显示名只是帮助识别。
3. **派任岗位**：在“默认生成模型”中选择刚创建的模型。写作、规划和审稿默认共用它；只有确实需要不同模型时才覆盖规划或审稿岗位。嵌入模型独立配置，用于语义检索，不参与正文生成。
4. **先用手写链路验收**：回到书架建一部空白作品，确认故事、大纲和写作台可用，再发起一次最小 AI 编辑提案。这样可以把模型连通问题与产品数据问题分开。

支持的上游协议是 OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages。不同协议的 Base URL、鉴权头和请求路径由渠道类型处理；不要把一个只支持 Anthropic 的地址登记成 OpenAI Chat 渠道。

## 浏览器内核与本地 Server 的区别

| 调用方         | 密钥保存位置                                | 上游要求                                | 适用场景                     |
| -------------- | ------------------------------------------- | --------------------------------------- | ---------------------------- |
| 浏览器本地内核 | 当前站点 OPFS 数据库                        | 上游允许浏览器 CORS                     | 在线体验、单机浏览器本地优先 |
| 本地 Server    | Server 环境变量或本地数据库                 | Server 能访问上游；不受浏览器 CORS 影响 | 桌面发行包、源码生产启动     |
| Docker Server  | `.env.local`、挂载数据库或 Compose 环境变量 | 容器能访问上游                          | 本机或自托管                 |

浏览器站点和本地 Server 是两个独立的数据驱动。把密钥配置在一个模式中不会自动出现在另一个模式里。在线体验清理站点数据前，先从设置下载完整 SQLite 库。

## 服务端环境变量

复制模板并仅在本机保存：

```bash
cp .env.example .env.local
```

`.env.local` 不得提交到 Git。常用变量如下：

| 变量                                                               | 默认值/范围                  | 作用                                                       |
| ------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------- |
| `NARRATIVE_LLM_BASE_URL`                                           | `https://api.example.com/v1` | 默认模型渠道的 Base URL，占位值必须替换                    |
| `NARRATIVE_LLM_API_KEY`                                            | 空                           | 默认模型渠道密钥；也可使用协议专属变量                     |
| `NARRATIVE_LLM_MODEL`                                              | 空                           | 默认上游模型名                                             |
| `NARRATIVE_LLM_CONTEXT_WINDOW` / `NARRATIVE_LLM_MAX_OUTPUT_TOKENS` | 空                           | 默认模型的上下文和输出上限元数据                           |
| `NARRATIVE_CHAT_*`                                                 | 空                           | OpenAI Chat 协议覆盖项                                     |
| `NARRATIVE_RESPONSES_*`                                            | 空                           | OpenAI Responses 协议覆盖项                                |
| `NARRATIVE_ANTHROPIC_*`                                            | 空                           | Anthropic Messages 协议覆盖项                              |
| `NARRATIVE_EMBEDDING_MODEL`                                        | 空                           | 可选的 OpenAI 兼容嵌入模型；未设置时使用全文与实体信号检索 |
| `NARRATIVE_MODEL_PRICING_JSON`                                     | 空                           | 可选的模型计价元数据，用于运行成本估算                     |
| `NARRATIVE_DATA_DIR`                                               | `./data`                     | SQLite 数据库目录                                          |
| `NARRATIVE_BACKUP_DIR`                                             | `./data/backups`             | 一致性备份目录，建议放到独立磁盘或同步目录                 |
| `NARRATIVE_BACKUP_RETENTION`                                       | `10`，范围 1-100             | 自动保留的备份数量                                         |
| `NARRATIVE_BACKUP_INTERVAL_MINUTES`                                | `360`，范围 5-43200          | 自动备份间隔                                               |
| `NARRATIVE_BACKUP_ON_STARTUP`                                      | `false`                      | Server 启动时是否立即备份                                  |
| `NARRATIVE_SERVER_HOST`                                            | `127.0.0.1`                  | 监听地址；远程监听需要额外安全配置                         |
| `NARRATIVE_SERVER_PORT`                                            | `4317`                       | API/生产同源服务端口                                       |
| `NARRATIVE_ALLOW_REMOTE`                                           | `false`                      | 是否允许非回环访问；公网前必须配置令牌和 TLS               |
| `NARRATIVE_AUTH_TOKEN`                                             | 空                           | 远程访问令牌，至少 24 个字符                               |
| `NARRATIVE_STATIC_DIR`                                             | 空                           | 生产模式托管 Web 静态文件的目录                            |

本地发行包启动器另有三个只影响启动器的变量：`NARRALUME_PORT` 修改本地监听端口，`NARRALUME_DATA_DIR` 修改数据目录，`NARRALUME_NODE_VERSION` 指定便携 Node.js 版本。它们不是 Server 的通用环境变量；Windows、macOS 和 Linux 启动器会把最终值传给 Server。普通使用通常只需要前两个。

## Docker 的特殊变量

Compose 使用 `.env.local` 和 shell 环境：

- `NARRATIVE_AUTH_TOKEN`：默认示例值只适合本机试用；离开本机前必须替换为高熵令牌。
- `NARRATIVE_WEB_BIND_HOST`：默认 `127.0.0.1`。改为 `0.0.0.0` 等于把 Web 端口发布到所有网卡，不应在没有 TLS、网络 ACL 和独立备份时操作。
- `NARRATIVE_BACKUP_HOST_DIR`：宿主机独立备份目录，默认 `./data/backups`，映射到容器 `/app/backups`。

Docker Server 在容器内部以 `0.0.0.0` 监听并启用远程模式，这是容器网络需要；宿主机只通过 Web/Nginx 访问，Server 端口不直接发布。

## Bridge / Relay

Bridge 和 Relay 是可选的通用上游代理。普通用户不需要它们：浏览器模式可以直接调用允许 CORS 的上游，本地 Server 或 Docker 可以直接在服务端调用上游。只有维护公开在线体验，并且需要让 Cloudflare Relay 访问维护者本机或私有网络里的模型服务时，才需要在本机运行 Bridge。

这条高级链路是：`浏览器 → Web → Relay → Tunnel/Access → 本机 Bridge → 上游模型`。Bridge 只负责转发，不是作品数据库、账号系统或普通用户的必需后端；部署者仍需自己定义域名、来源白名单、限流、日志和密钥注入。

Bridge 需要下列变量：

```text
UPSTREAM_BASE_URL=https://api.example.com/v1
UPSTREAM_API_KEY=replace-me
UPSTREAM_MODEL=replace-me
BRIDGE_SHARED_SECRET=replace-with-at-least-24-characters
BRIDGE_PORT=4320
BRIDGE_MAX_CONCURRENCY=8
BRIDGE_UPSTREAM_TIMEOUT_MS=600000
```

Relay 的公开变量指定 Bridge 地址、模型和唯一允许的 Web Origin：

```text
UPSTREAM_BASE_URL=https://api.example.com/v1
RELAY_MODEL=replace-me
WEB_ORIGIN=https://app.example.com
```

Relay 还需要通过 `wrangler secret put` 写入 `BRIDGE_ACCESS_CLIENT_ID`、`BRIDGE_ACCESS_CLIENT_SECRET`、`BRIDGE_SHARED_SECRET`、`TURNSTILE_SECRET_KEY` 和 `SESSION_SIGNING_KEY`。不要把这些值放进 `wrangler.toml`、命令行参数、截图或 Issue。

`api.example.com`、`app.example.com` 和 `replace-me` 仅为占位符。部署命令、Cloudflare Secret 写入和 smoke 检查见[通用 Cloudflare 指南](deploy-cloud.md)。

## 常见配置故障

- **模型列表有，但任务提示没有默认模型**：回到“默认生成模型”岗位重新派任；模型或渠道被停用也会解除派任。
- **浏览器提示 CORS**：确认渠道地址允许当前 Web Origin；如果使用本地 Server，确认请求走 Server 而不是浏览器直连。
- **401/403**：核对密钥来源、协议类型和上游 Base URL，不要把完整密钥粘进 Issue。
- **远程 Server 启动失败**：`NARRATIVE_ALLOW_REMOTE=true` 时必须同时设置至少 24 字符的 `NARRATIVE_AUTH_TOKEN`，并在 TLS/反向代理层做访问控制。
- **升级后环境变量不生效**：确认实际启动进程读取的是新目录的 `.env.local`，并重启 Server；运行中的进程不会自动重新加载环境变量。
