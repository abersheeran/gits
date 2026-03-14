# 使用文档（gits）

本文档基于当前仓库实现编写，目标是让你快速完成：

1. 配置 Cloudflare 资源并启动项目
2. 注册账户、创建仓库、管理 PAT 与协作者
3. 使用 Issue、Pull Request、Actions 和 Agent Session
4. 通过 API 与 Git Smart HTTP 走通核心链路

相关独立文档：

- [MCP 使用文档](/Users/aber/Documents/gits/gits/docs/MCP.zh-CN.md)

## 1. 当前产品范围

`gits` 当前是一个面向 Agent 协作的软件交付平台，主工作流是：

1. 创建仓库
2. 创建 Issue
3. 在 Issue 中补充验收标准和讨论
4. 触发 Agent Session
5. 创建或更新 Pull Request
6. 在 PR 中 review、继续 Agent、查看 validation summary
7. squash merge

当前明确边界：

- 仓库模型永久限定为个人仓库，不设计 Org / Team
- Git 接入方式明确限定为 HTTP Smart HTTP
- Workers 无法支持 SSH 协议服务，因此不提供 SSH
- 当前没有 Git LFS

## 2. 前置要求

- Node.js 20+
- npm
- Git
- curl
- `jq`（可选，文档里的部分 shell 示例会用到）
- Cloudflare 账号
- 已安装并登录 Wrangler：`npx wrangler login`
- 本地如需运行 Actions / Agent Runtime，建议安装 Docker Desktop 或兼容运行时

## 3. 项目初始化

```bash
npm install
cp .env.example .env
```

可选校验：

```bash
npm run typecheck
npm run test
```

## 4. Cloudflare 资源准备

下面示例使用与仓库默认配置一致的资源名；如果你使用自定义名称，请同步修改 [wrangler.jsonc](/Users/aber/Documents/gits/gits/wrangler.jsonc)。

### 4.1 必要资源

- D1：`gits`
- Git 对象 R2：`gits`
- Actions / Session 日志 R2：`gits-action-logs`
- Queue：`gits-actions`

### 4.2 创建资源

```bash
npx wrangler d1 create gits
npx wrangler r2 bucket create gits
npx wrangler r2 bucket create gits-action-logs
npx wrangler queues create gits-actions
```

创建 D1 后，把输出中的 `database_id` 写回 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

如果你没有使用默认资源名，也需要同步更新：

- `r2_buckets[0].bucket_name`
- `r2_buckets[1].bucket_name`
- `queues.producers[0].queue`
- `queues.consumers[0].queue`

### 4.3 配置本地与远程变量

本地 `.env` 至少配置：

```bash
APP_ORIGIN=auto
JWT_SECRET=replace-with-a-strong-secret
ALLOW_USER_REGISTRATION=true
```

说明：

- `APP_ORIGIN=auto` 适合本地调试
- 线上环境建议显式设置真实域名，例如 `https://gits.example.com`
- 当前必须提供的 secret 只有 `JWT_SECRET`
- 只有显式设置 `ALLOW_USER_REGISTRATION` 后，外部用户才可注册新账号

设置本地开发 secret：

```bash
npm run secret:dev
```

设置远程生产 secret：

```bash
npm run secret:prod
```

也可以在部署时传入非机密变量：

```bash
npm run deploy -- \
  --var APP_ORIGIN:https://gits.example.com \
  --var ALLOW_USER_REGISTRATION:true \
  --keep-vars
```

### 4.4 初始化数据库

本地：

```bash
npm run db:migrate:local
```

远程：

```bash
npm run db:migrate
```

说明：`npm run dev` 会在本地启动前自动执行一次本地迁移。

## 5. 本地运行与部署

### 5.1 启动 Worker / API

```bash
npm run dev
```

默认会启动本地 Worker，并应用本地 D1 migration。Wrangler 通常优先使用 `http://127.0.0.1:8787`，若端口冲突会自动顺延。

### 5.2 启动前端开发服务器

如果你需要单独调试前端：

```bash
npm run dev:web
```

通常做法是两个终端分别运行：

- 终端 1：`npm run dev`
- 终端 2：`npm run dev:web`

### 5.3 部署

```bash
npm run deploy
```

该脚本会先构建前端，再部署 Worker。

### 5.4 健康检查

- `GET /healthz`
- `GET /api/healthz`

## 6. 认证与权限模型

### 6.1 两类认证

1. Session（JWT）
用于 Web/API，例如登录、创建仓库、管理协作者、创建 Issue / PR、配置 Actions。

2. PAT（Personal Access Token）+ HTTP Basic Auth
用于 Git clone / fetch / push 私有仓库。

