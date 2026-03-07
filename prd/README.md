# gits PRD 索引

本文档集在 2026-03-07 基于当前代码实现与产品目标共同整理。当前代码仍是一套运行在 Cloudflare Workers 上的轻量 Git 托管产品，但产品目标已上调为“现代化的 Agent 原生 Git 平台”。

这意味着 PRD 不再只描述“现在已经有什么”，也要明确“为了成为 Agent 原生平台，还需要补哪些关键能力，以及哪些现有能力要重构”。

## 产品北极星

`gits` 的目标是把 Git 仓库、任务协作和 Agent 执行统一到一个产品里，让用户能在同一平台内完成：

- 托管代码与协作分支
- 把 Issue、PR、评论直接交给 Agent 执行
- 在受控权限与受控运行时里让 Agent 读代码、改代码、提 PR、回应评审
- 对 Agent 的身份、上下文、工具、权限边界、日志和产出保持全链路可见

## 核心产品对象

为支撑上述目标，产品定义应围绕以下对象组织：

- `Repository`：代码、分支、提交、协作权限的基础容器
- `Task`：Issue、PR 评论、手动 dispatch 等可交给 Agent 的工作单元
- `Agent Session`：一次可追踪、可暂停、可恢复的代理执行会话
- `Delegation`：Agent 对触发用户权限的继承、凭证下发与运行溯源
- `Review`：人类与 Agent 围绕代码变更的反馈、线程和协作
- `Runtime`：容器、委托权限、工具链、日志、artifact、缓存、成本与配额

## 产品总览

| 功能块 | 当前基线 | 面向 Agent 原生目标需要补足 | 文档 |
| --- | --- | --- | --- |
| 认证与访问控制 | 用户登录、Session、PAT、Git Basic Auth、Actions 内部 Token | 人类 / Agent / Service 三类主体、完整委托授权、审计日志、外部工具授权 | `02-auth-and-access.md` |
| 仓库管理与协作 | 个人仓库、协作者、公开/私有、基础设置 | 规则集、分支保护、模板仓库、归档与治理 | `03-repository-management-and-collaboration.md` |
| Git 托管与存储 | Smart HTTP、R2 持久化、push 触发工作流 | LFS、分支保护配置、提交 provenance 与溯源 | `04-git-hosting-and-storage.md` |
| 代码浏览与历史 | 仓库浏览、README、提交、路径历史、分支比较 | 全文搜索、符号跳转、blame、依赖关系、面向 Agent 的上下文打包 | `05-code-browsing-and-history.md` |
| Issue 与讨论 | Issue、评论、标签、里程碑、Reaction、`@actions` 触发 | Agent assignment、任务状态、验收标准、resume/handoff、结构化任务上下文 | `06-issues-and-discussions.md` |
| Pull Request 与评审 | PR 创建、比较、合并、Review、自动关闭 Issue | 行级评论、review thread、suggested changes、required checks、merge queue、从评论恢复 Agent | `07-pull-requests-and-reviews.md` |
| Actions 与 Agent Runtime | Prompt 驱动 workflow、容器执行、日志、rerun、dispatch | Agent Session、委托执行运行时、MCP / Tool Registry、预算、artifact、checkpoint | `08-actions-and-ai-automation.md` |

## 平台设计原则

- Agent 是一等公民，拥有完成任务所需的委托权限，但仍受仓库权限与规则约束
- 所有自动化都应能映射回”谁发起、在什么上下文、产生了什么结果”
- Issue、PR、评论和手动 dispatch 都应能转化为可追踪的 Agent Session
- Agent 的运行时不是黑盒，必须具备日志、artifact、checkpoint、resume 与成本可见性
- 信任 Agent 的执行能力，通过可见性和可追溯性保障质量，而非事前审批

## 当前系统结构

- API 与静态站点入口：`src/app.ts`、`src/index.ts`
- Web SPA：`web/src/App.tsx` 和 `web/src/pages/*`
- 数据库：D1，表结构在 `src/db/schema.sql`
- Git 存储：R2，读写封装在 `src/services/storage-service.ts`
- Git 计算：`isomorphic-git`，主要逻辑在 `src/services/git-service.ts` 与 `src/services/repository-browser-service.ts`
- Agent 运行时：Cloudflare Containers + Durable Objects + Queues，配置在 `wrangler.jsonc`

## 当前用户可见页面

- 公共页面：`/`、`/login`、`/register`
- 登录后页面：`/dashboard`、`/repositories/new`、`/tokens`、`/settings/actions`
- 仓库页面：`/repo/:owner/:repo`
- 仓库子页：`issues`、`pulls`、`actions`、`settings`、`collaborators`
- Agent Session 详情页：`/repo/:owner/:repo/agent-sessions/:sessionId`

后续需要新增至少两类界面：

- Agent Task / Inbox / Queue 面板

## 当前已落地的 P0 切片

- 已引入 `agent_sessions` 核心数据对象，并把 Agent Session 正式挂到仓库运行链路上
- 已支持以下入口创建 Session：
  - workflow / `@actions` 触发
  - Issue assign-agent / resume-agent
  - PR resume-agent
  - rerun / dispatch
- 已在仓库详情权限里补充 `canRunAgents`、`canManageActions`
- 已在仓库 Actions 页面展示最近 Agent sessions，并提供 session 取消入口
- 已在 Issue / PR 详情页展示最近 Agent session，并提供基于当前上下文继续执行、跳转到对应 session / run 的入口
- 已新增 Agent Session 详情页与基础 Timeline，可从 Issue / PR / Actions 页面进入
- Agent Session 立即执行，默认直接继承触发用户在仓库内的写权限，可推分支、提 PR、回写评论

本轮仍未完成：

- 更完整的运行日志与溯源记录
- 结构化 Session Step / Artifact / Usage / Intervention
- review thread 驱动的更细粒度 resume
- Ruleset / 分支保护配置

## 当前阶段优先级

### P0：把产品从”AI 挂件”升级为”Agent 原生平台”

- ✅ 建立 Agent Session 模型
- 建立人类 / Agent / Service 身份与完整委托授权
- 完善运行日志与溯源记录
- 增强 PR 评论驱动 Agent 继续执行的体验

### P1：让 Agent 协作链路完整可用

- MCP / Tool Registry
- 全文搜索、符号级上下文
- 行级评审线程
- Artifact、checkpoint、resume、handoff

### P2：让平台具备现代托管能力

- LFS
- Merge queue
- 提交签名与 provenance
- 多租户配额、预算、审计面板

## 代码归属原则

- 路由编排集中在 `src/routes/api.ts` 与 `src/routes/git.ts`
- 业务规则集中在 `src/services/*`
- 权限判定集中在 `src/middleware/auth.ts` 与 `src/services/repository-service.ts`
- Web 页面按业务块落在 `web/src/pages/*`
- 可复用 UI 能力按组件拆在 `web/src/components/*`

## 推荐阅读顺序

1. 先看 `02-auth-and-access.md`，建立主体、授权与审计边界。
2. 再看 `03`、`04`、`07`，理解仓库治理、Git enforcement 与评审主路径。
3. 最后看 `05`、`06`、`08`，理解 Agent 如何获取上下文、接任务并执行。
