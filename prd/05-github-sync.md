# GitHub 同步 PRD

## 1. 模块定位

把用户在 GitHub 上拥有的仓库及其管理的多个组织的仓库持续镜像到 gits，作为只读副本用于浏览、clone 和备份；需要脱离 GitHub 时可将镜像转为普通仓库。同步方向只有 GitHub → gits。授权通过部署者注册的 GitHub App 完成，同步哪些仓库由用户在 GitHub 的安装设置中决定。

## 2. 核心对象

| 对象 | 说明 |
| --- | --- |
| GitHub App | 部署者为本实例注册的一个 App，所有 gits 用户共用；凭证是实例级配置 |
| 同步源 | 一个 GitHub App 安装（个人账号或组织），绑定到一个 gits 用户，带命名前缀、过滤与可见性设置 |
| 远端仓库 | 安装可访问的 GitHub 仓库，以 GitHub 仓库 ID 标识，记录同步状态 |
| 镜像仓库 | 与远端仓库关联的 gits 仓库，归同步源所属的 gits 用户所有，只读 |

多组织规则：

- 每个个人账号或组织各自安装一次 App，每个安装对应一个同步源。安装时在 GitHub 上选择「全部仓库」或「指定仓库」，之后随时可以在 GitHub 上调整；选择「全部仓库」时，之后新建的仓库会自动纳入。
- 一个安装只能绑定到一个 gits 用户。
- App 必须设为「任何账号都可安装」，否则无法安装到其他组织。未绑定到 gits 用户的安装不会产生任何镜像。

## 3. 授权与绑定

1. **App 凭证**：部署者通过 `npm run github-app:create` 用 GitHub App Manifest 流程一键注册 App，脚本把 App ID、slug、Client ID、Client Secret、私钥和 Webhook Secret 写入 Worker secret（或本地 `.env`）。也可以手动注册，并按文档填写 URL、权限与事件。缺少任一配置时，GitHub 同步显示为未配置。
2. **App 权限**：仓库 Contents 只读、Metadata 只读；组织 Members 只读（用于校验绑定者是否为组织管理员）。订阅 `push` 与 `repository` 事件；`installation`、`installation_repositories` 事件由 GitHub 自动投递。
3. **绑定流程**：
   - 「添加账号或组织」跳转到 App 的安装页。安装或更新完成后，GitHub 跳回 Setup URL，gits 立即进入 OAuth 授权。
   - 「关联已有安装」直接进入 OAuth 授权。
   - OAuth 使用 `state` 与 PKCE，`state` 与当前 gits 会话绑定；OAuth 授权有效期为 10 分钟，回调只能使用一次；吊销发起授权的会话后，该次授权也失效。回调中用 code 换取用户令牌，读取该用户可访问的安装，逐个检查后绑定。
4. **绑定条件**：个人账号的安装只能由该账号本人绑定；组织的安装只能由组织管理员（成员身份为 `active` 且角色为 `admin`）绑定；已被其他 gits 用户绑定的安装不能再次绑定。不满足条件的安装不绑定，并在同步页说明原因。不信任 Setup URL 中的 `installation_id`。
5. **令牌**：gits 不保存用户令牌，用户令牌只在回调中使用。同步使用 App 私钥签发 JWT 换取的安装令牌（有效期 1 小时），在内存中缓存到过期前 5 分钟。
6. **解除绑定**：在 gits 中解除绑定，只删除同步源，不会在 GitHub 上卸载 App；同步页提供跳转到 GitHub 安装设置的链接。在 GitHub 上卸载 App 时，gits 收到 `installation.deleted` 后自动解除绑定。
7. 绑定后不会再校验绑定者是否仍是组织管理员：安装的授权属于组织本身。组织应在 GitHub 上管理或卸载安装。

## 4. 同步规则

### 4.1 发现

- 用安装令牌读取 `GET /installation/repositories`，每页 100 条。全部页读取成功才算一次完整发现；只有完整发现才把本次未出现的远端仓库标记为「GitHub 上不可访问」。
- 过滤：默认排除 Fork、包含已归档仓库，可在同步源设置中修改。用户可对单个远端仓库手动纳入或排除，手动选择优先于过滤规则。仓库范围本身由 GitHub 上的安装设置决定。
- 远端仓库的 `pushed_at` 与上次成功同步时的值不同即排队同步；每个镜像至少每 24 小时完整检查一次。

### 4.2 命名

- 镜像建在同步源所属的 gits 用户名下，本地名称为「同步源前缀 + GitHub 仓库名」。个人账号默认无前缀；组织默认前缀为 `<组织登录名>.`。GitHub 登录名不含 `.`，因此不同组织的同名仓库不会互相冲突。
- 本地名称在首次创建镜像时确定。之后修改前缀、GitHub 改名或转移都不改动已有镜像的名称，用户可在仓库设置中重命名。
- 远端仓库以 GitHub 仓库 ID 识别；仓库在同一用户已绑定的安装之间转移时沿用原镜像。
- 目标名称已被占用或不合法（如超过 100 个字符）时，远端仓库进入「名称冲突」且不创建仓库；用户为它指定本地名称后重试。