### 6.2 仓库权限

- `read`：可读取私有仓库
- `write`：`read` + 可 push + 可参与交付
- `admin`：`write` + 可管理协作者与仓库级 Actions 配置

### 6.3 本地 HTTP 的注意事项

`/api/auth/register` 与 `/api/auth/login` 返回 `Secure` Cookie。
在 `http://localhost` 或 `http://127.0.0.1` 调试时，浏览器通常不会自动带上它。

建议：

- 正式环境使用 HTTPS 域名
- 本地调试 API 时，从 `Set-Cookie` 中提取 JWT，改用 `Authorization: Bearer <jwt>`

## 7. Web 使用路径

### 7.1 账户与基础入口

- 首页：`/`
- 注册：`/register`
- 登录：`/login`
- Dashboard：`/dashboard`
- 新建仓库：`/repositories/new`
- Access Tokens：`/tokens`
- 全局 Actions 配置：`/settings/actions`

### 7.2 仓库与代码浏览

进入仓库后可使用：

- 仓库首页：`/repo/:owner/:repo`
- tree/blob 浏览：`/repo/:owner/:repo/:kind/:ref/*`
- 仓库设置：`/repo/:owner/:repo/settings`
- 协作者：`/repo/:owner/:repo/collaborators`

### 7.3 Issue 工作流

仓库内可使用：

- Issue 列表：`/repo/:owner/:repo/issues`
- 新建 Issue：`/repo/:owner/:repo/issues/new`
- Issue 详情：`/repo/:owner/:repo/issues/:number`

Issue 详情当前支持：

- 标题、正文、评论
- 验收标准
- 指派人
- task status / taskFlow
- assign agent / resume agent
- 查看关联 PR 的最新 validation summary

### 7.4 Pull Request 工作流

仓库内可使用：

- PR 列表：`/repo/:owner/:repo/pulls`
- 新建 PR：`/repo/:owner/:repo/pulls/new`
- PR 详情：`/repo/:owner/:repo/pulls/:number`

PR 详情当前支持：

- compare / diff
- review summary
- review threads
- validation summary
- merge summary
- resume agent
- squash merge

### 7.5 Actions 与 Session

仓库内可使用：

- Actions 页：`/repo/:owner/:repo/actions`
- Agent Session 详情：`/repo/:owner/:repo/agent-sessions/:sessionId`

Actions 页当前支持：

- 查看 workflow、run、日志 excerpt
- rerun
- dispatch workflow
- 查看 linked session

Session 详情当前支持：

- source / handoff
- validation summary
- artifacts
- usage records
- timeline
- prompt

## 8. API 快速实操

下面示例默认本地 API 地址为：

```bash
BASE_URL="http://127.0.0.1:8787"
```

如果 Wrangler 输出的端口不同，请按实际端口替换。

### 8.1 注册用户并提取 Session Token

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

查看当前用户：

```bash
curl -sS "$BASE_URL/api/me" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

### 8.2 创建仓库

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

### 8.3 创建 PAT（用于 Git）

```bash
PAT=$(
  curl -sS -X POST "$BASE_URL/api/auth/tokens" \
    -H "authorization: Bearer $SESSION_TOKEN" \
    -H "content-type: application/json" \
    -d '{"name":"laptop"}' \
  | jq -r '.token'
)
```

查看 PAT 列表：

```bash
curl -sS "$BASE_URL/api/auth/tokens" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

### 8.4 创建 Issue

```bash
curl -sS -X POST "$BASE_URL/api/repos/alice/demo/issues" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "title":"Fix login flow",
    "body":"Users cannot re-login after logout.",
    "acceptanceCriteria":"1. logout 后可重新登录\n2. 错误提示明确"
  }'
```

### 8.5 给 Issue 分配 Agent

```bash
curl -sS -X POST "$BASE_URL/api/repos/alice/demo/issues/1/assign-agent" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "agentType":"codex",
    "prompt":"先定位复现路径，再修复并补充必要测试。"
  }'
```

恢复 Issue Agent：

```bash
curl -sS -X POST "$BASE_URL/api/repos/alice/demo/issues/1/resume-agent" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "agentType":"codex",
    "prompt":"结合最新评论继续推进。"
  }'
```

### 8.6 创建 Pull Request

假设你已经 push 了 `feature/login-fix`：

```bash
curl -sS -X POST "$BASE_URL/api/repos/alice/demo/pulls" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "title":"Fix login flow after logout",
    "body":"Close #1",
    "baseRef":"main",
    "headRef":"feature/login-fix",
    "closeIssueNumbers":[1],
    "draft":false
  }'
```

