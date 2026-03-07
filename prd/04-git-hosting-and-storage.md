# Git 托管与存储 PRD

## 1. 模块目标

把 `gits` 作为一个可直接被标准 Git 客户端使用的远端仓库服务，提供 `clone`、`fetch`、`push` 所需的 Smart HTTP 能力，并将 Git 数据持久化在 R2。

## 2. 当前能力范围

- Git Smart HTTP 广告接口：
  - `GET /:owner/:repo/info/refs?service=git-upload-pack`
  - `GET /:owner/:repo/info/refs?service=git-receive-pack`
- Fetch：
  - `POST /:owner/:repo/git-upload-pack`
  - 支持 `want/have/done` 协商
  - 支持 shallow 能力：`deepen`、`deepen-since`、`deepen-not`
  - 支持对象过滤：`blob:none`、`blob:limit=<n>`
- Push：
  - `POST /:owner/:repo/git-receive-pack`
  - 解析 pkt-line 命令与 pack
  - 校验 ref 更新合法性
  - 回写对象与 refs 到 R2
  - 生成 `report-status`
- 仓库初始化：
  - 创建仓库时只初始化 `HEAD`
  - 默认分支名为 `main`
- Push 事件联动：
  - 成功 push 到分支或 tag 后，可触发 Actions 工作流

## 3. 存储设计

- 仓库前缀：`<owner>/<repo>/`
- HEAD：`<owner>/<repo>/HEAD`
- 引用：`<owner>/<repo>/refs/...`
- Git 对象：`<owner>/<repo>/objects/aa/bbbbb...`

这种设计让仓库迁移、删除和重命名都可以通过对象前缀遍历实现。

## 4. 关键流程

1. `info/refs` 读取仓库 refs，按服务类型拼出能力广告。
2. `git-upload-pack` 在 Workers 中解析客户端请求，计算 commit 集合与对象闭包，回传 pack。
3. `git-receive-pack` 验证 Basic Auth 后接收 pack，更新 refs，并把新对象同步回 R2。
4. Push 成功后，如果更新的是 `refs/heads/*` 或 `refs/tags/*`，再触发匹配的 Actions 工作流。

## 5. 核心接口

- `GET /:owner/:repo/info/refs?service=git-upload-pack`
- `GET /:owner/:repo/info/refs?service=git-receive-pack`
- `POST /:owner/:repo/git-upload-pack`
- `POST /:owner/:repo/git-receive-pack`

## 6. 关键代码文件

- `src/routes/git.ts`
- `src/services/git-service.ts`
- `src/services/git-protocol.ts`
- `src/services/git-upload-pack-negotiation.ts`
- `src/services/git-repo-loader.ts`
- `src/services/storage-service.ts`
- `src/services/git-errors.ts`
- `src/middleware/auth.ts`

## 7. 当前边界与注意点

- 只支持 HTTP Git 远端，不支持 SSH。
- 没有 Git LFS、Submodule 专项能力和 server-side hook 体系。
- 默认请求体限制：
  - `upload-pack` 8 MB
  - `receive-pack` 32 MB
  - 可通过环境变量覆盖
- Push 触发 Actions 时只关心分支和标签引用，不处理其他自定义 ref 命名空间。
