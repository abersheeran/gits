# 代码浏览与历史 PRD

## 1. 模块定位

帮助用户在网页中阅读仓库文件、查看提交改动和追溯路径历史，保持只读浏览边界。

## 2. 当前已实现能力

- 仓库主页：默认分支、分支选择、README、clone URL 和最新提交摘要。
- 目录与文件：`tree / blob` 路由、目录列表、文本预览、二进制元信息及最近提交。文本使用按需加载的 Monaco 只读查看器。
- 独立提交页：按分支查看历史，支持分页；仓库主页不再平铺最近提交列表。
- 提交详情：提交信息、变更统计、按目录组织的变更文件树和文本差异；新增、删除文本文件也显示差异。
- 路径历史：查看单个路径的相关提交，可打开提交详情。
- 差异查看默认显示改动行及上下 5 行，可展开更多上下文。提交详情侧边面板向下滚动时收起摘要，向上滚动或回到顶部时恢复。
- 移动端目录列表折叠次要列，分支选择等控件适配可用宽度。

## 3. 当前实现与数据结构

仓库详情、目录/文件、提交列表、单提交和路径历史均通过 `RepositoryObject` 读取。DO 复用内存仓库，依次以 DO 快照、R2 作为恢复来源。

`RepositoryBrowserService` 返回以下派生数据，不为浏览结果单独建 D1 表：

- 仓库详情：默认分支、选中引用、提交 OID、分支列表和 README。
- 目录/文件：路径、对象 OID、类型、最近提交；文件另含大小、二进制标记、截断标记和文本内容。
- 提交列表：提交摘要及 `page / perPage / hasNextPage` 分页信息。
- 提交详情：提交元数据、变更文件数、增删行数及结构化差异。
- 路径历史：引用、路径和提交摘要列表。

## 4. 关键流程

1. 用户选择仓库、引用和路径，或打开提交记录。
2. Worker 检查仓库读权限，将请求路由到仓库 DO。
3. 浏览服务读取 Git 对象并生成目录、文件或历史结果。
4. 前端在代码页展示内容，在独立提交页翻页，通过侧边面板查看提交详情。

## 5. 当前接口

| 接口 | 查询参数与用途 |
| --- | --- |
| `GET /api/repos/:owner/:repo` | 可选 `ref`；仓库信息及 README |
| `GET /api/repos/:owner/:repo/branches` | 分支列表 |
| `GET /api/repos/:owner/:repo/contents` | 可选 `ref`、`path`；省略路径时读取根目录 |
| `GET /api/repos/:owner/:repo/commits` | 可选 `ref`、`page`、`limit`；默认第 1 页、每页 20 条 |
| `GET /api/repos/:owner/:repo/commits/:oid` | 单提交详情 |
| `GET /api/repos/:owner/:repo/history` | 必填 `path`，可选 `ref`、`limit`；默认最多 20 条，无分页参数 |

`ref` 可使用分支名、完整引用或提交 OID。无权限读取私有仓库时返回 404。

## 6. 关键代码文件

- `src/services/repository-browser-service.ts`
- `src/services/repository-diff.ts`
- `src/services/repository-object.ts`
- `src/routes/api/repository-browser-routes.ts`
- `web/src/App.tsx`
- `web/src/pages/repository-page.tsx`
- `web/src/pages/repository-commits-page.tsx`
- `web/src/components/repository/repository-commit-detail-sheet.tsx`
- `web/src/components/repository/repository-diff-view.tsx`
- `web/src/components/repository/repository-change-diff-editor.tsx`
- `web/src/components/common/changes-workspace.tsx`
- `web/src/components/ui/monaco-text-viewer.tsx`
- `web/src/lib/api.ts`

## 7. 当前边界与下一步

- 没有代码搜索和网页文件编辑。
- README 读取上限 200 KiB，文本文件预览上限 512 KiB；超限文本会截断，二进制文件不显示文本内容。
- 提交列表已分页，路径历史仍按数量限制返回。
- 已支持按提交 OID 浏览，但缺少便捷的文件片段永久链接和行定位。

下一步优先增加基础代码搜索、文件片段永久链接及路径历史分页。