### 8.7 提交 Review

```bash
curl -sS -X POST "$BASE_URL/api/repos/alice/demo/pulls/1/reviews" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "decision":"approve",
    "body":"Looks good."
  }'
```

### 8.8 继续 PR Agent

```bash
curl -sS -X POST "$BASE_URL/api/repos/alice/demo/pulls/1/resume-agent" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "agentType":"codex",
    "prompt":"处理 review 反馈，并重新确认验证结果。"
  }'
```

### 8.9 创建 Actions Workflow

```bash
curl -sS -X POST "$BASE_URL/api/repos/alice/demo/actions/workflows" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "name":"PR Auto Review",
    "triggerEvent":"pull_request_created",
    "agentType":"codex",
    "prompt":"Review the pull request, summarize risk, and propose follow-up if needed.",
    "enabled":true
  }'
```

支持的公开 trigger：

- `issue_created`
- `pull_request_created`
- `push`

### 8.10 查看 Agent session

列出仓库 session：

```bash
curl -sS "$BASE_URL/api/repos/alice/demo/agent-sessions" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

## 9. Git 操作示例

### 9.1 push 到私有仓库

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

### 9.2 创建功能分支并推送

```bash
git checkout -b feature/login-fix
echo "fix" >> README.md
git add README.md
git commit -m "update readme"
git push -u origin feature/login-fix
```

### 9.3 clone 公有仓库

```bash
git clone "$BASE_URL/alice/public-repo.git"
```

### 9.4 clone 私有仓库

```bash
git clone "http://alice:${PAT}@127.0.0.1:8787/alice/demo.git"
```

## 10. 协作者与权限

### 10.1 添加或更新协作者

```bash
curl -sS -X PUT "$BASE_URL/api/repos/alice/demo/collaborators" \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "username":"bob",
    "permission":"write"
  }'
```

### 10.2 列出协作者

```bash
curl -sS "$BASE_URL/api/repos/alice/demo/collaborators" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

### 10.3 移除协作者

```bash
curl -sS -X DELETE "$BASE_URL/api/repos/alice/demo/collaborators/bob" \
  -H "authorization: Bearer $SESSION_TOKEN"
```

## 11. 常见问题排查

### 11.1 `401 Authentication required` / `Invalid credentials`

- Git Basic Auth 缺失或错误
- PAT 已吊销或过期
- Basic Auth 用户名与 PAT 所属用户不一致

### 11.2 `404 Repository not found`

- 仓库确实不存在
- 私有仓库且当前用户没有读权限
- 服务对无权限私有仓库会返回 404，以避免泄露存在性

### 11.3 `403 Forbidden`

- 已认证，但没有足够的写权限或管理员权限

### 11.4 `400 Base branch not found` / `Head branch not found`

- 创建 PR 时指定的分支不存在
- `baseRef` 与 `headRef` 填写错误

### 11.5 `413 Request body too large`

- push/fetch 请求体超出限制
- 调整 `UPLOAD_PACK_MAX_BODY_BYTES` / `RECEIVE_PACK_MAX_BODY_BYTES`

### 11.6 Actions run 一直不执行

- 队列 `gits-actions` 未创建
- 本地未正确运行容器环境
- 本地 Docker socket 不是默认路径

如果你的本地 Docker socket 不是默认路径，可先设置：

```bash
export DOCKER_HOST=unix:///var/run/docker.sock
```

### 11.7 浏览器本地登录后看起来“未登录”

- 本地 HTTP 环境下 `Secure` Cookie 不会自动回传
- 请改用 Bearer token 调试 API，或使用 HTTPS 域名环境

## 12. 当前明确边界

当前实现明确不包含：

- Org / Team
- SSH Git
- Git LFS
- 默认分支切换
- 细粒度分支保护策略
- 基础代码搜索

如果你要了解产品边界与模块设计，继续阅读：

- [prd/README.md](/Users/aber/Documents/gits/gits/prd/README.md)
- [prd/03-repository-management-and-collaboration.md](/Users/aber/Documents/gits/gits/prd/03-repository-management-and-collaboration.md)
- [prd/04-git-hosting-and-storage.md](/Users/aber/Documents/gits/gits/prd/04-git-hosting-and-storage.md)
- [prd/06-issues-and-discussions.md](/Users/aber/Documents/gits/gits/prd/06-issues-and-discussions.md)
- [prd/07-pull-requests-and-reviews.md](/Users/aber/Documents/gits/gits/prd/07-pull-requests-and-reviews.md)
- [prd/08-actions-and-ai-automation.md](/Users/aber/Documents/gits/gits/prd/08-actions-and-ai-automation.md)
