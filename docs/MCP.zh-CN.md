# MCP 使用文档（gits 平台）

本文档说明如何把 `gits` 平台提供的 MCP 能力接入本地 agent，并明确本地 agent 与 actions runtime 在认证方式上的区别。

## 1. 当前能力

平台当前提供两个 MCP tools：

- `gits_issue_reply`
- `gits_create_pull_request`

对应能力分别是：

- 向指定仓库的 Issue 发表评论
- 在指定仓库中创建 Pull Request，并可附带 `closeIssueNumbers`

MCP 服务入口为：

```text
ALL /api/mcp
```

常用查询参数：

- `owner`：仓库 owner 用户名
- `repo`：仓库名
- `issueNumber`：默认 Issue 编号，可选

示例：

```text
https://gits.example.com/api/mcp?owner=alice&repo=demo
https://gits.example.com/api/mcp?owner=alice&repo=demo&issueNumber=42
```

## 2. 认证与权限边界

### 2.1 本地 agent

本地 agent 使用你自己账号下创建的 token 连接平台 MCP endpoint。

这意味着：

- 平台不会为本地 agent 代发临时 token
- 本地 agent 的权限边界等于这个 token 对应账号本身在仓库里的权限
- 如果你希望限制本地 agent 能操作哪些仓库，应当控制：
  - 使用哪个账号
  - 该账号在目标仓库上的协作权限
  - 使用哪个 token

当前系统还没有单独的 token scope 模型；权限仍跟随账号 / 仓库权限体系。

### 2.2 Actions 里的 agent

Actions runtime 仍然使用平台签发的临时 token。

这意味着：

- actions runtime 不依赖用户手工提供本地 token
- 评论与建 PR 可继续按 actions 身份回写
- 这些临时 token 只用于平台内部 actions 执行链路，不暴露给本地 agent

## 3. 先创建用户 token

你可以通过 Web 页面或 API 创建 token。

### 3.1 Web 页面

- Access Tokens：`/tokens`

### 3.2 API

请求：

```bash
curl -X POST "$GITS_ORIGIN/api/auth/tokens" \
  -H "Authorization: Bearer $GITS_SESSION_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "local-mcp"
  }'
```

响应：

```json
{
  "token": "gts_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "tokenId": "..."
}
```

建议：

- 为本地 agent 单独创建一个 token
- 不要复用日常脚本或 Git push 使用的 token
- 如果要停用，直接在 `/tokens` 或 `DELETE /api/auth/tokens/:tokenId` 撤销

## 4. 接入 Codex

先准备环境变量：

```bash
export GITS_ORIGIN="https://gits.example.com"
export GITS_TOKEN="gts_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

添加 MCP server：

```bash
codex mcp add gits-platform \
  --url "$GITS_ORIGIN/api/mcp?owner=alice&repo=demo" \
  --bearer-token-env-var GITS_TOKEN
```

如果你希望给某个 Issue 预置默认上下文：

```bash
codex mcp add gits-platform \
  --url "$GITS_ORIGIN/api/mcp?owner=alice&repo=demo&issueNumber=42" \
  --bearer-token-env-var GITS_TOKEN
```

查看配置：

```bash
codex mcp get gits-platform
```

移除配置：

```bash
codex mcp remove gits-platform
```

## 5. 接入 Claude Code

先准备环境变量：

```bash
export GITS_ORIGIN="https://gits.example.com"
export GITS_TOKEN="gts_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

添加 MCP server：

```bash
claude mcp add --transport http gits-platform \
  "$GITS_ORIGIN/api/mcp?owner=alice&repo=demo" \
  --header "Authorization: Bearer $GITS_TOKEN"
```

如果你希望把配置放在项目范围，可以加 `-s project`：

```bash
claude mcp add -s project --transport http gits-platform \
  "$GITS_ORIGIN/api/mcp?owner=alice&repo=demo&issueNumber=42" \
  --header "Authorization: Bearer $GITS_TOKEN"
```

查看配置：

```bash
claude mcp get gits-platform
```

移除配置：

```bash
claude mcp remove gits-platform
```

## 6. Tools 参数说明

### 6.1 `gits_issue_reply`

输入参数：

- `body`：必填，评论正文
- `issueNumber`：可选；未提供时优先使用 MCP URL 里的 `issueNumber`
- `owner`：可选；未提供时优先使用 MCP URL 里的 `owner`
- `repo`：可选；未提供时优先使用 MCP URL 里的 `repo`

示例用途：

- 让 agent 在信息不足时回 Issue 追问
- 让 agent 在完成后回 Issue 说明交付结果

### 6.2 `gits_create_pull_request`

输入参数：

- `title`：必填
- `body`：可选
- `baseRef`：必填
- `headRef`：必填
- `closeIssueNumbers`：可选
- `owner`：可选；未提供时优先使用 MCP URL 里的 `owner`
- `repo`：可选；未提供时优先使用 MCP URL 里的 `repo`

示例用途：

- 让 agent 在完成修改后直接创建 PR
- 让 agent 创建带 `Closes #...` 语义的交付 PR

## 7. 推荐使用方式

如果你的 agent 主要服务于单仓库，推荐把 `owner` 和 `repo` 固定在 MCP URL 里，这样 prompt 更短，也更不容易调错仓库。

如果你的 agent 主要围绕某个 Issue 工作，推荐连 `issueNumber` 一起固定在 URL 里，这样 `gits_issue_reply` 不需要每次都重复传编号。

## 8. 常见问题

### 8.1 返回 401 Unauthorized

通常表示：

- token 无效
- token 已撤销
- 没有正确通过 `Authorization: Bearer ...` 发送

### 8.2 返回 403 Forbidden

通常表示当前 token 对应账号没有目标仓库的足够权限。

当前没有单独的 MCP scope，因此应回头检查：

- token 属于哪个账号
- 该账号是否是仓库 owner 或 collaborator
- collaborator 权限是否满足你的操作需求

### 8.3 Tool 提示缺少仓库或 Issue 上下文

说明你既没有：

- 在 MCP URL 里提供 `owner` / `repo` / `issueNumber`

也没有：

- 在 tool 调用参数里传这些值

最稳妥的做法是直接把默认仓库上下文写进 MCP URL。

## 9. 与 Actions 的关系

本地 agent 和 actions runtime 现在共用同一个平台 MCP endpoint，但认证方式不同：

- 本地 agent：用户自建 token
- actions runtime：平台临时 token

因此这个文档只覆盖“本地 agent 如何接入”。如果你关注的是 actions runtime 的运行链路，请看：

- [Actions 与 Agent Runtime PRD](/Users/aber/Documents/gits/gits/prd/08-actions-and-ai-automation.md)
