# Actions 与 Agent Runtime PRD

## 1. 模块定位

Actions 与 Agent Runtime 模块的职责是把“任务触发”转换成“可追踪执行”：

- workflow 决定何时创建 run。
- run 决定何时调用 runtime。
- session 决定如何把一次执行沉淀为可回看的任务上下文。

当前产品视角里，session 是核心对象，workflow 是触发机制。

## 2. 当前架构

### 2.1 配置层

- 全局 Actions 配置
- 仓库级 Actions 配置
- 仓库级实例规格选择：
  - `lite`
  - `basic`
  - `standard-1`
  - `standard-2`
  - `standard-3`
  - `standard-4`
- 支持注入 `codex` 和 `claude_code` 的配置文件内容

### 2.2 触发层

用户可配置的 workflow trigger：

- `issue_created`
- `pull_request_created`
- `push`

系统内部也会使用：

- `mention_actions`

当前支持的 session / run 入口包括：

- workflow 自动触发
- `@actions` mention
- issue assign
- issue resume
- PR resume
- run rerun
- workflow dispatch

### 2.3 执行层

- Queue 优先调度，无法入队时可直接执行
- Cloudflare Containers 承担 agent runtime
- 平台 Worker 直接暴露 HTTP MCP endpoint，供 actions runtime 与本地 agent 共用
- 不同实例规格使用不同 DO 绑定
- runtime 会：
  - clone 仓库
  - checkout 指定 ref/sha
  - 注入内部 token
  - 注入 agent 配置文件
  - 为 actions runtime 自动接入平台 MCP endpoint
  - 运行 agent 命令
  - 流式回传 stdout/stderr/result

### 2.4 记录层

- `action_runs` 记录 run 状态、来源、配置和 excerpt
- `agent_sessions` 记录 source、origin、branch、workflow、linked run
- `agent_session_steps`、`artifacts`、`usage_records`、`interventions` 用于沉淀执行过程
- 全量日志和全文 artifact 存在 `ACTION_LOGS_BUCKET`，D1 只保留 excerpt

### 2.5 平台 MCP 能力

- 平台直接提供 MCP tools：
  - `gits_issue_reply`
  - `gits_create_pull_request`
- actions runtime 通过平台签发的临时 token 接入这些工具
- 本地 agent 不再依赖 actions container 内嵌 MCP server，而是直接连接平台 MCP endpoint
- 本地 agent 使用用户自己在账号下创建的 token 接入；平台不为本地 agent 代发临时 token

## 3. 当前已实现能力

### 3.1 Run 与 Session

- run 状态：
  - `queued`
  - `running`
  - `success`
  - `failed`
  - `cancelled`
- session 作为一等对象存在，并可与 run 关联
- Session detail 已支持：
  - hero summary
  - source / handoff
  - validation
  - execution logs
  - timeline
  - prompt（默认折叠）

### 3.2 运行时输入

- runtime 可接收仓库 URL、ref、sha、Git 凭证、commit 身份
- 可注入 codex / claude_code 配置文件
- 会注入面向平台的环境变量和 token，用于回写 Issue / PR

### 3.3 运行时输出

- stdout / stderr / run logs excerpt
- artifacts excerpt
- usage records
- interventions
- structured validation report

### 3.4 平台 MCP

- 平台已能直接承载 MCP server，不再要求在 actions container 镜像内打包 `gits-platform-mcp`
- actions runtime 会把平台 MCP endpoint 作为 HTTP MCP server 注入给 codex / claude_code
- 本地 agent 也可直接连接同一个平台 MCP endpoint
- 对 actions runtime：
  - 继续使用平台临时 token
  - 评论与建 PR 仍可按 actions 身份回写
- 对本地 agent：
  - 使用用户自建 token
  - 不复用平台给 actions 生成的临时 token

### 3.5 摘要回流

- Issue 与 PR 页面会直接消费最近 run/session 的摘要
- validation summary 优先消费 structured validation report
- 若缺失 structured report，则回退到日志中对 tests/build/lint 的命令识别
- 当前支持：
  - `skipped`
  - `partial`
  - scoped multi-step checks
  - highlighted artifacts 优先级排序

### 3.6 主流程状态协调

- 若 run 来源是 `issue` 或 `pull_request`，完成后会自动触发 Issue task status 回流
- 回流失败不会覆盖 run 原始结果，但会留下 warning 供排障

## 4. 当前关键流程

### 4.1 自动 workflow

