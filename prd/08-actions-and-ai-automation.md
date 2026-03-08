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
- Session detail 现在改成分层视图：
  - Hero summary
  - Handoff & source
  - Validation
  - Execution logs
  - Timeline
  - Prompt（默认折叠）
- Session / Actions 内的全文 prompt、artifact 输出和运行日志现在统一使用 Monaco read-only viewer，而不是裸 `pre`
- 这些 Monaco viewer 现在按查看器实际挂载时 lazy load，避免 Actions / Session 页面首屏就带入整套 Monaco runtime
- Actions 页现在以 run 为主视图，session 退到 compact index / provenance 入口，不再把两套大块信息并排铺开。
- Issue assign / resume prompt 已显式带上验收标准。
- Issue 页已直接展示最近 Issue Session、最近 run，以及关联 PR 的最近 Session / run。
- Issue 页已开始直接展示关联 PR 的第一版 validation summary 与关键 artifact 摘要。
- PR 页已直接展示最近验证状态、关键 artifact 摘要、最近一次 Agent 修改摘要和 merge summary。
- Issue / PR 页已开始消费 rule-based tests / build / lint validation summary，并按优先级提炼 highlighted artifacts。
- Runtime 现在会要求 Agent 在退出前输出 machine-readable validation report；后端会抽取、持久化，并优先用于 Issue / PR 页的验证摘要。
- 这份结构化 report 已开始支持 `skipped`，用于表达明确未执行的验证步骤。
- 这份结构化 report 现在支持同 kind 多条 check，并通过 `scope` 表达 multi-step validation。
- 这份结构化 report 现在支持 `partial`，用于表达只部分完成或部分成功的验证结果。
- action run 完成后，如果 run 来源是 `issue` / `pull_request`，系统现在会自动重算并回写关联 Issue 的 `task_status`。
- Session / run 现在不只是一层 observability，也承担主流程状态协调触发点。
- 如果这次主流程状态回流失败，run 仍会按原始结果完成，但 logs 中会追加结构化 warning，worker logs 也会记录错误上下文，不再静默吞掉。
- stdout / stderr / run full logs 现在不再持久化到 D1 正文；D1 只保留 excerpt、大小和 usage metadata，全文统一落到专用 `ACTION_LOGS_BUCKET` R2。
- `action_runs.logs` 现在的语义是 excerpt / preview，而不是全文日志。
- Session artifact 的 `content_text` 现在也是 excerpt；查看全文通过按需读取对象存储。
- Timeline 现在只保留 lifecycle / intervention / 系统诊断，不再把 stdout / stderr 逐行灌进时间线。

## 3. 当前工作流

当前已经有一条基本可用的执行链：

1. 人类在 Issue 或 PR 中触发 Agent。
2. 系统创建 Agent Session。
3. Runtime 执行代码修改、构建、测试、推分支、评论回写。
4. Session 沉淀 excerpt、artifact metadata 与 structured validation summary；stdout / stderr / run full logs 写入专用 R2。
5. run 完成后按 source 自动回写 Issue 主流程状态。

## 4. 面向主工作流仍需补足

### 4.1 Session 已开始回流到任务链，但摘要层仍可增强

当前 Session 已经回流到：

- Issue 的任务视图
- PR 的 provenance / review 恢复入口
- PR 的 validation summary / merge summary

现在用户已经不需要先跳到 Session 详情页才能理解 PR 的最新验证状态。

### 4.2 验证结果已开始结构化，但仍不够面向评审

现在 artifact 和 usage 已经能回流到 PR 页面，并开始回流到 Issue 的关联 PR 视图，而且已有一版 runtime-emitted structured validation report + fallback 规则摘要，但还缺少更完整的评审输出：

- 这次运行测了什么
- 结果是通过还是失败
- 哪些输出值得人类优先看
- 如何把第一版结构化检查结果继续转成更稳定的 artifact 优先级和 review-oriented summary

这些结果应当被整理后直接放进 Issue / PR 页面，而不是只作为底层 observability 数据存在。

### 4.3 Session 的连续恢复已有统一 handoff 语义，但仍可继续增强

当前已经有：

- Issue assign / resume
- PR resume
- review thread focused resume
- PR sidebar 主 CTA 默认 handoff 到最早 unresolved review thread

但还缺：

- 更清晰的“这次 Session 在延续哪条反馈”
- 更完整的“上一轮 Agent 实际交付了什么”压缩摘要

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
4. 执行状态摘要、artifact excerpt 和 usage metadata 写回 D1；stdout / stderr / run full logs 写入专用 R2。
5. 若 run 来源是 Issue / PR，则在完成后自动触发主流程状态回写。
6. 用户可查看 Session timeline、artifact、usage、intervention。

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
- `GET /api/repos/:owner/:repo/actions/runs/:runId/logs`
- `GET /api/repos/:owner/:repo/actions/runs/:runId/logs/stream`
- `POST /api/repos/:owner/:repo/actions/runs/:runId/rerun`
- `POST /api/repos/:owner/:repo/actions/workflows/:workflowId/dispatch`
- `GET /api/repos/:owner/:repo/pulls/provenance/latest`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/timeline`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId/artifacts/:artifactId/content`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/cancel`

## 7. 当前数据

- `action_workflows`
- `action_runs`
- `action_runs.logs`：仅保存 excerpt / preview，不再保存全文 stdout / stderr / run logs
- `agent_sessions`
- `agent_session_steps`
- `agent_session_artifacts`
- `agent_session_artifacts.content_text`：仅保存 excerpt；全文日志位于 `ACTION_LOGS_BUCKET`
- `agent_session_usage_records`
- `agent_session_interventions`

## 8. 关键代码文件

- `src/services/actions-service.ts`
- `src/services/action-trigger-service.ts`
- `src/services/action-runner-service.ts`
- `src/services/action-run-queue-service.ts`
- `src/services/agent-session-service.ts`
- `src/services/agent-session-validation-summary.ts`
- `src/actions/actions-container.ts`
- `containers/actions-runner/server.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-actions-page.tsx`
- `web/src/pages/agent-session-detail-page.tsx`
- `web/src/lib/validation-summary.ts`
- `web/src/components/ui/monaco-text-viewer.tsx`
- `web/src/lib/monaco.ts`

## 9. 当前边界与下一步

- 当前 Workflow 仍然是重要底层机制，但产品主视角应该切到 Session。
- Session 已开始回流到 Issue / PR 主界面，PR 和 Issue 的关联 PR 视图都已有 tests / build / lint 验证摘要层，并优先消费 runtime-emitted structured validation report；skipped、partial 与 scoped multi-step checks 已可被结构化表达。
- Runtime 现在已经成为主流程状态回流的触发点之一，而不仅是日志与 artifact 采集点；回流失败时也会留下可见 warning 以便排障。
- Session UI 已开始按“决策摘要”和“按需展开正文”重新分层；Issue / PR / Actions 不再承担全文日志浏览，Session detail 与单独日志接口负责全文。
- 验证结果和 artifact 仍缺少更完整、面向评审的结构化摘要层。
- Monaco 目前覆盖的是只读查看器；Actions 配置编辑区仍保持原有 `Textarea` 输入模型。

下一步优先级：

1. 继续沉淀面向评审的 artifact 优先级和更明确的人类审校摘要。
2. 继续增强 Session 的 resume / continue / handoff 摘要，而不是再增加分散入口。
3. 为 Session 增加更好的上下文输入整理能力。
