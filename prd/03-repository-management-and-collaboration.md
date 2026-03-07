# 仓库管理与协作 PRD

## 1. 模块目标

让用户能够创建、维护、治理和协作使用仓库，并把“人类协作者规则”与“Agent 执行规则”统一到同一套仓库模型里。

对于 Agent 原生平台，仓库管理不只是“创建一个 repo”，还必须定义：

- 谁能在这个仓库里运行 Agent
- Agent 能写哪些分支
- 哪些检查、评审和仓库规则是强制的
- 团队与组织如何复用治理策略

## 2. 当前能力基线

- 公共仓库发现：
  - 首页展示公开仓库列表
  - `GET /api/public/repos`
- 个人仓库视图：
  - Dashboard 展示“我拥有的仓库 + 我协作的仓库”
  - `GET /api/repos`
- 仓库创建：
  - 名称校验
  - 私有仓库默认开启
  - 创建成功后初始化 `HEAD -> refs/heads/main`
- 仓库设置：
  - 修改名称
  - 修改描述
  - 修改公开/私有状态
  - 删除仓库
- 协作者管理：
  - 查询协作者
  - 新增或更新协作者权限
  - 删除协作者
- 参与者列表：
  - 返回 owner + collaborators，用于 Issue/PR 指派与评审人选择

## 3. 面向 Agent 原生目标需要补足

### 3.1 仓库治理能力

- 分支保护与 Ruleset：
  - 受保护分支
  - required checks
  - required reviews
  - 推送限制
  - 强制通过 PR 合并
- 默认分支切换
- 仓库归档
- 模板仓库
- Fork 与上游同步策略
- CODEOWNERS / Review Ownership 规则

### 3.2 Agent 与仓库规则

仓库层不再单独维护一张 Agent Policy 表，而是直接复用现有仓库权限与未来的 Ruleset：

- 谁能运行 Agent：
  - owner
  - collaborator
  - 后续可扩展到 team / org role
- Agent 执行范围：
  - 直接继承触发用户的仓库权限
  - 可创建新分支或更新已有工作分支
  - 可推送分支、创建 PR、回写 Issue / PR 评论
  - 具体限制由受保护分支、required checks、required reviews 等仓库规则决定
- 仓库页面需要展示的重点不再是“允许 Agent 做什么”，而是：
  - 当前仓库有哪些治理规则
  - Agent Session 产物会落到哪些分支和 PR
  - 哪些关键分支受保护

### 3.3 协作角色

现有 `read / write / admin / owner` 仍可保留，但需要扩展出与 Agent 相关的能力位，例如：

- `run_agents`
- `view_audit_logs`
- `cancel_agent_sessions`

## 4. 关键流程

### 当前已实现流程

1. 新建仓库时先写 D1，再初始化 R2 中的仓库结构；如果任一环节失败，会回滚。
2. 仓库重命名时会先迁移 R2 对象键，再更新 D1；数据库更新失败时再把 R2 名称迁回去。
3. Dashboard 查询同时覆盖 owner 关系和 collaborator 关系。
4. 参与者集合由 owner 和协作者合并去重后生成。

### 目标流程

1. 创建仓库时，同时选择仓库模板与默认治理规则。
2. 为仓库配置分支保护、required checks、默认 reviewer 规则。
3. 当用户把任务交给 Agent 时，系统直接继承触发用户在仓库内的权限，并生成可追溯的 Session。
4. Agent 产出的分支、PR、评论与 artifact 都带有完整的溯源信息，且仍受仓库治理规则约束。

## 5. 核心接口

### 当前接口

- `GET /api/public/repos`
- `GET /api/repos`
- `POST /api/repos`
- `PATCH /api/repos/:owner/:repo`
- `DELETE /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo/collaborators`
- `PUT /api/repos/:owner/:repo/collaborators`
- `DELETE /api/repos/:owner/:repo/collaborators/:username`
- `GET /api/repos/:owner/:repo/participants`

### 建议新增接口

- `POST /api/repos/:owner/:repo/rulesets`
- `GET /api/repos/:owner/:repo/rulesets`
- `PATCH /api/repos/:owner/:repo/rulesets/:rulesetId`
- `POST /api/repos/:owner/:repo/archive`
- `POST /api/repos/:owner/:repo/fork`

## 6. 数据模型

### 当前数据

- `repositories`
- `repository_collaborators`
- `repository_counters`

### 建议新增数据

- `repository_rulesets`
- `repository_branch_policies`
- `repository_templates`
- `repository_forks`

## 7. 关键代码文件

- `src/services/repository-service.ts`
- `src/services/storage-service.ts`
- `src/routes/api.ts`
- `web/src/pages/home-page.tsx`
- `web/src/pages/dashboard-page.tsx`
- `web/src/pages/new-repository-page.tsx`
- `web/src/pages/repository-settings-page.tsx`
- `web/src/pages/repository-collaborators-page.tsx`
- `web/src/components/repository/repository-header.tsx`

后续预计新增：

- `src/services/repository-policy-service.ts`
- `web/src/pages/repository-rulesets-page.tsx`

## 8. 当前边界与下一步

### 近期已落地（2026-03）

- 已移除 `repository_agent_policies`，不再为仓库单独维护 Agent 能力白名单
- Agent Session 现在直接继承触发用户在仓库内的权限
- 仓库详情权限已收口为：
  - `canRunAgents`
  - `canManageActions`
- 仓库 Actions 页面保留：
  - 最近 Agent Session 可观测性
  - session 取消入口
  - runner / container 配置入口

- 当前只有”用户个人仓库”模型
- 分支保护、默认分支切换、归档、模板仓库等仓库治理能力尚未实现
- 协作者权限是仓库级，不支持目录级或分支级权限
- 仓库删除为硬删除，D1 与 R2 数据都会移除

下一步优先级：

1. 增加 Ruleset、分支保护、required checks
2. 增加模板仓库、归档与 fork 策略
3. 把仓库治理规则与 Agent Session 溯源打通
