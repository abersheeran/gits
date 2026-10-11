# 使用文档（gits）

本文说明如何部署服务、管理个人仓库和协作者，以及通过网页、API 和 Git 读写代码。

## 1. 产品范围

`gits` 是运行在 Cloudflare Workers 上的个人 Git 仓库托管服务，提供账户与 PAT、仓库管理、分支管理、代码浏览、提交历史和 GitHub 同步。仓库可公开或私有，协作者按仓库授权。完整功能边界见 [PRD 索引](../prd/README.md#2-功能边界)。

## 2. 前置要求

- Node.js 22.12+、npm、Git、curl。
- Cloudflare 账号及可用的 D1、R2；Worker Previews 要求项目开发依赖 Wrangler >= 4.135.0，不使用全局安装版本。
- 以下 API 示例使用 `jq` 提取 PAT。

## 3. 项目初始化

```bash
npm install
npm --prefix web install
cp .env.example .env
npm run secret:dev
npm run build:web
```

按提示依次输入本地 JWT 密钥和 GitHub 令牌加密密钥。首次构建生成 `wrangler.jsonc` 所需的前端静态资源。可运行 `npm run typecheck` 和 `npm run test` 检查后端，前端构建也会检查前端 TypeScript。

## 4. Cloudflare 资源与配置

### 4.1 必要资源

| 绑定 | 用途 | 默认配置 |
| --- | --- | --- |
| `DB` | D1 元数据 | 生产 `gits`；Preview `gits-preview`；ID 以 [wrangler.jsonc](../wrangler.jsonc) 为准 |
| `GIT_BUCKET` | 仅用于导入旧格式仓库；对象与引用保存在每仓库 DO SQLite | 生产 R2 桶 `gits`；Preview R2 桶 `gits-preview` |
| `REPOSITORY_OBJECTS` | 仓库 Durable Object | `RepositoryObject`，每个 Preview 独立命名空间和存储 |
| `ASSETS` | 前端静态文件 | `web/dist` |

本地开发使用 Wrangler 本地资源。所有 Preview 分支共用上述预览 D1/R2，与生产隔离；DO 由部署配置管理。

### 4.2 创建远程资源

```bash
npx wrangler login
# 生产
npm run d1:create:remote
npx wrangler r2 bucket create gits
# Preview
npx wrangler d1 create gits-preview
npx wrangler r2 bucket create gits-preview
```

将返回的生产 D1 ID 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`。将 Preview D1 ID 同时填入 `wrangler.jsonc` 的 `previews.d1_databases[0].database_id` 和 `wrangler.preview-migrations.jsonc` 的 `d1_databases[0].database_id`；两处必须指向同一个预览数据库。

Preview 绑定与变量在 `previews` 中显式配置，不继承生产设置；`assets`、兼容日期与标志、DO 迁移仍在顶层。`REPOSITORY_OBJECTS` 在 Preview 中也必须声明。

### 4.3 本地、生产与 Preview 变量

本地 `.env` 模板：

```dotenv
JWT_SECRET=replace-with-a-strong-secret
GITHUB_TOKEN_ENCRYPTION_KEY=replace-with-a-strong-secret
ALLOW_USER_REGISTRATION=true
```

| 变量 | 用途与配置 |
| --- | --- |
| `JWT_SECRET` | 登录 JWT 密钥；本地 `npm run secret:dev:jwt`，生产 `npm run secret:prod:jwt` |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | GitHub PAT 加密密钥；本地 `npm run secret:dev:github`，生产 `npm run secret:prod:github`；未设置时停用同步，更换后需重新填写 PAT |
| `ALLOW_USER_REGISTRATION` | `true`（不区分大小写）启用注册，其他值或未设置时关闭 |
| `UPLOAD_PACK_MAX_BODY_BYTES` / `RECEIVE_PACK_MAX_BODY_BYTES` | fetch 默认 8 MiB；push 未设置时仅受平台请求体限制 |

开发脚本读取 `.env`，生产变量需要单独配置。部署时可用 `--var ALLOW_USER_REGISTRATION:true` 开放注册。

生产与 Preview 首次部署前分别设置 JWT 与 GitHub 加密密钥：

```bash
npm run secret:prod
npx wrangler preview base-config secret put JWT_SECRET
npx wrangler preview base-config secret put GITHUB_TOKEN_ENCRYPTION_KEY
```

Base 密钥用于新建的 Preview；已有 Preview 使用 `npx wrangler preview secret put JWT_SECRET --name <preview>` 更新。Preview 已在 `previews.vars` 中设置 `ALLOW_USER_REGISTRATION="true"`。

生产环境的 Cron 每 5 分钟运行一次同步调度。Preview 不运行 Cron，只能通过同步源或镜像的「立即同步」手动触发；任务完成后通过 alarm 接续派发队列。`previews` 不需要配置 Cron。

### 4.4 数据库迁移

```bash
# 本地
npm run db:migrate:local
# 生产远程
npm run db:migrate
# Preview 远程
npm run db:migrate:preview
```

`npm run dev` 自动执行本地迁移；`npm run deploy` 自动执行生产迁移；`npm run preview` 先通过 `wrangler.preview-migrations.jsonc` 迁移同一个 `gits-preview` 数据库，再运行 `wrangler preview`。

## 5. 本地运行、部署与健康检查

### 5.1 本地运行

两个终端分别运行：

```bash
npm run dev
```

```bash
npm run dev:web
```

浏览器打开 Vite 输出的地址。`web/vite.config.ts` 将 API、健康检查及 Git 请求代理到 `http://127.0.0.1:8787`，本地 Worker 需使用此端口。

### 5.2 Workers Builds 与 Preview

在 Workers Builds 中将仓库连接到 `gits` Worker，选择生产分支，为其余所有分支启用 **Preview builds**，根目录选择仓库根目录：

| 设置 | 命令 |
| --- | --- |
| Build command | `npm ci && npm --prefix web ci && npm run build` |
| Deploy command（生产分支） | `npm run deploy` |
| Preview command（其余分支） | `npm run preview` |

Preview 地址格式为 `<branch>-gits.<subdomain>.workers.dev`。手动运行 `npm run preview` 前需先构建前端。配置规则见 [Cloudflare Preview 文档](https://developers.cloudflare.com/workers/previews/configuration/)。

### 5.3 手动部署

远程资源配置完成后部署：

```bash
npm run secret:prod
npm run deploy -- --var ALLOW_USER_REGISTRATION:true
```

部署依次执行远程迁移、前端构建和 Worker 发布，并保留已有生产变量。之后再次部署直接运行 `npm run deploy`。

### 5.4 健康检查

```bash
BASE_URL="http://127.0.0.1:8787"
curl -sS "$BASE_URL/healthz"
curl -sS "$BASE_URL/api/healthz"
```

生产环境将 `BASE_URL` 替换为部署的 HTTPS 地址。两个接口均返回 `ok: true`，前者另含时间戳；这不代表已检测所有存储读写。

## 6. 认证与权限

注册和登录设置有效期为 7 天的 JWT 登录 cookie。API 也接受 `Authorization: Bearer <JWT或PAT>`；Git Basic Auth 使用用户名和该用户的 PAT，不能用账户密码代替。

| 身份 | 能力 |
| --- | --- |
| 游客 | 浏览、clone / fetch 公开仓库 |
| `read` 协作者 | 读取对应仓库，包括私有仓库 |
| `write` 协作者 | 读取和 Git push |
| `admin` 协作者 | 读取、Git push、管理协作者 |
| 所有者 | 上述全部能力，以及仓库设置、删除、分支管理 |

PAT 明文只在创建时返回，可设置到期时间或撤销；PAT 不限制到单个仓库。登出只清除登录 cookie，不撤销已有 JWT 或 PAT。

登录 cookie 使用 HttpOnly 和 SameSite=Lax；HTTPS 下设置 Secure，本地 HTTP 不设置 Secure，可直接使用浏览器或 curl cookie 文件。

## 7. Web 使用路径

### 7.1 账户

- `/`：公开仓库。
- `/register`、`/login`：注册、登录。
- `/dashboard`：拥有或参与协作的仓库。
- `/repositories/new`：创建仓库。
- `/tokens`：创建、查看和撤销 PAT；创建后保存令牌明文。

### 7.2 仓库与代码浏览

- `/repo/:owner/:repo`：README、分支选择、最新提交与目录。
- `/repo/:owner/:repo/:kind/:ref/*`：目录或文件，`kind` 为 `tree` 或 `blob`。
- `/repo/:owner/:repo/commits`：按分支分页查看提交，点击提交打开详情和差异。
- 代码页可查看路径历史；文本文件只读，二进制文件显示元信息。

### 7.3 分支

`/repo/:owner/:repo/branches` 列出全部分支。所有者可在此创建分支、设置默认分支或删除分支。新建分支的来源可选已有分支或完整提交 SHA；空仓库需先 push 一次。不能删除默认分支，且至少保留一个分支。

### 7.4 设置

所有者在 `/repo/:owner/:repo/settings` 修改名称、描述、可见性或删除仓库。删除需输入仓库名确认。重命名后需更新 Git 远端地址；删除会清理全部数据，不可恢复。Clone 地址在代码页复制。

### 7.5 协作者

所有者或 `admin` 协作者从仓库页「设置」标签进入 `/repo/:owner/:repo/collaborators`，按已注册用户名添加成员、修改权限或移除成员。

## 8. API 快速实操

以下示例使用第 5 节的 `BASE_URL`，并用 `cookies.txt` 保存登录 cookie。

### 8.1 注册与登录

启用注册后：

```bash
curl -sS -c cookies.txt -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"Password123"}'
```

已有账户可登录：

```bash
curl -sS -c cookies.txt -X POST "$BASE_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"usernameOrEmail":"alice","password":"Password123"}'
curl -sS -b cookies.txt "$BASE_URL/api/me"
```

### 8.2 创建仓库

```bash
curl -sS -b cookies.txt -X POST "$BASE_URL/api/repos" \
  -H 'content-type: application/json' \
  -d '{"name":"demo","description":"示例仓库","isPrivate":true}'
```

新仓库只有指向 `main` 的 `HEAD`，没有初始提交。

### 8.3 创建 PAT

```bash
PAT=$(curl -sS -b cookies.txt -X POST "$BASE_URL/api/auth/tokens" \
  -H 'content-type: application/json' \
  -d '{"name":"laptop"}' | jq -r '.token')
curl -sS -b cookies.txt "$BASE_URL/api/auth/tokens"
```

创建时可附加 `expiresAt`（毫秒时间戳）；不传则不过期。撤销使用 `DELETE /api/auth/tokens/:tokenId`。API 可改用 `-H "authorization: Bearer $PAT"` 认证。

## 9. Git 操作示例

### 9.1 首次 push

```bash
mkdir demo
cd demo
git init -b main
git config user.name "Alice"
git config user.email "alice@example.com"
echo '# demo' > README.md
git add README.md
git commit -m 'initial commit'
git remote add origin "$BASE_URL/alice/demo.git"
git push -u origin main
```

Git 提示认证时，用户名填 `alice`，密码填创建 PAT 时返回的令牌。协作者使用自己的用户名和 PAT，远端路径仍指向仓库所有者。

### 9.2 分支与 fetch

```bash
git checkout -b feature/docs
echo '使用说明' >> README.md
git add README.md
git commit -m 'update readme'
git push -u origin feature/docs
git fetch origin
```

### 9.3 clone 与浅克隆

在上级目录执行：

```bash
git clone "$BASE_URL/alice/demo.git" demo-copy
git clone --depth 1 "$BASE_URL/alice/demo.git" demo-shallow
git clone --filter=blob:none --no-checkout "$BASE_URL/alice/demo.git" demo-filtered
```

私有仓库按提示填写用户名和 PAT；公开仓库读取无需认证。

重命名仓库后使用 `git remote set-url origin <新的克隆地址>` 更新本地配置。

## 10. 协作者 API

`bob` 需先注册。先从第 9 节的示例仓库目录返回保存 `cookies.txt` 的目录，再执行以下操作；需要所有者或 `admin` 协作者权限：

```bash
# 添加或更新
curl -sS -b cookies.txt -X PUT "$BASE_URL/api/repos/alice/demo/collaborators" \
  -H 'content-type: application/json' \
  -d '{"username":"bob","permission":"write"}'
# 列出
curl -sS -b cookies.txt "$BASE_URL/api/repos/alice/demo/collaborators"
# 移除
curl -sS -b cookies.txt -X DELETE "$BASE_URL/api/repos/alice/demo/collaborators/bob"
```

## 11. 常见问题排查

| 现象 | 检查项 |
| --- | --- |
| 注册返回 403 | `ALLOW_USER_REGISTRATION` 是否为 `true` |
| Git 返回 401 | 是否使用 PAT、是否过期或撤销、用户名是否匹配令牌用户 |
| API 返回 401 | 是否携带有效登录 cookie 或 Bearer 凭证 |
| 仓库返回 404 | 路径是否正确，是否已重命名，当前用户是否有私有仓库读权限 |
| 操作返回 403 | push 需要写权限；设置、删除、分支管理 API 需要所有者身份 |
| 分支创建失败 | 起点必须为已有提交 OID，分支名不能重复或与已有分支路径冲突 |
| 删除分支返回 409 | 不能删除默认分支或最后一个分支 |
| 请求返回 413 | fetch 默认上限 8 MiB；push 检查平台请求体限制及可选的 `RECEIVE_PACK_MAX_BODY_BYTES`，大仓库可分批推送提交 |
| 本地页面无法调用 API | Worker 是否在 8787 端口，是否通过 Vite 地址访问，cookie 是否属于当前主机 |
| 静态资源目录不存在 | 先安装前端依赖并运行 `npm run build:web` |

## 12. 功能边界

- 仓库归个人所有，通过协作者共享；GitHub 组织仓库可同步到个人命名空间。
- 只做 Git 仓库托管，不提供 Issue、Pull Request、CI 或 Agent。
- 仅 HTTP Git；Workers 无法承载入站 SSH 服务，不提供 SSH Git。
- 网页只读，不提供文件编辑；不提供 Git LFS、代码搜索或分支保护。
- 分支管理的所有者限制不构成分支保护：有写权限即可通过 Git push 修改任意引用。
- 仓库硬删除，不可恢复。

各模块的详细规则见 [PRD 索引](../prd/README.md)。


## 13. GitHub 同步

1. 在 GitHub 创建 PAT。经典 PAT 需要 `repo`、`read:org` 范围；细粒度 PAT 需要目标所有者的 Contents 与 Metadata 只读权限，每个所有者单独添加连接。组织要求 SAML SSO 时先授权令牌。
2. 登录 gits，进入「同步」并添加 GitHub 账号，填写 PAT。
3. 选择要同步的所有者（本人或组织），设置前缀、Fork/归档过滤、可见性与频率。组织默认使用 `<组织登录名>.` 前缀。
4. 查看同步源仓库列表；可手动纳入、排除、处理名称冲突或立即同步。镜像只读，名称可以修改；停止同步后保留数据并恢复 push。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/github/connections` | 配置状态、连接与同步源摘要 |
| `POST /api/github/connections` | 校验并保存 `{ token }` |
| `PATCH /api/github/connections/:connectionId` | 更换同一 GitHub 账号的令牌 |
| `DELETE /api/github/connections/:connectionId` | 移除连接，保留本地仓库 |
| `GET /api/github/connections/:connectionId/owners` | 实时获取本人及组织 |
| `POST /api/github/sources` | 启用 `{ connectionId, ownerLogin, ...settings }` |
| `GET /api/github/sources/:sourceId` | 设置、状态与计数 |
| `PATCH /api/github/sources/:sourceId` | 修改设置或暂停 |
| `DELETE /api/github/sources/:sourceId` | 移除同步源，保留本地仓库 |
| `POST /api/github/sources/:sourceId/sync` | 立即发现并派发 |
| `GET /api/github/sources/:sourceId/repositories` | `status`、`page` 筛选分页，每页 50 条 |
| `PATCH /api/github/sources/:sourceId/repositories/:githubRepoId` | `selection`、`localName` |
| `POST /api/repos/:owner/:repo/mirror/sync` | 所有者立即同步镜像 |
| `DELETE /api/repos/:owner/:repo/mirror` | 所有者停止同步，转为普通仓库 |

仓库详情增加 `mirror`（普通仓库为 `null`），仓库列表增加 `is_mirror`（0 或 1）。
镜像 push 返回 403；修改描述、可见性与分支返回 409。接口时间均为毫秒时间戳。
