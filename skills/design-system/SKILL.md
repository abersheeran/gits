---
name: design-system
description: gits Web 界面的设计规范：视觉 token、页面布局、组件用法、交互模式与文案规则。修改 web/ 下任何界面、样式或文案前必须先读本文件。
---

# gits 设计规范

gits 是 Git 仓库托管工具。界面目标是**安静、紧凑、可扫读**：让仓库、文件、提交、分支这些任务对象成为页面主体，装饰退到最少。本文是 `web/` 的唯一设计依据；代码与本文冲突时改代码，规范本身不合理时先改本文再改代码。

## 1. 原则

1. **工具优先。** 页面直接展示任务对象。不做营销式 hero、统计卡、"最近访问"之类的装饰信息块。
2. **一层表面。** 画布（canvas）上放平面面板（panel）。面板内部只用分隔线划分区域，不再嵌套带边框、底色或阴影的卡片。禁止边框套边框、内边距叠内边距。
3. **阴影只属于浮层。** Sheet、Dialog、Select 下拉、Tooltip 才有阴影；页面上的面板、按钮、表格不用阴影。
4. **一次只做一件事。** 创建、编辑、二次确认放进 Dialog 或 Sheet，不和列表平铺在同一页面上。
5. **一种语言。** 界面文案统一为简体中文；Git 专有名词与标识保持原样（`main`、`HEAD`、commit SHA、PAT、URL）。

## 2. 视觉 Token

Token 定义在 `web/src/index.css`（CSS 变量）与 `web/tailwind.config.js`（Tailwind 映射）。只用 token，不写裸色值。

### 2.1 颜色

| 用途 | Tailwind 类 |
| --- | --- |
| 页面画布 | `bg-surface-canvas` |
| 面板、表格、输入框底色 | `bg-surface-base` |
| 面板内次级区域（表头、工具栏）、代码查看器与 diff | `bg-surface-canvas` |
| 行悬停 | `hover:bg-surface-hover` |
| 主文字 / 次要文字 / 弱化文字 | `text-text-primary` / `text-text-secondary` / `text-text-tertiary` |
| 默认边框 / 分隔线 | `border-border` / `border-border-subtle` |
| 主操作按钮 | `bg-action-primaryBg text-text-inverse` |
| 危险操作 | `danger` 系列 |
| 成功状态 | `success` 系列 |

`bg-surface-focus` 只用于选中态（当前导航项、当前文件树项、Select 高亮项）。

代码查看器与 diff（Monaco）整体使用 `bg-surface-canvas`，代码区与行号区同色，与 Markdown 代码块一致；加载占位也使用同一底色。语法颜色只从现有文字 / 状态 token 派生，以主文字色为主，少量暖色或低饱和状态色强调；普通代码与行号对比度不低于 4.5:1，注释不低于 3:1。不显示彩色括号、Unicode 歧义或不可见字符方框。

暗色 token 已在 `.dark` 中定义，当前未启用；新增颜色时必须同时给出亮色和暗色值。

### 2.2 字体与字号

- `font-display`（Onest）：页面标题、面板标题、按钮。
- `font-sans`（Inter）：正文、表格、表单。
- `font-mono`（JetBrains Mono）：SHA、分支名、路径、URL、代码。

只使用以下层级，不再引入新的字号 token：

| 层级 | 类 | 用途 |
| --- | --- | --- |
| 页面标题 | `font-display text-[22px] leading-8 font-semibold` | 每页一个 `h1` |
| 面板标题 | `font-display text-heading-3-16-semibold` | 面板头部 |
| 正文 | `text-body-xs`（14px） | 表格、列表、表单、说明 |
| 辅助信息 | `text-body-micro`（12px）+ `text-text-tertiary` | 时间、作者、计数 |
| 代码与标识 | `font-mono text-[13px]` | SHA、分支、路径 |

README 等 Markdown 正文沿用 `markdown-body` 的排版，不受上表约束。

### 2.3 圆角、间距与阴影

| 元素 | 圆角 |
| --- | --- |
| 按钮、输入框、Select | `rounded-md`（8px） |
| 面板、表格容器、代码块 | `rounded-lg`（12px） |
| Dialog、Sheet | `rounded-xl`（16px） |
| Badge、头像 | `rounded-full` |

- 间距用 4px 网格；面板内边距 16px（`p-4`），面板之间 16px（`space-y-4`）。页面区块之间最多 24px。
- 默认控件 `h-10 md:h-9`：表单控件、页头主操作。
- `sm` 控件 `h-10 md:h-8`：面板头操作、表格行内操作、分页、工具栏。
- 图标按钮 `size-10 md:size-8`。
- 页面元素不加阴影；浮层用 `shadow-overlay`。

## 3. 布局

### 3.1 应用外壳

