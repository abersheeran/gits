# 使用文档（gits）

本文说明如何部署服务、管理个人仓库和协作者，以及通过网页、API 和 Git 读写代码。

## 1. 当前产品范围

`gits` 是运行在 Cloudflare Workers 上的个人 Git 仓库托管服务，提供账户与 PAT、仓库管理、分支管理、代码浏览和提交历史。仓库可公开或私有，协作者按仓库授权。

## 2. 前置要求

- Node.js 20.19+ 或 22.12+、npm、Git、curl。
- Cloudflare 账号及可用的 D1、R2；Wrangler 由项目开发依赖提供。
- 以下 API 示例使用 `jq` 提取 PAT。

## 3. 项目初始化

```bash
npm install
npm --prefix web install
cp .env.example .env
npm run secret:dev
npm run build:web
```

按提示输入本地 JWT 密钥。首次构建生成 `wrangler.jsonc` 所需的前端静态资源。可运行 `npm run typecheck` 和 `npm run test` 检查后端，前端构建也会检查前端 TypeScript。

## 4. Cloudflare 资源与配置

### 4.1 必要资源

| 绑定 | 用途 | 默认配置 |
| --- | --- | --- |
| `DB` | D1 元数据 | 数据库 `gits` |
| `GIT_BUCKET` | Git 对象与引用 | R2 桶 `gits`，只需这一个桶 |
| `REPOSITORY_OBJECTS` | 仓库 Durable Object | `RepositoryObject` |
| `ASSETS` | 前端静态文件 | `web/dist` |

本地开发使用 Wrangler 本地资源；部署前创建远程 D1 和 R2。DO 由部署配置管理，无需手动创建命名空间。

### 4.2 创建远程资源

```bash
npx wrangler login
npm run d1:create:remote
npx wrangler r2 bucket create gits
```

将 D1 输出的 `database_id` 填入 [wrangler.jsonc](../wrangler.jsonc) 的 `d1_databases[0].database_id`。自定义桶名时同步修改 `r2_buckets[0].bucket_name`。

### 4.3 本地与生产变量

本地 `.env` 模板：

```dotenv
JWT_SECRET=replace-with-a-strong-secret
ALLOW_USER_REGISTRATION=true
```

- `JWT_SECRET`：必须替换为自己的密钥；本地用 `npm run secret:dev`，生产用 `npm run secret:prod` 设置。
- `ALLOW_USER_REGISTRATION`：去除空白后非空就启用注册，包括字符串 `false`。关闭注册需删除该变量或设置为空。
- `UPLOAD_PACK_MAX_BODY_BYTES` / `RECEIVE_PACK_MAX_BODY_BYTES`：可选的 fetch / push 请求体上限，默认分别为 8 MiB / 32 MiB。

开发脚本读取 `.env`，生产变量需要单独配置。部署时可用 `--var ALLOW_USER_REGISTRATION:true` 开放注册。

### 4.4 数据库迁移

```bash
# 本地
npm run db:migrate:local
# 远程
npm run db:migrate
```

`npm run dev` 自动执行本地迁移；`npm run deploy` 自动执行远程迁移。

### 4.5 迁移历史重置与重新部署

2026-10 已移除 Agent / Actions / Issue / Pull Request，D1 与 Durable Object 迁移历史均重置为单个初始迁移，分别为 `src/db/migrations/0001_init.sql` 和 `repository-object-v1`。

旧部署不能原地升级：先删除旧 `gits` Worker（连同其 Durable Object 命名空间及存储）、D1 数据库、R2 数据、`gits-actions` 队列，以及旧 `gits-actionscontainer*` 容器应用和镜像，再从零部署。本地开发先删除 `.wrangler/state`，再运行 `npm run dev`。

## 5. 本地运行、部署与健康检查

两个终端分别运行：

```bash
npm run dev
```

```bash
npm run dev:web
```

浏览器打开 Vite 输出的地址。`web/vite.config.ts` 将 API、健康检查及 Git 请求代理到 `http://127.0.0.1:8787`，本地 Worker 需使用此端口。

远程资源配置完成后部署：

```bash
npm run secret:prod
npm run deploy -- --var ALLOW_USER_REGISTRATION:true
```

部署依次执行远程迁移、前端构建和 Worker 发布，并保留已有生产变量。后续可直接运行 `npm run deploy`。

健康检查：

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
| 所有者 | 上述全部能力，以及仓库设置、删除、分支管理 API |

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

所有者在 `/repo/:owner/:repo/branches` 创建分支、设置默认分支或删除分支。创建需要已有提交的完整 40 位 OID；空仓库先 push 一次。删除 API 不允许删除默认分支，并要求至少保留一个分支。

### 7.4 设置

所有者在 `/repo/:owner/:repo/settings` 修改名称、描述、可见性，复制 clone URL 或删除仓库。重命名后需更新 Git 远端地址；删除会清理数据，没有回收站。

### 7.5 协作者

所有者或 `admin` 协作者在 `/repo/:owner/:repo/collaborators` 按已注册用户名添加成员、修改权限或移除成员。

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
| 注册返回 403 | `ALLOW_USER_REGISTRATION` 是否非空；关闭注册不能写 `false` |
| Git 返回 401 | 是否使用 PAT、是否过期或撤销、用户名是否匹配令牌用户 |
| API 返回 401 | 是否携带有效登录 cookie 或 Bearer 凭证 |
| 仓库返回 404 | 路径是否正确，是否已重命名，当前用户是否有私有仓库读权限 |
| 操作返回 403 | push 需要写权限；设置、删除、分支管理 API 需要所有者身份 |
| 分支创建失败 | 起点必须为已有提交 OID，分支名不能重复或与已有分支路径冲突 |
| 删除分支返回 409 | 不能删除默认分支或最后一个分支 |
| 请求返回 413 | 请求体超过限制，检查两个 Git 请求体上限变量 |
| 本地页面无法调用 API | Worker 是否在 8787 端口，是否通过 Vite 地址访问，cookie 是否属于当前主机 |
| 静态资源目录不存在 | 先安装前端依赖并运行 `npm run build:web` |

## 12. 当前边界

- 个人仓库加协作者，不提供组织或团队。
- 仅 HTTP Git；Workers 无法承载入站 SSH 服务，不提供 SSH Git。
- 没有 Git LFS、代码搜索、分支保护或网页文件编辑。
- 分支管理 API 的所有者限制不构成 Git push 的分支保护策略。
- 仓库硬删除，无恢复入口；仓库列表和路径历史尚无分页，提交历史已支持分页。

模块设计与后续方向见 [PRD 索引](../prd/README.md)。
