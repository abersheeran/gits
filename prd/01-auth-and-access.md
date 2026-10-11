# 认证与访问控制 PRD

## 1. 模块定位

为网页、API 和 Git 客户端提供统一的用户身份与仓库权限边界。

## 2. 主体与凭证

- 游客可浏览公开仓库，也可匿名 clone / fetch。
- 用户通过服务端会话访问 Web/API；注册、登录设置 `session` cookie，API 也接受 Bearer 会话令牌，不接受 JWT。
- PAT 可作为 API Bearer 凭证；Git Basic Auth 使用 `用户名:PAT`，用户名必须与令牌所属用户一致，不能使用账户密码代替 PAT。
- 仓库所有者拥有完整权限；协作者有 `read / write / admin` 三档权限。

## 3. 权限规则

| 操作 | 所需权限 |
| --- | --- |
| 读取公开仓库 | 无需登录 |
| 读取私有仓库 | 所有者或任一协作者 |
| Git push | 所有者或 `write / admin` 协作者 |
| 列出、添加、更新、移除协作者 | 所有者或 `admin` 协作者 |
| 修改仓库名称、描述、可见性或删除仓库 | 仅所有者 |
| 创建、删除分支或设置默认分支 | 仅所有者 |

无读权限的仓库 API 返回 404；Git 私有仓库匿名读取会要求认证。镜像仓库对所有权限都拒绝 Git push 与分支管理，见 [GitHub 同步](05-github-sync.md#45-只读与解除)。

## 4. 规则与流程

1. `ALLOW_USER_REGISTRATION` 去除首尾空白后为 `true`（不区分大小写）时允许注册，其他值或未设置时关闭。
2. 注册需要唯一用户名、唯一邮箱和至少 8 位密码；登录支持用户名或邮箱。
3. 密码经 bcrypt 哈希存储。每次登录创建独立的随机会话令牌，固定有效期为 7 天，不滑动续期；cookie 为 HttpOnly、SameSite=Lax，在 HTTPS 请求下设置 Secure，本地 HTTP 不设置 Secure。
4. 认证中间件先尝试 Bearer 会话令牌，再尝试 Bearer PAT，最后尝试 cookie。每次请求验证会话是否有效；登出删除服务端会话并清除 cookie，重复登出也成功。PAT 需单独撤销。
5. 用户创建 PAT 时指定名称，可选 `expiresAt`（毫秒时间戳）；明文仅在创建响应中返回。验证成功更新最近使用时间，撤销后不可继续使用。
6. PAT 继承所属用户的全部仓库权限，不按仓库或操作限定范围。
7. Git push 要求 Basic Auth；通过认证后仍按仓库权限检查写入资格。
8. 用户只能管理自己的登录设备，可以逐台吊销其他会话或一次退出所有其他设备；当前会话保留，当前设备通过「退出」登出。设备管理要求有效的登录会话，PAT 不可访问。吊销完成后，该令牌的后续请求不能通过验证，已开始的请求不追溯取消。
9. 登录设备指一次登录产生的会话，不进行物理设备指纹合并；同一浏览器重新登录会生成新的会话。记录登录时的 User-Agent 和 IP，以及创建、最近活动、到期时间；浏览器和系统名称仅供辨认，最近活动最多每分钟更新一次。
10. 登录凭证仅存储不可逆哈希，设备列表不返回凭证或哈希；公开设备 ID 不能用于登录。删除用户时同时删除其登录会话，过期会话不再展示。
11. 账户与鉴权响应不可缓存；拒绝跨站写操作，保护 cookie 登录态。被吊销设备下一次收到 API 401 时刷新身份并返回登录入口。

## 5. 界面

- `/register`、`/login`：注册与登录。
- `/tokens`：令牌列表展示名称、前缀、创建时间、过期时间、最近使用时间和状态。
- 创建令牌使用对话框，有效期可选不过期、7 天、30 天、90 天、1 年，前端换算为 `expiresAt`；创建成功后在对话框中仅展示一次明文并支持复制。
- 撤销令牌须二次确认。
- `/sessions`：顶栏账户区（桌面设备图标、移动端「登录设备」）进入。按创建时间倒序展示有效登录，当前设备优先；每页 20 条，由服务端分页。
- 设备列表展示浏览器、系统、登录 IP、登录时间、最近活动与当前设备标记；移动端折叠次要列。逐台退出使用图标按钮；「退出其他设备」在页头，两种操作均通过确认 Dialog。包含骨架、错误、空状态与分页。

## 6. 接口

- `POST /api/auth/register`：`username`、`email`、`password`。
- `POST /api/auth/login`：`usernameOrEmail`、`password`。
- `POST /api/auth/logout`：删除当前登录会话并清除 cookie；如果 Bearer 与 cookie 同时存在，二者的有效登录会话均被吊销，不撤销 PAT。
- `GET /api/me`：返回当前用户，未登录时为 `null`。
- `GET /api/auth/sessions?page=1`：返回 `{ sessions, hasNext }`；会话含 `id`、`user_agent`、`ip_address`、`created_at`、`last_used_at`、`expires_at`、`current`，时间均为毫秒时间戳。
- `DELETE /api/auth/sessions/:sessionId`：吊销自己的其他会话；当前会话返回 400，不属于自己或不存在返回 404。
- `DELETE /api/auth/sessions`：吊销自己的所有其他会话，保留当前会话。
- `POST /api/auth/tokens`：`name`、可选 `expiresAt`。
- `GET /api/auth/tokens`：列出当前用户的令牌元数据。
- `DELETE /api/auth/tokens/:tokenId`：撤销自己的令牌。

## 7. 数据模型

- `users`：ID、唯一用户名、唯一邮箱、密码哈希、创建时间。
- `access_tokens`：用户 ID、令牌哈希与前缀、名称、创建时间、到期时间、最近使用时间、撤销时间。
- `repository_collaborators`：仓库与用户的权限关系，详见 [02](02-repository-management-and-collaboration.md)。
- `user_sessions`：独立 ID、用户 ID、唯一令牌哈希、User-Agent、登录 IP、创建时间、最近活动时间、到期时间。吊销为硬删除。

## 8. 关键代码文件

- `src/middleware/auth.ts`
- `src/services/auth-service.ts`
- `src/services/session-service.ts`
- `src/routes/api/session-routes.ts`
- `src/services/repository-service.ts`
- `src/routes/api/platform-routes.ts`
- `src/routes/api/route-support.ts`
- `src/routes/git.ts`
- `src/db/schema.sql`
- `web/src/pages/login-page.tsx`
- `web/src/pages/register-page.tsx`
- `web/src/pages/tokens-page.tsx`
- `web/src/pages/sessions-page.tsx`
- `web/src/lib/session-api.ts`
