# Git 托管与存储 PRD

## 1. 模块目标

把 `gits` 作为一个可直接被标准 Git 客户端与 Agent Runtime 使用的远端仓库服务，提供 `clone`、`fetch`、`push` 所需的协议能力，并将 Git 数据与 Agent 产物安全持久化。

在 Agent 原生平台里，这个模块除了“能不能 push”，还要负责：

- 是否允许 Agent push
- Agent 只能 push 到哪里
- 受保护分支如何在协议层 enforce
- 自动化产出的提交、tag、merge 是否具备 provenance

## 2. 当前能力基线

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

## 4. 面向 Agent 原生目标需要补足

### 4.1 Git 协议能力

- Git LFS
- 更完整的 server capability 管理
- 更细的 push rule 错误反馈

### 4.2 Agent 写入模型

- Agent 可以推送到任何有权限的分支：
  - 可创建新分支（如 `feature/xxx`、`fix/xxx` 或自定义命名）
  - 可更新已有 feature branch
  - 可推送到默认分支（如果触发用户有权限）
- Agent 所有推送都应带 Session 元数据和 provenance，确保可追溯
- 分支保护规则（如 required checks、required reviews）主要用于保护关键分支，但 Agent 可以自由创建 PR 来提交变更

### 4.3 受保护分支与合并策略

- 分支保护主要用于协作规范，而非阻止 Agent：
  - 可配置 required checks（用于 CI/CD 验证）
  - 可配置 required reviews（用于人类评审）
  - Agent 可以直接推送或通过 PR 提交变更
- 支持 merge queue 与临时集成分支优化合并流程

### 4.4 Provenance 与产物

- Agent 生成提交需要明确：
  - `author`
  - `committer`
  - `generated-by agent`
  - 来源 Session ID
- 后续应支持：
  - signed commits
  - signed tags
  - build / patch / plan artifact 存储

## 5. 关键流程

### 当前已实现流程

1. `info/refs` 读取仓库 refs，按服务类型拼出能力广告。
2. `git-upload-pack` 在 Workers 中解析客户端请求，计算 commit 集合与对象闭包，回传 pack。
3. `git-receive-pack` 验证 Basic Auth 后接收 pack，更新 refs，并把新对象同步回 R2。
4. Push 成功后，如果更新的是 `refs/heads/*` 或 `refs/tags/*`，再触发匹配的 Actions 工作流。

### 目标流程

1. Agent Session 启动时，系统为其分配继承触发用户的 Git 权限，并继续受仓库协作权限与分支规则约束。
2. Agent push 时，协议层记录 Session 元数据和 provenance。
3. Agent 可以自主决定是直接推送还是创建 PR，基于任务需求和代码变更规模。
4. Push 成功后，系统把 provenance、artifact、运行记录与提交关联起来，确保可追溯。

## 6. 核心接口

### 当前接口

- `GET /:owner/:repo/info/refs?service=git-upload-pack`
- `GET /:owner/:repo/info/refs?service=git-receive-pack`
- `POST /:owner/:repo/git-upload-pack`
- `POST /:owner/:repo/git-receive-pack`

### 建议新增接口

- `GET /api/repos/:owner/:repo/git/policies`
- `GET /api/repos/:owner/:repo/git/provenance/:oid`
- `GET /api/repos/:owner/:repo/artifacts`
- `GET /api/repos/:owner/:repo/artifacts/:artifactId`

## 7. 关键代码文件

- `src/routes/git.ts`
- `src/services/git-service.ts`
- `src/services/git-protocol.ts`
- `src/services/git-upload-pack-negotiation.ts`
- `src/services/git-repo-loader.ts`
- `src/services/storage-service.ts`
- `src/services/git-errors.ts`
- `src/middleware/auth.ts`

后续预计新增：

- `src/services/git-policy-service.ts`
- `src/services/git-provenance-service.ts`
- `src/services/artifact-storage-service.ts`

## 8. 当前边界与下一步

- 只支持 HTTP Git 远端
- 没有 Git LFS、Submodule 专项能力和 server-side hook 体系
- 默认请求体限制：
  - `upload-pack` 8 MB
  - `receive-pack` 32 MB
  - 可通过环境变量覆盖
- Push 触发 Actions 时只关心分支和标签引用，不处理其他自定义 ref 命名空间

下一步优先级：

1. 增加受保护分支 enforcement
2. 引入 Agent 分支命名空间与 push provenance
3. 评估 Git LFS 与 artifact 存储路径
