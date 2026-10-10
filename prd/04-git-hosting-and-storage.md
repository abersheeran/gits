# Git 托管与存储 PRD

## 1. 模块定位

提供 clone / fetch / push 远端，持久化 Git 对象与引用，并为分支管理和代码浏览提供统一仓库访问入口。

## 2. 当前架构与存储

- Worker：鉴权、参数检查和 D1 仓库元数据查询。
- `RepositoryObject`：通过 `REPOSITORY_OBJECTS` 按仓库 ID 定位，处理 Git 协议、分支操作和浏览请求，复用内存仓库上下文。
- D1：保存用户、仓库、协作者、PAT 元数据。
- `GIT_BUCKET` R2：长期保存 Git 文件，前缀为 `<owner>/<repo>/`，包含 `HEAD`、`refs/`、`objects/`（含 pack 与索引）。
- DO storage：保存仓库快照；实例回收后优先从快照恢复，快照缺失时从 R2 加载并建立快照。

## 3. 当前协议能力

- 引用通告与 `want / have / done` 协商、pack 生成。
- 浅克隆：`deepen`、`deepen-since`、`deepen-not`。
- 对象过滤：`blob:none`、`blob:limit=<n>`。
- push：pkt-line 解析、pack 接收与索引、引用更新检查及 `report-status` 响应。
- push 按变更文件增量更新 R2 与 DO 快照，包括 pack、索引、引用和必要的 `HEAD` 更新。
- fetch 请求体默认上限 8 MiB，push 默认 32 MiB，可分别由 `UPLOAD_PACK_MAX_BODY_BYTES`、`RECEIVE_PACK_MAX_BODY_BYTES` 调整；这是请求体限制，不是仓库总大小限制。

## 4. 关键流程

### 4.1 初始化

创建仓库时先写 D1，再写入 `HEAD` 指向 `refs/heads/main`。空仓库没有提交，实际分支引用在首次 push 后产生。

### 4.2 Git push

1. Worker 验证 Basic Auth 中的用户名与 PAT，并检查仓库写权限。
2. 根据仓库 ID 将请求发给 DO，恢复或复用内存仓库。
3. 处理接收的 pack 和引用更新，收集变更与删除文件。
4. 增量持久化至 R2 和 DO 快照，更新内存中的引用视图并返回协议结果。

### 4.3 读取与恢复

代码浏览和 Git 读取复用同一 DO 上下文。新实例优先恢复 DO 快照，没有快照时读取 R2；首次冷加载仍需遍历仓库数据。仓库删除同步清理 R2、内存缓存和快照。

## 5. 当前接口

- `GET /:owner/:repo/info/refs?service=git-upload-pack`
- `GET /:owner/:repo/info/refs?service=git-receive-pack`
- `POST /:owner/:repo/git-upload-pack`
- `POST /:owner/:repo/git-receive-pack`

仓库名支持 `.git` 后缀。公开仓库可匿名读取；push 必须使用 Basic Auth 和 PAT。

## 6. 关键代码文件

- `src/routes/git.ts`
- `src/services/repository-object.ts`
- `src/services/repository-object-client.ts`
- `src/services/repository-object-protocol.ts`
- `src/services/git-service.ts`
- `src/services/git-protocol.ts`
- `src/services/git-upload-pack-negotiation.ts`
- `src/services/git-repo-loader.ts`
- `src/services/storage-service.ts`
- `src/routes/git.integration.test.ts`
- `src/routes/git.cli.integration.test.ts`

## 7. 当前边界与下一步

- 仅 HTTP Git；Workers 无法承载入站 SSH 服务，不提供 SSH 接入。
- 没有 Git LFS、分支保护或服务端自定义钩子策略。
- DO 内存上下文与快照会随仓库增长，首次从 R2 恢复仍有成本。

下一步优先评估大仓库快照体积、冷加载性能与存储失败时的恢复能力，并补充分支保护。
