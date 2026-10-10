# gits PRD 索引

本文以当前代码为准，记录产品现状、模块边界与下一步优先级。

## 1. 产品定义

`gits` 是部署在 Cloudflare Workers 上的个人 Git 仓库托管服务，专注传统 Git 仓库存储与管理。用户创建仓库、配置协作者，通过 Git 客户端读写代码，并在网页浏览文件、分支和提交历史。

## 2. 当前系统事实

- 后端：Cloudflare Workers + Hono，由 `src/routes/api/index.ts` 装配认证、仓库管理与浏览接口。
- D1：保存用户、仓库、协作者和个人访问令牌元数据。
- R2：`GIT_BUCKET` 保存 Git 对象、引用与 `HEAD`。
- Durable Object：`REPOSITORY_OBJECTS` 绑定 `RepositoryObject`，按仓库 ID 处理 Git 请求、分支操作和代码浏览；内存缓存配合 DO storage 快照，缺失快照时从 R2 恢复。
- 前端：React SPA，提供账户、仓库、代码浏览、提交历史、分支、设置和协作者页面。
- 部署：Workers Builds 连接仓库根目录，选择生产分支，并为其余所有分支启用 Preview builds。Build command 为 `npm ci && npm --prefix web ci && npm run build`，Deploy command 为 `npm run deploy`，Preview command 为 `npm run preview`；项目 Wrangler 依赖需 >= 4.135.0。
- 环境资源：生产 D1/R2 均为 `gits`；所有 Preview 共用 D1 `gits-preview` 和 R2 `gits-preview`，与生产隔离（绑定见 `wrangler.jsonc` 的 `previews`）。每个 Preview 自动获得独立 DO 命名空间和存储。
- Preview 配置：`wrangler.jsonc` 的 `previews` 显式声明 `DB`、`GIT_BUCKET`、`REPOSITORY_OBJECTS` 及 `ALLOW_USER_REGISTRATION="true"`；静态资源、兼容设置与 DO 迁移保留在顶层。`npm run preview` 先通过 `wrangler.preview-migrations.jsonc` 迁移预览 D1，再执行 `wrangler preview`，地址为 `<branch>-gits.<subdomain>.workers.dev`。
- 首次部署密钥：生产运行 `npm run secret:prod`，Preview 运行 `npx wrangler preview base-config secret put JWT_SECRET`（用于后续新建 Preview）。

## 3. 核心对象

| 对象 | 当前职责 |
| --- | --- |
| User | 登录主体、个人仓库所有者或协作者 |
| Repository | Git 远端、可见性与权限边界 |
| Collaborator | 仓库级 `read / write / admin` 权限 |
| Access Token | 用户创建、可撤销的 PAT，用于 API 和 Git 认证 |
| Branch/Ref | Git 引用及提交指向；默认分支由 `HEAD` 表达 |

## 4. 模块划分

| 模块 | 当前职责 | 文档 |
| --- | --- | --- |
| 02 认证与访问控制 | 注册、登录、JWT 登录态、PAT 和 Git Basic Auth | [认证与访问控制](02-auth-and-access.md) |
| 03 仓库管理与协作 | 仓库生命周期、可见性、协作者与分支管理 | [仓库管理与协作](03-repository-management-and-collaboration.md) |
| 04 Git 托管与存储 | Smart HTTP、R2 持久化与 DO 快照 | [Git 托管与存储](04-git-hosting-and-storage.md) |
| 05 代码浏览与历史 | README、目录、文件、提交详情与路径历史 | [代码浏览与历史](05-code-browsing-and-history.md) |

建议按 02 → 03 → 04 → 05 阅读，先理解访问边界，再理解存储与浏览。

## 5. 跨模块约束与当前缺口

- 公开仓库可匿名读取；私有仓库仅所有者和协作者可读。
- 仓库设置、删除和分支管理 API 仅限所有者；所有者及 `admin` 协作者可管理协作者。
- 仓库限定为个人所有，不设计组织或团队模型。
- 仅提供 HTTP Git；Workers 无法承载入站 SSH 服务，因此不提供 SSH Git。
- 尚无代码搜索、分支保护和 Git LFS。
- 删除为硬删除，会清理元数据、R2 数据和 DO 快照，没有回收站。

下一步优先完善代码搜索、分支保护与文件片段永久链接，并评估大仓库的冷加载和快照体积。

## 6. 2026-10 产品范围调整

Agent / Actions / Issue / Pull Request 功能已移除，产品收敛为 Git 仓库存储与管理。2026-10，D1 与 Durable Object 迁移历史均重置为单个初始迁移，分别为 `src/db/migrations/0001_init.sql` 和 `repository-object-v1`。

旧部署不能原地升级：先删除旧 `gits` Worker（连同其 Durable Object 命名空间及存储）、D1 数据库、R2 数据、`gits-actions` 队列，以及旧 `gits-actionscontainer*` 容器应用和镜像，再从零部署。本地开发先删除 `.wrangler/state`，再运行 `npm run dev`。
