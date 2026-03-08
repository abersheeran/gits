# 代码浏览与历史 PRD

## 1. 模块定位

代码浏览层的职责不是做完整 IDE，而是给两类使用者提供足够上下文：

- 人类在仓库页和 PR 页面理解代码、历史与 diff。
- Agent 在 review、Issue、PR 之间切换时拿到可靠的仓库现状。

它是 `Issue -> PR -> Review -> Merge` 的上下文底座。

## 2. 当前已实现能力

### 2.1 仓库主页

- 默认分支解析
- 分支列表
- README 渲染
- clone URL 展示
- open issue / open pull request 计数
- 最新提交摘要展示
- `Recent commits` 列表已从仓库主页移除，改为独立 `Commits` 界面承载

### 2.2 文件与目录浏览

- `tree / blob` 路由
- 目录树浏览
- 文本文件预览
- 二进制文件元信息
- 最新提交摘要展示
- 文本查看统一使用 Monaco 只读 viewer，按需懒加载

### 2.3 历史与比较

- 独立仓库 commit 历史页
- 分支 commit 历史
- 单路径历史
- 单提交详情
- compare diff
- ahead / behind
- mergeability 估算
- 统一 diff 结构：
  - `change`
  - `hunk`
  - `line`

### 2.4 为评审复用的 diff 能力

- PR 页直接复用 compare 结构化结果
- Review thread 锚点依赖文件路径、range 和 hunk header
- 新 commit 后的 thread re-anchor 与 stale 判断依赖 compare 结果再次映射

## 3. 当前实现方式

- 仓库详情、contents、commits、commit detail、history、compare 都通过 `RepositoryObject` 访问。
- 同一仓库的多个浏览请求共享一次 hydrate 后的内存上下文。
- `RepositoryBrowserService` 负责文件读取、README 识别、commit 摘要、compare 与 diff 结构化。
- 前端当前拆分为：
  - 仓库 code 页：仓库首页与 tree/blob 浏览
  - 独立 commits 页：分支 commit 历史与提交详情
  - compare / path history 仍复用同一套浏览服务和 diff 结构

## 4. 当前关键流程

1. 用户进入仓库页或 PR compare。
2. Worker 以 `repository.id` 路由到对应 `RepositoryObject`。
3. `RepositoryObject` 如有缓存则直接复用，否则从 R2 hydrate 仓库。
4. 浏览服务返回树、文件预览、commit 历史或 compare 结果。
5. PR 评审与 review thread 重锚继续消费同一份 diff 结构。

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
- `src/routes/api/index.ts`
- `src/routes/api/repository-browser-routes.ts`
- `src/routes/api/repository-browser-routes.test.ts`
- `src/routes/api/repository-browser-routes.integration.test.ts`
- `src/routes/api/pull-request-routes.ts`
- `web/src/pages/repository-page.tsx`
- `web/src/pages/repository-commits-page.tsx`
- `web/src/components/repository/repository-diff-view.tsx`
- `web/src/components/repository/repository-tabs.tsx`
- `web/src/components/repository/repository-change-diff-editor.tsx`
- `web/src/components/ui/monaco-text-viewer.tsx`
- `web/src/lib/monaco.ts`
- `web/src/lib/api.ts`

## 7. 当前边界与缺口

### 7.1 还没有代码搜索

- 当前没有按文件名、关键字或符号搜索代码的能力。
- Issue 和 review 反馈还不能自动反推出相关文件候选。

### 7.2 还没有面向任务的 Context Bundle

当前浏览层能返回仓库事实，但还不能直接整理为 Agent 更好消费的上下文包，例如：

- 候选文件
- 相关 diff
- 相关 review thread
- 最近一次 session 的关键 artifact

### 7.3 永久定位能力不足

- 已有 review thread 锚点。
- 但还缺面向浏览视图的 permalink、文件片段定位和从代码视图跳回任务上下文的更通用能力。

### 7.4 浏览层仍偏“仓库页”

- 现在的代码浏览是仓库中心视角。
- 还不是 Issue / PR / Review 中的任务中心视角。

## 8. 下一步优先级

1. 增加基础代码搜索。
2. 增加面向 Issue / PR / Review 的轻量 Context Bundle。
3. 增加更稳定的文件片段永久定位，并把代码浏览与任务页面导航更紧地连起来。
