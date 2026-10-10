# 仓库管理与协作 PRD

## 1. 模块定位

仓库模块管理代码归属、仓库生命周期、可见性与协作者。固定采用个人仓库模型，不扩展组织或团队。

## 2. 当前已实现能力

- 首页列出公开仓库；Dashboard 展示拥有及参与协作的仓库。
- 创建仓库，默认私有；可指定名称、描述和可见性。
- 所有者可重命名、修改描述、切换公开/私有和删除仓库。
- 设置页展示并支持复制 clone URL。
- 所有者可创建分支、切换默认分支、删除非默认分支。
- 所有者和 `admin` 协作者可列出协作者、添加已有用户、更新权限和移除协作者。

## 3. 当前协作模型

- `read`：读取仓库。
- `write`：读取及 Git push。
- `admin`：读取、Git push 及管理协作者。
- 所有者：上述全部能力，以及仓库设置、删除和分支管理 API。

`admin` 协作者不能修改仓库设置。分支管理 API 的所有者限制不等于分支保护；Git push 按仓库写权限处理引用更新。

## 4. 关键流程

### 4.1 创建与删除

创建先写入 D1 仓库元数据，再由 `RepositoryObject` 初始化指向 `refs/heads/main` 的 `HEAD`。此时没有提交或实际分支引用，首次 push 后才产生。初始化失败时尝试清理已创建的记录和存储。

删除先清理 R2 仓库数据、内存缓存和 DO 快照，再删除 D1 仓库记录及关联协作者；不提供恢复入口。

### 4.2 重命名

先迁移 R2 的仓库前缀，再更新 D1 名称；D1 更新失败时尝试回退存储名称。仓库 ID 保持不变，网页和 Git 远端地址随名称变化，客户端需更新远端地址。

### 4.3 协作者

按已有用户名添加或更新 `read / write / admin` 权限。所有者不能被添加为协作者，也不能通过协作者接口移除。

## 5. 当前接口

- `GET /api/public/repos`：公开仓库，支持 `limit`。
- `GET /api/repos`：当前用户拥有或参与协作的仓库。
- `POST /api/repos`：`name`、可选 `description`、`isPrivate`。
- `GET /api/repos/:owner/:repo`：仓库详情。
- `PATCH /api/repos/:owner/:repo`：更新 `name`、`description`、`isPrivate`。
- `DELETE /api/repos/:owner/:repo`：删除仓库。
- `GET /api/repos/:owner/:repo/collaborators`：协作者列表。
- `PUT /api/repos/:owner/:repo/collaborators`：`username`、`permission`。
- `DELETE /api/repos/:owner/:repo/collaborators/:username`：移除协作者。
- `GET /api/repos/:owner/:repo/branches`：分支列表。
- `POST /api/repos/:owner/:repo/branches`：`branchName`、`sourceOid`（仓库内已有提交的 40 位 OID）。
- `PATCH /api/repos/:owner/:repo/default-branch`：`branchName`。
- `DELETE /api/repos/:owner/:repo/branches/:branch`：删除分支；路径中的分支名需 URL 编码。

## 6. 当前数据模型

- `repositories`：ID、所有者 ID、名称、描述、可见性、创建时间；同一所有者下名称唯一。
- `repository_collaborators`：仓库 ID、用户 ID、权限和创建时间；仓库与用户组成联合主键。
- 分支与默认分支保存在 Git 引用及 `HEAD` 中，由 DO 读取，不另建 D1 分支表。

## 7. 关键代码文件

- `src/services/repository-service.ts`
- `src/services/storage-service.ts`
- `src/services/repository-object.ts`
- `src/routes/api/repository-admin-routes.ts`
- `src/routes/api/repository-browser-routes.ts`
- `web/src/pages/home-page.tsx`
- `web/src/pages/dashboard-page.tsx`
- `web/src/pages/new-repository-page.tsx`
- `web/src/pages/repository-settings-page.tsx`
- `web/src/pages/repository-branches-page.tsx`
- `web/src/pages/repository-collaborators-page.tsx`

## 8. 当前边界与下一步

没有分支保护、仓库派生、模板仓库、归档或回收站；仓库列表尚无分页。下一步优先补充分支保护和仓库列表分页，改善仓库数量增长后的管理体验。

## 9. 2026-03 分支管理补充

- 独立分支管理页仅对所有者开放，通过侧边表单创建分支，可删除非默认分支和切换默认分支。
- 设置页只保留基本设置与删除入口。
- 默认分支切换更新 Git `HEAD`，仓库详情与代码浏览随之读取新默认分支。
- 分支删除 API 禁止删除默认分支，并要求至少保留一个分支。
- 对应创建、默认分支切换和删除接口见第 5 节。

## 10. 2026-03 全局导航滚动行为补充

顶部全局导航随页面内容自然滚动，不固定吸附在视口顶部。首页、Dashboard、仓库与设置页面共享同一导航壳层。
