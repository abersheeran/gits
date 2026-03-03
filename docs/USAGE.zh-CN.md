# 使用文档（gits）

本文档面向当前仓库实现，目标是让你快速完成：

1. Cloudflare 资源准备与部署
2. 账户注册、登录、PAT 管理
3. Git 仓库创建、clone、push、协作者管理
4. 常见错误排查

## 1. 前置要求

- Node.js 20+
- npm
- Cloudflare 账号
- 已安装并登录 Wrangler（`npx wrangler login`）

## 2. 项目初始化

```bash
npm install
cp .env.example .env
```

可选验证：

```bash
npm run typecheck
npm run test
```

## 3. Cloudflare 资源配置

### 3.1 创建 D1 与 R2

```bash
npx wrangler d1 create git-service
npx wrangler r2 bucket create git-service-objects
```

把输出中的 D1 `database_id` 填到 `wrangler.jsonc`。

### 3.2 更新 wrangler.jsonc

确认以下字段：

- `d1_databases[0].database_id`
- `r2_buckets[0].bucket_name`

可选变量（控制 Git 请求体上限，字符串形式，建议在 Cloudflare 线上 Environment Variables 中配置）：

- `vars.UPLOAD_PACK_MAX_BODY_BYTES`（默认 `8388608`，8MB）
- `vars.RECEIVE_PACK_MAX_BODY_BYTES`（默认 `33554432`，32MB）

### 3.3 配置本地与线上变量

`.env` 仅用于本地开发（`npm run dev` 会通过 `wrangler --env-file .env` 读取）。
至少配置：

```bash
APP_ORIGIN=auto
JWT_SECRET=replace-with-a-strong-secret
```

远程 production 环境（Cloudflare）机密变量：

```bash
npm run secret:prod
```

本地 development 环境（写入项目根目录 `.env`）：

```bash
npm run secret:dev
```

说明：

- 这里只配置 `JWT_SECRET`。
- Actions 全局设置页只编辑并映射配置文件内容（`/root/.codex/config.toml` 与 `/root/.claude/settings.json`）。

非机密变量（例如 `APP_ORIGIN`、`UPLOAD_PACK_MAX_BODY_BYTES`、`RECEIVE_PACK_MAX_BODY_BYTES`）可以用两种方式配置到远程：

1. Cloudflare 控制台：Worker 设置页的 Variables/Environment Variables
2. Wrangler 命令行：在部署时通过 `--var` 写入/更新变量

```bash
npx wrangler deploy --minify \
  --var APP_ORIGIN:https://gits.example.com \
  --var UPLOAD_PACK_MAX_BODY_BYTES:8388608 \
  --var RECEIVE_PACK_MAX_BODY_BYTES:33554432 \
  --keep-vars
```

如果你使用项目脚本，也可以直接透传参数：

```bash
npm run deploy -- \
  --var APP_ORIGIN:https://gits.example.com
```

### 3.4 初始化数据库

本地：

```bash
npm run db:migrate:local
```

说明：`npm run dev` 会先自动执行一次本地迁移。

远程：

```bash
npm run db:migrate
```

## 4. 运行与部署

本地开发：

```bash
npm run dev
```

Wrangler 默认优先使用 `http://127.0.0.1:8787`，端口被占用时会自动顺延到下一个可用端口。

如果你的本地 Docker 不是默认 socket，请先设置（Cloudflare 文档推荐方式）：

```bash
export DOCKER_HOST=unix:///var/run/docker.sock
```

部署：

```bash
npm run deploy
```

健康检查：

- `GET /healthz`
- `GET /api/healthz`

## 5. 认证模型

系统有两种认证：

1. Session（JWT）
用于 Web/API（注册、创建仓库、管理协作者、创建 PAT 等）

2. PAT（Personal Access Token）+ HTTP Basic Auth
用于 Git push/fetch 私有仓库

### 5.1 关于本地 HTTP 的注意事项

`/api/auth/register` 与 `/api/auth/login` 返回的是 `Secure` Cookie。
如果你在 `http://localhost` 直接调试，浏览器通常不会发送该 Cookie。

建议：

- 正式环境使用 HTTPS 域名（推荐）
- 本地调试 API 时，从 `Set-Cookie` 里提取 JWT，改用 `Authorization: Bearer <jwt>`

## 6. API 快速实操

