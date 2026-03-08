# Issue 与讨论 PRD

## 1. 模块目标

Issue 是这款产品的任务入口，也是人类和 Agent 的主要对话面。

一个好的 Issue 页面应当同时承担：

- 问题描述
- 人机交流
- 当前任务状态
- 当前交付入口

它不是一个复杂的项目管理系统。

## 2. 当前能力基线

- Issue 列表与分页。
- Issue 详情：
  - 标题
  - 正文
  - 状态
  - 标签、里程碑、指派人
  - Reaction
- Issue 页面现在显式补上 emoji fallback 字体栈，标题、正文、评论与输入框里的原生 emoji 可稳定显示。
- Issue 上的 Reaction 现在使用真实 emoji 呈现，而不再回退成 `heart / rocket / laugh` 这类英文标签。
- Issue 评论与评论 Reaction。
- 自动化触发：
  - 新建 Issue
  - `@actions`
- Agent 入口：
  - assign-agent
  - resume-agent
- Issue 页展示最近 Agent Session，并可跳转到对应 Session / run。
- Issue 已支持简洁任务状态：
  - `open`
  - `agent-working`
  - `waiting-human`
  - `done`
- `issues.task_status` 现在会在主工作流事件后自动回写，而不再只依赖手动切换。
- 自动状态规则当前固定为：
  - `closed -> done`
  - 任一关联 open PR 仍在跑 run / session，或仍有 review / validation / mergeability 问题 -> `agent-working`
  - 任一关联 open PR 已 merge-ready -> `waiting-human`
  - 无 open PR 但 Issue 自身最新 run / session 仍在执行 -> `agent-working`
  - 无 open PR 且上一轮 Issue run / session 成功结束 -> `waiting-human`
  - 无 open PR 且上一轮 Issue run / session 失败或取消 -> `agent-working`
- Issue 已支持单独维护验收标准。
- Issue 详情页已展示关联 PR，以及每个关联 PR 的最新 Session / run 进展。
- Issue 详情页已开始直接展示关联 PR 的第一版 validation summary 与关键 artifact 摘要。
- Issue 详情页已开始把关联 PR 的验证结果结构化成 tests / build / lint 线索与重点 artifact。
- Issue 详情页现在会优先消费 Agent runtime 主动输出的 machine-readable validation report；拿不到时才回退到日志规则识别。
- 结构化 validation report 已开始支持 `skipped`，用于区分“明确没跑”与“仍在进行中”。
- 结构化 validation report 现在支持同 kind 多条 check，并可通过 `scope` 区分 `tests/unit`、`tests/integration` 这类 multi-step validation。
- 结构化 validation report 现在支持 `partial`，用于表达“命令完成了部分工作，但结果仍需要人类重点审校”。
- `GET issue detail` 现在返回 `taskFlow`，至少包含：
  - `status`
  - `waitingOn`
  - `headline`
  - `detail`
  - `driverPullRequestNumber`
- `GET issues` 与 `GET issue detail` 现在都会在返回前先重算并回写当前页涉及的 Issue 状态，保证列表徽章、详情页头部状态和 `taskFlow` 在同一次响应里一致。
- Issue detail 的 Task center 现在直接展示：
  - 当前在等谁
  - 自动生成的主流程摘要
  - 当前驱动中的 PR
  - 手动编辑 `task_status` 会在后续主流程事件中被自动覆盖的提示
- Issue detail 里的 Agent session 区现在收敛成 compact card，只保留：
  - 最近 session / run 状态
  - 最近验证 headline
  - 最近 Agent 交付摘要
  - `View session` / `View run` 入口
- Issue 页面不再承担 stdout / stderr / 全量日志浏览；这些全文入口统一落到 Session detail 或 Actions 页。

## 3. 当前工作流

当前已经可以做到：

1. 人类创建 Issue。
2. Agent 基于 Issue 正文与评论历史进入执行。
3. Agent 可继续通过 Session 推进工作。
4. 当交付进入 PR / Review / Merge 阶段后，Issue 的 `task_status` 会自动随主流程回流。

Issue 已经开始成为“任务中心”，但还没有把整条交付链的上下文完全收拢。

## 4. 面向主工作流仍需补足

### 4.1 Task center 已进入自动回流阶段，但摘要层仍可继续增强

现在已经有：

