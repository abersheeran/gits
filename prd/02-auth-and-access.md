# 认证与访问控制 PRD

## 1. 模块目标

这个模块的目标很简单：

- 让人类用户能登录并访问仓库、Issue、PR。
- 让协作者能读写仓库与参与评审。
- 让 Agent Session 能代表当前任务继续执行、推分支、创建 PR、回写评论。

它不是一个复杂的企业 IAM 或审批系统。

## 2. 当前主体模型

### 已实现主体

- 游客：可查看公开仓库及其代码、Issue、PR、Actions 结果。
- 登录用户：通过 Session Cookie 或 Bearer Token 访问受保护 API。
- 协作者：仓库级权限分为 `read`、`write`、`admin`。
- 仓库所有者：拥有仓库最高权限。
- Git 客户端：通过 `Basic username:access_token` 访问 Git HTTP 接口。
- Actions / Agent Runtime：使用短期内部 Token 执行克隆、推分支、评论、创建 PR。

## 3. 当前能力基线

- 用户注册、登录、登出。
- `GET /api/me` 返回当前用户。
- Session 支持 Cookie 与 Bearer。
- PAT 支持创建、列出、撤销。
- Git Push 要求 Basic Auth。
- Runtime 会为单次执行创建短期内部 Token。
- 已引入 `agent_sessions`，可以追踪：
  - 来源对象
  - 来源动作
  - 触发用户
  - 关联 run

## 4. 面向主工作流仍需补足

### 4.1 Agent 身份展示仍不够清楚

当前已有 delegated execution，但对用户来说，还不够直观地回答：

- 这次评论是谁发的
- 是哪个 Session 写的
- 它代表哪个人类用户继续工作

这个模块接下来要做的是把这些信息稳定地暴露出来，而不是引入更多主体类型。

### 4.2 Session 权限边界要继续收口

当前模型已经能工作，但还需要更明确的最小原则：

- Session 只拿当前任务所需的短期权限。
- Session 生命周期结束后，相关 Token 明确失效。
- Session 的 Git / 评论 / PR 写入都能稳定反查到来源 Session。

### 4.3 取消与恢复规则还需要更一致

Issue assign/resume、PR resume、review thread focused resume 已存在，但不同入口的可见性与交互还不完全统一。

## 5. 关键流程

### 当前已实现流程

1. 用户登录后获得 Session。
2. API 请求会识别 Session、PAT 或内部 Token。
3. Agent Session 启动时，Runtime 创建短期内部 Token。
4. Agent 使用这些短期能力去克隆仓库、推分支、回写评论或创建 PR。
5. Session 结束时，相关内部 Token 会被回收。

### 目标流程

1. 人类在 Issue 或 PR 中触发 Agent。
2. 系统创建 Agent Session，并明确记录触发人、来源对象和目标仓库。
3. Runtime 使用仅属于本次 Session 的短期权限完成执行。
4. 人类在 Issue / PR / Review 中能直接看见这次变更来自哪个 Session。

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

## 7. 当前数据

- `users`
- `access_tokens`
- `agent_sessions`
- `agent_session_steps`
- `agent_session_artifacts`
- `agent_session_usage_records`
- `agent_session_interventions`

## 8. 关键代码文件

- `src/middleware/auth.ts`
- `src/services/auth-service.ts`
- `src/services/agent-session-service.ts`
- `src/routes/api.ts`
- `src/routes/git.ts`
- `web/src/pages/login-page.tsx`
- `web/src/pages/register-page.tsx`
- `web/src/pages/tokens-page.tsx`
- `web/src/pages/agent-session-detail-page.tsx`

## 9. 当前边界与下一步

- 当前没有刷新令牌体系。
- PAT 仍然偏粗粒度，但已经足够当前主工作流。
- Git 鉴权仍以 HTTP Basic + Token 为主。
- Session 来源与执行身份已经能追踪，但在 Issue / PR 主界面的展示还不够集中。

下一步优先级：

1. 把 Session provenance 更直接地展示到 Issue、PR、Review UI。
2. 统一 assign / resume / cancel 的交互与可见性。
3. 收紧 Session 内部 Token 的最小可用范围和失效语义。