下面示例以 `BASE_URL` 为 `http://127.0.0.1:8787`（本地）为例；如果启动日志显示的是其它端口，请按实际端口替换。

```bash
BASE_URL="http://127.0.0.1:8787"
```

### 6.1 注册用户（并提取 session JWT）

```bash
SESSION_TOKEN=$(
  curl -si -X POST "$BASE_URL/api/auth/register" \
    -H "content-type: application/json" \
    -d '{
      "username":"alice",
      "email":"alice@example.com",
      "password":"Password123"
    }' \
  | sed -n 's/^Set-Cookie: session=\([^;]*\).*/\1/p' \
  | head -n 1
)
```

### 6.2 创建仓库

```bash
curl -sS -X POST "$BASE_URL/api/repos" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "name":"demo",
    "description":"demo repository",
    "isPrivate":true
  }'
```

### 6.3 创建 PAT（用于 Git）

```bash
PAT=$(
  curl -sS -X POST "$BASE_URL/api/auth/tokens" \
    -H "authorization: Bearer $SESSION_TOKEN" \
    -H "content-type: application/json" \
    -d '{"name":"laptop"}' \
  | jq -r '.token'
)
```

### 6.4 查看与吊销 PAT

```bash
curl -sS "$BASE_URL/api/auth/tokens" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

```bash
curl -sS -X DELETE "$BASE_URL/api/auth/tokens/<tokenId>" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

## 7. Git 操作示例

### 7.1 push 到私有仓库

```bash
mkdir demo && cd demo
git init -b main
git config user.name "Alice"
git config user.email "alice@example.com"
echo "# demo" > README.md
git add README.md
git commit -m "initial commit"

git remote add origin "http://alice:${PAT}@127.0.0.1:8787/alice/demo.git"
git push origin main
```

### 7.2 clone 公有仓库

```bash
git clone "$BASE_URL/alice/public-repo.git"
```

### 7.3 clone 私有仓库

```bash
git clone "http://alice:${PAT}@127.0.0.1:8787/alice/demo.git"
```

## 8. 协作者与权限

权限级别：

- `read`: 可读取私有仓库
- `write`: `read` + 可 push
- `admin`: `write` + 可管理协作者

### 8.1 添加/更新协作者

```bash
curl -sS -X PUT "$BASE_URL/api/repos/alice/demo/collaborators" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "username":"bob",
    "permission":"write"
  }'
```

### 8.2 列出协作者

```bash
curl -sS "$BASE_URL/api/repos/alice/demo/collaborators" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

### 8.3 移除协作者

```bash
curl -sS -X DELETE "$BASE_URL/api/repos/alice/demo/collaborators/bob" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

## 9. 仓库管理 API

重命名/更新描述/可见性：

```bash
curl -sS -X PATCH "$BASE_URL/api/repos/alice/demo" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "name":"demo-renamed",
    "description":"new description",
    "isPrivate":false
  }'
```

删除仓库：

```bash
curl -sS -X DELETE "$BASE_URL/api/repos/alice/demo-renamed" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

说明：仓库重命名后，请同步更新本地 remote URL。

## 10. Web 页面

当前提供最小 Web 页面：

- 首页：`GET /`（展示公开仓库）
- 仓库页：`GET /:owner/:repo`（分支、最近提交、README）

## 11. 常见问题排查

### 11.1 `401 Authentication required` / `Invalid credentials`

- Git Basic Auth 缺失或错误
- PAT 已吊销或过期
- Basic Auth 的用户名与 PAT 所属用户不一致

### 11.2 `404 Repository not found`

- 仓库确实不存在
- 私有仓库但你没有读权限（服务会返回 404，避免泄露存在性）

### 11.3 `403 Forbidden`

- 你已认证，但没有写权限或管理员权限

### 11.4 `413 Request body too large`

- push/fetch 请求体超过限制
- 调整 `UPLOAD_PACK_MAX_BODY_BYTES` / `RECEIVE_PACK_MAX_BODY_BYTES`

### 11.5 `415 Unsupported content type`

- 非标准 Git Smart HTTP 客户端发来的 `content-type` 不符合要求

## 12. 当前不包含的能力

当前实现尚未包含：

- Issues / Pull Requests / Actions
- Git LFS
- 细粒度分支保护策略
- SSH 协议（当前主要是 HTTPS Smart HTTP）
