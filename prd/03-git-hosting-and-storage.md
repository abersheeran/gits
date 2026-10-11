# Git 托管与存储 PRD

## 1. 模块定位

提供 clone / fetch / push 远端，持久化 Git 对象与引用，并为分支管理和代码浏览提供统一仓库访问入口。只提供 HTTP Git。

## 2. 架构与存储

- Worker：鉴权、参数检查和 D1 仓库元数据查询；请求体与响应体以流的形式在 Worker 与 DO 之间传递。
- `RepositoryObject`：通过 `REPOSITORY_OBJECTS` 按仓库 ID 定位，处理 Git 协议、分支操作和浏览请求。每个仓库的对象与引用保存在该 DO 自己的 SQLite 中，按需读取单个对象，不把整个仓库载入内存。
- D1：保存用户、仓库、协作者、PAT 元数据。
- `GIT_BUCKET` R2：只保存旧存储格式的仓库数据，供首次访问时导入，见 4.5。

### 2.1 对象存储

- 对象表以 OID 为主键，记录对象类型、大小，以及 pack 条目原样的压缩负载。delta 条目保留为「基对象 OID + delta」，不展开成完整对象。
- 负载不超过 1 MiB 时与对象行存在一起，更大的负载按 1 MiB 分块存入分块表。SQLite DO 的单行上限为 2 MB，分块后单个对象大小不受此限制。
- delta 链深度上限为 50：入库时若链深超过上限，该对象改存为完整对象，避免多次 push 后读取一个对象需要逐级还原过长的链。
- 读取对象时按 delta 链逐级还原，并用按字节计量的 LRU 缓存保存还原结果。需要在内存中还原的对象（delta 对象或完整读取）上限为 32 MiB；完整对象的预览与差异只读取所需前缀，不受此限制。
- 引用与 `HEAD` 存在同一 SQLite 中，引用更新在事务内比较并交换，与对象写入保持一致。
- 不做垃圾回收：push 失败遗留的对象、被强推覆盖的历史对象会保留。

### 2.2 容量

- 单仓库存储上限为 SQLite DO 的 10 GB，与仓库对象总数无关；Workers Paid 账户总存储不设上限。
- 单次 push 受平台请求体上限（Workers Free 与 Pro 区域为 100 MB）和单次请求 5 分钟 CPU 时间约束；超过时可分多次 push 较早的提交。
- clone 与 fetch 以流的形式生成 pack，响应大小不受内存限制。

## 3. 协议能力

- 引用通告与 `want / have / done` 协商、pack 生成。
- 浅克隆：`deepen`、`deepen-since`、`deepen-not`。
- 对象过滤：`blob:none`、`blob:limit=<n>`。
- push：流式解析 pkt-line 与 pack，逐条入库，支持 thin pack，并做连通性检查后更新引用，返回 `report-status`。
- fetch 请求体默认上限 8 MiB，可由 `UPLOAD_PACK_MAX_BODY_BYTES` 调整；push 请求体默认只受平台上限约束，可由 `RECEIVE_PACK_MAX_BODY_BYTES` 另设上限。超限返回 413。

## 4. 关键流程

### 4.1 初始化

创建仓库时先写 D1，再由 DO 初始化 SQLite 并写入指向 `refs/heads/main` 的 `HEAD`。空仓库没有提交，实际分支引用在首次 push 后产生。

### 4.2 Git push

1. Worker 验证 Basic Auth 中的用户名与 PAT，并检查仓库写权限，把请求体流转发给 DO。
2. DO 同一时间只处理一个写入；逐条解析 pack 条目，计算 OID 并写入对象表，delta 的基对象可来自本次 pack 或仓库已有对象。
3. 连通性检查：本次新写入的提交与树所引用的对象必须都已存在（子模块条目除外），否则拒绝全部引用更新。
4. 在一个事务内按旧值比较并更新引用及必要的 `HEAD`，返回协议结果。

### 4.3 clone 与 fetch

1. 没有共同提交且未请求浅克隆时，按入库顺序流式发送全部对象，按过滤条件排除 blob；对象数取自同一快照，期间的新 push 不影响本次响应。
2. 有共同提交或请求浅克隆时，先选出需要的提交，再把每个提交的树与其父提交的树比较，只发送发生变化的对象；没有可用父提交（根提交或浅克隆边界）时发送完整的树。增量选择超过提交或对象数上限且未请求浅克隆时，退回第 1 步的全量发送。
3. 对象的 delta 基对象也在本次 pack 中时，按 `REF_DELTA` 原样发送压缩负载；否则还原为完整对象后发送。
4. 全量发送可能包含不可达对象，客户端会忽略。

### 4.4 镜像拉取

GitHub 镜像由 DO alarm 作为 upload-pack 客户端从 GitHub 拉取 pack，与 push 共用流式入库与连通性检查；引用按远端强制对齐。规则见 [GitHub 同步](05-github-sync.md#43-拉取)。

### 4.5 旧格式迁移

旧格式把仓库文件保存在 R2 的 `<owner>/<repo>/` 前缀下，并在 DO 键值存储中保留快照。DO 首次处理某个已有仓库时：

1. 从 R2 导入松散对象、全部 pack（按上传时间从早到晚，基对象缺失的 pack 在其余 pack 之后重试）、引用与 `HEAD`。
2. 逐个读取导入的对象并校验 OID，确认每个引用都指向已存在的对象。
3. 校验通过后标记迁移完成，删除该仓库的 R2 数据与旧快照；校验失败时保留旧数据并返回错误。

迁移期间同一仓库的其他请求等待迁移完成。新建仓库不写 R2。

### 4.6 删除与重命名

删除仓库时清空 DO 存储，并删除可能残留的 R2 旧格式数据。重命名只更新 D1；未迁移的仓库在重命名前先按原名称完成迁移。

## 5. 接口

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
- `src/services/git-store/`：SQLite 对象与引用存储、delta、pack 入库与生成、旧格式迁移
- `src/services/git-service.ts`
- `src/services/git-protocol.ts`
- `src/services/git-upload-pack-negotiation.ts`
- `src/services/storage-service.ts`
- `src/routes/git.integration.test.ts`
- `src/routes/git.cli.integration.test.ts`
