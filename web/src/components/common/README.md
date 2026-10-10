# 通用组件

| 组件 | 文件 | 复用方式 |
| --- | --- | --- |
| PageHeader | `page-header.tsx` | 页面唯一 h1、可选说明与主操作，不加面板外框。 |
| Panel | `panel.tsx` | 单层面板；`header` 接收标题与操作，正文自行选择表格或 `p-4`。 |
| EmptyState | `empty-state.tsx` | 面板内空状态，支持标题、说明与下一步操作。 |
| ConfirmDialog | `confirm-dialog.tsx` | 所有破坏性操作的异步确认；`confirmName` 要求准确输入仓库名，失败保留对话框。 |
| RepositoryLayout | `repository-layout.tsx` | 仓库头、下划线标签及设置二级导航；仅所有者显示设置标签。 |
| IconButton | `icon-button.tsx` | 带中文无障碍名称与 Tooltip 的 ghost 图标按钮。 |
| ErrorAlert | `error-alert.tsx` | 对应操作区域的错误提示；无错误时不渲染。 |
| RelativeTime | `relative-time.tsx` | 毫秒时间戳显示为相对时间，完整时间放在 title；null 使用占位文案。 |
| Pagination | `pagination.tsx` | 上一页、下一页与当前页；支持加载时禁用。 |
| RepositoryList | `repository-list.tsx` | 仓库表格与空状态，20 条一页；探索页可省略可见性列。 |
| BranchSelect | `branch-select.tsx` | 代码与提交页共用的分支选择，兼容完整引用与提交 SHA。 |
| PermissionSelect | `permission-select.tsx` | 中文权限选择，值保持 read / write / admin。 |
| CommitRow | `commit-row.tsx` | 提交标题、作者、相对时间、可复制 SHA 与可选的快照入口。 |
| RepositoryContents | `repository-contents.tsx` | 目录表格、路径导航、文件预览与 README，目录每页 50 条。 |
| PathHistorySheet | `path-history-sheet.tsx` | 按需读取路径历史；根目录使用提交接口，其他路径逐步增加 limit（最多 100 条）。 |
| ChangesWorkspace | `changes-workspace.tsx` | 变更文件树与差异区域，通过 sectionIdForPath 定位文件。 |
| ChangesFileTree | `changes-file-tree.tsx` | 可折叠目录树，显示中文变更状态，点击文件定位差异。 |
| ShaCopyButton | `sha-copy-button.tsx` | 短 SHA 本身即复制按钮，复制完整 SHA，提供 Tooltip 与短暂勾选反馈；Clone URL 和新令牌继续使用 CopyButton。 |
