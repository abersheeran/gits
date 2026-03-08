# gits PRD 索引

## 1. 产品定义

`gits` 当前的产品目标不是一个强调治理、审批、控制台和企业配置的 Git 平台。

它是一个面向 Agent 协作的软件交付平台，核心工作流只有一条：

1. 人类发现产品问题。
2. 人类创建 Issue。
3. Agent 在 Issue 中和人类持续交流，澄清问题、补充计划、推进实现。
4. Agent 基于 Issue 发起 PR。
5. 人类与 Agent 围绕 PR、代码 diff 和测试产物反复审校。
6. Agent 根据反馈继续修改 PR。
7. 人类确认后合并 PR。

因此，所有 PRD 都应围绕这条链路服务，而不是围绕复杂的治理系统服务。

## 2. 核心对象

- `Repository`：代码与分支的容器。
- `Issue`：任务入口和人机对话面。
- `Pull Request`：代码交付和评审入口。
- `Review Thread`：围绕具体 diff 的修改反馈。
- `Agent Session`：一次可追踪的执行与回写过程。

## 3. 当前已落地骨架

- 已支持仓库、协作者、公开/私有仓库和基础 Git 托管。
- 已支持 Issue 列表、详情、评论、标签、里程碑、Reaction。
- 已支持从 Issue assign/resume Agent，并在 Issue 页展示最近 Session。
- 已支持 Issue 任务状态、验收标准，以及关联 PR 的统一任务视图；`issues.task_status` 会在主流程事件后自动回流，Issue 列表/详情读路径也会先自洽再返回。
- 已支持 PR 创建、比较、Review、Reaction、squash merge。
- 已支持 anchored review thread、多轮 thread comments、suggested changes。
- 已支持 review thread 在新 commit 后 re-anchor、stale 标记和 patch-set changed 展示。
- 已支持在 PR 页面直接展示 validation summary、merge summary、Task chain / Handoff 和关联 Issue 完成度；review summary 已按 reviewer 当前有效决策汇总。
- 已支持从单条 unresolved review thread focused resume Agent。
- 已引入 `Agent Session` 作为一等对象，并沉淀 timeline、artifact、usage、intervention。
- 已开始把 Agent Session 界面按“任务决策摘要”和“按需展开正文”重新分层：Issue / PR / Actions 展示摘要，Session detail 与单独日志接口负责全文。
- 已把 stdout / stderr / run full logs 从 D1 移出；D1 只保留 excerpt 与元数据，全文日志落到专用 R2。
- 已支持从 Issue、PR、workflow、mention、rerun、dispatch 创建 Session。

## 4. 当前真正的缺口

### 4.1 Review 循环还不够顺

- Agent 修改 PR 后，Review 与 Session 的状态回流已经有了明确的主流程语义，但还缺更强的“本轮改动消化了哪些反馈”摘要。
- review thread 已有第一版 re-anchor / stale 标记，但复杂 diff 场景下还缺更智能映射。

### 4.2 PR 的验证摘要还是首版

- 当前已能在 PR 中直接看最近验证状态、关键 artifact 和 merge summary。
- 但还缺更结构化的测试/构建拆分，以及更稳定的人类审校摘要提炼。

### 4.3 Agent 上下文供给还偏弱

- 还缺基础代码搜索。
- 还缺面向 Issue / PR / Review 的轻量 Context Bundle。
- Agent 进入 Session 前，还不能稳定拿到“相关文件候选 + 历史摘要 + 最近验证结果”。

### 4.4 Session 连续性还不够强

- Issue 对话、PR Review、Agent 修改记录已经有了第一版统一任务链与 handoff 摘要。
- 但用户仍需要更稳定的“上一轮 Agent 实际交付了什么”压缩视图，以及更强的上下文 bundle。

## 5. 模块划分

| 功能块 | 在主工作流中的职责 | 文档 |
| --- | --- | --- |
| 认证与访问控制 | 让人类、协作者和 Agent Session 能安全访问仓库与 API | `02-auth-and-access.md` |
| 仓库管理与协作 | 提供最小可用的仓库、协作者和默认协作边界 | `03-repository-management-and-collaboration.md` |
| Git 托管与存储 | 提供 clone/fetch/push 与 Session 关联的提交存储 | `04-git-hosting-and-storage.md` |
| 代码浏览与历史 | 为人类评审和 Agent 执行提供代码上下文 | `05-code-browsing-and-history.md` |
| Issue 与讨论 | 作为任务入口和人机协作对话面 | `06-issues-and-discussions.md` |
| Pull Request 与评审 | 作为代码交付、评审和修改循环中心 | `07-pull-requests-and-reviews.md` |
| Actions 与 Agent Runtime | 承载 Agent Session 的执行、回写和可观测性 | `08-actions-and-ai-automation.md` |

## 6. 当前优先级

### P0

- 把 `Issue -> PR -> Review -> Merge` 这条主链路做顺。
- 让 Issue 成为任务中心。
- 让 PR 成为交付与评审中心。
- 让 Agent Session 成为这条链路的可追踪执行载体。

### P1

- 增加代码搜索和轻量 Context Bundle。
- 把验证结果和 artifact 更直接地并入 Issue 主界面。
- 强化 thread 在多次提交之间的连续性。

## 7. 推荐阅读顺序

1. 先看 `06-issues-and-discussions.md`，理解任务入口。
2. 再看 `07-pull-requests-and-reviews.md`，理解交付与评审循环。
3. 再看 `08-actions-and-ai-automation.md`，理解 Session 如何驱动执行。
4. 最后看 `02`、`03`、`04`、`05`，补齐支撑层能力。
