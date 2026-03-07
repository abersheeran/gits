# Pull Request 与评审 PRD

## 1. 模块目标

为分支协作提供标准且面向 Agent 的 PR 工作流，包括“发起比较、关联 Issue、请求评审、接收 review feedback、继续执行、合并、触发后续自动化”。

在 Agent 原生平台里，PR 是人类与 Agent 共同完成代码交付的主界面，因此必须同时满足：

- 人类评审效率
- Agent 可继续迭代
- 分支治理可 enforce
- 所有自动化产出可追踪

## 2. 当前能力基线

- PR 列表与详情：
  - 支持 `open`、`closed`、`merged`、`all`
  - 支持分页
- 新建 PR：
  - 选择 `baseRef` 与 `headRef`
  - 支持 draft
  - 支持关闭关联 Issue 编号
  - 支持标签、里程碑、指派人、请求评审人
  - Actions 使用 `displayAsActions` 内部 Token 创建 PR 时，作者显示为 `actions`
- PR 详情：
  - 比较结果
  - ahead/behind
  - mergeability
  - 文件 diff
  - review summary
- Review：
  - `comment`
  - `approve`
  - `request_changes`
- 合并：
  - 当前只支持 squash merge
  - 合并成功后回写 base 分支 ref
  - 已关联的 Issue 会被自动关闭
- Reaction：
  - 支持 PR 本体与 Review 的 Reaction
- 自动化联动：
  - PR 创建触发 `pull_request_created`
  - PR 标题或正文新增 `@actions` 触发 `mention_actions`
  - PR 合并生成新提交后，会再触发一次 `push`

## 3. 权限与可见性

- 公开仓库的 PR 列表、详情和运行结果可匿名查看
- 创建与更新 PR 要求当前用户是 owner 或 collaborator
- Actions 内部 Token 若声明 `displayAsActions`，仍沿用触发用户的协作权限校验，但 PR 作者落为 `actions`
- Review 也要求当前用户具备仓库协作身份
- 请求评审人与指派人的可选集合来自 owner + collaborators

面向 Agent 原生目标，还需要增加：

- `resume_from_review_comment`
- `enqueue_merge`
- `view_provenance`

## 4. 面向 Agent 原生目标需要补足

### 4.1 行级评审与线程

- 行级评论
- 多轮 review thread
- resolved / unresolved 状态
- suggested changes
- review thread 与 commit range 绑定

### 4.2 Agent 继续执行

- 从 PR 评论直接恢复 Agent Session
- 指定“只修 review comments”或“重新规划整组变更”
- 让 Agent 能读取 unresolved threads、required checks 状态与最新 diff

### 4.3 合并治理

- merge commit
- rebase merge
- merge queue
- required checks
- required reviews
- stale review 失效策略
- auto-update branch / rebase with base

### 4.4 Provenance 与展示

- PR 页面展示：
  - 来自哪个 Agent
  - 来源 Session
  - 运行摘要
  - 相关 artifact
- Agent 创建的提交、评论、patch 应带 provenance 标识

## 5. 关键流程

### 当前已实现流程

1. 创建 PR 时先验证 base/head 分支存在，且不能相同。
2. 系统会阻止同一 `head/base` 组合下重复存在未关闭 PR。
3. 若请求来自 `displayAsActions` 内部 Token，会在保存前把 PR 作者替换为系统 `actions` 用户。
4. 更新 PR 时可同步更新 labels、assignees、requested reviewers、milestone、closing issues。
5. 状态改为 `merged` 时，调用 `PullRequestMergeService` 执行 squash merge。
6. 合并成功后：
  - 更新 PR 状态与 merge commit
  - 自动关闭关联 Issue
  - 触发以 base 分支为目标的 push 工作流

### 目标流程

1. Agent 基于 Issue 或 PR 评论生成独立分支并创建 PR。
2. 评审人在文件行上提出 review thread，平台记录 unresolved 状态与阻塞条件。
3. 用户可从单条 review comment 直接触发 Agent resume。
4. Agent 完成修复后更新同一分支或新 patch set，线程自动关联到最新 diff。
5. 当 required checks、required reviews、merge queue 条件都满足后，PR 才可进入最终合并。

## 6. 核心接口

### 当前接口

- `GET /api/repos/:owner/:repo/pulls`
- `GET /api/repos/:owner/:repo/pulls/:number`
- `GET /api/repos/:owner/:repo/pulls/:number/reviews`
- `POST /api/repos/:owner/:repo/pulls`
- `PATCH /api/repos/:owner/:repo/pulls/:number`
- `POST /api/repos/:owner/:repo/pulls/:number/reviews`
- `GET /api/repos/:owner/:repo/compare`

### 建议新增接口

- `GET /api/repos/:owner/:repo/pulls/:number/review-threads`
- `POST /api/repos/:owner/:repo/pulls/:number/review-threads`
- `POST /api/repos/:owner/:repo/pulls/:number/review-threads/:threadId/resolve`
- `POST /api/repos/:owner/:repo/pulls/:number/resume-agent`
- `POST /api/repos/:owner/:repo/pulls/:number/merge-queue`
- `GET /api/repos/:owner/:repo/pulls/:number/provenance`

## 7. 数据模型

### 当前数据

- `pull_requests`
- `pull_request_reviews`
- `pull_request_closing_issues`
- `pull_request_labels`
- `pull_request_assignees`
- `pull_request_review_requests`
- `reactions`

### 建议新增数据

- `pull_request_review_threads`
- `pull_request_line_comments`
- `pull_request_check_runs`
- `pull_request_merge_queue_entries`
- `pull_request_provenance`

## 8. 关键代码文件

- `src/services/pull-request-service.ts`
- `src/services/pull-request-merge-service.ts`
- `src/services/repository-browser-service.ts`
- `src/services/repository-metadata-service.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-pulls-page.tsx`
- `web/src/pages/new-pull-request-page.tsx`
- `web/src/pages/pull-request-detail-page.tsx`
- `web/src/components/repository/repository-diff-view.tsx`

后续预计新增：

- `src/services/pull-request-review-thread-service.ts`
- `src/services/merge-queue-service.ts`
- `web/src/components/repository/review-thread-list.tsx`
- `web/src/components/repository/pull-request-provenance-card.tsx`

## 9. 当前边界与下一步

### 近期已落地（2026-03）

- 已新增 `POST /api/repos/:owner/:repo/pulls/:number/resume-agent`
- PR 详情页现在会展示最近的 Agent Session，并支持：
  - 选择 Agent 类型
  - 输入额外指令
  - 基于当前 PR 标题、描述、Review 历史与 head 分支上下文继续 Agent
  - 跳转到对应 Actions session / run
- PR 级 Session 已成为可追踪对象，能够和 run 生命周期保持同步

- 目前只有 squash merge，没有 merge commit、rebase merge、merge queue
- 没有 PR 行级评论、suggested changes、review thread
- 关闭关联 Issue 依赖显式保存的 `closeIssueNumbers`，不是从自然语言关键字实时解析
- Actions 运行容器会显式写入 `actions` git identity，因此自动化生成并推送的提交不会继承触发用户的 `user.name / user.email`
- 还不能从单条 review comment / unresolved thread 精准恢复 Agent

下一步优先级：

1. 增加 review thread 与行级评论
2. 增加从 review comment 恢复 Agent
3. 增加 required checks / required reviews / merge queue
4. 增加 PR provenance 展示
