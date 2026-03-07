# Actions 与 AI 自动化 PRD

## 1. 模块目标

把仓库事件转换为可执行的 AI 工作流，让 Codex 或 Claude Code 在受控容器中读取代码、执行提示词，并把结果沉淀为运行记录、日志和后续协作动作。

## 2. 当前能力范围

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

## 3. 当前执行链路

1. 业务事件触发 `triggerActionWorkflows` 或 `triggerMentionActionRun`。
2. 系统在 D1 中创建 `action_runs` 记录。
3. 若配置了 Queue，则消息进入 `ACTIONS_QUEUE`；否则直接在当前请求上下文异步执行。
4. Worker 通过 Durable Object 命中指定规格容器，向 `/execute` 发送代理类型、Prompt、Repo URL、触发用户上下文、Env 和配置文件。
5. 容器 `onStart` 里按本次 run 需求创建克隆 Token、Issue 回复 Token、PR 创建 Token，并在转发到 `/run` 前把它们注入 Prompt / Env。
6. 运行日志持续写回 D1，前端可以通过 SSE 观看流式更新。
7. 运行结束后 Worker 仍会 best-effort 停止容器实例，Token 回收由容器 `onStop / onError / onActivityExpired` 统一负责。

## 4. 权限与可见性

- Workflow 列表和运行记录对“可读仓库”可见。
- 当前实现中，仓库 owner 或任意 collaborator 都可以：
  - 修改仓库级 Actions 配置
  - 创建/编辑 workflow
  - rerun 和 dispatch
- PR 创建专用内部 Token 会带 `displayAsActions`，因此通过平台 API 创建的 PR 作者显示为 `actions`，但权限仍继承触发用户。
- 全局 Actions 配置只要求登录，不区分更高等级后台角色。

## 5. 核心接口

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

## 6. 数据模型与基础设施

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

## 7. 关键代码文件

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

## 8. 当前边界与注意点

- 这套 Actions 不是 GitHub Actions 风格的 YAML 工作流，而是 Prompt 驱动的代理执行系统。
- Workflow 列表默认会过滤掉以 `__` 开头的内部工作流。
- 目前没有审批流、并发配额面板、可视化 DAG、缓存、artifact 管理。
- 全局配置和仓库级配置的权限边界偏宽，后续如果进入多租户场景，需要单独收紧。
