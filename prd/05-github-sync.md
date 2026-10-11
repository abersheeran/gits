# GitHub 同步 PRD

## 1. 模块定位

把用户在 GitHub 上拥有的仓库及其所属多个组织的仓库持续镜像到 gits，作为只读副本用于浏览、clone 和备份；需要脱离 GitHub 时可将镜像转为普通仓库。同步方向只有 GitHub → gits。

## 2. 核心对象

| 对象 | 说明 |
| --- | --- |
| GitHub 连接 | 一个 GitHub 令牌及其所属 GitHub 账号；一个 gits 用户可添加多个连接 |
| 同步源 | 连接下被启用的一个 GitHub 所有者（令牌账号本人或某个组织），带命名前缀、过滤、可见性与频率设置 |
| 远端仓库 | 同步源发现的 GitHub 仓库，以 GitHub 仓库 ID 标识，记录同步状态 |
| 镜像仓库 | 与远端仓库关联的 gits 仓库，归连接所属的 gits 用户所有，只读 |

多组织规则：

- 经典 PAT 可同时访问令牌账号本人及其所属的全部组织；用户在同一连接下为每个要同步的所有者分别启用同步源。
- 细粒度 PAT 只能访问单个资源所有者，因此每个组织需单独添加一个连接。
- 同一 gits 用户下，一个 GitHub 所有者只能有一个同步源。

## 3. 凭证

1. 只支持 PAT。经典 PAT 必须包含 `repo` 与 `read:org`，缺少任一范围时拒绝保存并返回缺失项；细粒度 PAT 需对目标所有者授予 Contents 与 Metadata 只读权限，权限不足在发现时报告。
2. 保存时调用 GitHub `GET /user` 校验，记录 GitHub 登录名、用户 ID、令牌类型（按 `ghp_` / `github_pat_` 前缀判断）和经典 PAT 的范围。
3. 令牌以 AES-256-GCM 加密存入 D1，密钥由 secret `GITHUB_TOKEN_ENCRYPTION_KEY` 经 HKDF 派生；明文不返回前端、不写日志，错误信息去除令牌。更换该 secret 后已保存的令牌需重新填写。
4. GitHub 返回 401 时连接标记为失效，其下同步源暂停；用户更换令牌后恢复。
5. 组织启用 SAML SSO 且令牌未授权时（403 且带 `X-GitHub-SSO`），只有该同步源标记为「需要 SSO 授权」。

## 4. 同步规则

### 4.1 发现

- 令牌账号本人：`GET /user/repos?affiliation=owner&visibility=all`，只含该账号拥有的仓库。
- 组织：`GET /orgs/{org}/repos?type=all`。
- 每页 100 条，全部页读取成功才算一次完整发现；只有完整发现才把本次未出现的远端仓库标记为「GitHub 上不可访问」。
- 过滤：默认排除 Fork、包含已归档仓库，可在同步源设置中修改。用户可对单个远端仓库手动纳入或排除，手动选择优先于过滤规则。
- 远端仓库的 `pushed_at` 与上次成功同步时记录的值不同即排队同步；每个镜像至少每 24 小时完整检查一次。

### 4.2 命名

- 镜像建在连接所属的 gits 用户名下，本地名称为「同步源前缀 + GitHub 仓库名」。令牌账号本人默认无前缀；组织默认前缀为 `<组织登录名>.`，GitHub 登录名不含 `.`，因此不同组织的同名仓库不会互相冲突。
- 本地名称在首次创建镜像时确定。之后修改前缀、GitHub 改名或转移都不改动已有镜像的名称，用户可在仓库设置中重命名。
- 远端仓库以 GitHub 仓库 ID 识别；仓库在已启用的同步源之间转移时沿用原镜像。
- 目标名称已被占用或不合法（如超过 100 个字符）时，远端仓库进入「名称冲突」且不创建仓库；用户为它指定本地名称后重试。

### 4.3 拉取

