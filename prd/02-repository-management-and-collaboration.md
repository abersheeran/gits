# 仓库管理与协作 PRD

## 1. 模块定位

仓库模块管理代码归属、仓库生命周期、可见性、分支与协作者。仓库固定归个人所有。

## 2. 能力

- 探索页（`/`）列出最新创建的公开仓库；我的仓库页（`/dashboard`）列出拥有及参与协作的仓库。两个列表均在前端每页 20 条。
- 创建仓库（`/repositories/new`）：名称、可选描述和可见性，默认私有；创建成功后直接进入仓库页。
- 所有者可重命名、修改描述、切换公开/私有和删除仓库。
- 所有可读用户可查看分支列表；所有者可创建分支、切换默认分支、删除非默认分支。
- 所有者和 `admin` 协作者可列出协作者、添加已有用户、更新权限和移除协作者。

## 3. 协作模型

- `read`：读取仓库。
- `write`：读取及 Git push。
- `admin`：读取、Git push 及管理协作者。
- 所有者：上述全部能力，以及仓库设置、删除和分支管理。

`admin` 协作者不能修改仓库设置。分支管理的所有者限制不等于分支保护：有写权限即可通过 Git push 创建、更新或删除任意引用。

## 4. 关键流程

### 4.1 创建与删除

创建先写入 D1 仓库元数据，再由 `RepositoryObject` 初始化指向 `refs/heads/main` 的 `HEAD`。此时没有提交或实际分支引用，首次 push 后才产生。初始化失败时尝试清理已创建的记录和存储。

删除需在确认对话框中输入匹配的仓库名。删除先清理 R2 仓库数据、内存缓存和 DO 快照，再删除 D1 仓库记录及关联协作者，不可恢复。

### 4.2 重命名

先迁移 R2 的仓库前缀，再更新 D1 名称；D1 更新失败时尝试回退存储名称。仓库 ID 保持不变，网页和 Git 远端地址随名称变化，客户端需更新远端地址。

### 4.3 分支

- 新建分支使用对话框，来源可选已有分支（默认选中默认分支）或输入完整提交 SHA；API 统一接收 40 位 `sourceOid`。
- 切换默认分支更新 Git `HEAD`，仓库详情与代码浏览随之读取新默认分支。
- 删除分支须确认；不能删除默认分支，且至少保留一个分支。

### 4.4 协作者

通过对话框按已有用户名添加协作者；权限在列表内直接选择并保存，移除须确认。所有者不能被添加为协作者，也不能通过协作者接口移除。

## 5. 界面

- 仓库页由仓库头与「代码 / 提交 / 分支 / 设置」标签组成；「设置」标签对所有者和 `admin` 协作者可见，其他用户不显示。
- 所有者的设置分「常规」（`/repo/:owner/:repo/settings`）与「协作者」（`/repo/:owner/:repo/collaborators`）两项。常规设置包含名称、描述、可见性和删除仓库。
- `admin` 协作者的「设置」直接进入协作者页，不显示二级导航。
- 新建仓库与常规设置使用同一可见性单选，附含义说明。
- Clone 地址只在代码页展示。

## 6. 接口

- `GET /api/public/repos`：公开仓库，按创建时间倒序；`limit` 默认 50，最大 100。
- `GET /api/repos`：当前用户拥有或参与协作的全部仓库。
- `POST /api/repos`：`name`、可选 `description`、`isPrivate`。
- `GET /api/repos/:owner/:repo`：仓库详情；`viewerPermission` 为当前访问者的权限 `owner / admin / write / read`，匿名或无关用户为 `null`。
- `PATCH /api/repos/:owner/:repo`：更新 `name`、`description`、`isPrivate`。
- `DELETE /api/repos/:owner/:repo`：删除仓库。
- `GET /api/repos/:owner/:repo/collaborators`：协作者列表。
- `PUT /api/repos/:owner/:repo/collaborators`：`username`、`permission`。
- `DELETE /api/repos/:owner/:repo/collaborators/:username`：移除协作者。
- `GET /api/repos/:owner/:repo/branches`：分支列表。
- `POST /api/repos/:owner/:repo/branches`：`branchName`、`sourceOid`（仓库内已有提交的 40 位 OID）。
- `PATCH /api/repos/:owner/:repo/default-branch`：`branchName`。
- `DELETE /api/repos/:owner/:repo/branches/:branch`：删除分支；路径中的分支名需 URL 编码。

## 7. 数据模型

- `repositories`：ID、所有者 ID、名称、描述、可见性、创建时间；同一所有者下名称唯一。
- `repository_collaborators`：仓库 ID、用户 ID、权限和创建时间；仓库与用户组成联合主键。
- 分支与默认分支保存在 Git 引用及 `HEAD` 中，由 DO 读取，不另建 D1 分支表。

## 8. 关键代码文件

- `src/services/repository-service.ts`
- `src/services/storage-service.ts`
- `src/services/repository-object.ts`
- `src/routes/api/repository-admin-routes.ts`
- `src/routes/api/repository-browser-routes.ts`
- `web/src/components/common/repository-layout.tsx`
- `web/src/pages/home-page.tsx`
- `web/src/pages/dashboard-page.tsx`
- `web/src/pages/new-repository-page.tsx`
- `web/src/pages/repository-settings-page.tsx`
- `web/src/pages/repository-branches-page.tsx`
- `web/src/pages/repository-collaborators-page.tsx`
