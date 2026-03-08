# 代码浏览与历史 PRD

## 1. 模块目标

代码浏览模块的目标只有一个：让人类评审和 Agent 执行都能更快理解当前仓库上下文。

它是 `Issue -> PR -> Review -> Merge` 这条主工作流的上下文层。

## 2. 当前能力基线

- 仓库主页：
  - 默认分支
  - 分支列表
  - README 渲染
- 单仓库缓存协调：
  - 仓库详情、contents、commits、history、compare 全部经由 `RepositoryObject`
  - 同一仓库的多个并发浏览请求共享同一次 repo hydrate
- 文件与目录浏览：
  - tree / blob 路由
  - 文本文件预览
  - 二进制文件元信息
- 历史能力：
  - 分支提交历史
  - 单路径历史
  - 单提交详情
  - 分支比较与 diff
  - ahead / behind
  - mergeability 估算
- Diff 结构化输出：
  - hunk
  - line
  - 行级锚点可供 Review Thread 使用

## 3. 面向主工作流仍需补足

### 3.1 基础代码搜索

当前人类和 Agent 都还缺一个最基础的入口：

- 根据文件名、关键字快速找代码
- 根据 Issue 或 Review 内容找到相关文件

这是当前最明确的缺口。

### 3.2 轻量 Context Bundle

当 Agent 从 Issue 或 PR 进入执行时，平台还不能稳定提供一个轻量上下文包，至少应包含：

- 相关文件候选
- 相关 diff
- 相关 review thread
- 最近一次 Session 的关键产物

### 3.3 评审友好的永久定位

现在已经有行级 thread，但还缺更通用的：

- 永久链接
- 明确的文件片段定位
- 从浏览视图跳回 Issue / PR 上下文

## 4. 关键流程

### 当前已实现流程

1. 用户进入仓库后，Worker 按 `repository.id` 将浏览请求路由到单仓库 `RepositoryObject`。
2. `RepositoryObject` 复用已 hydrate 的内存仓库，返回树、文件、README、提交历史和 compare diff。
3. PR 页面复用了同一仓库缓存下的结构化 diff 结果，用于创建和重锚 anchored review thread。

### 目标流程

1. 人类在 Issue 中描述问题。
2. Agent 进入执行前，平台自动整理相关代码上下文。
3. 人类在 PR 中查看 diff、历史和测试结果。
4. Agent 根据 review thread 继续修改代码。

## 5. 当前接口

- `GET /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo/branches`
- `GET /api/repos/:owner/:repo/contents`
- `GET /api/repos/:owner/:repo/commits`
- `GET /api/repos/:owner/:repo/commits/:oid`
- `GET /api/repos/:owner/:repo/history`
- `GET /api/repos/:owner/:repo/compare`

## 6. 关键代码文件

- `src/services/repository-browser-service.ts`
- `src/services/repository-object.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-page.tsx`
- `web/src/components/repository/repository-diff-view.tsx`
- `web/src/lib/api.ts`

## 7. 当前边界与下一步

- 当前没有全文搜索。
- 当前没有 Context Bundle。
- 当前代码浏览更多还是“仓库页面”，还不是“任务上下文页面”。
- 当前浏览缓存只在单个 `RepositoryObject` 实例内存中生效；实例回收后会重新从 R2 hydrate。

下一步优先级：

1. 增加基础代码搜索。
2. 增加面向 Issue / PR / Review 的轻量 Context Bundle。
3. 增加文件片段永久定位，并把代码浏览与 Issue / PR 导航更紧地串起来。
