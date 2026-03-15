# Pull Request 与评审 PRD

## 1. 模块定位

PR 是当前产品里的交付中心和评审中心。

它承载的不是抽象审批流，而是一条非常具体的闭环：

1. Agent 或人类基于 Issue 发起 PR。
2. 人类查看 diff、validation summary 和 review thread。
3. Agent 根据 thread 或 PR 级 handoff 继续修改。
4. 人类决定是否 squash merge。

因此，PR 页最重要的是把“看改动、提反馈、继续修改、确认合并”组织成一条顺畅路径。

## 2. 当前已实现能力

### 2.1 PR 创建与元数据

- PR 列表与详情
- PR 列表页使用 URL `page` 参数管理分页，默认第 1 页，每页 20 条；切换 `open / closed / merged / all` 筛选会回到第 1 页
- 选择 `baseRef / headRef`
- draft
- closing issues
- 阻止同一 `head/base` 组合的重复 open PR

### 2.2 PR 详情

- compare 结果
- ahead / behind
- mergeability
- 文件 diff
- PR 详情页的 `Files changed` 以摘要卡进入右侧 Sheet，避免把大段 diff 与 reviews / handoff 直接平铺在主页面
- `Files changed` 右侧 Sheet 头部会持续显示 PR 标题、作者、分支流向与改动统计，避免进入 diff 后丢失当前评审上下文
- `Files changed` 默认只显示改动行以及上下 5 行代码，允许用户按需展开更多上下文
- `Files changed` 与 commit changes 左侧展示按目录组织的文件树，并标记新增 / 修改 / 删除文件
- `Files changed` 中新增或删除的文本文件继续按文本 diff 展示，不会错误降级成 `Binary change`
- review summary
- validation summary
- merge summary
- closing issues 完成度摘要
- `taskFlow` / handoff 摘要
- 最新 session provenance 摘要
- PR 列表与详情头部的状态徽标直接锚定到对应 session，Actions 跳转不再暴露独立 run 参数
- PR 详情只在存在 pending session 时继续轮询 provenance 与详情，静止状态下不维持后台刷新

### 2.3 Review

- review 决策：
  - `comment`
  - `approve`
  - `request_changes`
- review summary 按 reviewer 当前有效决策汇总，而不是历史累计
- PR 详情页的 submit review 编辑器默认收起，仅在显式进入编辑状态后展开 decision 与 write/preview，并沿用页面内标准卡片尺度

### 2.4 Review Thread

- anchored 到真实 diff path/range/hunk
- 多轮 comments
- 历史 comments 中如 API 返回 suggested change，会以只读代码块展示
- `open / resolved`
- `Files changed` 内支持类似 GitHub 的行级 comment 草稿流：
  - 点击行号或代码行即可选中 review range
  - 左侧文件树同步显示当前 patch 中被修改的文件，并可附带该文件的 `open / resolved` thread 数量，便于先按文件定位再进入 diff 评论
  - 草稿表单直接挂在对应文件的 diff 区块内，并默认先展示选区摘要；只有显式进入编辑状态后才展开正文编辑器、write/preview 与提交动作
  - 一旦草稿正文已有内容，草稿表单会保持展开，避免用户折叠后误以为草稿已丢失
  - 文件头展示该文件的 `open / resolved` thread 数量
  - `Files changed` 也提供独立的右侧 Sheet 组件形态，选中 review range 时会把 thread composer 固定到右栏
- 仓库页、PR / Issue / Actions 等分页标签在移动端统一支持横向滚动，保持当前标签可读且不压缩成多行
- 支持从单条 unresolved thread focused resume agent
- 新 commit 后会给出锚点状态：
  - `current`
  - `reanchored`
  - `stale`
- 同时显示 `patchset_changed`
- open review thread 下的 reply composer 默认收起，仅在显式进入编辑状态后展示正文编辑器与提交动作，并沿用页面内标准卡片尺度

### 2.5 Merge

- 当前只支持 squash merge
- 合并后自动关闭关联 closing issues
- 合并后自动删除 head 分支（head 与 base 相同时跳过，删除失败不影响合并结果）
- merge 成功会触发对应 `push` workflow

## 3. 当前 handoff 与状态语义

PR detail 会返回 `taskFlow`，当前主要回答：

