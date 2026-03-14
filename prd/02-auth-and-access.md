# 认证与访问控制 PRD

## 1. 模块定位

认证与访问控制模块的职责是把三类主体纳入同一条权限链：

- 人类用户如何登录和访问仓库/API。
- Git 客户端如何安全地 clone / fetch / push。
- Agent Runtime 如何在一次 session 内代表触发者继续完成代码、评论和 PR 写入。

当前目标不是企业 IAM，而是为主工作流提供足够清晰、可追踪的权限边界。

## 2. 当前主体与凭证模型

### 2.1 主体

- 游客：可访问公开仓库及其代码、Issue、PR、Actions 摘要。
- 登录用户：通过 session cookie 或 bearer session token 访问受保护 API。
- 协作者：在仓库级获得 `read / write / admin` 权限。
- 仓库 owner：拥有最高权限。
- Git 客户端：通过 `Basic username:access_token` 访问 HTTP Git 服务。
- Agent Session / Action Run：通过内部短期 token 和 delegated identity 在受限范围内执行。

### 2.2 凭证

- 浏览器登录态：JWT session，支持 cookie 和 bearer。
- 个人访问令牌：`access_tokens`，可创建、列出、撤销。
- Git 访问：只接受 Basic Auth，用户名必须与 token 对应用户匹配。
- Runtime 内部 token：用于一次 run/session 内的 Git push、Issue 评论、PR 创建等操作。

## 3. 当前权限规则

- 公开仓库默认可读。
- 私有仓库只有 owner 或 collaborator 可读。
- 写权限要求 owner 或 `write / admin` collaborator。
- 管理仓库、协作者和 Actions 配置要求 owner 或 `admin` collaborator。
- 仓库详情接口会下发 `canCreateIssueOrPullRequest / canRunAgents / canManageActions`，前端据此控制入口显隐。

## 4. 当前已实现能力

- 注册、登录、登出、当前用户查询。
- 注册受环境变量 `ALLOW_USER_REGISTRATION` 控制：只有显式设置该变量时才允许创建新用户。
- PAT 创建、列表、撤销。
- session bearer 与 PAT bearer 共存；中间件会先尝试 session，再回退到 access token。
- Git 路由使用单独的 Basic Auth 中间件。
- 每次 interactive agent 入口、workflow run、rerun、dispatch 都会创建或关联 `agent_sessions`。
- Session 会记录：
  - `source_type / source_number / source_comment_id`
  - `origin`
  - `created_by / delegated_from`
  - `workflow_id / linked_run_id`
  - `branch_ref / trigger_ref / trigger_sha`

## 5. 关键流程

### 5.1 人类访问

1. 部署环境显式设置 `ALLOW_USER_REGISTRATION` 后，游客才可调用注册接口创建账号；未设置时注册直接被拒绝。
2. 用户注册或登录。
3. Worker 通过 session cookie 或 bearer token 识别用户。
4. 路由根据仓库权限决定是否允许读、写或管理。

### 5.2 Git 客户端访问

1. 客户端用 `username:access_token` 发起 Basic Auth。
2. Worker 验证 token，并要求 token 所属用户名与 Basic 用户名一致。
3. Git 读写权限继续按仓库 owner/collaborator 规则判定。

### 5.3 Agent 代表执行

1. 用户从 Issue / PR / workflow 触发一轮 Agent session。
2. 系统创建 session，并记录 `created_by` 与 `delegated_from`。
3. runtime 注入内部 token 与必要配置文件。
4. Agent 在当前权限范围内 clone、push、评论、创建 PR。
5. session 结束后保留 provenance 与 observability 数据，内部 token 不再继续复用。

## 6. 当前接口

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `POST /api/auth/tokens`
- `GET /api/auth/tokens`
- `DELETE /api/auth/tokens/:tokenId`
- `POST /api/repos/:owner/:repo/issues/:number/assign-agent`
- `POST /api/repos/:owner/:repo/issues/:number/resume-agent`
- `POST /api/repos/:owner/:repo/pulls/:number/resume-agent`
- `GET /api/repos/:owner/:repo/agent-sessions/:sessionId`
- `POST /api/repos/:owner/:repo/agent-sessions/:sessionId/cancel`

## 7. 当前数据模型

- `users`
- `access_tokens`
- `agent_sessions`
- `agent_session_attempts`
- `agent_session_attempt_events`
- `agent_session_attempt_artifacts`

## 8. 关键代码文件

- `src/middleware/auth.ts`
- `src/services/auth-service.ts`
- `src/services/agent-session-service.ts`
- `src/routes/api/index.ts`
- `src/routes/api/platform-routes.ts`
- `src/routes/api/platform-routes.test.ts`
- `src/routes/api/actions-routes.ts`
- `src/routes/git.ts`
- `web/src/pages/login-page.tsx`
- `web/src/pages/register-page.tsx`
- `web/src/pages/tokens-page.tsx`
- `web/src/pages/agent-session-detail-page.tsx`

## 9. 当前边界与下一步

- 当前没有刷新 token 或长期设备会话管理。
- PAT 仍然是粗粒度令牌，没有 repo-scoped 或 action-scoped 权限模型。
- Git 鉴权当前明确限定为 HTTP Basic + token；由于 Workers 无法支持 SSH 协议服务，不提供 SSH key 接入。
- provenance 已经存在于 session 维度，但 Issue / PR / Review 主界面仍缺更直接的身份展示。

下一步优先级：

1. 把 “这次修改是谁触发、由哪个 session 执行、代表谁继续” 更直接地展示到 Issue / PR / Review。
2. 统一 assign / resume / cancel 入口的权限反馈与 UI 语义。
3. 继续收紧内部 token 的最小权限和失效边界。
