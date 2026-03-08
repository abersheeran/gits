# Pull Request 与评审 PRD

## 1. 模块目标

PR 是这款产品的交付中心。

它要承载的是一条非常具体的协作链：

1. Agent 基于 Issue 发起 PR。
2. 人类和 Agent 一起看代码 diff、review thread、测试产物。
3. Agent 根据反馈持续更新 PR。
4. 人类最终决定是否合并。

因此，PR 页面最重要的不是复杂治理，而是让“看改动、提反馈、继续修改、确认合并”足够顺。

## 2. 当前能力基线

- PR 列表与详情。
- 创建 PR：
  - 选择 `baseRef` / `headRef`
  - draft
  - 关联关闭 Issue
  - 标签、里程碑、指派人、请求评审人
- PR 详情：
  - compare 结果
  - ahead / behind
  - mergeability
  - 文件 diff
  - review summary
  - 最新 Agent provenance 摘要
- Review：
  - `comment`
  - `approve`
  - `request_changes`
- Review Thread：
  - anchored 到真实 diff hunk / compare range
  - 支持多轮 comments
  - 支持 suggested changes
  - `open / resolved`
  - 支持从单条 unresolved thread focused resume Agent
- 合并：
  - 当前支持 squash merge
  - 合并后自动关闭关联 Issue

## 3. 当前工作流

当前已经能跑通下面这条链：

1. Agent 创建或更新分支。
2. Agent 发起 PR。
3. 人类在 diff 上创建 review thread。
4. Agent 从 thread focused resume。
5. 人类最终合并 PR。

但 PR 页面还不够完整。

## 4. 面向主工作流仍需补足

### 4.1 PR 页面还缺“验证结果中心”

现在有 Session、artifact、usage，但用户做最终判断时还不够直接。

PR 页应该直接展示：

- 最近一次测试结果
- 最近一次构建结果
- 关键 artifact 摘要
- 最近一次 Agent 修改摘要

而不是主要依赖用户再跳到 Session 页拼接理解。

### 4.2 Review 线程在多次提交之间还不够稳定

当前 thread 已锚定到真实 diff，但还缺：

- 新 commit 后的重新锚定
- stale thread 标记
- 更明确的 patch-set 变化感知

### 4.3 合并前的判断面还不够直接

PR 页面需要一个非常清晰的 merge summary，至少包括：

- 是否仍有 unresolved thread
- 最近一次 Agent 修改是否完成
- 最近一次验证是否通过
- 关联 Issue 是否满足验收标准

### 4.4 Issue 与 PR 的双向关联仍然偏弱

当前支持关闭关联 Issue，但还缺更清晰的任务链视图：

- 这个 PR 来自哪个 Issue
- 当前 PR 正在解决 Issue 的哪部分反馈
- 合并后如何回写 Issue 状态

## 5. 关键流程

### 当前已实现流程

1. 创建 PR 时校验 base/head。
2. 系统阻止同一 `head/base` 组合的重复未关闭 PR。
3. PR 页面可展示 compare、reviews、review threads、Agent provenance。
4. 用户可从 thread 直接继续 Agent。
5. 合并成功后自动关闭关联 Issue。

### 目标流程

1. Agent 基于 Issue 提交 PR。
2. 人类在 PR 中评审代码和测试产物。
3. Agent 根据 review thread 继续修改。
4. PR 页面持续汇总“最新改动 + 最新验证 + 最新反馈”。
5. 人类完成最终合并。

## 6. 当前接口

- `GET /api/repos/:owner/:repo/pulls`
- `GET /api/repos/:owner/:repo/pulls/:number`
- `POST /api/repos/:owner/:repo/pulls`
- `PATCH /api/repos/:owner/:repo/pulls/:number`
- `GET /api/repos/:owner/:repo/pulls/:number/reviews`
- `POST /api/repos/:owner/:repo/pulls/:number/reviews`
- `GET /api/repos/:owner/:repo/pulls/:number/review-threads`
- `POST /api/repos/:owner/:repo/pulls/:number/review-threads`
- `POST /api/repos/:owner/:repo/pulls/:number/review-threads/:threadId/comments`
- `POST /api/repos/:owner/:repo/pulls/:number/review-threads/:threadId/resolve`
- `POST /api/repos/:owner/:repo/pulls/:number/resume-agent`
- `GET /api/repos/:owner/:repo/pulls/:number/provenance`
- `GET /api/repos/:owner/:repo/compare`

## 7. 当前数据

- `pull_requests`
- `pull_request_reviews`
- `pull_request_review_threads`
- `pull_request_review_thread_comments`
- `pull_request_closing_issues`
- `pull_request_labels`
- `pull_request_assignees`
- `pull_request_review_requests`
- `reactions`

## 8. 关键代码文件

- `src/services/pull-request-service.ts`
- `src/services/pull-request-merge-service.ts`
- `src/services/repository-browser-service.ts`
- `src/routes/api.ts`
- `web/src/pages/pull-request-detail-page.tsx`
- `web/src/components/repository/repository-diff-view.tsx`

## 9. 当前边界与下一步

- 当前只有 squash merge。
- PR 页面还没有把测试结果和关键 artifact 直接做成判断面。
- thread 在新 commit 后还缺更稳定的连续性处理。

下一步优先级：

1. 在 PR 页面补测试/构建/关键 artifact 摘要。
2. 增加 merge summary，让人类更容易做最终判断。
3. 增强 thread 在多次提交之间的重新锚定与 stale 标记。
4. 把 PR 和来源 Issue 之间的状态回流做得更明显。