- 现在是在等 agent 还是等人类
- 当前主导的关联 issue 是哪一个
- 如果要继续 agent，应该继续整个 PR 还是优先继续某条 review thread

已确定的关键规则：

- 如果有 unresolved review thread，主 CTA 默认继续最早的 open thread
- 如果没有 unresolved thread，则继续整个 PR
- `primaryIssueNumber` 优先选择仍 open 且未 `done` 的 closing issue
- PR detail 返回前会先重算并回写关联 closing issue 的 task status，保证 PR 与 Issue 侧状态一致

## 4. 当前验证摘要

PR 页面已经直接消费 session 的验证信息：

- 优先使用 runtime 输出的 structured validation report
- 缺失时回退到日志规则识别
- 当前可结构化展示：
  - tests
  - build
  - lint
  - `skipped`
  - `partial`
  - scoped multi-step checks
- highlighted artifacts 会按失败/通过上下文与检查命中结果做优先级排序
- validation summary 与 Agent handoff 只围绕最新 session 展示，不再额外分出 linked run 入口
- PR detail 中 Validation summary / Merge summary / Task chain / Agent handoff 的说明改为标题旁 HelpTip，正文只保留面向用户任务的状态信息

## 5. 当前关键流程

1. Agent 推分支并创建 PR。
2. PR 创建时触发 `pull_request_created` workflow。
3. 人类在 PR diff 上创建 review 和 review thread 评论。
4. Agent 从 PR 级或 thread 级入口继续执行。
5. 新 commit 后，thread 尝试映射到当前 patch set。
6. review、thread、session、merge 结果持续回流到 PR handoff 和关联 Issue task status。
7. 人类完成 squash merge。

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

## 7. 当前数据模型

- `pull_requests`
- `pull_request_reviews`
- `pull_request_review_threads`
- `pull_request_review_thread_comments`
- `pull_request_closing_issues`

## 8. 关键代码文件

- `src/services/pull-request-service.ts`
- `src/services/pull-request-review-thread-anchor-service.ts`
- `src/services/pull-request-merge-service.ts`
- `src/services/repository-browser-service.ts`
- `src/services/agent-session-validation-summary.ts`
- `src/services/workflow-task-flow-service.ts`
- `src/routes/api/index.ts`
- `src/routes/api/pull-request-routes.ts`
- `src/routes/api/pull-request-query-routes.ts`
- `src/routes/api/pull-request-review-routes.ts`
- `src/routes/api/pull-request-command-routes.ts`
- `src/routes/api/pull-request-routes.test.ts`
- `web/src/pages/pull-request-detail-page.tsx`
- `web/src/components/repository/pull-request-inline-thread-composer.tsx`
- `web/src/components/repository/pull-request-files-changed-sheet.tsx`
- `web/src/lib/validation-summary.ts`
- `web/src/components/repository/repository-diff-view.tsx`
- `web/src/components/repository/repository-change-diff-editor.tsx`
- `web/src/lib/monaco.ts`

## 9. 当前边界与缺口

### 9.0 PR 当前不提供 emoji reaction

- PR 正文与 review 记录页不再提供 emoji reaction 交互。
- 数据库不再保留 reaction 表，避免和 review decision / thread 状态形成重复信号。

### 9.1 review thread 连续性仍偏保守

- 已支持 current / reanchored / stale。
- 但 rename、复杂 diff、跨不连续 range 的映射仍不够强。

### 9.2 validation summary 仍是第一版 review 摘要

- 已经能展示 tests/build/lint 与重点 artifact。
- 但还缺更稳定的人类审校摘要和“先看什么”的明确排序。

### 9.3 handoff 已有规则，但反馈消化表达仍不足

- 已能告诉用户继续哪条 thread 或整个 PR。
- 但还缺“本轮 Agent 修改消化了哪些 thread/哪部分 Issue 反馈”的压缩表达。

### 9.4 merge 策略仍然最小化

- 当前只有 squash merge。
- 没有 rebase merge、merge commit、分支保护等更复杂策略。

## 10. 下一步优先级

1. 继续增强 validation summary 和 artifact 的 review-oriented 摘要能力。
2. 提升 review thread 在 rename / 复杂 patch set 下的锚点映射质量。
3. 增强“本轮修改消化了哪些反馈”的回流表达。
