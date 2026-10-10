# 认证与访问控制 PRD

## 1. 模块定位

为网页、API 和 Git 客户端提供统一的用户身份与仓库权限边界。

## 2. 当前主体与凭证

- 游客可浏览公开仓库，也可匿名 clone / fetch。
- 用户通过 JWT 登录态访问 Web/API；注册、登录设置 `session` cookie，API 也接受 Bearer JWT。
- PAT 可作为 API Bearer 凭证；Git Basic Auth 使用 `用户名:PAT`，用户名必须与令牌所属用户一致，不能使用账户密码代替 PAT。
- 仓库所有者拥有完整权限；协作者有 `read / write / admin` 三档权限。

## 3. 当前权限规则

| 操作 | 所需权限 |
| --- | --- |
| 读取公开仓库 | 无需登录 |
| 读取私有仓库 | 所有者或任一协作者 |
| Git push | 所有者或 `write / admin` 协作者 |
| 列出、添加、更新、移除协作者 | 所有者或 `admin` 协作者 |
| 修改仓库名称、描述、可见性或删除仓库 | 仅所有者 |
| 通过 API 创建、删除分支或设置默认分支 | 仅所有者 |

无读权限的仓库 API 返回 404；Git 私有仓库匿名读取会要求认证。

## 4. 当前能力与流程

1. `ALLOW_USER_REGISTRATION` 去除空白后非空时允许注册。未设置或为空时关闭；字符串 `false` 也会启用注册。
2. 注册需要唯一用户名、唯一邮箱和至少 8 位密码；登录支持用户名或邮箱。
3. 密码经 bcrypt 哈希存储。登录 JWT 有效期为 7 天；cookie 为 HttpOnly、SameSite=Lax，在 HTTPS 请求下设置 Secure，本地 HTTP 不设置 Secure。
4. 认证中间件先尝试 Bearer JWT，再尝试 Bearer PAT，最后尝试 cookie。登出只清除 cookie，不撤销已经签发的 JWT 或 PAT。
5. 用户创建 PAT 时指定名称，可选 `expiresAt`（毫秒时间戳）；明文仅在创建响应中返回。验证成功更新最近使用时间，撤销后不可继续使用。
6. Git push 要求 Basic Auth；通过认证后仍按仓库权限检查写入资格。

## 5. 当前接口

- `POST /api/auth/register`：`username`、`email`、`password`。
- `POST /api/auth/login`：`usernameOrEmail`、`password`。
- `POST /api/auth/logout`：清除登录 cookie。
- `GET /api/me`：返回当前用户，未登录时为 `null`。
- `POST /api/auth/tokens`：`name`、可选 `expiresAt`。
- `GET /api/auth/tokens`：列出当前用户的令牌元数据。
- `DELETE /api/auth/tokens/:tokenId`：撤销自己的令牌。

## 6. 当前数据模型

- `users`：ID、唯一用户名、唯一邮箱、密码哈希、创建时间。
- `access_tokens`：用户 ID、令牌哈希与前缀、名称、创建时间、到期时间、最近使用时间、撤销时间。
- `repository_collaborators`：仓库与用户的权限关系，详见 [03](03-repository-management-and-collaboration.md)。

JWT 登录态不使用独立数据库表。

## 7. 关键代码文件

- `src/middleware/auth.ts`
- `src/services/auth-service.ts`
- `src/services/repository-service.ts`
- `src/routes/api/platform-routes.ts`
- `src/routes/api/route-support.ts`
- `src/routes/git.ts`
- `src/db/schema.sql`
- `web/src/pages/login-page.tsx`
- `web/src/pages/register-page.tsx`
- `web/src/pages/tokens-page.tsx`

## 8. 当前边界与下一步

- PAT 沿用用户的仓库权限，没有按仓库限定的授权范围。
- 没有刷新令牌、设备登录管理或单独撤销 JWT 的能力。
- 不提供 SSH key 接入；Workers 无法承载入站 SSH 服务。

下一步优先考虑按仓库限定 PAT 权限、登录态撤销及更清楚的到期提示。
