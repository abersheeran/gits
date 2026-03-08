# Git 托管与存储 PRD

## 1. 模块目标

这个模块的职责是为人类和 Agent 提供稳定可用的 Git 远端：

- 可以 clone / fetch / push。
- 可以让 Agent 推工作分支。
- 可以把提交、分支和 Session 之间的关系存下来。

它不承担复杂的策略治理职责。

## 2. 当前能力基线

- Git Smart HTTP：
  - `info/refs`
  - `git-upload-pack`
  - `git-receive-pack`
- 单仓库单实例 Durable Object：
  - `RepositoryObject` 以 `repository.id` 作为稳定 key
  - 同一仓库的 Smart HTTP 读写与 Git 计算统一在同一个 DO 中执行
  - DO 仅保留实例内内存缓存，冷启动时再从 R2 hydrate
- R2 持久化：
  - `HEAD`
  - `refs/*`
  - `objects/*`
- Push 成功后会触发匹配的 Actions 工作流。
- 创建仓库时初始化默认分支 `main`。

## 3. 当前存储模型

- 仓库前缀：`<owner>/<repo>/`
- HEAD：`<owner>/<repo>/HEAD`
- 引用：`<owner>/<repo>/refs/...`
- 对象：`<owner>/<repo>/objects/aa/bbbbb...`

## 4. 面向主工作流仍需补足

### 4.0 当前架构边界

当前 Git 托管链路已经变成明确的两层：

- Worker 负责鉴权、参数校验、D1 元数据和 workflow 编排。
- `RepositoryObject` 负责仓库 hydrate、Git 协议处理、对象写回和同仓库缓存复用。

这解决了“同一页面多个请求重复从 R2 重建仓库”的问题，但也引入了一条明确前提：

- 仓库存储写入必须经由当前 Worker/DO 路径完成，不能再假设有外部进程直接改同一份 R2 数据。

### 4.1 Agent 生成提交的 provenance 还不够完整

当前 Agent 已能推分支和创建 PR，但还需要更明确地回答：

- 这个 commit 来自哪个 Session
- 这个分支是为哪个 Issue / PR 创建的
- 最近一次交付对应哪些测试与 artifact

### 4.2 Git 写入结果还没和评审页面紧密连接

用户在 PR 页面看到的是 diff 和 review thread，但还缺少对“这次 push 带来了什么验证结果”的直接映射。

### 4.3 Agent 分支语义还不够清楚

当前系统已经能生成和更新工作分支，但还没有一套更清晰的展示方式，让用户在 Issue / PR / Session 中看出当前正在推进的是哪条分支。

## 5. 关键流程

### 当前已实现流程

1. Worker 完成 Git 鉴权与仓库读写权限判断。
2. Worker 按 `repository.id` 路由到单仓库 `RepositoryObject`。
3. `RepositoryObject` 从 R2 hydrate 仓库到内存，并复用后续同仓库请求。
4. Push 时 DO 解析命令、接收 pack、写入对象和 refs，并将最新 refs 回传 Worker。
5. Push 成功后 Worker 根据更新后的 refs 触发后续自动化。

### 目标流程

1. Agent 从 Issue 或 PR 启动 Session。
2. Agent 在工作分支上提交代码并推送。
3. 用户在 PR 中看到这些提交与对应的验证结果。
4. 人类完成最终合并。

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

## 8. 当前边界与下一步

- 当前只支持 HTTP Git 远端。
- 当前 Git 仓库缓存只保存在 `RepositoryObject` 实例内存中，不落 DO storage 快照。
- Push provenance 还没有直接体现在提交和 PR 主界面中。
- Git 存储层还没有把提交、artifact、Session 做更直接的关联输出。

下一步优先级：

1. 增加 commit 与 Session 的 provenance 关联能力。
2. 在 PR 和 Session 视图里更直接展示工作分支与提交来源。
3. 为测试结果和关键 artifact 提供与提交关联的展示入口。
