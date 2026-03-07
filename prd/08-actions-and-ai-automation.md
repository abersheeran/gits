# Actions 与 Agent Runtime PRD

## 1. 模块目标

把仓库事件和用户指令转换为可控制、可审计、可恢复的 Agent Session，让 Codex、Claude Code 或后续自定义 Agent 在受控运行时中读取代码、执行工具、修改代码、创建 PR，并把结果沉淀为运行记录、日志、artifact 与后续协作动作。

当前代码里的这套系统仍以“Prompt 驱动 workflow”为主，但产品目标应提升为“Agent Runtime + Agent Control Plane”。

## 2. 当前能力基线

- 全局配置：
  - 配置 Codex 与 Claude Code 的默认配置文件内容
  - 配置长度上限 120000 字符
- 仓库级配置：
  - 选择容器实例规格：`lite`、`basic`、`standard-1` 到 `standard-4`
  - 覆盖或继承全局配置
- Workflow 管理：
  - 触发事件：
    - `issue_created`
    - `pull_request_created`
    - `mention_actions`
    - `push`
  - 执行代理：
    - `codex`
    - `claude_code`
  - Push 可按 branch/tag 正则过滤
- Run 管理：
  - 状态：`queued`、`running`、`success`、`failed`、`cancelled`
  - 支持查看最近运行、按来源 Issue/PR 聚合最近运行、按评论聚合最近运行
  - 支持 rerun
  - 支持手动 dispatch
- 日志能力：
  - 支持轮询与运行状态 reconcile
  - 支持 SSE 增量流式读取
  - 单次运行日志做长度裁剪与秘密脱敏
- 运行时能力：
  - 使用 Cloudflare Containers / Durable Objects 执行代理
  - 可通过 Queue 异步消费
  - 可将仓库克隆进容器
  - 可注入运行时环境变量和配置文件
  - 容器启动时通过 lifecycle hook 创建临时内部 Token，停止时自动回收
  - Runner workspace 会显式配置独立的 actions git commit identity
- 内建自动化：
  - `@actions` 会自动确保存在隐藏的 internal workflow
  - 如果仓库没有 `issue_created` workflow，系统会自动创建一个默认内部 workflow

## 3. 面向 Agent 原生目标需要补足

### 3.1 核心对象从 Workflow 升级为 Session

平台需要把以下对象提升为一等公民：

- `agent_profiles`
- `agent_sessions`
- `agent_session_steps`
- `session_interventions`
- `agent_artifacts`
- `agent_tool_invocations`
- `agent_usage_records`

Workflow 仍保留，但退化为触发模板；核心追踪单元应是 Session，而不是 Run。

### 3.2 Agent Control Plane

需要新增控制面配置：

- Agent 定义与版本
- MCP / Tool Registry
- Secrets / Env 注入边界
- 预算与配额（用于成本控制）
- 并发上限（用于资源管理）
- 人工介入与暂停策略
- 默认环境镜像 / 预装工具集

### 3.3 Runtime 能力

- Checkpoint / Resume
- Artifact 上传与下载
- Workspace Snapshot
- 缓存
- 更细粒度的网络、文件系统、命令执行策略
- 更完整的 stdout / stderr / structured events
- 长任务心跳与卡死检测

### 3.4 Agent 协作入口

除了事件触发，还需要原生支持：

- 从 Issue 指派创建 Session
- 从 PR 评论恢复 Session
- 从手动任务面板启动 Session
- 从代码片段或 diff 片段启动 Session

### 3.5 可观测性与运营

- Session Timeline
- Step 级耗时
- Token / 工具 / 网络使用记录
- 成本统计
- 失败分类
- 人工干预记录

## 4. 当前执行链路

1. 业务事件触发 `triggerActionWorkflows` 或 `triggerMentionActionRun`。
2. 系统在 D1 中创建 `action_runs` 记录。
3. 若配置了 Queue，则消息进入 `ACTIONS_QUEUE`；否则直接在当前请求上下文异步执行。
4. Worker 通过 Durable Object 命中指定规格容器，向 `/execute` 发送代理类型、Prompt、Repo URL、触发用户上下文、Env 和配置文件。
5. 容器 `onStart` 里按本次 run 需求创建克隆 Token、Issue 回复 Token、PR 创建 Token，并在转发到 `/run` 前把它们注入 Prompt / Env。
6. 运行日志持续写回 D1，前端可以通过 SSE 观看流式更新。
7. 运行结束后 Worker 仍会 best-effort 停止容器实例，Token 回收由容器 `onStop / onError / onActivityExpired` 统一负责。

## 5. 目标执行链路

1. 用户或系统事件创建 Task，并选择 Agent、目标仓库。
2. 平台生成 Agent Session，挂上来源对象、上下文包、委托权限和预算限制。
3. Runtime 根据 Session 规格启动容器，只注入当前 Session 所需的 Secrets、网络与工具权限。
4. Agent 在容器内按当前 Session 权限执行必要操作：
  - 读写文件系统
  - 执行构建、测试
  - 安装依赖包
  - 访问必要的网络 API
  - 创建评论、分支、PR
  - 推送分支
  - 生成 artifact
5. 若 Session 失败或收到人工反馈，可在同一上下文里 resume。
6. Session 结束后，平台保留完整 Timeline、artifact、usage 与 provenance，用于审计和后续评审。

