# 仓库管理与协作 PRD

## 1. 模块定位

仓库模块负责回答三个基础问题：

- 代码放在哪里。
- 谁可以访问和协作。
- Issue、PR、Actions 等协作对象附着在哪个边界内。

当前仓库层永久保持最小集，个人仓库是固定边界，不扩展到 Org / Team / 组织治理系统。

## 2. 当前已实现能力

- 首页公开仓库发现。
- Dashboard 展示“我拥有的仓库”和“我参与协作的仓库”。
- 创建仓库。
- 修改仓库名称、描述和公开/私有状态。
- 仓库设置页展示 Clone URL，并支持一键复制。
- 删除仓库。
- 协作者管理：
  - 列表查询
  - 新增或更新权限
  - 移除协作者
- 参与者列表可供 Issue 指派、PR 指派和 reviewer 选择复用。
- 仓库详情接口会返回：
  - open issue / open pull request 计数
  - 是否可创建 issue / pull request
  - 是否可运行 agent
  - 是否可管理 actions

## 3. 当前协作模型

- 仓库永久只保留个人 owner 模型，不设计 organization/team。
- collaborator 只有仓库级 `read / write / admin` 三档权限。
- owner 与 `admin` collaborator 可管理仓库设置与 Actions 配置。
- `write / admin` collaborator 可参与代码写入、Issue/PR 维护和 agent 驱动的交付动作。
- Agent Session 不拥有独立仓库角色，而是沿用触发者可用权限。

## 4. 当前关键流程

### 4.1 仓库创建与生命周期

1. 用户创建仓库。
2. D1 写入仓库元数据。
3. Git 存储层初始化默认分支 `main` 及基础仓库结构。
4. 后续仓库页、Git 路由、Issue/PR/Actions 都以该仓库为边界工作。

### 4.2 协作扩散

1. owner 添加 collaborator。
2. collaborator 获得读/写/管理能力。
3. Issue、PR、review 和 run/session 都在同一仓库边界内协作。

### 4.3 仓库重命名

1. 修改 D1 中的仓库名称。
2. Git 存储前缀同步迁移。
3. 仓库详情与 Git 远端地址切换到新路径。

## 5. 当前接口

- `GET /api/public/repos`
- `GET /api/repos`
- `POST /api/repos`
- `PATCH /api/repos/:owner/:repo`
- `DELETE /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo/collaborators`
- `PUT /api/repos/:owner/:repo/collaborators`
- `DELETE /api/repos/:owner/:repo/collaborators/:username`
- `GET /api/repos/:owner/:repo/participants`

## 6. 当前数据模型

- `repositories`
- `repository_collaborators`
- `repository_counters`

## 7. 关键代码文件

- `src/services/repository-service.ts`
- `src/services/storage-service.ts`
- `src/routes/api/index.ts`
- `src/routes/api/repository-admin-routes.ts`
- `src/routes/api/repository-admin-routes.test.ts`
- `src/routes/api/repository-metadata-routes.ts`
- `web/src/pages/home-page.tsx`
- `web/src/pages/dashboard-page.tsx`
- `web/src/pages/new-repository-page.tsx`
- `web/src/pages/repository-settings-page.tsx`
- `web/src/pages/repository-collaborators-page.tsx`

## 8. 当前边界与缺口

### 8.1 仓库仍是“个人仓库 + 协作者”

- 组织、团队、组级权限不是未来规划，仓库协作边界永久限定在个人仓库 + collaborator。
- 当前没有 fork、template repo、archive 等扩展仓库模型。

### 8.2 仓库页仍以代码入口为主

- 已经有 open issue / open pull request 计数。
- 但仓库首页还没有把“当前活跃任务链、活跃 session、最近交付分支”组织成更明显的任务导航层。

### 8.3 默认分支能力不足

- 创建仓库默认初始化 `main`。
- 当前没有默认分支切换与分支保护能力。

### 8.4 删除仍是硬删除

- 当前仓库删除会直接清理元数据和存储，不提供回收站或软删除。

## 9. 下一步优先级

1. 增加默认分支切换能力。
2. 强化仓库页到活跃 Issue / PR / Session 的导航。
3. 继续把仓库页从“单纯代码入口”提升为“任务入口 + 代码入口”的混合视图。

## 10. 2026-03 分支管理补充

- 仓库设置页新增分支管理区块，owner 可直接：
  - 创建分支
  - 删除非默认分支
  - 切换默认分支
- 分支管理暂仅对仓库 owner 开放，与当前仓库重命名 / 删除权限保持一致。
- 默认分支切换通过更新 Git `HEAD` 指向实现，仓库详情页与代码浏览页会随之读取新的默认分支。
- 删除分支受两条保护规则限制：
  - 默认分支不可删除
  - 仓库至少保留一个分支
- 新增接口：
  - `POST /api/repos/:owner/:repo/branches`
  - `PATCH /api/repos/:owner/:repo/default-branch`
  - `DELETE /api/repos/:owner/:repo/branches/:branch`
