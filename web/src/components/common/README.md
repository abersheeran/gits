# 通用组件

| 组件 | 文件 | 复用方式 |
| --- | --- | --- |
| PageHeader | `page-header.tsx` | 页面唯一 h1、可选说明与主操作，不加面板外框。 |
| Panel | `panel.tsx` | 单层面板；字符串 `header` 自动使用 PanelTitle（h2），自定义头部用 PanelTitle 组合标题与 sm 操作；正文自行选择表格或 `p-4`。 |
| EmptyState | `empty-state.tsx` | 面板内空状态，支持自定义 icon（默认 Inbox）、标题、说明与下一步操作。 |
| ConfirmDialog | `confirm-dialog.tsx` | 所有破坏性操作的异步确认；`confirmName` 要求准确输入仓库名，失败保留对话框。 |
| RepositoryLayout | `repository-layout.tsx` | 仓库头、下划线标签及设置二级导航；仅所有者显示设置标签。 |
| IconButton | `icon-button.tsx` | 带中文无障碍名称与 Tooltip 的 ghost 图标按钮。 |
| ErrorAlert | `error-alert.tsx` | 对应操作区域的错误提示；支持 title，默认「操作失败」；面板顶部使用 inset 通栏底部分隔线，无错误时不渲染。 |
| RelativeTime | `relative-time.tsx` | 毫秒时间戳显示为相对时间，完整时间放在 title；null 使用占位文案。 |
| Pagination | `pagination.tsx` | 上一页、下一页与当前页；支持加载时禁用。 |
| RepositoryList | `repository-list.tsx` | 仓库表格与空状态，20 条一页；可见性 Badge 跟随名称，探索页隐藏 Badge。 |
| BranchSelect | `branch-select.tsx` | 代码与提交页共用的分支选择，兼容完整引用与提交 SHA。 |
| PermissionSelect | `permission-select.tsx` | 中文权限选择，值保持 read / write / admin，className 透传给触发器；表格内用 h-8 w-24。 |
| CommitRow | `commit-row.tsx` | 提交标题、作者、相对时间、可复制 SHA 与可选的快照入口；compact 用于文件面板头，同一行显示作者和标题，actions 传入额外操作。 |
| RepositoryContents | `repository-contents.tsx` | 最近提交面板头、目录表格、文件预览与 README，目录每页 50 条。 |
| PathHistorySheet | `path-history-sheet.tsx` | 按需读取路径历史；根目录使用提交接口，其他路径逐步增加 limit（最多 100 条）。 |
| ChangesWorkspace | `changes-workspace.tsx` | 变更文件树与差异区域，通过 sectionIdForPath 定位文件。 |
| ChangesFileTree | `changes-file-tree.tsx` | 可折叠目录树，显示中文变更状态，点击文件定位差异。 |
| ShaCopyButton | `sha-copy-button.tsx` | 短 SHA 本身即复制按钮，复制完整 SHA，提供 Tooltip 与短暂勾选反馈；Clone URL 和新令牌使用 CopyField。 |
| CopyField | `copy-field.tsx` | 只读等宽值与相连的复制图标按钮；用于 Clone 地址和新令牌，点击值选中全文；label 表示值本身（「Clone 地址」「令牌」），用作字段无障碍名称，复制按钮名称为「复制${label}」。 |
| VisibilityField | `visibility-field.tsx` | 原生私有 / 公开单选，附图标与含义说明；新建仓库与设置页共用 value、onChange、name。 |
| EmptyRepositoryGuide | `empty-repository-guide.tsx` | 无分支时展示 Clone 地址、推送命令与访问令牌入口；defaultBranch 为空时使用 main。 |
| PathBreadcrumbs | `path-breadcrumbs.tsx` | 代码页工具栏路径导航，根目录不显示，子路径以仓库名为根；通过 link 生成各级目录和当前文件地址。 |
| CopyIconButton | `copy-icon-button.tsx` | 通过 value、label、className 复用复制图标按钮；统一图标切换、Tooltip 和 sr-only 状态播报，label 为复制动作名称。 |
