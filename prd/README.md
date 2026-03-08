# gits PRD 索引

本文基于当前代码实现重写，目标是让 `prd/` 成为“现状说明 + 下一步边界”的文档，而不是功能愿景堆叠。

## 1. 产品定义

`gits` 不是面向企业治理的 Git 平台。

它是一个把 Git 托管、Issue、Pull Request、Review 和 Agent Runtime 串成一条交付链的 Agent 协作平台。当前产品主线是：

1. 人类创建仓库并提交 Issue。
2. Issue 作为任务中心，沉淀问题描述、验收标准和对话历史。
3. Agent 从 Issue、PR 或 review feedback 进入一次可追踪的 `Agent Session`。
4. Agent 推分支、创建或更新 PR，并回写评论、验证结果和交付摘要。
5. 人类在 PR 中查看 diff、review thread、validation summary 和 merge summary。
6. Agent 根据 review thread 或 PR 级 handoff 继续修改。
7. 人类确认后完成 squash merge，关联 Issue 收敛到完成状态。

产品重点不是“多系统治理”，而是把 `Issue -> Session -> PR -> Review -> Merge` 这条链路做顺。

## 2. 当前系统事实

- 后端是 Cloudflare Workers + Hono API。
- `/api` 路由现在由 `src/routes/api/index.ts` 统一装配，并按 platform / repository / issue / pull request / actions 拆分到 `src/routes/api/*.ts`。
- 前端是 React SPA，核心页面包括首页、Dashboard、仓库页、Issue、PR、Actions 和 Session detail。
- 元数据存储在 D1。
- Git 对象与引用存储在 `GIT_BUCKET` R2。
- run/session 全量日志与全文 artifact 存储在 `ACTION_LOGS_BUCKET` R2；D1 只保留 excerpt 与元数据。
- 每个仓库由一个 `RepositoryObject` Durable Object 负责 hydrate、Git 协议处理、浏览缓存和 squash merge。
- Agent 执行通过 Queue + Cloudflare Containers 调度，支持多种容器实例规格。

## 3. 核心对象

| 对象 | 当前职责 |
| --- | --- |
| `User` | 登录主体、仓库 owner、协作者和 Agent 委托来源 |
| `Repository` | Git 远端、权限边界和 Issue/PR/Actions 容器 |
| `Issue` | 任务入口、讨论面、验收标准与任务状态中心 |
| `Pull Request` | 代码交付中心，承载 compare、review、validation、merge |
| `Review Thread` | 围绕 diff 行区间的反馈单元，可随 patch set 尝试重锚 |
| `Action Workflow` | 自动化触发规则，决定何时创建 run |
| `Action Run` | 一次实际执行任务，承载状态、日志 excerpt、配置与来源事件 |
| `Agent Session` | 一次可追踪的 Agent 执行上下文，沉淀 timeline、artifact、usage、intervention |

## 4. 当前主工作流

### 4.1 任务入口

- Issue 支持标题、正文、评论、标签、里程碑、指派人、Reaction。
- Issue 支持独立 `acceptance_criteria`。
- `issues.task_status` 当前使用 `open / agent-working / waiting-human / done` 四态。
- Issue 列表和详情在返回前会按主流程重算相关状态，避免列表与详情分叉。

### 4.2 交付入口

- PR 支持从 `baseRef / headRef` 创建，支持 draft、closing issues、labels、milestone、assignees、reviewers。
- PR 详情聚合 compare、reviews、review threads、validation summary、merge summary 和 handoff。
- Review thread 支持 anchored range、suggested changes、多轮 comment、resolve，以及新 commit 后的 `current / reanchored / stale` 状态。
- 当前合并策略只有 squash merge。

### 4.3 执行入口

- Agent 可以由 workflow、mention、rerun、dispatch、issue assign/resume、pull request resume 创建 session。
- Session 与 run 可双向关联；Issue、PR、Actions 页面会展示摘要，Session detail 负责全文回看。
- runtime 会提取 machine-readable validation report；缺失时回退到日志规则归纳。

## 5. 跨模块约束

- Issue 是任务中心，PR 是交付中心，Session/Run 是执行中心。
- Git 读写、代码浏览和 merge 统一通过 `RepositoryObject`，避免同仓库并发请求重复从 R2 hydrate。
- 主流程状态不是独立工作流引擎；当前主要通过 `issues.task_status` 和 `taskFlow` 计算结果表达。
- Session/run 不只是 observability 对象，也是 Issue/PR 状态回流的触发点。
- 全量日志与全文 artifact 不留在 D1，D1 只保留摘要层和索引层数据。

## 6. 模块划分

| 模块 | 当前职责 | 文档 |
| --- | --- | --- |
| 认证与访问控制 | 统一人类、Git 客户端和 Agent Runtime 的身份与权限边界 | `02-auth-and-access.md` |
| 仓库管理与协作 | 管理仓库生命周期、协作者和基础协作边界 | `03-repository-management-and-collaboration.md` |
| Git 托管与存储 | 提供 Smart HTTP、R2 Git 存储、DO 仓库缓存和 merge 能力 | `04-git-hosting-and-storage.md` |
| 代码浏览与历史 | 提供树、文件、历史、commit、compare 与 review 可复用 diff 结构 | `05-code-browsing-and-history.md` |
| Issue 与讨论 | 承载任务描述、验收标准、讨论、任务状态和 Agent 入口 | `06-issues-and-discussions.md` |
| Pull Request 与评审 | 承载交付、review、validation、merge 和 handoff | `07-pull-requests-and-reviews.md` |
| Actions 与 Agent Runtime | 承载 workflow、run、session、执行调度和可观测性 | `08-actions-and-ai-automation.md` |

## 7. 当前缺口

### 7.1 代码上下文供给仍偏弱

- 还没有基础代码搜索。
- 还没有面向 Issue / PR / Review 的轻量 Context Bundle。
- Agent 进入 session 前拿到的“相关文件 + 相关 thread + 最近验证摘要”仍不够稳定。

### 7.2 Review 闭环仍偏保守

- thread 已支持第一版 re-anchor，但复杂 diff、rename 和更长 range 的映射仍不够强。
- PR 还缺更明确的“本轮修改消化了哪些反馈”摘要。

### 7.3 provenance 仍以会话级为主

- 已能看到 run/session 来源、分支和 trigger ref。
- 但 commit 级 provenance 还没有稳定回流到代码浏览和 PR 主界面。

### 7.4 仓库基础能力仍保持最小集

- 仓库模型永久限定为个人仓库，不设计组织/团队模型。
- 当前没有默认分支切换能力。
- 当前 Git 接入方式明确限定为 HTTP Git；由于 Workers 无法支持 SSH 协议服务，SSH 不属于当前待补能力。

## 8. 当前优先级

### P0

- 让 `Issue -> PR -> Review -> Merge` 成为最顺手的一条主链路。
- 让 Issue 的 task center 和 PR 的 handoff 成为默认工作面。
- 让 run/session 的摘要层比日志层更先被人类消费。

### P1

- 增加代码搜索和上下文 bundle。
- 提升 review thread 在复杂 patch set 下的连续性。
- 强化 validation summary 和 artifact 的 review-oriented 摘要表达。

## 9. 推荐阅读顺序

1. 先看 `06-issues-and-discussions.md`，理解任务入口和状态回流。
2. 再看 `07-pull-requests-and-reviews.md`，理解交付、评审和 handoff。
3. 再看 `08-actions-and-ai-automation.md`，理解 run/session 如何驱动执行。
4. 最后看 `02`、`03`、`04`、`05`，补齐权限、仓库、Git 与代码浏览支撑层。
