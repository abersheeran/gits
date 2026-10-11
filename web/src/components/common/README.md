# 通用组件

| 组件 | 文件 | 复用方式 |
| --- | --- | --- |
| PageHeader | `page-header.tsx` | 页面唯一 h1、可选说明与主操作，不加面板外框。 |
| Panel | `panel.tsx` | 单层面板；字符串 `header` 自动使用 PanelTitle（h2），自定义头部用 PanelTitle 组合标题与 sm 操作；正文自行选择表格或 `p-4`。 |
| EmptyState | `empty-state.tsx` | 面板内空状态，支持自定义 icon（默认 Inbox）、标题、说明与下一步操作。 |
| ConfirmDialog | `confirm-dialog.tsx` | 所有破坏性操作的异步确认；`confirmName` 要求准确输入仓库名，失败保留对话框。 |
| RepositoryLayout | `repository-layout.tsx` | 仓库头、下划线标签及设置二级导航；按 `detail.viewerPermission` 显示设置：所有者有常规与协作者两项，admin 协作者只有协作者一项且不显示二级导航。 |
| IconButton | `icon-button.tsx` | 带中文无障碍名称与 Tooltip 的 ghost 图标按钮。 |
| ErrorAlert | `error-alert.tsx` | 对应操作区域的错误提示；支持 title，默认「操作失败」；面板顶部使用 inset 通栏底部分隔线，无错误时不渲染。 |
| RelativeTime | `relative-time.tsx` | 毫秒时间戳显示为相对时间，完整时间放在 title；null 使用占位文案。 |
| Pagination | `pagination.tsx` | 上一页、下一页与当前页；支持加载时禁用。 |
| RepositoryList | `repository-list.tsx` | 仓库表格与空状态，20 条一页；可见性 Badge 跟随名称，探索页隐藏 Badge。 |
| BranchSelect / BranchSelectSkeleton | `branch-select.tsx` | 代码与提交页共用的分支选择，兼容完整引用与提交 SHA；BranchSelectSkeleton 为页面与路由 fallback 提供同尺寸占位。 |
| PermissionSelect | `permission-select.tsx` | 中文权限选择，值保持 read / write / admin，className 透传给触发器；表格内用 h-8 w-24。 |
| CommitRow | `commit-row.tsx` | 提交标题、作者、相对时间、可复制 SHA 与可选的快照入口；compact 用于文件面板头，同一行显示作者和标题，actions 传入额外操作。 |
| RepositoryContents | `repository-contents.tsx` | 最近提交面板头、目录表格、文件预览与 README，目录每页 50 条；loading 时禁用分页。 |
| PathHistorySheet | `path-history-sheet.tsx` | 按需读取路径历史；根目录使用提交接口，其他路径逐步增加 limit（最多 100 条）。 |
| ChangesWorkspace | `changes-workspace.tsx` | 变更文件树与差异区域，通过 sectionIdForPath 定位文件。 |
| ChangesFileTree | `changes-file-tree.tsx` | 可折叠目录树，显示中文变更状态，点击文件定位差异。 |
| ShaCopyButton | `sha-copy-button.tsx` | 短 SHA 本身即复制按钮，复制完整 SHA，提供 Tooltip 与短暂勾选反馈；Clone URL 和新令牌使用 CopyField。 |
| CopyField | `copy-field.tsx` | 只读等宽值与相连的复制图标按钮；用于 Clone 地址和新令牌，点击值选中全文；label 表示值本身（「Clone 地址」「令牌」），用作字段无障碍名称，复制按钮名称为「复制${label}」。 |
| VisibilityField | `visibility-field.tsx` | 原生私有 / 公开单选，附图标与含义说明；新建仓库与设置页共用 value、onChange、name。 |
| EmptyRepositoryGuide | `empty-repository-guide.tsx` | 无分支时展示 Clone 地址、推送命令与访问令牌入口；defaultBranch 为空时使用 main。 |
| PathBreadcrumbs | `path-breadcrumbs.tsx` | 代码页工具栏路径导航，根目录不显示，子路径以仓库名为根；通过 link 生成各级目录和当前文件地址。 |
| CopyIconButton | `copy-icon-button.tsx` | 通过 value、label、className 复用复制图标按钮；统一图标切换、Tooltip 和 sr-only 状态播报，label 为复制动作名称。 |
| TableSkeleton / CommitListSkeleton | `list-skeletons.tsx` | 面板内表格按 variant 选仓库、令牌、协作者或分支；提交列表用 rows 控制行数，browseAction 为提交页保留快照按钮位置，announce 控制唯一播报。 |
| RepositoryContentsSkeleton / ReadmeSkeleton | `code-skeletons.tsx` | kind 选择目录或文件面板；README 复用外层内边距；代码行与编辑器占位复用 ui/code-viewer-skeleton。 |
| CommitDetailHeaderSkeleton / CommitDetailSkeleton | `commit-detail-skeleton.tsx` | 提交详情 Sheet 的头部与变更工作区；仅主体播报。 |
| PageSkeleton | `page-skeleton.tsx` | 认证检查与路由 Suspense 共用；按路径立即显示真实页头及同形状骨架，user 用于仓库所有者操作占位。 |
| FormSkeleton | `form-skeleton.tsx` | variant 选择 login / register / repository / settings，匹配字段、可见性与按钮位置。 |
| RepositoryPageSkeleton | `repository-page-skeleton.tsx` | PageSkeleton 的仓库路由占位，复用对应页面的工具栏、面板标题与内容骨架。 |
| RepositoryCodeToolbar | `repository-code-toolbar.tsx` | 代码页与路由 fallback 共用分支区域、URL 面包屑和 Clone 地址；branch 传入选择器或骨架。 |
