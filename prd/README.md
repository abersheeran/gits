# gits PRD 索引

本文档集基于当前代码实现反向整理，时间点为 2026-03-07。目标不是重新发明路线图，而是把现有产品能力、模块边界、关键接口和代码归属拆清楚，方便继续开发。

## 产品总览

`gits` 是一个运行在 Cloudflare Workers 上的轻量 Git 托管产品，当前包含以下主能力：

| 功能块 | 解决的问题 | 主要入口 | 文档 |
| --- | --- | --- | --- |
| 认证与访问控制 | 用户登录、会话保持、PAT 鉴权、Git Basic Auth | `/api/auth/*` `/api/me` Git Smart HTTP | `02-auth-and-access.md` |
| 仓库管理与协作 | 仓库创建、可见性、协作者、个人仓库视图 | `/api/public/repos` `/api/repos*` Web 首页与设置页 | `03-repository-management-and-collaboration.md` |
| Git 托管与存储 | `clone/fetch/push`、Smart HTTP、R2 持久化 | `/:owner/:repo/info/refs` `git-upload-pack` `git-receive-pack` | `04-git-hosting-and-storage.md` |
| 代码浏览与历史 | 分支浏览、README、文件预览、提交详情、路径历史、分支比较 | `/api/repos/:owner/:repo/contents` `/commits` `/history` `/compare` | `05-code-browsing-and-history.md` |
| Issue 与讨论 | Issue 列表、详情、评论、标签、里程碑、指派、Reaction | `/api/repos/:owner/:repo/issues*` | `06-issues-and-discussions.md` |
| Pull Request 与评审 | PR 创建、比较、评审、关闭关联 Issue、合并 | `/api/repos/:owner/:repo/pulls*` | `07-pull-requests-and-reviews.md` |
| Actions 与 AI 自动化 | 事件触发工作流、运行队列、容器执行、日志流、全局与仓库级配置 | `/api/settings/actions` `/api/repos/:owner/:repo/actions/*` | `08-actions-and-ai-automation.md` |

## 当前系统结构

- API 与静态站点入口：`src/app.ts`、`src/index.ts`
- Web SPA：`web/src/App.tsx` 和 `web/src/pages/*`
- 数据库：D1，表结构在 `src/db/schema.sql`
- Git 存储：R2，读写封装在 `src/services/storage-service.ts`
- Git 计算：`isomorphic-git`，主要逻辑在 `src/services/git-service.ts` 与 `src/services/repository-browser-service.ts`
- Actions 运行时：Cloudflare Containers + Durable Objects + Queues，配置在 `wrangler.jsonc`

## 用户可见页面

- 公共页面：`/`、`/login`、`/register`
- 登录后页面：`/dashboard`、`/repositories/new`、`/tokens`、`/settings/actions`
- 仓库页面：`/repo/:owner/:repo`
- 仓库子页：`issues`、`pulls`、`actions`、`settings`、`collaborators`

## 代码归属原则

- 路由编排集中在 `src/routes/api.ts` 与 `src/routes/git.ts`
- 业务规则集中在 `src/services/*`
- 权限判定集中在 `src/middleware/auth.ts` 与 `src/services/repository-service.ts`
- Web 页面按业务块落在 `web/src/pages/*`
- 可复用 UI 能力按组件拆在 `web/src/components/*`

## 推荐阅读顺序

1. 先看 `02-auth-and-access.md`，理解用户、令牌和权限边界。
2. 再看 `03` 到 `07`，理解核心协作产品面。
3. 最后看 `08-actions-and-ai-automation.md`，理解自动化与 AI 执行链路。
