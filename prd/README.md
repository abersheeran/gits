# gits PRD 索引

本文定义产品范围、系统组成和跨模块规则，各模块细节见第 2 节表中的文档。

## 1. 产品定义

`gits` 是部署在 Cloudflare Workers 上的个人 Git 仓库托管服务。用户创建仓库、配置协作者，通过 Git 客户端读写代码，并在网页浏览文件、分支和提交历史；也可把自己在 GitHub 上的仓库及所属组织的仓库持续镜像进来。

## 2. 功能边界

产品范围仅包含下表能力，建议按顺序阅读：

| 模块 | 能力 | 文档 |
| --- | --- | --- |
| 01 认证与访问控制 | 注册（可关闭）、登录、登出、个人访问令牌（PAT）、Git Basic Auth、仓库级权限 | [认证与访问控制](01-auth-and-access.md) |
| 02 仓库管理与协作 | 个人仓库的创建、重命名、描述、可见性与删除；`read / write / admin` 协作者；分支创建、删除与默认分支 | [仓库管理与协作](02-repository-management-and-collaboration.md) |
| 03 Git 托管与存储 | Smart HTTP clone / fetch / push，浅克隆与对象过滤；每仓库 DO SQLite 对象存储，旧格式自动迁移 | [Git 托管与存储](03-git-hosting-and-storage.md) |
| 04 代码浏览与历史 | README、目录、只读文件预览、分页提交历史、提交差异、路径历史 | [代码浏览与历史](04-code-browsing-and-history.md) |
| 05 GitHub 同步 | 通过 PAT 连接多个 GitHub 账号，按所有者（本人或组织）启用同步，定时镜像为只读仓库，可转为普通仓库 | [GitHub 同步](05-github-sync.md) |

以下能力不在范围内：

- 组织与团队：仓库归个人所有，通过协作者共享；GitHub 组织的仓库同步后以前缀平铺在个人名下。
- Issue、Pull Request、CI 与 Agent：产品只负责 Git 仓库托管。
- 推送到 GitHub 或其他远端的镜像、双向同步，以及 GitHub 以外的代码托管来源。
- SSH Git：Workers 无法承载入站 SSH 服务，只提供 HTTP Git。
- 网页编辑文件：文件浏览只读，提交只能通过 Git push 写入。
- 代码搜索、分支保护、Git LFS、服务端钩子、Fork、模板仓库、归档与回收站。

上表之外的能力均不属于产品范围；新增能力前须先由维护者修改本节。

## 3. 系统组成

| 组件 | 职责 |
| --- | --- |
| Worker（Hono） | 提供静态资源、`/api` 接口（`src/routes/api/index.ts`）与 Git Smart HTTP（`src/routes/git.ts`），负责鉴权和 D1 元数据查询；Cron 每 5 分钟运行 GitHub 同步调度器 |
| D1 `DB` | 用户、仓库、协作者和 PAT 元数据；GitHub 连接、同步源与远端仓库同步状态 |
| R2 `GIT_BUCKET` | 旧存储格式的仓库数据，首次访问时导入 DO 后删除 |
| Durable Object `REPOSITORY_OBJECTS` | `RepositoryObject` 按仓库 ID 处理 Git 请求、分支操作、代码浏览，并通过 alarm 执行镜像拉取；Git 对象与引用存在该 DO 的 SQLite 中，按需读取 |
| React SPA | 账户、仓库、代码、提交、分支、设置和协作者页面 |

部署与环境配置见 [README](../README.md#deployment)。

## 4. 核心对象

| 对象 | 职责 |
| --- | --- |
| User | 登录主体、个人仓库所有者或协作者 |
| Repository | Git 远端、可见性与权限边界 |
| Collaborator | 仓库级 `read / write / admin` 权限 |
| Access Token | 用户创建、可撤销的 PAT，用于 API 和 Git 认证 |
| Branch/Ref | Git 引用及提交指向；默认分支由 `HEAD` 表达 |
| GitHub Connection / Sync Source | GitHub 令牌及其账号；连接下按 GitHub 所有者启用的同步设置 |
| Mirror | 与 GitHub 仓库关联、只读的仓库 |

## 5. 跨模块规则

- 公开仓库可匿名读取；私有仓库仅所有者和协作者可读，无读权限的 API 请求返回 404。
- 仓库设置、删除和分支管理仅限所有者；所有者及 `admin` 协作者可管理协作者。
- Git push 需要 PAT 和仓库写权限；镜像仓库拒绝 push 与分支管理。
- 删除为硬删除，同时清理 D1 元数据、DO 存储和残留的 R2 旧格式数据，不可恢复。
