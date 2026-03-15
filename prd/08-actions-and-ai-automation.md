# Actions 与 Agent Runtime PRD

## 1. 模块定位

Actions 模块把"任务触发"转换成"可追踪执行"。整个模块完全运行在 Cloudflare 生态内，不依赖任何外部计算、存储或队列服务。

- workflow 决定何时创建 session。
- session 决定何时调用 runtime。
- session 也负责把一次执行沉淀为可回看的任务上下文。

当前产品视角里，session 是核心对象，workflow 是触发机制。

当前实现已经去掉旧的 action run 兼容层：

- 前后端接口统一返回 `session`，不再额外包装 `run` 字段。
- 日志流事件统一使用 `session` / `sessionId`。
- Issue、PR、评论和 workflow dispatch 全部直接关联 agent session。
- `action_workflows` 只保留 workflow 定义本身，不再保留旧的 `command` 列。

## 2. Cloudflare 基础设施映射

整个 Actions 模块的每一层职责都由特定的 Cloudflare 原语承担，不允许引入 Cloudflare 生态外的计算或存储依赖。

| Cloudflare 原语 | 模块内职责 | 绑定名 |
| --- | --- | --- |
| Worker | API 层、触发编排、执行协调、MCP endpoint | 主 Worker |
| D1 | workflow 配置、session / attempt / event 元数据 | `DB` |
| R2 | 全量日志、全文 artifact | `ACTION_LOGS_BUCKET` |
| Queue | session 执行调度，解耦触发与执行 | `ACTIONS_QUEUE` |
| Durable Object (Container) | agent runtime 容器，按实例规格绑定不同 DO namespace | `ACTIONS_RUNNER*` |
| Durable Object | 仓库级 Git 状态（非 Actions 专属，但 Actions 依赖其 clone/checkout） | `REPOSITORY_OBJECTS` |
| Observability | Worker 级日志与 trace | 全局启用 |

### 2.1 基础设施约束

- **无外部数据库**：所有结构化数据必须存 D1。D1 单行 1MB、单次查询 5ms 目标、无 JOIN 性能保障。
- **日志只存 R2**：所有日志（包括 excerpt 和全量）只允许存 R2，不允许存 D1。D1 只保留 session/attempt 的状态与元数据索引，不保留任何日志内容。
- **无外部对象存储**：日志和 artifact 全文存 R2。R2 无列表性能保障——因此必须在 D1 维护索引。
- **无外部队列**：调度完全依赖 Cloudflare Queues。Queue 消息至少投递一次——因此 consumer 必须幂等（用 attempt claim 机制去重）。
- **无外部容器编排**：agent runtime 由 Cloudflare Containers 承担，每个实例规格对应独立的 DO class 和 binding。不使用 Kubernetes、ECS 或任何外部容器服务。
- **无长连接服务器**：Worker 不支持持久 TCP/WebSocket 服务端。日志流使用 SSE（Server-Sent Events）或轮询，不依赖 WebSocket 推送。
- **无 SSH 协议**：Worker 无法监听 SSH。Git 接入和 agent clone 均走 HTTP。

## 3. 架构分层

### 3.1 配置层

- 全局 Actions 配置（`global_settings`）
- 仓库级 Actions 配置（`repository_actions_configs`）
- 仓库级配置覆盖全局配置；缺省时回退全局值
- 实例规格选择：`lite` / `basic` / `standard-1` / `standard-2` / `standard-3` / `standard-4`
- 每个实例规格对应 `wrangler.jsonc` 中独立的 Container 定义和 DO binding
- 支持注入 `codex` 和 `claude_code` 的配置文件内容

### 3.2 触发层

用户可配置的 workflow trigger：

- `issue_created`
- `pull_request_created`
- `push`

系统内部 trigger：

- `mention_actions`

补充约束：

- `mention_actions` 只允许由系统内部创建，不出现在用户可配置的 workflow trigger 选择器中。

Session 入口（均创建新 session，不附着旧 session）：

- workflow 自动触发
- `@actions` mention
- issue assign
- issue resume
- PR resume
- session rerun
- workflow dispatch

### 3.3 调度层（Queue）

```
触发 → 创建 session + 首个 queued attempt → enqueue 到 ACTIONS_QUEUE
                                                    ↓
                                          Queue consumer 拉取消息
                                                    ↓
                                          claim attempt（幂等去重）
                                                    ↓
                                          按 instance_type 选择 DO namespace
                                                    ↓
                                          调用 Container DO.fetch(/execute)
```

