# 代码浏览与历史 PRD

## 1. 模块目标

让用户在不克隆仓库的情况下，直接在 Web 中完成“看代码、看 README、看提交、看路径历史、看分支差异”的核心阅读工作流。

## 2. 当前能力范围

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

## 3. 关键流程

1. 页面加载时并行请求仓库详情、提交历史、目录内容、路径历史。
2. 当用户切换分支或路径时，前端通过路由切换驱动重新加载数据。
3. 比较页面底层通过 `findMergeBase + dry-run merge + tree diff` 计算变更量与可合并性。
4. README 使用 Markdown 渲染组件懒加载，以降低仓库首页初始成本。

## 4. 核心接口

- `GET /api/repos/:owner/:repo`
- `GET /api/repos/:owner/:repo/branches`
- `GET /api/repos/:owner/:repo/contents`
- `GET /api/repos/:owner/:repo/commits`
- `GET /api/repos/:owner/:repo/commits/:oid`
- `GET /api/repos/:owner/:repo/history`
- `GET /api/repos/:owner/:repo/compare`

## 5. 关键数据输出

- 仓库默认分支、选中 ref、HEAD OID
- 目录树条目与其 latest commit
- 文件预览内容、大小、二进制标记、截断标记
- 提交摘要、文件变更数、增删行数、patch 内容
- Ref 比较结果：`mergeBaseOid`、`mergeable`、`aheadBy`、`behindBy`

## 6. 关键代码文件

- `src/services/repository-browser-service.ts`
- `src/routes/api.ts`
- `web/src/pages/repository-page.tsx`
- `web/src/components/readme-markdown.tsx`
- `web/src/components/repository/markdown-body.tsx`
- `web/src/components/repository/repository-diff-view.tsx`
- `web/src/components/repository/repository-tabs.tsx`
- `web/src/lib/api.ts`

## 7. 当前边界与注意点

- 当前没有全文搜索、代码跳转、blame、提交图谱。
- 比较与 mergeability 以 Workers 内的 `isomorphic-git` 计算结果为准，不包含代码所有者规则等更高层策略。
- 代码浏览是单仓库视图，没有跨仓库依赖关系图。
