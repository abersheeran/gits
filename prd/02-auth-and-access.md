# 认证与访问控制 PRD

## 1. 模块目标

为 Web 站点、REST API、Git 远端和 Agent Runtime 提供统一身份识别与授权体系，在“游客 / 人类用户 / Agent / Service / 仓库规则”之间建立清晰边界。

作为 Agent 原生平台，这个模块不应只解决“用户能不能登录”，还要解决：

- Agent 代表谁执行
- Agent 能访问哪些仓库、分支、工具和秘密
- 哪些动作必须受仓库策略与审计约束
- 每次自动化行为能否被完整审计

## 2. 当前主体与权限模型

### 已实现主体

- 游客：可访问公开仓库及其代码、Issue、PR、Actions 结果
- 登录用户：通过 Session Cookie 或 Bearer Token 访问受保护 API
- 协作者：仓库级权限分为 `read`、`write`、`admin`
- 仓库所有者：拥有仓库设置、删除、重命名等最高权限
- Git 客户端：通过 `Basic username:access_token` 访问 Git HTTP 接口
- Actions 内部调用：使用短期内部 Token，必要时可“显示为 actions 用户”发评论或创建 PR

### 面向 Agent 原生目标需新增的主体

- `agent`：具备独立身份、配置和能力声明的执行主体，可由系统内建，也可由仓库自定义
- `service`：面向外部集成、Webhook、MCP Tool、部署系统的服务主体
- `delegated session`：由人类用户、仓库策略或系统事件派生出的短期代理会话身份

## 3. 当前能力基线

- 用户注册：用户名、邮箱、密码
- 用户登录/登出：登录后下发 `session` Cookie，默认 7 天有效
- 当前用户查询：`GET /api/me`
- Session 校验：
  - 优先读 `Authorization: Bearer <token>`
  - 若 Bearer 不是 Session，再尝试把它当 Access Token
  - 最后回退到 `session` Cookie
- Access Token 生命周期：
  - 创建 PAT
  - 查询 PAT 列表
  - 撤销 PAT
- Git Basic Auth：
  - Push 强制 Basic Auth
  - Fetch 在携带 Basic Header 时也会校验
- 内部 Actions Token：
  - 容器 `onStart` 时创建临时 Token 用于克隆仓库
  - 需要评论 Issue 时创建 `displayAsActions` Token
  - 需要创建 PR 时创建单独短期 Token，并以 `actions` 身份落库作者信息

## 4. 面向 Agent 原生目标需要补足

### 4.1 身份体系

- 将身份模型显式拆分为 `human`、`agent`、`service`
- 支持 Agent Profile，区分：
  - 平台内建 Agent
  - 仓库自定义 Agent
  - 仅运行时可见的临时 Agent
- Agent Session 需要有独立会话 ID、发起人、来源任务、来源评论、来源 workflow

### 4.2 授权体系

- PAT 改为细粒度 Token，至少支持：
  - 仓库范围
  - 操作范围：`repo:read`、`repo:write`、`issues:write`、`pulls:write`、`actions:run`
  - 过期时间
- Agent Token 改为委托式短期授权：
  - 继承触发用户的仓库权限
  - 默认可用于推分支、创建 PR、修改 Issue/PR
  - 不能绕过仓库协作权限与未来的 Ruleset / 受保护分支规则
- Agent Session 不需要事前审批，默认即可执行；高风险外部操作如部署或生产系统调用可在未来追加一次性人工确认
- 所有 delegated token 都应带 Session 元数据，便于追踪

### 4.3 审计与可追踪性

- 每个 Token、Session、委托动作与人工干预都需要审计日志
- 所有 Agent 发起的评论、提交、PR、推送都要可追溯到：
  - 发起人
  - Agent Profile
  - Session ID
  - 委托来源与人工干预记录
- `displayAsActions` 不应是唯一表达方式，还需要保留真实 delegated actor 元数据

### 4.4 集成与企业能力

- OAuth / SSO 集成
- 外部 MCP / Tool Provider 授权
- 环境级 Secret 与仓库级 Secret 分层注入

## 5. 关键流程

### 当前已实现流程

1. 用户注册或登录后，`/api/auth/register` 与 `/api/auth/login` 会签发 Session JWT，并设置 `httpOnly` Cookie。
2. API 请求经过 `optionalSession` 中间件时，会自动识别 Bearer Token、PAT 和 Cookie。
3. Git Push 进入 `requireGitBasicAuth`，要求用户名与 Token 所属用户完全匹配。
4. Actions 容器启动后通过 lifecycle hook 为触发用户签发短期内部 Token，并在 `onStop / onError / onActivityExpired` 路径中回收。