- 消息格式：`{ repositoryId, sessionId, attemptId, requestOrigin }`
- consumer 以 batch 消费（`max_batch_size: 10`，`max_batch_timeout: 5s`）
- 成功处理后 ack；异常时依赖 Queue 自动重投递
- claim 机制保证同一 attempt 不被重复执行
- consumer 只负责 claim、组装配置并触发 Container `/execute`；不持有贯穿整个执行期的长连接

### 3.4 执行层（Containers）

Container 是 Cloudflare Containers（基于 Durable Object 的容器原语），不是独立的容器编排系统。

**Container 生命周期与 session 状态协同：**

- Container `onStart` → attempt 推进到 `running`，session 推进到 `running`
- Container `onStop` / `onError` → 若 attempt 尚未完成，补写失败结果
- Container `onActivityExpired` → 视为心跳中断，停止容器并走 `onStop` 收敛
- 不依赖容器内状态服务对外暴露状态供平台轮询

**Container 内部（`containers/actions-runner/server.ts`）：**

- HTTP 服务暴露 `/execute`、`/stop`、`/healthz`，以及 DO 内部使用的 `/verify-callback-secret`、`/callback`
- DO `/execute` 只负责拉起容器、签发 callback secret 并异步触发容器内 `/run`，成功启动后立即返回 `{ started: true }`
- 容器内 `/run` 接收 RunRequest 后：
  - clone 仓库（HTTP Git，使用平台签发的临时 clone token）
  - checkout 指定 ref/sha
  - 写入 agent 配置文件（codex → `.codex/config.toml`，claude_code → `.claude/settings.json`）
  - 注册平台 MCP server（`gits-platform`）
  - 注入环境变量和 token
  - spawn agent 进程
  - 定期向平台 Worker API 发送 heartbeat callback
  - 完成后发送 completion callback（附带 result / artifact 元数据）
  - callback 与兼容流模式中的 stdout/stderr 均保留完整输出，不在 runtime 进程内截断
  - 迁移期内若未提供 callback 字段，则回退到 legacy NDJSON stream，仅用于兼容旧调用方
- Worker API 收到 callback 后先调用 Container DO `/verify-callback-secret` 校验 `callbackSecret`
- heartbeat 仅在校验通过后调用 Container DO `/keepalive` 续租 activity timeout
- completion 仅在校验通过后完成 attempt/session 收敛，并调用 Container DO `/callback` + `/stop`
- 执行完成后 container 保持 10 分钟待命，然后释放

**实例规格与 DO namespace 映射：**

| 实例规格 | DO class | binding |
| --- | --- | --- |
| `lite` | `ActionsContainer` | `ACTIONS_RUNNER` |
| `basic` | `ActionsContainerBasic` | `ACTIONS_RUNNER_BASIC` |
| `standard-1` | `ActionsContainerStandard1` | `ACTIONS_RUNNER_STANDARD_1` |
| `standard-2` | `ActionsContainerStandard2` | `ACTIONS_RUNNER_STANDARD_2` |
| `standard-3` | `ActionsContainerStandard3` | `ACTIONS_RUNNER_STANDARD_3` |
| `standard-4` | `ActionsContainerStandard4` | `ACTIONS_RUNNER_STANDARD_4` |

Container DO 实例命名：`agent-session-{sessionId}-attempt-{attemptNumber}`

### 3.5 记录层（D1 + R2）

**D1 存储（元数据，不存日志）：**

| 表 | 职责 |
| --- | --- |
| `agent_sessions` | session 级状态、来源、分支、workflow、failure reason/stage（不含 `logs` 列） |
| `agent_session_attempts` | attempt 级生命周期（queued → running → 终态）、实例规格、升配来源 |
| `agent_session_attempt_events` | attempt 事件流（warning、retry_scheduled 等结构化事件，不存日志 chunk） |
| `agent_session_attempt_artifacts` | attempt 级 artifact 索引（session_logs、stdout、stderr 的 R2 key，按 attempt + kind 唯一） |

**R2 存储（所有日志与 artifact 内容）：**

- 所有日志（含摘要和全量）和 artifact 全文按 session/attempt 组织存入 `ACTION_LOGS_BUCKET`
- 前端从 R2 拉取日志内容，D1 只提供索引和状态查询
- Actions 页与会话工作区的分页标签在移动端支持横向滚动，避免会话 / 工作流 / 运行时切换被压缩换行

### 3.6 平台 MCP 层

平台 Worker 直接承载 MCP endpoint（`/api/mcp`），不在 container 镜像内打包独立 MCP server。

**当前 MCP tools：**

- `gits_issue_reply` — 回复 Issue 评论
- `gits_create_pull_request` — 创建 PR（支持关联 closing issues）

