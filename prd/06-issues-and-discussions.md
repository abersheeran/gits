# Issue 与讨论 PRD

## 1. 模块目标

提供轻量工单与讨论面，让协作者围绕仓库中的问题、需求和自动化结果进行记录、更新和交流。

## 2. 当前能力范围

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

- 公开仓库的 Issue 列表与详情可匿名查看。
- 私有仓库只有可读用户可查看。
- 创建 Issue、更新 Issue、发表评论要求当前用户是 owner 或 collaborator。
- 标签、里程碑的维护属于仓库写权限，不属于普通读权限。
- Reaction 需要登录，但对“可读仓库”即可操作。

## 4. 关键流程

1. 创建 Issue 时，先校验标签、指派人、里程碑归属，再写入 Issue 主记录和关联元数据。
2. 创建 Issue 后，系统会构建会话历史，并按默认分支上下文触发自动化工作流。
3. 更新 Issue 时，如果正文从“未 mention”变成“出现 `@actions`”，会新增 mention run。
4. 新评论后会重新构造整段 Issue 对话历史，供后续自动化运行使用。

## 5. 核心接口

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

## 6. 数据模型

- `issues`
- `issue_comments`
- `repository_labels`
- `repository_milestones`
- `issue_labels`
- `issue_assignees`
- `reactions`

## 7. 关键代码文件

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

## 8. 当前边界与注意点

- 还没有 Issue 评论编辑、删除、引用回复、富文本附件。
- 没有看板、迭代、优先级、模板等项目管理层能力。
- Issue 自动化复用了 `issue_created` 事件语义，事件名本身没有拆成更细的 `issue_commented`。
