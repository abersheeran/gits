# 仓库管理与协作 PRD

## 1. 模块目标

让用户能够创建、维护、发现和协作使用仓库，并把仓库级权限、参与者和基础设置管理集中在一套模型里。

## 2. 当前能力范围

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

## 3. 权限模型

- `read`：可读取私有仓库内容，可进入协作流程，但不能修改仓库设置。
- `write`：可管理标签、里程碑等写操作。
- `admin`：可管理协作者。
- Owner：独占仓库重命名、删除、可见性修改能力。

## 4. 关键流程

1. 新建仓库时先写 D1，再初始化 R2 中的仓库结构；如果任一环节失败，会回滚。
2. 仓库重命名时会先迁移 R2 对象键，再更新 D1；数据库更新失败时再把 R2 名称迁回去。
3. Dashboard 查询同时覆盖 owner 关系和 collaborator 关系。
4. 参与者集合由 owner 和协作者合并去重后生成。

## 5. 核心接口

- `GET /api/public/repos`
- `GET /api/repos`
- `POST /api/repos`
- `PATCH /api/repos/:owner/:repo`
- `DELETE /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo/collaborators`
- `PUT /api/repos/:owner/:repo/collaborators`
- `DELETE /api/repos/:owner/:repo/collaborators/:username`
- `GET /api/repos/:owner/:repo/participants`

## 6. 数据模型

- `repositories`
- `repository_collaborators`
- `repository_counters`

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

## 8. 当前边界与注意点

- 当前只有“用户个人仓库”模型，没有组织、团队、分组空间。
- 分支保护、默认分支切换、归档、模板仓库等仓库治理能力尚未实现。
- 协作者权限是仓库级，不支持目录级或分支级权限。
- 仓库删除为硬删除，D1 与 R2 数据都会移除。
