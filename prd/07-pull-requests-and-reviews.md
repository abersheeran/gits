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
  - validation summary
  - merge summary
  - 关联 closing Issue 的任务完成度摘要
- 最新 Agent provenance 摘要
- PR validation summary 已开始按 tests / build / lint 规则化拆分，并优先展示更值得人类先看的 artifact。
- PR validation summary 现在会优先消费 Agent runtime 主动输出的 machine-readable validation report，并在缺失时回退到 rule-based 检测。
- Review：
  - `comment`
  - `approve`
  - `request_changes`
- Review Thread：
  - anchored 到真实 diff hunk / compare range
  - 支持多轮 comments
  - 支持 suggested changes
  - `open / resolved`
  - 新 commit 后自动 re-anchor
  - 无法映射到当前 diff 时标记 stale
  - 显示 patch-set changed 状态
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

现在 PR 的评审连续性已经有了第一版 patch-set 感知。

## 4. 面向主工作流仍需补足

### 4.1 Review 线程连续性已经有第一版，但仍偏保守

当前 thread 已支持：

- 新 commit 后的重新锚定
- stale thread 标记
- patch-set changed 状态展示

但这套连续性仍偏保守，还缺：

- rename / 更复杂 diff 场景下的锚点延续
- 跨非连续行变更的更智能 range 映射
- 更明确的“本次 Agent 修改消化了哪些 thread”回流

### 4.2 验证摘要已经进入结构化阶段，但仍可继续增强

现在 PR 页面已经能直接展示最近验证状态、关键 artifact 摘要、最近一次 Agent 修改摘要和 merge summary。
runtime 也开始要求 Agent 在退出前输出 machine-readable validation report，后端会抽取并优先用于 tests / build / lint 摘要。

但这套结构化验证结果还缺更完整的覆盖，例如：

- skipped / partial / multi-step validation 的一致表示
- 对 artifact 做更稳定的优先级排序
- 自动提炼更明确的人类审校摘要

### 4.3 Issue 与 PR 的双向关联仍然偏弱

当前支持关闭关联 Issue，但还缺更清晰的任务链视图：

- 这个 PR 来自哪个 Issue
- 当前 PR 正在解决 Issue 的哪部分反馈
- 合并后如何回写 Issue 状态

## 5. 关键流程

### 当前已实现流程

1. 创建 PR 时校验 base/head。
2. 系统阻止同一 `head/base` 组合的重复未关闭 PR。
3. PR 页面可展示 compare、reviews、review threads、validation summary、merge summary、Agent provenance。
4. 用户可从 thread 直接继续 Agent。
5. 新 commit 后，thread 会尝试重新锚定到当前 diff；无法锚定时明确标记 stale。
6. 合并成功后自动关闭关联 Issue。

### 目标流程

1. Agent 基于 Issue 提交 PR。
2. 人类在 PR 中评审代码和测试产物。
3. Agent 根据 review thread 继续修改。
4. 新 commit 后 review thread 连续映射到最新 patch-set。
5. PR 页面持续汇总“最新改动 + 最新验证 + 最新反馈 + 关联 Issue 完成度”。
6. 人类完成最终合并。

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
- `GET /api/repos/:owner/:repo/pulls/provenance/latest`
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
- `src/services/agent-session-validation-summary.ts`
- `src/routes/api.ts`
- `web/src/pages/pull-request-detail-page.tsx`
- `web/src/lib/validation-summary.ts`
- `web/src/components/repository/repository-diff-view.tsx`

## 9. 当前边界与下一步

- 当前只有 squash merge。
- PR 页面已具备 tests / build / lint validation summary 和 merge summary，并开始优先消费 runtime-emitted structured validation report。
- PR provenance 已支持批量读取，以便把来源 Issue 中的关联 PR 验证结果直接回流。
- thread 已具备第一版重锚定和 stale 标记，但更复杂 diff 还缺更智能映射。

下一步优先级：

1. 把 PR 和来源 Issue 之间的状态回流做得更明显。
2. 继续扩展结构化验证结果的覆盖面和 artifact 优先级提炼。
3. 提升 review thread 在 rename / 复杂 patch-set 下的锚点映射质量。
