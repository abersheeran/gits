# Issue 与讨论 PRD

## 1. 模块目标

提供任务面与讨论面，让协作者能够围绕仓库中的问题、需求和自动化结果进行记录、更新、协作，并把 Issue 升级为可交给 Agent 的任务载体。

在 Agent 原生平台里，Issue 不应只是记录问题的地方，还应承担：

- 任务分派
- 上下文承载
- 验收标准定义
- Agent 进度反馈
- 人机协作的连续对话历史

## 2. 当前能力基线

- Issue 列表：
  - 支持 `open`、`closed`、`all`
  - 支持分页
- Issue 详情：
  - 标题、正文、状态
  - 标签、里程碑、指派人
  - Reaction 汇总
- 评论：
  - 可新增 Issue 评论
  - 评论自带 Reaction
- 元数据管理：
  - 标签、里程碑由仓库级元数据服务提供
  - 可把 owner + collaborators 作为可指派用户
- 自动化联动：
  - 新建 Issue 触发 `issue_created`
  - 新评论也沿用 `issue_created` 事件模型，但会在 prompt 中注明 `issue_comment_added`
  - 正文或评论出现 `@actions` 时触发 `mention_actions`
- Actions 代发评论：
  - 使用内部 Token 时，评论作者可显示为 `actions`

## 3. 权限与可见性

- 公开仓库的 Issue 列表与详情可匿名查看
- 私有仓库只有可读用户可查看
- 创建 Issue、更新 Issue、发表评论要求当前用户是 owner 或 collaborator
- 标签、里程碑的维护属于仓库写权限，不属于普通读权限
- Reaction 需要登录，但对“可读仓库”即可操作

面向 Agent 原生目标，还需要补充：

- `assign_to_agent`
- `resume_agent_session`
- `accept_agent_result`
- `manage_issue_templates`

## 4. 面向 Agent 原生目标需要补足

### 4.1 任务编排

- Agent Assignment：将 Issue 直接分派给指定 Agent
- 验收标准 / Checklist
- 优先级、类型、复杂度估算
- Task State：
  - `open`
  - `in_progress`
  - `waiting_for_agent`
  - `waiting_for_human`
  - `done`

### 4.2 会话衔接

- 从 Issue 创建 Agent Session
- 在评论中继续 / 停止 / 重试 Agent
- 支持 handoff：一个 Agent 结束后交给另一个 Agent 或人类
- 每条 Agent 评论应能链接到具体 Session、PR、commit 或 artifact

### 4.3 更细的事件模型

- `issue_created`
- `issue_commented`
- `issue_reopened`
- `issue_assigned_to_agent`
- `issue_agent_resumed`

当前把评论复用到 `issue_created` 语义里不利于后续扩展，应拆为显式事件。

### 4.4 任务模板与上下文

- Issue 模板
- 任务描述模板
- 结构化验收标准
- 附件与引用回复
- 与 Context Bundle 的关联

## 5. 关键流程

### 当前已实现流程

1. 创建 Issue 时，先校验标签、指派人、里程碑归属，再写入 Issue 主记录和关联元数据。
2. 创建 Issue 后，系统会构建会话历史，并按默认分支上下文触发自动化工作流。
3. 更新 Issue 时，如果正文从“未 mention”变成“出现 `@actions`”，会新增 mention run。
4. 新评论后会重新构造整段 Issue 对话历史，供后续自动化运行使用。

### 目标流程

1. 用户创建 Issue 时可直接选择“指派给 Agent”。
2. 系统据此生成 Task + Agent Session，并挂上验收标准与上下文包。
3. Agent 运行中可持续回写进度、计划、阻塞点和产出链接。
4. 用户在评论里要求调整后，系统从同一任务上下文恢复或创建新的 Session。
5. 若 Agent 通过 PR 交付结果，Issue 自动关联到 PR、Review、merge 状态与最终交付物。

## 6. 核心接口

### 当前接口

- `GET /api/repos/:owner/:repo/issues`
- `GET /api/repos/:owner/:repo/issues/:number`
- `GET /api/repos/:owner/:repo/issues/:number/comments`
- `POST /api/repos/:owner/:repo/issues`
- `PATCH /api/repos/:owner/:repo/issues/:number`
- `POST /api/repos/:owner/:repo/issues/:number/comments`
- `GET /api/repos/:owner/:repo/labels`
- `POST /api/repos/:owner/:repo/labels`
- `GET /api/repos/:owner/:repo/milestones`
- `PUT /api/repos/:owner/:repo/reactions`
- `DELETE /api/repos/:owner/:repo/reactions`

### 建议新增接口

- `POST /api/repos/:owner/:repo/issues/:number/assign-agent`
- `POST /api/repos/:owner/:repo/issues/:number/resume-agent`
- `POST /api/repos/:owner/:repo/issues/:number/stop-agent`
- `GET /api/repos/:owner/:repo/issues/:number/sessions`
- `POST /api/repos/:owner/:repo/issue-templates`

## 7. 数据模型

### 当前数据

- `issues`
- `issue_comments`
- `repository_labels`
- `repository_milestones`
- `issue_labels`
- `issue_assignees`
- `reactions`

### 建议新增数据

- `issue_task_states`
- `issue_acceptance_criteria`
- `issue_agent_assignments`
- `issue_agent_sessions`
- `issue_templates`

## 8. 关键代码文件

- `src/services/issue-service.ts`
- `src/services/repository-metadata-service.ts`
- `src/services/action-trigger-service.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-issues-page.tsx`
- `web/src/pages/new-issue-page.tsx`
- `web/src/pages/issue-detail-page.tsx`
- `web/src/components/repository/reaction-strip.tsx`
- `web/src/components/repository/repository-metadata-fields.tsx`
- `web/src/components/repository/markdown-editor.tsx`

后续预计新增：

- `src/services/issue-task-service.ts`
- `web/src/components/repository/issue-agent-panel.tsx`
- `web/src/components/repository/issue-acceptance-criteria.tsx`

## 9. 当前边界与下一步

### 近期已落地（2026-03）

- 已新增 Issue 级 Agent 入口：
  - `POST /api/repos/:owner/:repo/issues/:number/assign-agent`
  - `POST /api/repos/:owner/:repo/issues/:number/resume-agent`
- Issue 详情页现在会展示最近的 Agent Session，并支持：
  - 选择 Agent 类型
  - 输入额外指令
  - 从当前 Issue 对话上下文 assign / resume
  - 跳转到对应 Actions session / run
- Session 创建时会携带完整 Issue 正文与评论历史，而不是只把 `@actions` 当成一次性 prompt 触发

- 还没有 Issue 评论编辑、删除、引用回复、富文本附件
- 没有看板、迭代、优先级、模板等项目管理层能力
- Issue 自动化复用了 `issue_created` 事件语义，事件名本身没有拆成更细的 `issue_commented`
- 还没有 `stop-agent`、任务状态机、验收标准与 handoff

下一步优先级：

1. 增加 Agent Assignment 与 Task State
2. 拆分 Issue 事件模型
3. 增加验收标准、模板与 resume/handoff
4. 把 Agent 输出与 Issue 生命周期打通