1. issue 创建、PR 创建或 push 发生。
2. 系统匹配启用的 workflow。
3. 创建 run，并同步创建 linked session。
4. runtime 执行并回写结果。

### 4.2 交互式继续

1. 用户从 Issue、PR 或 review thread 点击继续 Agent。
2. 系统创建内部 workflow 对应的 run/session。
3. prompt 会带入 Issue/PR/Review 上下文、验收标准和必要 token。
4. 执行结果以 handoff 摘要形式回流到 Issue / PR。

### 4.3 观测与回看

1. Actions 页以 run 为主视图，支持筛选、查看日志、rerun。
2. Session detail 负责查看 timeline、artifact、usage、intervention 与 prompt。
3. 全文日志与全文 artifact 按需读取对象存储。

## 5. 当前接口

- `ALL /api/mcp`
- `GET /api/settings/actions`
- `PATCH /api/settings/actions`
- `GET /api/repos/:owner/:repo/actions/config`
- `PATCH /api/repos/:owner/:repo/actions/config`
- `GET /api/repos/:owner/:repo/actions/workflows`
- `POST /api/repos/:owner/:repo/actions/workflows`
- `PATCH /api/repos/:owner/:repo/actions/workflows/:workflowId`
- `GET /api/repos/:owner/:repo/actions/runs`
- `GET /api/repos/:owner/:repo/actions/runs/latest`
- `GET /api/repos/:owner/:repo/actions/runs/latest-by-comments`
- `GET /api/repos/:owner/:repo/actions/runs/:runId`
- `GET /api/repos/:owner/:repo/actions/runs/:runId/logs`
- `GET /api/repos/:owner/:repo/actions/runs/:runId/logs/stream`
- `POST /api/repos/:owner/:repo/actions/runs/:runId/rerun`
- `POST /api/repos/:owner/:repo/actions/workflows/:workflowId/dispatch`
- `GET /api/repos/:owner/:repo/agent-sessions`
- `GET /api/repos/:owner/:repo/agent-sessions/latest`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/timeline`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts/:artifactId/content`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/cancel`

## 6. 当前数据模型

- `global_settings`
- `repository_actions_configs`
- `action_workflows`
- `action_runs`
- `agent_sessions`
- `agent_session_steps`
- `agent_session_artifacts`
- `agent_session_usage_records`
- `agent_session_interventions`

## 7. 关键代码文件

- `src/services/actions-service.ts`
- `src/services/action-trigger-service.ts`
- `src/services/action-runner-service.ts`
- `src/services/action-run-queue-service.ts`
- `src/services/agent-session-service.ts`
- `src/services/agent-session-validation-summary.ts`
- `src/services/platform-mcp-service.ts`
- `src/actions/actions-container.ts`
- `containers/actions-runner/server.ts`
- `src/routes/api.ts`
- `docs/MCP.zh-CN.md`
- `web/src/pages/repository-actions-page.tsx`
- `web/src/pages/agent-session-detail-page.tsx`
- `web/src/lib/validation-summary.ts`
- `web/src/components/ui/monaco-text-viewer.tsx`
- `web/src/lib/monaco.ts`

## 8. 当前边界与缺口

### 8.1 workflow 仍是触发层，不应喧宾夺主

- 当前 workflow 很重要，但产品主视角应继续围绕 session 和 handoff，而不是 workflow 配置本身。

### 8.2 validation summary 仍需更面向评审

- 已有 structured report、fallback 规则、highlighted artifacts。
- 但对“这次到底测了什么、该先看什么、为什么还需要人类判断”的表达仍可继续增强。

### 8.3 session 连续性表达仍不足

- 已有 issue assign/resume、PR resume、thread-focused resume、rerun、dispatch。
- 但还缺更清晰的“这次 session 在延续哪条反馈、完成了什么”的压缩摘要。

### 8.4 输入上下文仍偏弱

- runtime 已能执行。
- 但 session 开始前仍缺代码搜索、相关文件候选、review thread 摘要和更稳定的上下文 bundle。

### 8.5 本地 agent 接入仍缺更明确的产品化入口

- 平台 MCP endpoint 已可复用给本地 agent。
- 但用户如何发现 endpoint、如何选择自己的 token、如何管理 token 粒度，仍需要后续产品入口承接。

## 9. 下一步优先级

1. 继续沉淀更面向评审的 validation 和 artifact 摘要。
2. 增强 session 的 resume / continue / handoff 语义，而不是增加更多分散入口。
3. 为 runtime 补上更好的任务上下文输入整理能力。
4. 为本地 agent 补更清晰的接入入口与 token 权限管理体验。