**接入方式：**

| 调用方 | 认证方式 | 说明 |
| --- | --- | --- |
| actions runtime（容器内 agent） | 平台签发的临时 token | 评论与建 PR 以 actions 身份回写 |
| 本地 agent（用户机器） | 用户自建 token | 不复用平台临时 token |

MCP server 在 container 内注册为 `gits-platform`，agent 通过 HTTP 调用平台 `/api/mcp`。

## 4. 执行模型

### 4.1 Session 状态

`queued` → `running` → `success` / `failed` / `cancelled`

Session 状态由平台 Worker 与 Container 生命周期协同推进，不由容器内 HTTP 状态接口回传。

- 用户主动 cancel 支持 `queued` 和 `running` session；对 `running` session，平台先锁定 session/attempt 为 `cancelled`，再向对应 container 发送 `/stop`。

### 4.2 Attempt 模型

每个 session 可包含多个 attempt（当前最多 2 次）。

**Attempt 状态：**

`queued` → `booting` → `running` → `success` / `failed` / `retryable_failed` / `cancelled`

**重试与升配：**

- boot 阶段的 container / DO internal error 归类为可重试失败
- 重试时可自动升配实例规格（`lite → basic → standard-1 → ...`）
- `promoted_from_instance_type` 记录升配来源
- 没有拿到 started 信号时不写入 `started_at`

**失败分类：**

| 维度 | 枚举值 |
| --- | --- |
| failure_reason | `boot_timeout`、`container_error`、`dockerd_bootstrap_failed`、`stream_disconnected`、`missing_result`、`workspace_preparation_failed`、`git_clone_failed`、`git_checkout_failed`、`agent_exit_non_zero`、`storage_write_failed`、`cancel_requested`、`unknown_infra_failure`、`unknown_task_failure` |
| failure_stage | `boot`、`workspace`、`runtime`、`result`、`logs`、`side_effects`、`unknown` |

### 4.3 日志流

- 未展开日志的 pending session：后台轮询 session 状态（D1），需要日志时从 R2 拉取
- 已展开且仍在运行的 session：建立 SSE 日志流，流关闭或报错后回退后台 refresh
- 流式日志的本地状态与服务端状态冲突时，前端优先以服务端终态收敛

## 5. 关键流程

### 5.1 自动 workflow

1. issue 创建、PR 创建或 push 发生
2. Worker 匹配启用的 workflow（push 支持 branch/tag regex）
3. 创建 session + 首个 queued attempt
4. enqueue 到 `ACTIONS_QUEUE`
5. Queue consumer claim attempt → 选择 DO namespace → 调用 Container `/execute`
6. 容器运行时主动 callback heartbeat / completion → Worker 通过 heartbeat keepalive 容器，并在 completion 时写入 attempt events（D1）+ flush 日志到 R2 + stop DO
7. 执行完成 → complete attempt → sync terminal session → 触发 source 状态回流

### 5.2 交互式继续

1. 用户从 Issue、PR 或 review thread 触发继续
2. 创建内部 workflow 对应的 session 和首个 attempt
3. prompt 带入 Issue/PR/Review 上下文、验收标准和 token
4. 执行结果以 handoff 摘要回流到 Issue / PR

### 5.3 观测与回看

1. Actions 页以 session 为主视图，支持筛选、查看日志、rerun
2. Issue / PR 跳到 Actions 页时用 `sessionId` 锚定
3. Session detail 展示 attempts、attempt events、artifacts、timeline、prompt
4. 全文日志和全文 artifact 按需从 R2 读取，按最新 attempt 组织

当前仓库内的 Actions 页面已经重写为三段结构：

- `sessions`：左侧列表 + 右侧 session workspace，用于查看日志、attempt、artifact、cancel、rerun。
- `workflows`：workflow 列表 + sheet 编辑器，用于创建、编辑、启停、dispatch；仅暴露 `issue_created` / `pull_request_created` / `push`。
- `runtime`：仓库级实例规格与 agent 配置覆盖。

### 5.4 摘要回流

- Issue 与 PR 页面消费最近 session 的摘要
- validation summary 优先消费 structured validation report（从 attempt events 提取）
- 缺失 structured report 时回退到日志中的 tests/build/lint 命令模式识别
- 支持 `skipped`、`partial`、scoped multi-step checks、highlighted artifacts 优先级排序
- 回流失败不覆盖 session 原始结果，留 warning 供排障

## 6. 接口

