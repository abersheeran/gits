# Pull Request 与评审 PRD

## 1. 模块目标

为分支协作提供标准的 PR 工作流，包括“发起比较、关联 Issue、请求评审、合并、自动关闭 Issue、触发后续自动化”。

## 2. 当前能力范围

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

- 公开仓库的 PR 列表、详情和运行结果可匿名查看。
- 创建与更新 PR 要求当前用户是 owner 或 collaborator。
- Actions 内部 Token 若声明 `displayAsActions`，仍沿用触发用户的协作权限校验，但 PR 作者落为 `actions`。
- Review 也要求当前用户具备仓库协作身份。
- 请求评审人与指派人的可选集合来自 owner + collaborators。

## 4. 关键流程

1. 创建 PR 时先验证 base/head 分支存在，且不能相同。
2. 系统会阻止同一 `head/base` 组合下重复存在未关闭 PR。
3. 若请求来自 `displayAsActions` 内部 Token，会在保存前把 PR 作者替换为系统 `actions` 用户。
4. 更新 PR 时可同步更新 labels、assignees、requested reviewers、milestone、closing issues。
5. 状态改为 `merged` 时，调用 `PullRequestMergeService` 执行 squash merge。
6. 合并成功后：
  - 更新 PR 状态与 merge commit
  - 自动关闭关联 Issue
  - 触发以 base 分支为目标的 push 工作流

## 5. 核心接口

- `GET /api/repos/:owner/:repo/pulls`
- `GET /api/repos/:owner/:repo/pulls/:number`
- `GET /api/repos/:owner/:repo/pulls/:number/reviews`
- `POST /api/repos/:owner/:repo/pulls`
- `PATCH /api/repos/:owner/:repo/pulls/:number`
- `POST /api/repos/:owner/:repo/pulls/:number/reviews`
- `GET /api/repos/:owner/:repo/compare`

## 6. 数据模型

- `pull_requests`
- `pull_request_reviews`
- `pull_request_closing_issues`
- `pull_request_labels`
- `pull_request_assignees`
- `pull_request_review_requests`
- `reactions`

## 7. 关键代码文件

- `src/services/pull-request-service.ts`
- `src/services/pull-request-merge-service.ts`
- `src/services/repository-browser-service.ts`
- `src/services/repository-metadata-service.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-pulls-page.tsx`
- `web/src/pages/new-pull-request-page.tsx`
- `web/src/pages/pull-request-detail-page.tsx`
- `web/src/components/repository/repository-diff-view.tsx`

## 8. 当前边界与注意点

- 目前只有 squash merge，没有 merge commit、rebase merge、merge queue。
- 没有 PR 行级评论、suggested changes、review thread。
- 关闭关联 Issue 依赖显式保存的 `closeIssueNumbers`，不是从自然语言关键字实时解析。
- Actions 运行容器会显式写入 `actions` git identity，因此自动化生成并推送的提交不会继承触发用户的 `user.name / user.email`。