## 6. 权限与可见性

### 当前状态

- Workflow 列表和运行记录对“可读仓库”可见
- 当前实现中，仓库 owner 或任意 collaborator 都可以：
  - 修改仓库级 Actions 配置
  - 创建/编辑 workflow
  - rerun 和 dispatch
- PR 创建专用内部 Token 会带 `displayAsActions`，因此通过平台 API 创建的 PR 作者显示为 `actions`，但权限仍继承触发用户
- 全局 Actions 配置只要求登录，不区分更高等级后台角色

### 目标状态

- `view_runs` 与 `view_logs` 分离
- `run_agents`、`rerun_agents`、`cancel_agents` 分离
- 全局运行时配置只能由平台管理员修改
- Agent Session 的可见性应与仓库权限一致，日志完整记录所有操作，确保可追溯

## 7. 核心接口

### 当前接口

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
- `GET /api/repos/:owner/:repo/actions/runs/:runId/logs/stream`
- `POST /api/repos/:owner/:repo/actions/runs/:runId/rerun`
- `POST /api/repos/:owner/:repo/actions/workflows/:workflowId/dispatch`

### 建议新增接口

- `GET /api/repos/:owner/:repo/agents`
- `POST /api/repos/:owner/:repo/agents`
- `POST /api/repos/:owner/:repo/agent-sessions`
- `GET /api/repos/:owner/:repo/agent-sessions`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/resume`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/cancel`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts`
- `GET /api/repos/:owner/:repo/tool-registry`

## 8. 数据模型与基础设施

### 当前数据与绑定

- D1 表：
  - `global_settings`
  - `repository_actions_configs`
  - `action_workflows`
  - `action_runs`
- Worker 绑定：
  - `ACTIONS_QUEUE`
  - `ACTIONS_RUNNER*`
  - `GIT_BUCKET`
  - `DB`
- 容器定义与实例规格在 `wrangler.jsonc`

### 建议新增数据与能力

- `agent_profiles`
- `agent_sessions`
- `agent_session_steps`
- `agent_artifacts`
- `agent_tool_invocations`
- `agent_usage_records`
- `agent_checkpoints`
- `tool_registry_entries`
- `session_interventions`

## 9. 关键代码文件

- `src/services/actions-service.ts`
- `src/services/action-trigger-service.ts`
- `src/services/action-runner-service.ts`
- `src/services/action-run-queue-service.ts`
- `src/services/action-container-instance-types.ts`
- `src/actions/actions-container.ts`
- `containers/actions-runner/server.ts`
- `src/index.ts`
- `src/routes/api.ts`
- `wrangler.jsonc`
- `web/src/pages/actions-settings-page.tsx`
- `web/src/pages/repository-actions-page.tsx`

后续预计新增：

- `src/services/agent-session-service.ts`
- `src/services/tool-registry-service.ts`
- `web/src/pages/agent-session-detail-page.tsx`
- `web/src/pages/agent-inbox-page.tsx`

## 10. 当前边界与下一步

### 近期已落地（2026-03）

- 已新增 `agent_sessions`
- `action_runs` 现在会在以下入口同步创建或关联 Agent Session：
  - workflow
  - `@actions` mention
  - Issue assign / resume
  - PR resume
  - rerun
  - dispatch
- Run 状态变更会同步回写 Session 状态，至少覆盖：
  - `queued`
  - `running`
  - `success`
  - `failed`
- Runtime 现在会向容器注入 Session 元数据环境变量
- Runtime 默认按 delegated session 直接提供 git push、PR 创建与评论回写能力
- 仓库 Actions 页面现在同时承担：
  - 最近 Session 可观测性入口
  - 正在运行或排队 Session 的 cancel 控制入口
- 已新增独立 `Agent Session` 详情页：`/repo/:owner/:repo/agent-sessions/:sessionId`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId` 现在会补充：
  - 关联 `linkedRun`
  - 来源对象上下文 `sourceContext`
- 已新增 `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/timeline`
  - 第一版 Timeline 基于现有 `agent_sessions` 生命周期字段和 `action_runs.logs` 聚合生成
  - 已覆盖 created / queued / claimed / started / log / completed / cancelled 等基础事件
- Issue、PR、Actions 页面现在都可以跳转到 Session 详情页
- Agent Session 立即执行，无需等待审批

- 这套 Actions 不是 GitHub Actions 风格的 YAML 工作流，而是 Prompt 驱动的代理执行系统
- Workflow 列表默认会过滤掉以 `__` 开头的内部工作流
- 目前没有并发配额面板、可视化 DAG、缓存、artifact 管理
- 全局配置和仓库级配置的权限边界偏宽，后续如果进入多租户场景，需要单独收紧
- Agent 推分支与创建 PR 已不再走人工审批；当前更大的缺口是结构化 step / artifact / usage / intervention 数据和更完整的委托审计

下一步优先级：

1. 把 Timeline 从 `session + run logs` 聚合升级为结构化 `step / intervention / usage / artifact` 事件流
2. 增加预算追踪、artifact 管理、checkpoint 支持
3. 增加 MCP / Tool Registry
4. 增强任务面板、Session 可观测性与 resume/handoff
