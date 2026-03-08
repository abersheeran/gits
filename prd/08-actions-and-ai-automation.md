# Actions 与 Agent Runtime PRD

## 1. 模块目标

这个模块的目标不是搭一个复杂的控制平面。

它的职责是：

- 把 Issue、PR 和评论转换成 Agent Session。
- 让 Agent 在运行时执行代码修改、测试和回写。
- 把执行结果沉淀成可追踪的 timeline、artifact 和验证摘要。

Session 是核心，workflow 只是触发手段。

## 2. 当前能力基线

- 全局和仓库级 Actions 配置。
- Prompt 驱动 workflow。
- 支持 `codex` 和 `claude_code`。
- Run 管理：
  - `queued`
  - `running`
  - `success`
  - `failed`
  - `cancelled`
- Runtime 基于 Cloudflare Containers / Durable Objects / Queue 执行。
- 运行时可克隆仓库、注入配置和临时内部 Token。
- `agent_sessions` 已是一等对象。
- Session 已支持：
  - timeline
  - artifacts
  - usage records
  - interventions
- Session 详情页已存在。
- Issue、PR、Actions 页面都能跳转到 Session。
- Issue assign / resume prompt 已显式带上验收标准。
- Issue 页已直接展示最近 Issue Session、最近 run，以及关联 PR 的最近 Session / run。

## 3. 当前工作流

当前已经有一条基本可用的执行链：

1. 人类在 Issue 或 PR 中触发 Agent。
2. 系统创建 Agent Session。
3. Runtime 执行代码修改、构建、测试、推分支、评论回写。
4. Session 沉淀日志与 artifact。

## 4. 面向主工作流仍需补足

### 4.1 Session 已开始回流到任务链，但 PR 侧还不够强

当前 Session 已经回流到：

- Issue 的任务视图
- PR 的 provenance / review 恢复入口

但用户在 PR 里仍需要更直接的验证摘要，而不只是 Session 明细。

### 4.2 验证结果的输出还不够面向评审

现在 artifact 和 usage 已经有了，但还缺少更直接的评审输出：

- 这次运行测了什么
- 结果是通过还是失败
- 哪些输出值得人类优先看

这些结果应当被整理后直接放进 Issue / PR 页面，而不是只作为底层 observability 数据存在。

### 4.3 Session 的连续恢复还可以更顺

当前已经有 Issue resume 和 PR review thread focused resume，但还缺：

- 更统一的 resume 入口
- 更清晰的“这次 Session 在延续哪条反馈”
- 更直接的 handoff 语义

### 4.4 上下文输入仍偏弱

Runtime 已能执行，但 Agent 进入前拿到的上下文还不够好，仍缺：

- 相关代码候选
- 相关 review thread 摘要
- 最近验证结果摘要

## 5. 关键流程

### 当前已实现流程

1. 事件或用户操作创建 run。
2. 系统同步创建或关联 Agent Session。
3. Runtime 获取临时权限并执行。
4. 执行状态与结果持续写回 D1。
5. 用户可查看 Session timeline、artifact、usage、intervention。

### 目标流程

1. 人类在 Issue 中触发 Agent。
2. Agent 进入 Session，并在必要时继续与人类交流。
3. Agent 推进实现并发起或更新 PR。
4. 人类在 PR 中给出反馈。
5. Agent 从反馈继续恢复同一条任务链。

## 6. 当前接口

- `GET /api/settings/actions`
- `PATCH /api/settings/actions`
- `GET /api/repos/:owner/:repo/actions/config`
- `PATCH /api/repos/:owner/:repo/actions/config`
- `GET /api/repos/:owner/:repo/actions/workflows`
- `POST /api/repos/:owner/:repo/actions/workflows`
- `PATCH /api/repos/:owner/:repo/actions/workflows/:workflowId`
- `GET /api/repos/:owner/:repo/actions/runs`
- `GET /api/repos/:owner/:repo/actions/runs/:runId`
- `GET /api/repos/:owner/:repo/actions/runs/:runId/logs/stream`
- `POST /api/repos/:owner/:repo/actions/runs/:runId/rerun`
- `POST /api/repos/:owner/:repo/actions/workflows/:workflowId/dispatch`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/timeline`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/cancel`

## 7. 当前数据

- `action_workflows`
- `action_runs`
- `agent_sessions`
- `agent_session_steps`
- `agent_session_artifacts`
- `agent_session_usage_records`
- `agent_session_interventions`

## 8. 关键代码文件

- `src/services/actions-service.ts`
- `src/services/action-trigger-service.ts`
- `src/services/action-runner-service.ts`
- `src/services/action-run-queue-service.ts`
- `src/services/agent-session-service.ts`
- `src/actions/actions-container.ts`
- `containers/actions-runner/server.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-actions-page.tsx`
- `web/src/pages/agent-session-detail-page.tsx`

## 9. 当前边界与下一步

- 当前 Workflow 仍然是重要底层机制，但产品主视角应该切到 Session。
- Session 已开始回流到 Issue / PR 主界面，但 PR 侧仍缺更强的验证摘要层。
- 验证结果和 artifact 仍缺少面向评审的摘要层。

下一步优先级：

1. 增加面向评审的验证摘要，而不是只暴露底层日志和 artifact。
2. 统一 Session 的 resume / continue / handoff 入口。
3. 为 Session 增加更好的上下文输入整理能力。
