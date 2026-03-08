# Git 托管与存储 PRD

## 1. 模块定位

Git 托管与存储层是整个平台的底座，职责是：

- 为人类和 Agent 提供可用的 clone / fetch / push 远端。
- 把 Git 对象、引用和默认分支持久化到对象存储。
- 为代码浏览、PR compare、review thread 重锚和 squash merge 提供统一仓库读写入口。

当前重点是“可用、可追踪、可复用”，不是复杂 Git 策略控制台。

## 2. 当前架构

### 2.1 两层执行模型

- Worker 负责：
  - 鉴权
  - 请求参数校验
  - D1 仓库元数据查询
  - Actions workflow 触发编排
- `RepositoryObject` Durable Object 负责：
  - 按 `repository.id` 定位仓库
  - 优先从 DO storage 快照恢复仓库，缺失时再从 R2 hydrate 到内存
  - 复用同仓库后续请求的缓存上下文
  - Git 协议处理
  - 代码浏览读操作
  - squash merge

### 2.2 存储介质

- D1 保存仓库元数据与协作对象。
- `GIT_BUCKET` R2 保存 `HEAD`、`refs/*`、`objects/*`。
- `RepositoryObject` 的 DO storage 保存仓库快照，用于实例回收后的快速恢复。
- DO 实例内存仍保留当前热缓存；R2 继续作为长期持久化存储。

## 3. 当前已实现能力

### 3.1 Smart HTTP

- `info/refs`
- `git-upload-pack`
- `git-receive-pack`

### 3.2 fetch / clone 能力

- advertise refs
- `want / have / done` negotiation
- pack 生成
- shallow clone 参数：
  - `deepen`
  - `deepen-since`
  - `deepen-not`
- object filter：
  - `blob:none`
  - `blob:limit=<n>`

### 3.3 push 能力

- pkt-line 命令解析
- pack 接收与索引
- ref 更新校验
- `report-status` 响应
- 写回 R2 后同步更新 HEAD/ref 视图
- push 成功后触发匹配的 `push` workflow

### 3.4 merge 能力

- PR 合并目前仅支持 squash merge
- merge 在 `RepositoryObject` 内完成，结果回写仓库对象并更新引用

## 4. 当前存储模型

- 仓库前缀：`<owner>/<repo>/`
- HEAD：`<owner>/<repo>/HEAD`
- 引用：`<owner>/<repo>/refs/...`
- 对象：`<owner>/<repo>/objects/aa/bbbbb...`

创建仓库时会初始化默认分支 `main`，后续默认分支解析优先读取 HEAD，再回退到 `refs/heads/main` 或首个可用 head ref。

## 5. 当前关键流程

### 5.1 仓库初始化

1. 创建仓库时写入 D1。
2. Git 存储初始化 HEAD 和 `refs/heads/main`。
3. 仓库页、Git 路由和 compare 读取开始可用。

### 5.2 Git push

1. Worker 完成 Basic Auth 和仓库写权限校验。
2. 请求按仓库路由到 `RepositoryObject`。
3. DO 在内存仓库上执行 `receive-pack`。
4. 更新后的 refs 和 objects 持久化回 R2。
5. 同步把最新 `.git` 文件树写入 DO storage 快照。
6. Worker 根据更新后的 ref 触发 `push` workflows。

### 5.3 代码浏览/PR compare

1. 仓库页或 PR compare 请求进入 `RepositoryObject`。
2. 如果仓库尚未 hydrate，则优先尝试从 DO storage 快照恢复。
3. 若快照不存在，再从 R2 加载到内存，并回写一份最新快照到 DO storage。
4. 后续同仓库浏览请求复用已加载上下文。

### 5.4 DO 实例回收后的恢复

1. 同一 `repository.id` 的新 `RepositoryObject` 实例启动后，先检查 DO storage 是否已有仓库快照。
2. 若存在快照，则直接恢复 `.git` 文件树和 HEAD/ref 视图，避免重新遍历 R2。
3. 若不存在快照，则回退到 R2 hydrate，并在首次加载完成后建立快照。
4. 仓库删除时同步清理 DO storage 快照，避免保留陈旧仓库状态。

## 6. 当前接口

- `GET /:owner/:repo/info/refs?service=git-upload-pack`
- `GET /:owner/:repo/info/refs?service=git-receive-pack`
- `POST /:owner/:repo/git-upload-pack`
- `POST /:owner/:repo/git-receive-pack`

## 7. 关键代码文件

- `src/routes/git.ts`
- `src/services/repository-object.ts`
- `src/services/git-service.ts`
- `src/services/git-protocol.ts`
- `src/services/git-upload-pack-negotiation.ts`
- `src/services/git-repo-loader.ts`
- `src/services/storage-service.ts`
- `src/middleware/auth.ts`

## 8. 当前边界与缺口

### 8.1 Git 接入方式仍有限

- 当前 Git 接入方式明确限定为 HTTP Git；由于 Workers 无法支持 SSH 协议服务，SSH 不在当前能力边界内。
- 当前没有分支保护、签名策略、server-side hook policy 等治理能力。

### 8.2 provenance 仍主要停留在 run/session 层

- Agent 已能推分支、创建 PR、记录 branch ref。
- 但 commit 与 session 的直接映射还没有稳定回流到仓库浏览和 PR 主视图。

### 8.3 仓库缓存已升级为内存 + DO storage 快照

- 当前已经从“仅实例内存缓存”提升为“实例内存缓存 + DO storage 快照”。
- 这显著减少了同仓库重复 hydrate，也减少了实例回收后的 R2 重建成本。
- 仍然存在的边界是：首次冷启动或快照不存在时，仍需回退到 R2 hydrate。

### 8.4 Git 写入和 review 结果的链接仍不够强

- push 可以触发 workflow。
- 但“这次 push 产出了哪组验证结果、解决了哪些 review 反馈”还没有在 Git 视角下形成稳定摘要。

## 9. 下一步优先级

1. 增加 commit / branch / session 的 provenance 串联能力。
2. 在 PR 和 Session 视图中更直接展示工作分支与最近提交来源。
3. 继续把 Git 写入结果和 validation / artifact / review 摘要连接起来。
4. 评估 DO storage 快照的体积控制、增量更新与观测指标。