- 顶栏通栏：白底、底部分隔线、高 56px，随页面自然滚动，不吸顶。
- 左侧放 Logo 与 `gits`，其后是主导航：**探索**（`/`）、**我的仓库**（`/dashboard`）、**同步**（`/sync`）、**访问令牌**（`/tokens`）。右侧是当前用户名、**登录设备**（`/sessions`）与**退出**；未登录时显示**登录**、**注册**。桌面端主导航项与右侧操作同高（`sm` 控件高度 `md:h-8`）。
- 「我的仓库」「同步」「访问令牌」仅登录用户可见；`/sync` 与 `/sync/sources/:sourceId` 均高亮「同步」。
- 导航高亮必须准确：`/repo/...` 页面不高亮任何主导航项。
- 移动端（`< md`）顶栏只保留 Logo 和菜单图标按钮，导航与账户操作放进右侧 Sheet。
- 不放页脚。

### 3.2 页面容器与页头

- 内容区使用 `.app-container`（最大宽度 `max-w-page`，移动端左右 16px），上下留白 `py-6 md:py-8`。
- **页头（PageHeader）**：左侧 `h1` 加最多一行说明，右侧放本页主操作，下方 `mb-6`。页头不放 Badge 标签、统计数字或 HelpTip 堆叠。
- 需要返回上级时，在页头上方放 BackLink（次要文字色、无按钮底色，箭头与内容左缘对齐），不用 ghost 按钮或负外边距去凑对齐。
- 表单类页面居中、单列；登录、注册用 `max-w-md`，新建仓库用 `max-w-xl`。登录 / 注册页的互相跳转是面板下方居中的一行文字链接，不是按钮。

### 3.3 面板（Panel）

- 结构：`rounded-lg border border-border bg-surface-base`，无阴影。
- 可选面板头：标题 + 右侧操作，统一 `min-h-[52px] px-4 py-2.5 border-b border-border-subtle`，有无按钮高度一致；面板头操作一律用 `size="sm"`。
- 面板顶部错误提示使用 `ErrorAlert inset`：通栏，只有底部分隔线，无圆角、无左右上边框。
- 列表行之间用 `border-b border-border-subtle`，最后一行无分隔线。
- 面板内不再嵌套 Card、`panel-inset`、`panel-card` 之类带底色或边框的容器。需要分组时用分隔线或小标题。

### 3.4 仓库页布局

所有 `/repo/:owner/:repo/*` 页面共用同一个仓库布局：

1. **仓库头**：`owner / name`（name 加粗，可点击回仓库首页）、可见性 Badge（公开/私有）、描述（无描述则不显示）。镜像在名称后显示链接到 GitHub 的「镜像」Badge。
2. **标签导航**：下划线式标签——代码（`Code2`）、提交（`History`）、分支（`GitBranch`）；仓库所有者和 `admin` 协作者额外看到**设置**（`Settings`）。当前标签用 `text-text-primary` 加 2px 底边，其余 `text-text-secondary`。标签内容与仓库头左缘对齐（标签不加左右内边距，用间距分隔）。标签栏底部一条贯通分隔线。
3. **设置**内部用二级导航切换**常规**和**协作者**（桌面为左侧竖排，移动端为顶部横排）。`admin` 协作者只有**协作者**一项，不显示二级导航。

「代码」标签页结构：

- 工具栏：左侧分支选择 + 路径面包屑（仅在子路径下显示，以仓库名为根；根目录不显示），右侧 Clone 地址（CopyField）。
- 文件面板：面板头是最近提交摘要（头像、作者、提交标题、短 SHA、相对时间、「历史」）；下面是目录表格（不显示表头）或文件元信息条 + 代码。
- README 面板。
- 空仓库（没有任何分支）不显示分支选择和文件面板，普通仓库改为显示推送指引（EmptyRepositoryGuide）；镜像显示「等待首次同步」空状态。

不允许某个仓库子页面自己再造一套头部样式。

## 4. 组件

基础组件在 `web/src/components/ui`（shadcn 风格），可复用的业务组件在 `web/src/components/common`，并在 `web/src/components/common/README.md` 登记。新增通用组件放在 `common` 下并补 README。

