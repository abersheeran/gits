# 认证与访问控制 PRD

## 1. 模块目标

为 Web 站点、REST API 和 Git Smart HTTP 提供统一身份识别能力，并在“游客 / 登录用户 / 协作者 / 仓库所有者 / Actions 内部调用”之间建立明确的访问边界。

## 2. 当前用户与权限模型

- 游客：可访问公开仓库及其代码、Issue、PR、Actions 结果。
- 登录用户：通过 Session Cookie 或 Bearer Token 访问受保护 API。
- 协作者：仓库级权限分为 `read`、`write`、`admin`。
- 仓库所有者：拥有仓库设置、删除、重命名等最高权限。
- Git 客户端：通过 `Basic username:access_token` 访问 Git HTTP 接口。
- Actions 内部调用：使用短期内部 Token，必要时可“显示为 actions 用户”发评论。

## 3. 当前能力范围

- 用户注册：用户名、邮箱、密码。
- 用户登录/登出：登录后下发 `session` Cookie，默认 7 天有效。
- 当前用户查询：`GET /api/me`。
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
  - 需要创建 PR 时创建单独短期 Token，并以 actions 身份落库作者信息

## 4. 关键流程

1. 用户注册或登录后，`/api/auth/register` 与 `/api/auth/login` 都会签发 Session JWT，并设置 `httpOnly` Cookie。
2. API 请求经过 `optionalSession` 中间件时，会自动识别 Bearer Token、PAT 和 Cookie。
3. Git Push 进入 `requireGitBasicAuth`，要求用户名与 Token 所属用户完全匹配。
4. Actions 容器启动后通过生命周期 hook 为触发用户签发短期内部 Token，并在 `onStop / onError / onActivityExpired` 路径中回收。

## 5. 核心接口

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `POST /api/auth/tokens`
- `GET /api/auth/tokens`
- `DELETE /api/auth/tokens/:tokenId`
- `GET /:owner/:repo/info/refs?service=git-receive-pack`
- `POST /:owner/:repo/git-receive-pack`

## 6. 数据与状态

- `users`：用户主表。
- `access_tokens`：PAT、内部 Token、Actions 展示 Token 都落在这里。
- Session Token 不落库，直接由 JWT 验签。
- `accessTokenContext` 额外标识内部 Token、是否显示为 actions 用户。
- 带 `displayAsActions` 的内部 Token 在权限上仍继承触发用户，但 Issue 评论与 PR 作者会显示为 `actions`。

## 7. 关键代码文件

- `src/middleware/auth.ts`
- `src/services/auth-service.ts`
- `src/routes/api.ts`
- `src/routes/git.ts`
- `web/src/pages/login-page.tsx`
- `web/src/pages/register-page.tsx`
- `web/src/pages/tokens-page.tsx`
- `web/src/lib/api.ts`

## 8. 当前边界与注意点

- 当前没有 OAuth、SSO、组织级身份体系。
- Access Token 没有细粒度 scope，权限继承自用户在仓库内的现有身份。
- Session 只有 JWT，没有刷新令牌机制。
- Git 鉴权只支持 HTTP Basic + PAT，不支持 SSH。
- Actions 使用的内部 Token 默认是短期有效，并绑定到单次容器运行生命周期，不适合人工长期持有。
