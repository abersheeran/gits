# 代码浏览与历史 PRD

## 1. 模块目标

让用户和 Agent 在不克隆仓库的情况下，直接在 Web 中完成“看代码、理解上下文、定位变更、追踪历史”的核心工作流。

对 Agent 原生平台来说，代码浏览模块不只是“一个仓库页面”，而是上下文层，负责把仓库内容组织成对人类评审和 Agent 执行都可消费的结构化信息。

## 2. 当前能力基线

- 仓库主页：
  - 默认分支信息
  - 分支列表
  - README 渲染
  - 打开克隆地址
- 树与文件浏览：
  - 路由支持 `/repo/:owner/:repo`
  - 也支持 `/repo/:owner/:repo/:kind/:ref/*`
  - `kind` 为 `tree` 或 `blob`
- 文件预览：
  - 文本文件直接预览
  - 二进制文件只给元信息，不直接渲染内容
  - 文件内容支持截断保护
- 目录增强：
  - 每个目录项附带最新提交信息
  - 目录内 README 可就地渲染
- 历史能力：
  - 分支提交历史
  - 单路径历史
  - 单提交详情
  - 分支比较与 diff
  - ahead/behind 统计
  - mergeability 估算

## 3. 面向 Agent 原生目标需要补足

### 3.1 搜索与定位

- 全文代码搜索
- Symbol 级导航：
  - definition
  - references
  - outline
- `blame`
- 提交图谱与分支关系图

### 3.2 面向 Agent 的上下文打包

当用户从 Issue、PR 评论或手动 dispatch 发起 Agent 时，平台应能自动生成 `context bundle`，至少包含：

- 相关文件候选集
- 历史提交摘要
- 关联 Issue / PR / 评论上下文
- 相关 review 线程
- 最近一次 Agent run 的关键输出

### 3.3 跨仓库与依赖关系

- 跨仓库搜索
- 依赖关系图
- 被哪些仓库引用
- 可选的工作区级知识索引

### 3.4 评审友好能力

- 代码片段分享与永久链接
- 行内上下文展开
- PR 视图与浏览视图共享统一 diff / blame / history 入口

## 4. 关键流程

### 当前已实现流程

1. 页面加载时并行请求仓库详情、提交历史、目录内容、路径历史。
2. 当用户切换分支或路径时，前端通过路由切换驱动重新加载数据。
3. 比较页面底层通过 `findMergeBase + dry-run merge + tree diff` 计算变更量与可合并性。
4. README 使用 Markdown 渲染组件懒加载，以降低仓库首页初始成本。

### 目标流程

1. 用户在 Issue 或 PR 中指派 Agent 后，系统基于任务内容自动生成上下文候选。
2. Agent Session 启动前，平台把代码搜索结果、相关符号、历史变更与对话上下文打成 Context Bundle。
3. 用户在评审界面可直接从代码片段、行级评论或 commit diff 发起新的 Agent Session。
4. Context Bundle 可被缓存、复用，并在 Session resume 时增量刷新。

## 5. 核心接口

### 当前接口

- `GET /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo/branches`
- `GET /api/repos/:owner/:repo/contents`
- `GET /api/repos/:owner/:repo/commits`
- `GET /api/repos/:owner/:repo/commits/:oid`
- `GET /api/repos/:owner/:repo/history`
- `GET /api/repos/:owner/:repo/compare`

### 建议新增接口

- `GET /api/repos/:owner/:repo/search/code`
- `GET /api/repos/:owner/:repo/search/symbols`
- `GET /api/repos/:owner/:repo/blame`
- `GET /api/repos/:owner/:repo/dependencies`
- `POST /api/repos/:owner/:repo/context-bundles`
- `GET /api/repos/:owner/:repo/context-bundles/:bundleId`

## 6. 关键数据输出

### 当前输出

- 仓库默认分支、选中 ref、HEAD OID
- 目录树条目与其 latest commit
- 文件预览内容、大小、二进制标记、截断标记
- 提交摘要、文件变更数、增删行数、patch 内容
- Ref 比较结果：`mergeBaseOid`、`mergeable`、`aheadBy`、`behindBy`

### 建议新增输出

- 代码搜索结果及排名
- symbol 定义与引用位置
- blame 区块与 author / commit 归属
- context bundle 元数据：
  - 来源任务
  - 相关文件
  - 历史摘要
  - 最近一次 run 关联

## 7. 关键代码文件

- `src/services/repository-browser-service.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-page.tsx`
- `web/src/components/readme-markdown.tsx`
- `web/src/components/repository/markdown-body.tsx`
- `web/src/components/repository/repository-diff-view.tsx`
- `web/src/components/repository/repository-tabs.tsx`
- `web/src/lib/api.ts`

后续预计新增：

- `src/services/code-search-service.ts`
- `src/services/context-bundle-service.ts`
- `web/src/components/repository/code-search-panel.tsx`
- `web/src/components/repository/symbol-navigator.tsx`

## 8. 当前边界与下一步

- 当前没有全文搜索、代码跳转、blame、提交图谱
- 比较与 mergeability 以 Workers 内的 `isomorphic-git` 计算结果为准，不包含代码所有者规则等更高层策略
- 代码浏览是单仓库视图，没有跨仓库依赖关系图

下一步优先级：

1. 增加全文搜索与 symbol 导航
2. 增加 `blame` 与永久链接
3. 增加 Context Bundle 生成与复用
4. 增加跨仓库依赖与引用视图
