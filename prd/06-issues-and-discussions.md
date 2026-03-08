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
- Issue 已支持单独维护验收标准。
- Issue 详情页已展示关联 PR，以及每个关联 PR 的最新 Session / run 进展。
- Issue 详情页已开始直接展示关联 PR 的第一版 validation summary 与关键 artifact 摘要。
- Issue 详情页已开始把关联 PR 的验证结果结构化成 tests / build / lint 线索与重点 artifact。

## 3. 当前工作流

当前已经可以做到：

1. 人类创建 Issue。
2. Agent 基于 Issue 正文与评论历史进入执行。
3. Agent 可继续通过 Session 推进工作。

Issue 已经开始成为“任务中心”，但还没有把整条交付链的上下文完全收拢。

## 4. 面向主工作流仍需补足

### 4.1 Task center 已有骨架，但还不够自动

现在已经有：

- 简洁任务状态
- 验收标准
- 关联 PR 视图
- 最近 Issue run / Session 视图
- 关联 PR 的第一版验证摘要回流
- 关联 PR 的 rule-based tests / build / lint 验证摘要

但仍缺：

- 更自动的状态回流，而不是主要靠人类手动切换
- 更稳定的“当前该看哪条验证 / 哪个 artifact”提炼
- 更高置信度的测试 / 构建识别，而不是只靠输出规则归纳

### 4.2 Agent 对话入口还可以更顺

当前已经有 assign/resume，但还缺：

- 更明显的“继续让 Agent 处理”入口
- 更明显的“当前在等谁”状态提示
- 从最新 Session / PR / review 反馈回到 Issue 的连续视图

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
5. 合并完成后，Issue 明确收敛为完成状态。

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

- 当前没有任务状态机。
- 当前任务状态仍主要靠显式切换，而不是更强的自动回流。
- 当前已有 Issue <-> PR <-> Session 汇总视图，且关联 PR 已带 tests / build / lint 线索、验证 headline 与重点 artifact 摘要。
- 但当前验证摘要仍依赖输出规则归纳，离真正稳定的任务级判断还差 agent 主动产出的结构化检查结果。
- Issue 事件模型仍然偏粗。

下一步优先级：

1. 继续增强“当前在等谁”的自动状态回流。
2. 把 Issue 中的验证摘要从规则识别升级为更稳定的结构化测试/构建结果。
3. 让 Issue 成为整个任务链的统一入口与回看入口。