- 只同步 `refs/heads/*`、`refs/tags/*` 与 `HEAD`；不同步 `refs/pull/*`、Wiki、Issue、Release 附件与 LFS 对象，LFS 指针文件作为普通内容同步。
- 本地引用强制对齐远端：新增、强制更新，并删除远端已不存在的引用；`HEAD` 跟随 GitHub 默认分支。已拉取的对象不会因远端强推而删除。
- 以本地已有引用作为 have 增量拉取，只下载缺少的对象。GitHub 空仓库只创建空镜像。
- GitHub 报告的仓库大小超过单仓库存储上限（10 GB，见 [Git 托管与存储](03-git-hosting-and-storage.md#22-容量)）时，远端仓库标记为「超出大小限制」且不写入任何数据；远端大小变化后重新评估。单次拉取超过 5 分钟 CPU 时间时按失败处理。

### 4.4 元数据

- 描述在每次发现后覆盖为 GitHub 描述。
- 可见性按同步源策略：「跟随 GitHub」（默认，GitHub 私有则私有、公开则公开，随发现更新）或「全部私有」。GitHub `internal` 仓库视为私有。
- 镜像仓库的描述与可见性不能在 gits 修改，名称可以修改。

### 4.5 只读与解除

- 镜像仓库拒绝一切写入：Git push、创建与删除分支、切换默认分支。push 在 `git-receive-pack` 引用发现阶段返回 403，提示仓库为 GitHub 镜像。
- 协作者照常管理，但镜像期间任何权限都不能写入。
- 停止同步：所有者确认后镜像转为普通仓库，保留全部数据并恢复写入；对应远端仓库改为手动排除，不会重新创建镜像。
- 删除镜像仓库同样把对应远端仓库改为手动排除。
- GitHub 上删除仓库或失去访问权限：保留本地镜像与数据，状态为「GitHub 上不可访问」并停止同步；恢复访问后自动继续。
- 移除同步源或连接：其下镜像全部转为普通仓库并保留数据。

## 5. 调度

1. Cron 每 5 分钟运行调度器：对到期的同步源执行发现，再派发到期的镜像任务。同步源频率可选 15 分钟、1 小时（默认）、6 小时、每天。
2. 镜像任务由对应仓库的 `RepositoryObject` 通过 alarm 执行。新远端仓库在派发时才创建本地仓库，超出大小限制或名称冲突的不创建。
3. 全实例同时最多运行 4 个镜像任务。每个任务结束后立即派发下一个到期任务，初次导入不必等待 Cron 周期。
4. 派发通过 D1 条件更新领取任务并设置 20 分钟租约，任务带领取标识，过期或被重新领取的任务直接放弃。重复派发只会产生一次无变化的拉取。
5. 领取时即计入尝试次数，因此进程被平台终止（内存或 CPU 超限）也按失败处理。失败按 5 分钟、15 分钟、1 小时、6 小时、24 小时退避；GitHub REST 速率限制耗尽时，同步源推迟到重置时间。
6. 「立即同步」：同步源立即执行一次发现并派发；单个镜像立即派发。
7. Worker Previews 不运行 Cron，Preview 中只能手动触发；触发后的后续任务仍由任务结束时的接续派发推进。

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

同步源状态：正常、需要 SSO 授权、失败（显示原因）、已暂停（手动暂停或连接失效）。

## 7. 界面

- 主导航新增「同步」（`/sync`），仅登录用户可见。
- `/sync`：页头主操作「添加 GitHub 账号」，在 Dialog 中填写令牌，所需范围通过 ? 图标的 Tooltip 说明。每个连接一个面板：面板头为 GitHub 头像、登录名、连接状态，以及更换令牌、移除的图标按钮；面板主体为所有者表格，列出令牌账号本人与所属组织，列为所有者、已同步/总数、状态、上次同步与操作。
  - 未启用的所有者行内显示「同步」，打开设置 Sheet 确认前缀、过滤、可见性与频率后启用。
  - 已启用的所有者提供立即同步与设置图标按钮，点击名称进入同步源页。
  - 表格下方「添加组织」打开 Dialog 输入组织登录名，用于细粒度令牌或列表中未出现的组织。
- `/sync/sources/:sourceId`：页头为所有者名，操作为立即同步与设置（Sheet）。状态筛选为「全部 / 已同步 / 需处理 / 未同步」，「需处理」包含失败、超出大小限制、名称冲突与 GitHub 上不可访问。表格列为 GitHub 仓库（外链）、本地仓库（链接）、状态（失败原因在 Tooltip）、上次同步与操作（立即同步、纳入、排除、指定本地名称）。每页 50 条。
- 仓库头与我的仓库列表：镜像仓库名称后显示「镜像」Badge，链接到 GitHub 仓库。
- 代码页：镜像尚未完成首次同步时显示等待同步的空状态，不显示推送命令。
- 分支页：镜像仓库不显示新建、删除与切换默认分支操作。
- 仓库设置「常规」：镜像的描述与可见性只读，用 ? 图标的 Tooltip 说明由 GitHub 同步；新增「同步」区，展示来源、状态、上次同步，并提供立即同步与停止同步（二次确认）。
- 移除同步源或连接须二次确认，说明镜像会转为普通仓库并保留数据。

## 8. 接口

GitHub 接口均需登录，只能访问自己的连接与同步源。

| 接口 | 用途 |
| --- | --- |
| `GET /api/github/connections` | 连接列表，含各连接已启用同步源的摘要 |
| `POST /api/github/connections` | `token`；校验后创建连接 |
| `PATCH /api/github/connections/:connectionId` | `token`；更换令牌 |
| `DELETE /api/github/connections/:connectionId` | 移除连接及其同步源 |
| `GET /api/github/connections/:connectionId/owners` | 实时读取令牌账号与所属组织，并标记已启用的同步源 |
| `POST /api/github/sources` | `connectionId`、`ownerLogin` 及设置字段；启用同步源 |
| `GET /api/github/sources/:sourceId` | 同步源详情与各状态计数 |
| `PATCH /api/github/sources/:sourceId` | `namePrefix`、`includeForks`、`includeArchived`、`visibilityPolicy`、`intervalMinutes`、`paused` |
| `DELETE /api/github/sources/:sourceId` | 移除同步源 |
| `POST /api/github/sources/:sourceId/sync` | 立即发现并派发 |
| `GET /api/github/sources/:sourceId/repositories` | 远端仓库列表；`status`、`page`，每页 50 条 |
| `PATCH /api/github/sources/:sourceId/repositories/:githubRepoId` | `selection`（`auto / include / exclude`）、`localName` |
| `POST /api/repos/:owner/:repo/mirror/sync` | 立即同步该镜像，仅所有者 |
| `DELETE /api/repos/:owner/:repo/mirror` | 停止同步并转为普通仓库，仅所有者 |

`GET /api/repos/:owner/:repo` 增加 `mirror`：`fullName`、`htmlUrl`、`state`、`lastSyncedAt`、`lastError`，普通仓库为 `null`。`GET /api/repos` 的每项增加 `is_mirror`。

## 9. 数据模型

- `github_connections`：ID、用户 ID、GitHub 用户 ID 与登录名、令牌类型、令牌密文、经典 PAT 范围、状态、最近错误、创建与更新时间。
- `github_sync_sources`：ID、用户 ID、连接 ID、所有者类型（`user / organization`）、所有者登录名与 GitHub ID、名称前缀、是否包含 Fork、是否包含归档、可见性策略、频率、是否暂停、状态与最近错误、下次与上次发现时间、租约到期时间、创建时间；用户与所有者 GitHub ID 联合唯一。
- `github_repositories`：ID、用户 ID、同步源 ID、GitHub 仓库 ID、全名、描述、私有/Fork/归档标记、大小、默认分支、`pushed_at`、最近出现时间、不可访问起始时间、手动选择、指定本地名称、关联仓库 ID（唯一，仓库删除时置空）、同步状态与最近错误、尝试次数、上次成功同步时的 `pushed_at`、上次同步时间、下次同步时间、租约到期时间与领取标识；用户与 GitHub 仓库 ID 联合唯一。

仓库是否为镜像由 `github_repositories` 是否存在指向它的记录决定，不在 `repositories` 增加字段。删除同步源或连接时级联删除其远端仓库记录，镜像随之成为普通仓库。

## 10. 实现约束

- 拉取客户端：实现 Smart HTTP 协议 v0 的 upload-pack 客户端，复用 `git-protocol.ts` 的 pkt-line 编解码；请求 `ofs-delta side-band-64k no-progress`，不请求 `thin-pack`；流式读取 pack，超过上限立即中止。认证使用 Basic Auth，用户名为 GitHub 登录名、密码为令牌。
- 共享入库：复用 push 的流式 pack 入库与连通性检查。push 按旧值比较后更新引用，镜像按远端强制对齐。
- 共享建仓：从 `POST /api/repos` 抽出建仓服务（D1 记录、DO 初始化与失败回滚），供接口和镜像共用。
- DO alarm：`RepositoryObject` 在 DO storage 中记录待执行任务（仓库 ID 与领取标识）；alarm 从 D1 读取当前仓库名称与连接凭证后执行，结果写回 D1，并调用派发器接续。
- Worker 配置：`triggers.crons` 设为每 5 分钟；新增 secret `GITHUB_TOKEN_ENCRYPTION_KEY`，Preview 通过 base-config 单独设置。

## 11. 不在范围

- gits → GitHub 的推送镜像与双向同步。
- GitHub App、OAuth 授权与 Webhook 实时触发；变更检测依赖 `pushed_at` 轮询。
- 他人拥有、用户仅为协作者的仓库。
- Issue、Pull Request、Wiki、Release 与 LFS 对象。
- gits 组织：组织仓库以前缀平铺到个人命名空间。
- 批量删除镜像仓库。

## 12. 关键代码文件

- `src/services/github/`：GitHub REST 客户端、令牌加密、发现与调度派发
- `src/services/git-fetch-client.ts`
- `src/services/repository-object.ts`
- `src/services/git-service.ts`
- `src/routes/api/github-sync-routes.ts`
- `src/routes/git.ts`
- `src/index.ts`
- `src/db/migrations/`
- `web/src/pages/sync-page.tsx`
- `web/src/pages/sync-source-page.tsx`
- `web/src/components/common/repository-layout.tsx`
- `web/src/pages/repository-settings-page.tsx`
- `web/src/pages/repository-branches-page.tsx`
