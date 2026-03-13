# Issue 与讨论 PRD

## 1. 模块定位

Issue 是当前产品里的任务入口、对话面和状态中心。

一个可用的 Issue 页面需要同时承载：

- 问题描述
- 验收标准
- 人机对话历史
- 当前在等谁
- 当前由哪条 PR 驱动交付

它不是复杂项目管理系统，而是当前主工作流的起点和回看点。

## 2. 当前已实现能力

### 2.1 基础对象

- Issue 列表与分页
- Issue 详情
- Issue 评论
- Issue 与评论 Reaction

### 2.2 任务中心

- `issues.task_status` 四态：
  - `open`
  - `agent-working`
  - `waiting-human`
  - `done`
- 独立 `acceptance_criteria`
- Issue 详情页的验收标准区已升级为查看态 / 编辑态切换面板；默认展示当前生效标准，进入编辑状态后只保留草稿编辑区与 write/preview、保存状态提示，并沿用页面内更接近标准卡片的圆角与间距
- Issue 详情页的评论编辑器也默认收起，只在显式进入编辑状态后展开 write/preview 与提交动作，并沿用页面内标准卡片尺度
- `taskFlow` 摘要：
  - 当前状态
  - 当前等待方
  - 自动生成的 headline / detail
  - 当前驱动 PR 编号

### 2.3 与交付链的连接

- Issue 详情会展示关联 PR。
- 每个关联 PR 会展示最近 session 进展。
- Issue 页会展示关联 PR 的 validation summary 与 highlighted artifacts 摘要。
- Issue 列表、详情头部和评论区的状态徽标都直接锚定到对应 session，而不是旧的 run 入口。
- Linked pull request 卡片只展示最新 session 与验证摘要，不再额外暴露独立 run 按钮。
- Issue 页不再铺开全文日志，全文入口统一回到 Actions 页或 Session detail。
- Issue 详情只在存在 pending issue session、comment session 或关联 PR validation 时继续轮询刷新，避免无意义的前端重复请求。

### 2.4 Agent 与自动化入口

- `assign-agent`
- `resume-agent`
- `@actions` mention
- Issue 新建后可触发 `issue_created` workflow
- 普通 issue comment 也会继续触发 issue workflow，以便让同一任务对话继续推进

## 3. 当前状态回流规则

Issue 不是独立状态机系统，当前主要靠 `issues.task_status` 和 `taskFlow` 表达主流程状态。

已实现的核心语义：

- Issue 关闭后收敛到 `done`
- 若关联 open PR 仍在执行、仍有 unresolved thread、change request、validation/mergeability 问题，则倾向 `agent-working`
- 若关联 open PR 已进入可人工判断或 merge-ready 阶段，则倾向 `waiting-human`
- 若没有 open PR，则回退到 Issue 自身最近 session 的状态解释
- Issue 列表与详情返回前会先重算并回写涉及的 task status，保证单次读请求内状态一致

## 4. 当前关键流程

### 4.1 从 Issue 发起任务

1. 人类创建 Issue，并补充验收标准。
2. 系统可按仓库 workflow 自动创建 session。
3. 用户也可以手动 assign/resume agent。

### 4.2 从对话继续推进

1. 人类继续在 Issue 中补充评论。
2. 非 `@actions` comment 仍会驱动 issue workflow 继续理解任务上下文。
3. `@actions` mention 会走单独的 mention workflow。

### 4.3 向 PR 转移交付

1. Agent 根据 Issue 内容推分支或创建 PR。
2. PR review / validation / merge 状态回流到 Issue 的 task center。
3. 用户可以在 Issue 中直接看到当前驱动 PR 和最新交付摘要。

## 5. 当前接口

- `GET /api/repos/:owner/:repo/issues`
- `GET /api/repos/:owner/:repo/issues/:number`
- `GET /api/repos/:owner/:repo/issues/:number/comments`
- `POST /api/repos/:owner/:repo/issues`
- `PATCH /api/repos/:owner/:repo/issues/:number`
- `POST /api/repos/:owner/:repo/issues/:number/comments`
- `POST /api/repos/:owner/:repo/issues/:number/assign-agent`
- `POST /api/repos/:owner/:repo/issues/:number/resume-agent`
- `GET /api/repos/:owner/:repo/pulls/provenance/latest`
- `GET /api/repos/:owner/:repo/agent-sessions/latest`
- `GET /api/repos/:owner/:repo/agent-sessions/latest-by-comments`

## 6. 当前数据模型

- `issues`
- `issue_comments`

## 7. 关键代码文件

- `src/services/issue-service.ts`
- `src/services/repository-metadata-service.ts`
- `src/services/workflow-task-flow-service.ts`
- `src/services/action-trigger-service.ts`
- `src/routes/api/index.ts`
- `src/routes/api/issue-routes.ts`
- `src/routes/api/issue-routes.test.ts`
- `web/src/pages/repository-issues-page.tsx`
- `web/src/pages/new-issue-page.tsx`
- `web/src/pages/issue-detail-page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/validation-summary.ts`
- `web/src/components/repository/markdown-editor.tsx`

## 8. 当前边界与缺口

### 8.0 Issue 当前不提供 emoji reaction

- Issue 正文与评论页不再提供 emoji reaction 交互。
- 数据库不再保留 reaction 表，避免继续积累无业务价值的反馈噪音。

### 8.1 task center 已可用，但摘要仍偏首版

- 已经有 task status、taskFlow、关联 PR、最新 session 和 validation summary。
- 但“当前最该看哪条验证、哪份 artifact、哪段 handoff”还不够稳定。

### 8.2 任务状态不是硬 override

- 手动编辑 `task_status` 仍然允许。
- 但后续 assign/resume、review thread、merge、session 完成等事件会自动覆盖。

### 8.3 事件语义仍偏粗

- 当前主要区分 issue 新建、普通评论继续推进、`@actions` mention 和交付链回流。
- 还没有更细粒度的任务事件层。

### 8.4 Issue 仍未完全收拢整条交付链

- 当前已能回看到驱动 PR 和最近执行摘要。
- 但对“上一轮 Agent 实际完成了什么”的压缩表达仍不够强。

## 9. 下一步优先级

1. 继续增强 validation summary、artifact 优先级和人类审校摘要提炼。
2. 让 Issue 更稳定地承担整条任务链的统一入口与回看入口。
3. 在不引入重型状态机的前提下，继续补强更细粒度的事件语义。
