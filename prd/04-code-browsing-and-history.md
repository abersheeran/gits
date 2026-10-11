# 代码浏览与历史 PRD

## 1. 模块定位

帮助用户在网页中阅读仓库文件、查看提交改动和追溯路径历史。浏览只读，文件改动只能通过 Git push 提交。

## 2. 能力

- 代码页：工具栏集中分支选择、路径导航与 Clone 地址；文件面板头部显示最近一次提交摘要。
- 目录：`tree` 路由展示目录列表及各项最近提交，每页 50 条；目录含 README（`README.md`、`README`、`README.txt`、`README.mkd`，不区分大小写）时在列表下方渲染。
- 文件：`blob` 路由用只读 Monaco 查看器展示文本；二进制文件只显示元信息。
- 空仓库：显示 Clone 地址和首次推送命令。
- 提交页：按分支分页查看历史，每页 20 条；每条提交提供短 SHA 复制、相对时间（悬停查看完整时间）和「浏览此时文件」入口。
- 提交详情：点击提交标题打开 Sheet，展示提交信息、变更统计、按目录组织的变更文件树和文本差异；新增、删除的文本文件也显示差异。差异默认显示改动行及上下 5 行，可展开更多上下文；点击文件树定位对应差异。
- 路径历史：目录与文件页通过「历史」打开 Sheet，列出该路径的相关提交，可打开提交详情。

## 3. 限制

- 文本文件预览上限 512 KiB，超限时截断并提示仅显示部分内容；README 读取上限 200 KiB，差异中单个文件读取上限 256 KiB，超出部分不显示。
- 路径历史初始加载 20 条，可逐次加载更多，最多 100 条。
- `ref` 可使用分支名、完整引用或提交 OID；以提交 OID 打开的地址固定指向该版本。

## 4. 实现与数据结构

仓库详情、目录/文件、提交列表、单提交和路径历史均通过 `RepositoryObject` 读取。DO 复用内存仓库，依次以 DO 快照、R2 作为恢复来源。

`RepositoryBrowserService` 返回以下派生数据，不为浏览结果单独建 D1 表：

- 仓库详情：默认分支、选中引用、提交 OID、分支列表和 README。
- 目录/文件：路径、对象 OID、类型、最近提交；文件另含大小、二进制标记、截断标记和文本内容。
- 提交列表：提交摘要及 `page / perPage / hasNextPage` 分页信息。
- 提交详情：提交元数据、变更文件数、增删行数及结构化差异。
- 路径历史：引用、路径和提交摘要列表。

## 5. 关键流程

1. 用户选择仓库、引用和路径，或打开提交记录。
2. Worker 检查仓库读权限，将请求路由到仓库 DO。
3. 浏览服务读取 Git 对象并生成目录、文件或历史结果。
4. 前端在代码页展示内容，在提交页翻页，通过 Sheet 查看提交详情与路径历史。根目录的路径历史使用提交列表接口。

## 6. 接口

| 接口 | 查询参数与用途 |
| --- | --- |
| `GET /api/repos/:owner/:repo` | 可选 `ref`；仓库信息、当前访问者权限 `viewerPermission` 及 README |
| `GET /api/repos/:owner/:repo/branches` | 分支列表 |
| `GET /api/repos/:owner/:repo/contents` | 可选 `ref`、`path`；省略路径时读取根目录 |
| `GET /api/repos/:owner/:repo/commits` | 可选 `ref`、`page`、`limit`；默认第 1 页、每页 20 条，`limit` 最大 100 |
| `GET /api/repos/:owner/:repo/commits/:oid` | 单提交详情 |
| `GET /api/repos/:owner/:repo/history` | 必填 `path`，可选 `ref`、`limit`；默认 20 条，最大 100 条 |

无权限读取私有仓库时返回 404。

## 7. 关键代码文件

- `src/services/repository-browser-service.ts`
- `src/services/repository-diff.ts`
- `src/services/repository-object.ts`
- `src/routes/api/repository-browser-routes.ts`
- `web/src/App.tsx`
- `web/src/pages/repository-page.tsx`
- `web/src/pages/repository-commits-page.tsx`
- `web/src/components/repository/repository-commit-detail-sheet.tsx`
- `web/src/components/common/repository-contents.tsx`
- `web/src/components/common/path-history-sheet.tsx`
- `web/src/components/repository/repository-diff-view.tsx`
- `web/src/components/repository/repository-change-diff-editor.tsx`
- `web/src/components/common/changes-workspace.tsx`
- `web/src/components/ui/monaco-text-viewer.tsx`
- `web/src/lib/api.ts`