- `ALL /api/mcp`
- `GET /api/settings/actions`
- `PATCH /api/settings/actions`
- `GET /api/repos/:owner/:repo/actions/config`
- `PATCH /api/repos/:owner/:repo/actions/config`
- `GET /api/repos/:owner/:repo/actions/workflows`
- `POST /api/repos/:owner/:repo/actions/workflows`
- `PATCH /api/repos/:owner/:repo/actions/workflows/:workflowId`
- `POST /api/repos/:owner/:repo/actions/workflows/:workflowId/dispatch`
- `GET /api/repos/:owner/:repo/agent-sessions`
- `GET /api/repos/:owner/:repo/agent-sessions/latest`
- `GET /api/repos/:owner/:repo/agent-sessions/latest-by-comments`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/logs`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/logs/stream`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/timeline`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts/:artifactId/content`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/cancel`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/rerun`
- `POST /api/internal/container-callback`

其中：

- `GET .../:sessionId` 返回 `attempts`、`activeAttempt`、`latestAttempt`、`events`、`artifacts`、`validationSummary`
- `GET .../pulls/:number/provenance` 和 `GET .../pulls/provenance/latest` 复用同一套 session detail 结构
- `POST /api/internal/container-callback` 只接收 container runtime 的 `heartbeat` / `completion` 回调；Queue consumer 在 `/execute` 返回 `started: true` 后立即结束，不再阻塞等待执行完成

## 7. 数据模型

- `global_settings`
- `repository_actions_configs`
- `action_workflows`
- `agent_sessions`
- `agent_session_attempts`
- `agent_session_attempt_events`
- `agent_session_attempt_artifacts`

## 8. 关键代码文件

- `src/services/actions-service.ts`
- `src/services/action-prompt-builders.ts`
- `src/services/action-trigger-service.ts`
- `src/services/action-runner-service.ts`
- `src/services/action-container-callback-service.ts`
- `src/services/action-run-queue-service.ts`
- `src/services/agent-session-service.ts`
- `src/services/agent-session-validation-summary.ts`
- `src/services/platform-mcp-service.ts`
- `src/actions/actions-container.ts`
- `containers/actions-runner/server.ts`
- `src/routes/api/index.ts`
- `src/routes/api/platform-routes.ts`
- `src/routes/api/actions-routes.ts`
- `src/routes/api/actions-callback-routes.ts`
- `src/routes/api/actions-workflow-routes.ts`
- `src/routes/api/actions-session-routes.ts`
- `src/routes/api/shared.ts`
- `src/routes/api/actions-routes.test.ts`
- `docs/MCP.zh-CN.md`
- `web/src/pages/repository-actions-page.tsx`
- `web/src/pages/agent-session-detail-page.tsx`
- `web/src/components/repository/repository-actions-sessions-panel.tsx`
- `web/src/components/repository/repository-actions-session-workspace.tsx`
- `web/src/components/repository/repository-actions-workflows-panel.tsx`
- `web/src/components/repository/repository-actions-workflow-sheet.tsx`
- `web/src/lib/agent-session-utils.ts`
- `web/src/lib/validation-summary.ts`
- `web/src/components/ui/monaco-text-viewer.tsx`
- `web/src/lib/monaco.ts`

## 9. 边界与缺口

### 9.1 Cloudflare 生态边界已明确

- 计算：Worker + Containers，不引入外部 FaaS 或 VM。
- 存储：D1 + R2，不引入外部数据库或对象存储。
- 调度：Queues，不引入外部消息队列。
- 容器：Cloudflare Containers（DO-based），不引入外部容器编排。

### 9.2 validation summary 仍需更面向评审

- 已有 structured report、fallback 规则、highlighted artifacts。
- 对"这次到底测了什么、该先看什么、为什么还需要人类判断"的表达仍可继续增强。

### 9.3 session 连续性表达仍不足

- 已有 issue assign/resume、PR resume、thread-focused resume、rerun、dispatch。
- 还缺更清晰的"这次 session 在延续哪条反馈、完成了什么"的压缩摘要。

### 9.4 输入上下文仍偏弱

- runtime 已能执行。
- session 开始前仍缺代码搜索、相关文件候选、review thread 摘要和更稳定的上下文 bundle。

### 9.5 本地 agent 接入仍缺产品化入口

- 平台 MCP endpoint 已可复用给本地 agent。
- 用户如何发现 endpoint、如何选择 token、如何管理 token 粒度，仍需后续产品入口承接。

## 10. 下一步优先级

1. 继续沉淀更面向评审的 validation 和 artifact 摘要。
2. 增强 session 的 resume / continue / handoff 语义，而不是增加更多分散入口。
3. 为 runtime 补上更好的任务上下文输入整理能力。
4. 为本地 agent 补更清晰的接入入口与 token 权限管理体验。