### 4.3 拉取

- 只同步 `refs/heads/*`、`refs/tags/*` 与 `HEAD`；不同步 `refs/pull/*`、Wiki、Issue、Release 附件与 LFS 对象，LFS 指针文件作为普通内容同步。
- 本地引用强制对齐远端：新增、强制更新，并删除远端已不存在的引用；`HEAD` 跟随 GitHub 默认分支。已拉取的对象不会因远端强推而删除。
- 以本地已有引用作为 have 增量拉取，只下载缺少的对象；连通性检查只覆盖本次新增的对象。GitHub 空仓库只创建空镜像。
- GitHub 报告的仓库大小超过单仓库存储上限（10 GB，见 [Git 托管与存储](03-git-hosting-and-storage.md#22-容量)）时，远端仓库标记为「超出大小限制」且不写入任何数据；远端大小变化后重新评估。单次拉取超过 5 分钟 CPU 时间时按失败处理。

### 4.4 元数据

- 描述在每次发现后覆盖为 GitHub 描述。
- 未手动设置的镜像可见性按同步源的默认可见性策略：「跟随 GitHub」（默认，GitHub 私有则私有、公开则公开，随发现更新）或「私有」。GitHub `internal` 仓库视为私有。
- 所有者可单独修改镜像在 gits 上的可见性；手动选择优先于 GitHub 可见性和同步源策略，后续发现、同步、修改同步源策略以及同一用户的安装间转移均保留该选择，不会修改 GitHub 仓库的可见性。
- 镜像仓库的描述不能在 gits 修改，名称可以修改。

### 4.5 只读与解除

- 镜像仓库拒绝一切写入：Git push、创建与删除分支、切换默认分支。push 在 `git-receive-pack` 引用发现阶段返回 403，并以 `text/plain` 说明仓库为 GitHub 镜像，git 客户端会显示该说明。
- 协作者照常管理，但镜像期间任何权限都不能写入。
- 停止同步：所有者确认后镜像转为普通仓库，保留全部数据并恢复写入；对应远端仓库改为手动排除，不会重新创建镜像。
- 删除镜像仓库同样把对应远端仓库改为手动排除。
- GitHub 上删除仓库、或从安装的仓库范围中移除：保留本地镜像与数据，状态为「GitHub 上不可访问」并停止同步；恢复访问后自动继续。
- 解除同步源绑定或在 GitHub 上卸载 App：其下镜像全部转为普通仓库并保留数据。

## 5. 调度

1. **Webhook 为主**：`push` 事件让对应远端仓库立即排队并派发；`repository`、`installation_repositories` 事件以及 `installation` 的 `new_permissions_accepted`、`unsuspend` 动作触发该安装的一次发现；`installation` 的 `deleted` 动作解除绑定，`suspend` 动作暂停同步源。Webhook 用 `X-Hub-Signature-256` 校验，验证通过后立即返回 202，处理在后台完成；未绑定的安装直接忽略。重复投递只会产生一次无变化的拉取。
2. **轮询兜底**：Cron 每 5 分钟运行调度器，对距上次发现超过 6 小时的同步源执行发现，再派发到期的镜像任务。已挂起的安装每 6 小时复查是否恢复或被卸载，仍挂起时不读取仓库、不派发任务；用户手动暂停的同步源不自动复查。Webhook 丢失时，最迟在下一次兜底发现时补齐。发现执行期间收到的新发现请求保留到下一次 Cron，失去领取标识的发现任务不得覆盖同步状态或仓库元数据。
3. 镜像任务由对应仓库的 `RepositoryObject` 通过 alarm 执行。新远端仓库在派发时才创建本地仓库；超出大小限制或名称冲突的不创建。
4. 全实例同时最多运行 4 个镜像任务。每个任务结束后立即派发下一个到期任务。
5. 派发通过 D1 条件更新领取任务，并设置 20 分钟租约；任务带领取标识，过期或被重新领取的任务直接放弃。任务执行期间收到的同步请求（webhook 或发现）不会丢失，任务结束后立即重新排队。
6. 领取时即计入尝试次数，因此进程被平台终止（内存或 CPU 超限）也按失败处理。失败按 5 分钟、15 分钟、1 小时、6 小时、24 小时退避；GitHub REST 速率限制耗尽时，该同步源的发现与新镜像任务派发均推迟到重置时间，Webhook 与手动同步不能绕过等待。
7. 「立即同步」：同步源立即执行一次发现并派发；单个镜像立即派发。
8. Worker Previews 不支持 GitHub 同步：一个 App 只有一个 Webhook 与 Setup 地址，指向生产环境。

## 6. 状态

| 远端仓库状态 | 含义 |
| --- | --- |
| 未同步 | 被过滤规则或手动排除 |
| 排队中 | 等待派发 |
| 同步中 | 任务执行中 |
| 已同步 | 最近一次同步成功 |
| 失败 | 最近一次同步失败，显示原因并按退避重试 |
| 超出大小限制 | 见 4.3 |
| 名称冲突 | 见 4.2 |
| GitHub 上不可访问 | 见 4.5 |

同步源状态：正常、失败（显示原因）、已暂停（gits 中手动暂停）、已挂起（GitHub 上挂起了安装）。

## 7. 界面

- 主导航「同步」（`/sync`），仅登录用户可见。
- 同步列表与同步源详情在页面可见时每 10 秒刷新状态，页面隐藏时暂停，Webhook 触发或后台完成的任务无需手动刷新页面。
- `/sync`：页头主操作「添加账号或组织」（跳转到 App 安装页），次操作「关联已有安装」（进入 OAuth）。未配置 App 时显示空状态，引导用户联系部署者配置 GitHub App；注册命令见部署文档。
  - 绑定回调的结果通过地址参数带回：成功时刷新列表；有安装因为不是本人账号、不是组织管理员或已被他人绑定而未能绑定时，在页面顶部用错误提示逐个说明。
  - 同步源表格每页 50 条，列为：账号（头像、登录名、个人或组织、仓库范围为全部或指定）、已同步/总数、状态、上次同步、操作（立即同步、设置、在 GitHub 上管理、解除绑定）。点击账号名进入同步源页；「N 个仓库需处理」是可点击入口，直达该账号的需处理筛选第一页。存在仓库异常时不显示「正常」，同步源自身失败、暂停或挂起仍单独展示。解除绑定须二次确认，说明镜像会转为普通仓库并保留数据，且不会在 GitHub 上卸载 App。
- `/sync/sources/:sourceId`：页头为账号名，操作为立即同步、设置（Sheet）、在 GitHub 上管理仓库范围。状态筛选为「全部 / 已同步 / 需处理 / 未同步」，「需处理」包含失败、超出大小限制、名称冲突与 GitHub 上不可访问。表格列为 GitHub 仓库（外链）、本地仓库（链接）、状态（失败原因在 Tooltip）、上次同步与操作（立即同步、纳入、排除、指定本地名称）。每页 50 条。
  - 「需处理」筛选使用问题列表，每项直接展示仓库、具体原因及处理入口；可展开查看完整错误详情，移动端同样可见。名称冲突提供「指定本地名称」，可重试失败提供「重试同步」，访问权限问题提供「检查 GitHub 授权」，下架或超限提供 GitHub 查看入口。停止同步或排除仓库仍须二次确认。
  - 处理完成后由刷新移出问题列表，没有问题时显示「没有需要处理的仓库」。问题原因不只依赖悬停提示。
- 同步源设置 Sheet：本地名称前缀、包含 Fork、包含已归档仓库、默认可见性策略、暂停同步；默认可见性选项说明仅影响未单独设置可见性的镜像。
- 仓库头与我的仓库列表：镜像仓库名称后显示「镜像」Badge，链接到 GitHub 仓库。
- 代码页：镜像尚未完成首次同步时显示等待同步的空状态，不显示推送命令。
- 分支页：镜像仓库不显示新建、删除与切换默认分支操作。
- 仓库设置「常规」：镜像的描述只读，用 ? 图标的 Tooltip 说明由 GitHub 同步；可见性显示当前值，通过编辑图标打开对话框并单独保存，说明修改仅影响 gits 且后续同步会保留选择；「同步」区展示来源、状态、上次同步，并提供立即同步与停止同步（二次确认）。

## 8. 接口

除 Webhook 外，GitHub 接口均需登录，只能访问自己的同步源。

| 接口 | 用途 |
| --- | --- |
| `GET /api/github/sources` | `{ configured, installUrl, sources }` |
| `GET /api/github/authorize` | 浏览器跳转：发起 OAuth（`state` + PKCE）后重定向到 GitHub |
| `GET /api/github/setup` | App 的 Setup URL：已登录时转入 `/api/github/authorize`，未登录时转到登录页 |
| `GET /api/github/oauth/callback` | OAuth 回调：校验、绑定，然后重定向回 `/sync` 并带上结果参数 |
| `POST /api/github/webhook` | Webhook 入口，签名校验，无需登录 |
| `GET /api/github/sources/:sourceId` | 同步源详情与各状态计数 |
| `PATCH /api/github/sources/:sourceId` | `namePrefix`、`includeForks`、`includeArchived`、`visibilityPolicy`、`paused` |
| `DELETE /api/github/sources/:sourceId` | 解除绑定 |
| `POST /api/github/sources/:sourceId/sync` | 立即发现并派发 |
| `GET /api/github/sources/:sourceId/repositories` | 远端仓库列表；`status`、`page`，每页 50 条 |
| `PATCH /api/github/sources/:sourceId/repositories/:githubRepoId` | `selection`（`auto / include / exclude`）、`localName` |
| `POST /api/repos/:owner/:repo/mirror/sync` | 立即同步该镜像，仅所有者 |
| `DELETE /api/repos/:owner/:repo/mirror` | 停止同步并转为普通仓库，仅所有者 |

`GET /api/repos/:owner/:repo` 增加 `mirror`：`sourceId`、`fullName`、`htmlUrl`、`state`、`lastSyncedAt`、`lastError`，普通仓库为 `null`。`GET /api/repos` 的每项增加 `is_mirror`。

## 9. 数据模型

- `github_oauth_states`：一次性 OAuth 状态（不使用 JWT），会话吊销或用户删除时级联删除。
- `github_installations`（同步源）：ID、GitHub 安装 ID（唯一）、所属 gits 用户 ID、账号 ID/登录名/类型/头像、仓库范围（`all / selected`）、绑定者 GitHub 用户 ID 与登录名、名称前缀、是否包含 Fork、是否包含归档、可见性策略、是否暂停、是否被挂起、状态与最近错误、下次与上次发现时间、限流等待截止时间、租约与领取标识、创建与更新时间。
- `github_repositories`：ID、所属 gits 用户 ID、同步源 ID、GitHub 仓库 ID、全名、描述、私有/Fork/归档标记、大小、默认分支、`pushed_at`、最近出现时间、不可访问起始时间、手动选择、指定本地名称、关联仓库 ID（唯一，仓库删除时置空）、同步状态与最近错误、尝试次数、同步请求时间、上次成功同步时的 `pushed_at`、上次同步时间、下次同步时间、租约、领取标识与领取时间；用户与 GitHub 仓库 ID 联合唯一。
- 远端仓库另记录本地镜像的手动可见性（未设置 / 公开 / 私有）；首次镜像默认未设置，停止同步或删除镜像时清除，转为普通仓库后保留当前可见性。

仓库是否为镜像由 `github_repositories` 是否存在指向它的记录决定，不在 `repositories` 增加字段。解除同步源时级联删除其远端仓库记录，镜像随之成为普通仓库。

## 10. 实现约束

- App JWT 使用 RS256，`iat` 提前 60 秒，`exp` 不超过 10 分钟，`iss` 为 Client ID。私钥同时接受 PKCS#1 与 PKCS#8 格式的 PEM，以及 base64 编码的 PEM。
- 拉取客户端：Smart HTTP 协议 v0 的 upload-pack 客户端，Basic Auth 用户名为 `x-access-token`、密码为安装令牌；请求 `ofs-delta side-band-64k no-progress`，不请求 `thin-pack`；流式入库。
- 所有对 GitHub 的请求使用 `redirect: "manual"`，3xx 一律当作错误；workerd 不支持 `redirect: "error"`，`fetch` 也不能以对象方法的形式调用。
- 配置：secret `GITHUB_APP_ID`、`GITHUB_APP_SLUG`、`GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_APP_WEBHOOK_SECRET`；Cron 每 5 分钟。
- App 注册脚本生成的默认名称不超过 GitHub 的 34 字符限制；支持 `--no-open` 输出注册地址供用户在指定浏览器打开。

## 11. 不在范围

- 个人访问令牌（PAT）与 OAuth App 授权。需要同步自己不是管理员的组织时，由组织管理员安装 App 并绑定到自己的 gits 账号。
- gits → GitHub 的推送镜像与双向同步。
- 他人拥有、用户仅为协作者的仓库。
- Issue、Pull Request、Wiki、Release 与 LFS 对象。
- gits 组织：组织仓库以前缀平铺到个人命名空间。
- Worker Previews 中的 GitHub 同步。
- 批量删除镜像仓库。

## 12. 关键代码文件

- `src/services/github/`：App 认证（JWT 与安装令牌）、REST 客户端、OAuth 绑定、Webhook 处理、发现、调度与派发、镜像 alarm、停止同步
- `src/services/git-fetch-client.ts`、`src/services/git-fetch-protocol.ts`
- `src/services/repository-creation.ts`
- `src/services/repository-object.ts`
- `src/routes/api/github-*.ts`
- `src/routes/git.ts`
- `src/index.ts`
- `src/db/migrations/0002_github_sync.sql`
- `scripts/create-github-app.mjs`
- `web/src/pages/sync-page.tsx`、`web/src/pages/sync-source-page.tsx`
- `web/src/components/common/github-*.tsx`、`repository-mirror-panel.tsx`
- `web/src/lib/github-api.ts`
