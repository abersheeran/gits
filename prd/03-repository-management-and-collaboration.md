# 仓库管理与协作 PRD

## 1. 模块目标

仓库模块只需要承担最小职责：

- 提供代码容器。
- 定义谁能协作。
- 为 `Issue -> PR -> Merge` 工作流提供基础边界。

它不应该扩展成复杂的治理控制台。

## 2. 当前能力基线

- 公开仓库发现。
- Dashboard 展示拥有的仓库和参与协作的仓库。
- 创建仓库。
- 修改仓库名称、描述、公开/私有状态。
- 删除仓库。
- 协作者管理：
  - 查询协作者
  - 新增或更新权限
  - 删除协作者
- 参与者列表可用于 Issue/PR 指派与评审人选择。

## 3. 当前协作模型

- owner 拥有仓库最高权限。
- collaborator 具备 `read / write / admin` 三档权限。
- Agent Session 直接继承触发用户的仓库权限。
- `canRunAgents` 与 `canManageActions` 已进入仓库权限视图。

## 4. 面向主工作流仍需补足

### 4.1 仓库页面还没有把任务流展示清楚

当前仓库更多还是代码入口，接下来要更清楚地承载：

- 当前有哪些活跃 Issue
- 当前有哪些 Agent 正在推进的 PR
- 最近 Session 产物落到了哪些分支和 PR

### 4.2 默认协作路径还需要更顺

当前已经有协作者模型，但从仓库进入主工作流时，还缺少更强的入口串联：

- 从仓库快速进入活跃 Issue
- 从 Issue 快速看到交付中的 PR
- 从 PR 快速回到来源 Issue

### 4.3 默认分支管理仍然偏死

当前创建仓库时默认就是 `main`，但还没有默认分支切换能力。这个不是复杂治理能力，而是一个基础仓库能力。

## 5. 关键流程

### 当前已实现流程

1. 创建仓库时写入 D1 并初始化 R2 中的 Git 仓库结构。
2. 重命名仓库时会同步迁移 R2 对象前缀。
3. Dashboard 同时按 owner 和 collaborator 关系列出仓库。
4. Issue/PR 可复用 owner + collaborators 作为参与者集合。

### 目标流程

1. 用户创建仓库并邀请协作者。
2. 协作者在仓库中提交 Issue。
3. Agent 基于 Issue 工作并发起 PR。
4. 人类在同一仓库内继续评审和合并。

## 6. 当前接口

- `GET /api/public/repos`
- `GET /api/repos`
- `POST /api/repos`
- `PATCH /api/repos/:owner/:repo`
- `DELETE /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo/collaborators`
- `PUT /api/repos/:owner/:repo/collaborators`
- `DELETE /api/repos/:owner/:repo/collaborators/:username`
- `GET /api/repos/:owner/:repo/participants`

## 7. 当前数据

- `repositories`
- `repository_collaborators`
- `repository_counters`

## 8. 关键代码文件

- `src/services/repository-service.ts`
- `src/services/storage-service.ts`
- `src/routes/api.ts`
- `web/src/pages/home-page.tsx`
- `web/src/pages/dashboard-page.tsx`
- `web/src/pages/new-repository-page.tsx`
- `web/src/pages/repository-settings-page.tsx`
- `web/src/pages/repository-collaborators-page.tsx`

## 9. 当前边界与下一步

- 当前只有个人仓库模型。
- 协作者权限仍然是仓库级。
- 仓库删除仍是硬删除。
- 仓库页对“当前任务链”展示还不够强。

下一步优先级：

1. 增加默认分支切换。
2. 提升仓库页对活跃 Issue / PR / Session 的入口组织。
3. 把 Issue、PR、Session 之间的导航关系做得更明显。