### 目标流程

1. 人类用户从 Issue、PR 评论或手动 dispatch 创建 Agent Session。
2. 系统为 Agent Session 签发继承触发用户权限的短期 Token，用于推分支、创建 PR 与评论回写。
3. Agent 在容器内按当前 Session 权限执行代码编写、构建、测试与必要工具调用。
4. 所有读写行为都带上 Session 元数据，且不能绕过仓库规则与分支保护限制。
5. Session 结束、取消、超时或被回收后，关联 Token、Secret Mount、外部授权一并失效。

## 6. 核心接口

### 当前接口

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `POST /api/auth/tokens`
- `GET /api/auth/tokens`
- `DELETE /api/auth/tokens/:tokenId`
- `GET /:owner/:repo/info/refs?service=git-receive-pack`
- `POST /:owner/:repo/git-receive-pack`

### 建议新增接口

- `GET /api/agents`
- `POST /api/repos/:owner/:repo/agents`
- `POST /api/agent-sessions`
- `GET /api/agent-sessions/:sessionId`
- `POST /api/agent-sessions/:sessionId/cancel`
- `GET /api/audit-log`
- `GET /api/repos/:owner/:repo/policies/access`

## 7. 数据与状态

### 当前数据

- `users`：用户主表
- `access_tokens`：PAT、内部 Token、Actions 展示 Token 都落在这里
- Session Token 不落库，直接由 JWT 验签
- `accessTokenContext` 额外标识内部 Token、是否显示为 actions 用户
- 带 `displayAsActions` 的内部 Token 在权限上仍继承触发用户，但 Issue 评论与 PR 作者会显示为 `actions`

### 建议新增数据

- `agent_profiles`
- `agent_sessions`
- `audit_logs`
- `external_tool_credentials`
- `repository_access_policies`
- `session_secret_grants`

## 8. 关键代码文件

- `src/middleware/auth.ts`
- `src/services/auth-service.ts`
- `src/routes/api.ts`
- `src/routes/git.ts`
- `web/src/pages/login-page.tsx`
- `web/src/pages/register-page.tsx`
- `web/src/pages/tokens-page.tsx`
- `web/src/lib/api.ts`

后续预计新增：

- `src/services/agent-session-service.ts`
- `src/services/session-intervention-service.ts`
- `src/services/audit-log-service.ts`
- `web/src/pages/security-settings-page.tsx`
- `web/src/pages/agent-session-detail-page.tsx`

## 9. 当前边界与下一步

### 近期已落地（2026-03）

- 已在权限视图里补充：
  - `canRunAgents`
  - `canManageActions`
- 已引入 `agent_sessions`，用于记录：
  - 来源对象（Issue / PR / manual）
  - 来源动作（workflow / mention / issue_assign / issue_resume / pull_request_resume / rerun / dispatch）
  - delegated actor
  - linked run
- Issue、PR、rerun、dispatch 现在都会创建可追踪的 Agent Session，而不再只有 `action_runs`
- Agent Session 默认立即执行，无需等待审批
- Runtime 默认直接提供委托执行所需的 git push、PR 创建与评论回写能力
- 保留可选的 `cancel` 能力，用于中止正在运行或排队的 Session
- 已新增 Agent Session 详情页与基础 Timeline，能看到：
  - 来源对象上下文
  - 关联 run
  - 基于现有 session / run logs 聚合出的执行时间线

- 当前没有 OAuth、SSO 等企业身份集成
- Access Token 没有细粒度 scope，权限继承自用户在仓库内的现有身份
- Session 只有 JWT，没有刷新令牌机制
- Git 鉴权只支持 HTTP Basic + PAT
- Actions 使用的内部 Token 默认是短期有效，并绑定到单次容器运行生命周期，不适合人工长期持有
- Agent Session 已支持立即执行，但运行日志、delegated actor 追踪与审计记录还需要更完善的结构化支持

下一步优先级：

1. 建立 `human / agent / service` 三类主体
2. 把内部 Token 升级为 Agent Session 委托授权，并补齐更细粒度的审计与溯源
3. 增强运行日志与审计追踪能力
4. 增加细粒度 Token scope（用于 PAT 和外部集成）