- 简洁任务状态
- 验收标准
- 关联 PR 视图
- 最近 Issue run / Session 视图
- 关联 PR 的第一版验证摘要回流
- 关联 PR 的 rule-based tests / build / lint 验证摘要
- 关联 PR 的 runtime-emitted structured validation report
- 结构化 checks 中的 skipped / running 区分
- 结构化 checks 中同 kind multi-step 的 scope 区分
- 结构化 checks 中的 partial 语义

现在已经补上：

- 主流程事件驱动的 `task_status` 自动回写
- `taskFlow` 级别的“当前在等谁 / 下一步该做什么”摘要
- 与驱动 PR 的直接回链

但仍缺：

- 更稳定的“当前该看哪条验证 / 哪个 artifact”提炼
- 更明确的人类审校摘要生成，而不是只覆盖 tests / build / lint + skipped + scoped multi-step + partial

### 4.2 Agent 对话入口还可以更顺

当前已经有 assign/resume，且 Task center 会明确提示当前等待方与驱动 PR。

下一步还缺：

- 从最新 Session / PR / review 反馈回到 Issue 的更强连续视图
- 更稳定的“上一轮 Agent 到底交付了什么”的摘要压缩

## 5. 关键流程

### 当前已实现流程

1. 人类创建 Issue。
2. Agent 从 Issue 正文和评论历史生成 Session。
3. Agent 可继续修改代码、推分支、创建 PR。

### 目标流程

1. 人类在 Issue 中描述问题并补充验收标准。
2. Agent 在 Issue 中与人类交流并推进实现。
3. Agent 发起 PR。
4. 人类与 Agent 继续在 PR 中审校。
5. PR review / validation / merge 结果持续自动回写到 Issue 的任务状态。
6. 合并完成后，Issue 明确收敛为完成状态。

## 6. 当前接口

- `GET /api/repos/:owner/:repo/issues`
- `GET /api/repos/:owner/:repo/issues/:number`
- `GET /api/repos/:owner/:repo/issues/:number/comments`
- `POST /api/repos/:owner/:repo/issues`
- `PATCH /api/repos/:owner/:repo/issues/:number`
- `POST /api/repos/:owner/:repo/issues/:number/comments`
- `POST /api/repos/:owner/:repo/issues/:number/assign-agent`
- `POST /api/repos/:owner/:repo/issues/:number/resume-agent`
- `GET /api/repos/:owner/:repo/pulls/provenance/latest`
- `GET /api/repos/:owner/:repo/labels`
- `GET /api/repos/:owner/:repo/milestones`

## 7. 当前数据

- `issues`
- `issue_comments`
- `issue_labels`
- `issue_assignees`
- `repository_labels`
- `repository_milestones`
- `reactions`

## 8. 关键代码文件

- `src/services/issue-service.ts`
- `src/services/repository-metadata-service.ts`
- `src/services/action-trigger-service.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-issues-page.tsx`
- `web/src/pages/new-issue-page.tsx`
- `web/src/pages/issue-detail-page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/validation-summary.ts`
- `web/src/components/repository/markdown-editor.tsx`
- `web/src/components/repository/reaction-strip.tsx`

## 9. 当前边界与下一步

- 当前没有独立状态机表；仍直接复用 `issues.task_status` 作为持久化状态值。
- 手动编辑 `task_status` 仍然存在，但它不是永久 override；后续主流程事件会自动覆盖。
- 读请求现在允许触发必要的状态回写，以确保新服务从第一天起就没有“列表一个状态、详情另一个状态”的分叉。
- 当前已有 Issue <-> PR <-> Session 汇总视图，且 Issue 页里的 Session 展示已收敛为“任务决策摘要”，不再铺开展示 prompt 或全文日志。
- 关联 PR 已带 tests / build / lint 线索、验证 headline 与重点 artifact 摘要。
- 当前验证摘要已开始优先消费 agent 主动产出的结构化检查结果，并在缺失时回退到输出规则归纳；其中 skipped 已与 running/pending 分开表示，multi-step checks 可通过 scope 区分，partial 也已可被结构化表达。
- Issue 事件模型仍然偏粗。

下一步优先级：

1. 继续增强结构化验证结果的 artifact 优先级和人类审校摘要提炼。
2. 让 Issue 成为整个任务链的统一入口与回看入口。
3. 继续补强更细粒度的事件语义，而不引入额外 schema。