| 组件 | 规则 |
| --- | --- |
| Button | 变体：`default`（每个区域最多一个主操作）、`outline`（次要操作）、`ghost`（行内/工具栏操作）、`destructiveOutline`（危险区域里进入破坏性流程的入口，如「删除仓库」）、`destructive`（实心，只在确认 Dialog 内使用）。图标按钮必须带 `aria-label` 和 Tooltip。 |
| Badge | 高 20px（`px-2 py-0.5`），默认分支用 `outline`。只表达状态或属性：公开/私有、默认分支、令牌状态（有效/已过期/已撤销）、文件变更类型。不用 Badge 做页面标签。 |
| Table | 桌面端列表的首选。表头 `h-10 bg-surface-canvas text-body-micro text-text-tertiary`；单元格 `px-4 py-2`；行最小高 44px（移动端 48px），行悬停变色。行内主链接通过 `-my-2 py-2 block` 等方式把点击区扩展到单元格高度，不再用 `min-h-10` 撑高行。移动端隐藏次要列，或改为两行堆叠，不出现横向滚动。 |
| Dialog | 短表单与所有二次确认（删除仓库、删除分支、撤销令牌、移除协作者、创建令牌、添加协作者）。底部按钮右对齐：「取消」+ 主操作。删除仓库要求输入仓库名才能确认。 |
| Sheet | 需要较多空间、且要对照当前页面查看的内容：提交详情、路径历史、移动端导航。 |
| Select | 选项有限的选择：分支、权限、令牌有效期。 |
| HelpTip | 只在概念确实不直观时使用（例如 PAT 的用途），每个面板最多一个。 |
| Skeleton | 单块占位使用 `Skeleton`，一组占位由 `SkeletonRegion` 管理无障碍播报，立即显示；代码行与编辑器占位在 ui，业务组合骨架在 common，按真实内容结构与行高复用。已有内容的原地刷新通过 `useLoadingSkeleton` 延迟切换骨架。 |
| EmptyState | 面板内居中：图标 + 一行标题 + 可选一行说明 + 可选主操作。 |
| ShaCopyButton | 短 SHA 使用无底色的 ghost 等宽文字，悬停才显示底色；复制成功给出短暂反馈。 |
| CopyField | 带边框的只读等宽值 + 右侧相连的复制图标按钮，用于 Clone 地址和新令牌。 |
| VisibilityField | 私有 / 公开单选，每项带图标和一行说明；新建仓库和仓库设置共用。 |

## 5. 交互模式

- **对象即链接。** 仓库行、文件行、提交标题本身就是链接，不再额外放「查看」按钮。
- **行内操作。** 破坏性操作一律用带 Tooltip 的 IconButton，并先弹确认 Dialog；非破坏、语义不直观的操作（「设为默认」）用 `ghost` + `size="sm"` 文字按钮。
- **长列表。** 必须分页或「加载更多」，且不挤压主内容宽度。路径历史放进 Sheet，不常驻在代码旁边。
- **时间。** 显示相对时间（「3 分钟前」），完整时间放在 `title` 属性里。
- **SHA。** 显示 7 位短 SHA，等宽字体，可复制。
- **令牌有效期。** 用预设选项（不过期、7 天、30 天、90 天、1 年），不让用户输入时间戳。新令牌只显示一次，创建成功后在 Dialog 中展示并提供复制。
- **增删行数。** `+N` 用 `text-success`，`-N` 用 `text-danger-text`。
- **加载。** 骨架与真实内容同形状、同行高；已知框架（顶栏、仓库头、标签栏、面板标题）立即显示真实内容。首次加载立即显示同形状骨架；已有内容的原地刷新保留旧内容，超过约 200ms 仍未完成才切换为骨架，返回时直接显示新内容。各加载阶段的骨架不延迟、不淡入；脉冲只在 `motion-safe` 下播放。每个页面或 Sheet 同时只由一个区域播报一次「正在加载…」（单个 `…`），辅助骨架不播报；界面不写加载过程文字。
- **错误。** 在对应面板顶部用 Alert 显示可读的错误信息，并保留用户已输入的内容。
- **表单。** 标签在上，说明文字在下（`text-text-tertiary`），提交中按钮显示加载态并禁用。

## 6. 文案

- 简体中文。按钮以动词开头：「新建仓库」「创建令牌」「复制」「删除分支」。
- 写用户能做什么、会得到什么。不写布局原因、实现细节、内部状态或数据来源（例如不要写「避免和列表平铺」「正在获取路由包」）。
- 不出现指示性横幅。需要解释时用 HelpTip。
- 空状态告诉用户下一步，例如「还没有仓库。新建一个开始使用。」
- 错误信息说明发生了什么、用户能怎么做。

## 7. 响应式

- 断点：`md`（768px）以下视为移动端。
- 移动端左右边距 16px，页面不出现横向滚动；代码、diff、长 URL 在各自容器内滚动或截断。
- 移动端主操作按钮可以占满宽度；页头操作换行到标题下方。
- 触控目标不小于 40px。

## 8. 自检清单

提交界面改动前逐项确认：

- [ ] 没有卡片嵌卡片、边框套边框，页面元素没有阴影。
- [ ] 每页一个 `h1`，页头没有 Badge 标签和统计卡。
- [ ] 文案全部为简体中文，没有实现细节自述。
- [ ] 创建、编辑、删除都在 Dialog 或 Sheet 中完成，破坏性操作有确认。
- [ ] 列表有空状态、加载态，长列表能分页。
- [ ] 375px 宽度下无横向滚动，导航可用。
- [ ] `npm --prefix web run build` 与 `npm --prefix web run lint` 通过。
