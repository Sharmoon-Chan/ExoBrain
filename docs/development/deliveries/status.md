# ExoBrain 优化任务台账

最新更新：2026-10-20。访客体验 UX-01–06 与引用编号修复已以 `6774aee` 推送上线，代码 CI 成功、生产冒烟 20/20，三条真实精选已发布并通过最终浏览器复核。功能链路通过；短答、延迟和语义质量仍未全部达标。发布证据见 [UX-06](../visitor-experience/deliveries/UX-06.md)，真实内容/首答见 [UX-05](../visitor-experience/deliveries/UX-05.md)，下一批见 [UX-07/08 任务书](../visitor-experience/follow-up.md)。下文保留 01–08 与 R1–R5 历史，旧测试数量、端点故障和“未发布”不能替代最新回执。

由主 Agent 维护。子 Agent 交付先进入“待审查”，主 Agent 核对 diff、接口与真实测试证据后才标记“验收通过”。

## 0. 工作环境与起点

| 项目 | 实际值 |
| --- | --- |
| 仓库工作目录 | `D:\Code\Java\JChatMind`（共享目录模式，仅主 Agent 执行 Git 暂存/提交/推送） |
| 分支 | `main`，起始提交 `68f71d3`（文档基线 `212a17c` 之上两笔文档提交） |
| 远程映射 | `exobrain` → `https://github.com/2458438169/ExoBrain.git`（推送目标）；`origin` → 上游 `youngyangyang04/JChatMind`（不推送） |
| 起始未提交修改 | 仅未跟踪目录 `.claude/`、`.idea/`（非本任务产物，保持不提交） |
| JDK | `D:\Soft\Java\jdk-21`（Java 21，PATH 上默认 Java 8 需先覆盖 `JAVA_HOME`） |
| 前端 | Node `v24.18.0`、npm `11.16.0`；`ui/node_modules` 已安装 |
| 评测 Python | `D:\Soft\Python\Anaconda5.3.0\python.exe`（Python 3.7.0，pytest 3.8.0，requests 可用；2026-10-18 离线用例 74 passed） |
| 真实 PostgreSQL | Docker 容器 `exobrain-dev-pg`（`pgvector/pgvector:pg17`，`127.0.0.1:15432`，用户/库 `exobrain`） |
| 真实 Embedding 服务 | `https://emrank.tech/v1/embeddings`，模型 `BAAI/bge-m3`，实际返回 1024 维（探测提交见下） |
| 生产部署 | 本机无可达的线上环境与凭据；生产发布状态按本台账末尾“发布状态”一节据实说明 |

坐标探测记录（主 Agent，2026-10-16）：

- `GET https://emrank.tech/v1/models` → HTTP 200，`BAAI/bge-m3` 在模型目录内；仓库内 `application-dev.yaml` 的 `cloudflare/bge-m3` 已失效（HTTP 404）。
- `POST https://emrank.tech/v1/embeddings`，`model=BAAI/bge-m3` → HTTP 200，`dims=1024`。

## 1. 任务台账

状态取值：待开始 / 执行中 / 待审查 / 返工 / 验收通过 / 受阻。

| 编号 | 负责人 | 工作目录 | 起始提交 | 依赖 | 允许修改文件 | 状态 | 交付提交 | 证据位置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 Markdown 并发隔离 | 子 Agent A1（中断后主 Agent 核验收尾） | 共享目录 | `68f71d3` | 无 | `MarkdownParserServiceImpl.java`、新增解析器测试、`deliveries/01.md` | **验收通过** | `0aa79ed` | `docs/development/deliveries/01.md`（49 测试通过、4 个 Windows 符号链接跳过） |
| 02 检索评测基线 | 子 Agent A2 → 子 Agent A2b（上游中断后重派） | 共享目录 | `68f71d3` | 无（候选对比依赖 03） | `evaluation/**`、`deliveries/02.md` | **验收通过**（基线 + 2026-10-18 补做 body-v1 同条件对比） | `a8fed26`；对比见本批提交 | `evaluation/runs/legacy-title-v1/summary.json`（真实基线 Hit@3 0.850 / Recall@3 0.812 / MRR@3 0.738；`validate.py` 退出 0；pytest 74 passed）；`evaluation/runs/body-v1/`（真实候选 Hit@3 0.600，`comparison.md`、`chunks.csv`、`index-snapshot.json`、`boundary-diagnostic.json`） |
| 03 正文索引与结构化检索 | 子 Agent B1 + 主 Agent 审查 | 共享目录 | `0aa79ed` | 01（已合入）；与 02 共用语料 | `retrieval/**`、`DocumentFacadeServiceImpl`、chunk 实体/mapper、`RagService*`、`KnowledgeTools`、`DemoKnowledgeTool`、`20261017-03-body-index.sql`、`docs/adr/0003-*.md`、`deliveries/03.md` | **验收通过** | `6aac8cd` | `deliveries/03.md`；默认 profile 230/0/0/4、`-Ppostgres-it` 19/19（主 Agent 复跑） |
| 04 可核验引用 | 子 Agent B1（中断后主 Agent 收尾） | 共享目录 | `ecdb738` | 03 协议；前端按契约开发 | `citation/**`、`JChatMind.java`、`DirectAnswerTool`、`ChatMessageDTO`、`DemoCatalogService`、`AgentChatHistory.tsx`、`DocumentPreviewDrawer.tsx`、`ui/src/types`、`ui/src/api`、`docs/adr/0004-*.md`、`deliveries/04.md` | **验收通过**（2026-10-18 补做真实浏览器交互验收：引用按行定位、执行时间线、SSE 断线刷新通过；390px 发现布局缺陷，见 `deliveries/browser-acceptance.md`） | 见下一提交 | `deliveries/04.md`（230 单测 + 19 集成 + lint + 两套构建）；`deliveries/browser-acceptance.md` |
| 05 执行追踪 | 子 Agent C1 | 共享目录 | `a6921dc` | 04（已合入） | `execution/**`、run/event mapper/DTO/service、`20261017-05-runs.sql`、`docs/adr/0005-*.md`、`deliveries/05.md` | **验收通过** | `39108e4` | `deliveries/05.md`；单元 265（当时）、集成 38/38、端到端含 `runId` 与事件 |
| 06 持久化文档导入 | 子 Agent C2 | 共享目录 | `a6921dc` | 03（已合入） | `ingestion/**`、`DocumentFacadeServiceImpl`、`20261017-06-ingestion.sql`、导入状态 UI、`deliveries/06.md` | **验收通过** | `09814f3` | `deliveries/06.md`；单元 265、集成 38/38（含 14 项故障注入）、端到端上传返回 jobId 后 `SUCCEEDED` |
| 07 持久化对话任务 | 子 Agent（上游配额耗尽中断）→ 主 Agent 收尾 | 共享目录 | `39108e4` | 05（已合入）；参考 06 | `runs/**`、`20261017-07-durable-runs.sql`、提交/入队路径、`CreateChatMessageRequest/Response`、`DemoChatService`/`DemoController`、`docs/adr/0007-*.md`、`deliveries/07.md` | **验收通过**：单元 269、集成 51/51（含 13 项队列故障/重启场景）、端到端 40/40 + 19/19；2026-10-18 补做**双实例 + 并发 HTTP + 真实 kill 演练**（同会话并发 200/409、幂等重放同 `runId`、崩溃后 `INTERRUPTED` 不重放；默认租约下 3/3 冒烟通过） | `1f4d776c` 之后本批提交 | `docs/development/deliveries/07.md`、`deliveries/durable-runs-drill.md` |
| 08 CI、工程文档与集成 | 子 Agent A3（中断）→ 子 Agent A3b | 共享目录 | `68f71d3` | 基础部分独立；验收随批 | `.github/**`、`pom.xml`、`scripts/**`、`README.md`、`docs/architecture.md`、`docs/adr/**`、`docs/provenance.md`、`deliveries/08.md` | **验收通过**（文档中的“待实现”标注在 03 合入后由主 Agent 修正） | `ecdb738` | `deliveries/08.md`；`-Punit` 165 / `-Ppostgres-it` 6（隔离副本），复跑后 230 / 19 |

共享文件所有权（本轮实际约定）：

- `jchatmind/pom.xml`、`ui/package.json`、锁文件：仅 08 修改，其他任务通过主 Agent 申请小补丁。
- 根 `README.md`、`deploy/README.md`、`deploy/nginx.conf`：08 起草，主 Agent 最终定稿。
- `docs/development/deliveries/status.md`：仅主 Agent 维护。
- `MarkdownParserService*`：01 → 03 串行接续。
- `DocumentFacadeServiceImpl`、chunk 实体/mapper：03 → 06 串行接续。
- `JChatMind.java`、消息 metadata：04 → 05 → 07 串行接续。
- 新增数据库迁移：按任务编号各自负责，执行顺序由主 Agent 在 08 文档中固化。

## 2. 波次与调度记录

| 波次 | 分派 | 实际并发 | 备注 |
| --- | --- | --- | --- |
| A | 01、02、08 基础并行；主 Agent 核实基线、准备真实 PostgreSQL 与 Embedding 坐标 | 子 Agent 3 + 主 Agent | 共享目录，文件所有权已在上表固定 |
| B | 03 正文索引（依赖已合入的 01）、08 剩余部分（CI + 工程文档）；02 收尾（数据集/测试/真实基线） | 子 Agent 3 + 主 Agent | 2026-10-17 18:20 前后分派 |
| C | 04 可核验引用（消费 03 的契约） | 子 Agent + 主 Agent | 03 冻结协议后分派；04 会话中断后由主 Agent 补齐 ADR、交付记录与实测 |
| D | 05 执行追踪 + 06 持久化导入并行；第一阶段端到端验收（独立构建） | 子 Agent 2 + 主 Agent | 第一阶段是检查点：03/04 合入并提交后用 `git archive` 独立构建跑真实验收 |
| E | 07 持久化对话任务（依赖 05，参考 06 的租约模式） | 子 Agent + 主 Agent | 07 子 Agent 因上游配额耗尽中断，主 Agent 接手核验正常路径、补 ADR/交付记录 |
| F | 统一回归（单元/集成/前端/端到端）、README 与部署文档校正、推送 `exobrain` | 主 Agent | 见第 3、4 节；生产部署未执行 |

> 说明：波次 A 的三个子 Agent 均被上游模型服务中断（403），其中 02 由新会话接手收尾；01 与 08 的已完成代码由主 Agent 亲自复核（`.\mvnw.cmd -o test "-Dtest=MarkdownParser*Test,Document*Test,RagServiceImplTest"` → 49 通过 / 4 跳过；`.\mvnw.cmd -o test -Ppostgres-it` 对真实 PostgreSQL 17.11 → 6 通过 / 0 跳过），01 已提交为 `0aa79ed`。

## 3. 发布状态

- 代码推送：**已完成**。`exobrain`（https://github.com/2458438169/ExoBrain.git）的 `main` 从 `68f71d3` 快进到 `85e68b1`（第一批 16 个提交：01–07、08、验收材料与 07 的队列测试）；随后补做 02 候选对比、浏览器验收、07 多实例/并发/真实 kill 演练，再追加 `a6bc0ae`、`34a5d28`、`c06ecfe` 与本行所在提交。未推送上游 `origin`，未强推，未覆盖他人提交；推送需经本机系统代理（`127.0.0.1:7897`）访问 github.com。按用户选择，本轮推送**接受触发一次 GitHub Actions CI**。
- 生产部署：**已执行（2026-10-18，Asia/Shanghai）**。
  - 镜像 `exobrain:20261018-durable-runs`（JAR 62,928,190 字节，`FROM exobrain:20261014` + 覆盖 app.jar），容器 healthy。
  - 迁移按 03 → 05 → 06 → 07 顺序应用并补齐应用角色 GRANT（新增 6 张表：`exobrain_index_revision`、`exobrain_kb_index_state`、`exobrain_run`、`exobrain_run_event`、`exobrain_ingestion_job`、`exobrain_chat_run_job`）。
  - 前端切换到 `releases/20261018-durable-runs`（`ui/` 游客版 + `admin/` 账号版），`current` 符号链接已切换。
  - 网关：生产 `nginx.conf` 的 demo 白名单加入 `chat-sessions/<uuid>/runs`、`runs/<uuid>`、`documents/<uuid>/ingestion`，`nginx -t` 通过后 `systemctl reload nginx`。
  - 备份：`backups/pre-durable-runs-20261018-134926/`（db.sql.gz、documents.tar.gz、secrets、旧 release、nginx.conf、compose.yaml）。
  - 验证：应用与数据库 healthy、启动后无 ERROR 日志；首页 200、`/admin/` 200、游客 agents/knowledge-bases 200、公开文档预览 200（`03_java_backend_faq.md`，2615 字符）、未知 demo 路径 404（fail-closed 仍在）、`/api/runs/*` 与 `/api/chat-sessions/*/runs` 无会话 401；数据行数保持 2 KB / 3 文档 / 18 chunk / 10 会话 / 62 消息 / 2 账号不变。
  - 回滚：`ln -sfn releases/20261016-kb-privacy current` 并把 compose 的 image 改回 `exobrain:20261016-kb-privacy` 后 `docker compose up -d app`；迁移为增量、旧代码可读旧列，不要回删表。<br>说明：本次发布在 07 的队列测试补齐之后执行；`docs/adr/0007` 与 `deliveries/07.md` 记录的未验证项（多实例、真实 JVM 重启演练、浏览器交互）仍然有效。

## 4. 第一阶段验收（已完成）

- 记录：`docs/development/deliveries/acceptance-phase1.md`（含阶段一与 05/06/07 之后的两次真实复跑）
- 被测提交：第一阶段 `a6921dc`（38/38 + 18/18）；加入 05/06 后 `dd19818`（40/40 + 19/19）；加入 07 后同一脚本再次复跑（40/40 + 19/19，队列与运行记录均为 `SUCCEEDED`）。每次都用 `git archive` 导出后独立构建的 jar 运行，不是共享工作目录里的进行中改动。
- 真实环境：PostgreSQL 17.11 + pgvector 0.8.7、真实 Embedding `BAAI/bge-m3`（1024 维）、真实对话模型（DeepSeek-V4-Flash-0731）。
- 结果：账号/管理员矩阵 40/40、游客路径 19/19，应用日志 0 条 ERROR；正文事实命中并给出可复核的行号引用（48-73 / 43-64，`indexVersion = body-v1`）；上传返回 jobId 后任务 `SUCCEEDED`（6/6 chunks）；`exobrain_chat_run_job` 与 `exobrain_run` 均有 `SUCCEEDED` 记录。
- 同一提交的自动化检查：后端默认 profile 269 通过 / 4 跳过、真实 PostgreSQL 集成 51/51（含 07 的 13 项队列场景）、评测 `validate.py` 退出 0 与 `pytest 74 passed`、前端 lint 与两套构建通过。
- 2026-10-18 补做（三项原「未执行」）：
  - 02 的 body-v1 同条件对比（隔离库 `exobrain_eval02`，产品切块 + 真实 Embedding；见 `deliveries/02.md` 第 12 节）。冻结判据下 Hit@3 0.600 < 基线 0.850，但 17/44 个证据单元只差「标题行」边界（诊断口径 43/44 单元、40/40 题），判据与题集均未修改。
  - 真实浏览器交互验收（引用按行定位 7–9 行、执行时间线 9 事件、SSE 断线刷新后只有一条回答；390px 发现引用卡片无宽度约束导致横向滚动的缺陷，未改代码）。见 `deliveries/browser-acceptance.md`。
  - 07 的双实例 + 并发 HTTP + 真实 kill 演练（同会话并发 200/409 且只 1 个运行、幂等键三次同 `runId`、`kill -9` 后 22.1 s 标记 `INTERRUPTED` 且不重放、默认租约下 3/3 冒烟通过；另记录 20 s 租约低于模型时延的自我中断限制）。见 `deliveries/durable-runs-drill.md`。
- 仍未执行：多主机部署、网络分区/时钟漂移、CI 在 GitHub 上的实际执行。

## 5. 独立验收（2026-10-19，提交 `65b1237`）与整改

外部独立验收判定**暂不通过**，列出 6 项；本轮已全部改动源码（**未提交**，除 `.gitattributes` 已入暂存区）：

| 编号 | 级别 | 处理 | 验证 |
| --- | --- | --- | --- |
| F01 迟到答案 | P1 | 新增 `RunResultWriter`（锁任务行 + fencing + RUNNING 校验，消息与 `answer_message_id` 同事务）+ 租约独立心跳 | 新增 `RunResultGuardIntegrationTest` 5 项全过 |
| F02 前端未传幂等键 | P1 | `AgentChatView` 每个发送意图一个稳定键，重试/重连复用 | 真实 Chromium 丢弃响应后重试：2 次提交 / 1 个运行 / 1 条用户消息 / `attempts=1` |
| F03 同键并发 409 | P2 | `replayAfterConflict` 参数顺序改为 `(scope, session, key)` | 集成测试断言同键取回原 `runId`、异内容仍冲突 |
| F04 无答复运行不可见 | P2 | 按 `triggeringMessageId` 展示终态/错误码/耗时；活动运行 5 s 轮询 | 真实取消与真实中断会话均可见 |
| F05 冻结资产哈希漂移 | P2 | `.gitattributes` 对 corpus/datasets/public-demo 固定 `eol=lf` | `core.autocrlf=true` 检出后 `validate.py` 退出 0、`pytest 74 passed` |
| F06 390px 引用溢出 | P2 | 引用卡片 `min-w-0 max-w-full overflow-hidden`、文件名 `break-all`、标题 `break-words`、正文 `break-words [&_a]:break-all` | 390px 与 320px：消息列 `scrollWidth == clientWidth`，无元素超宽 |

复跑结果：单元 269（265 通过 / 4 跳过 / 0 失败）；真实 PostgreSQL 56（**55 通过 / 0 失败 / 1 错误**，错误项为
`RetrievalIndexIntegrationTest.realEmbeddingAnswersBodyOnlyFacts`，外部 Embedding 端点返回 `HTTP 503
completion_backlog`，`curl` 可直接复现，非代码缺陷）；前端 lint 与构建通过。

- 仍未完成：F01 的真实 HTTP 注入延迟复现脚本、真实付费模型对比、GitHub Actions 远端执行。
- 工作区另有未提交的界面主题改动（15 个文件）和 `ui/preview.html`（他人未跟踪文件），本轮未改其内容。

## 6. 第二轮独立验收（2026-10-19，R2）与修复

第二轮验收结论：**F03–F06 通过、F01 迟到写入已挡住**，新增 1 个 P1 + 3 个 P2。本轮全部处理完毕（仍未提交）：

| 编号 | 级别 | 问题 | 修复 |
| --- | --- | --- | --- |
| R2-01 | P1 | 首条消息手动重试后，SSE 重连换新键重发 | 任何一次确认受理都清空 `initialMessage`、置 `initialSent=true`；失败只回退标记 |
| R2-02 | P2 | 终态重放后界面停在“生成中”、输入禁用 | 新增 `settleSubmission`：消费 `runStatus`/`idempotentReplay`，终态恢复输入 |
| R2-03 | P2 | 取消跨心跳周期被误记为重启中断 | 心跳/检查点区分取消 / 被锁挡住 / 真丢失；过期扫描对 `cancel_requested` 写 `CANCELLED` |
| R2-04 | P2 | 一个任务的行锁堵死唯一心跳线程 | 每租约独立单线程调度器 + 独立连接 + `SET LOCAL lock_timeout` |

验证：单元 269（265 通过 / 4 跳过 / 0 失败）；真实 PostgreSQL **58（57 通过 / 0 失败 / 1 错误**，仍是外部
Embedding 端点 503，非代码问题）；`RunResultGuardIntegrationTest` 现 **7 项全过**（新增取消跨心跳周期、
行锁隔离两项）；前端 lint 与构建通过；真实浏览器复现「丢响应 → 手动重试同键 → 杀后端触发 SSE 重连」后
提交仍只有 2 次、1 个键，DB 1 运行 / 1 用户消息，输入框恢复可用。
- 仍未完成：真实付费模型对比（Embedding 端点 503）、GitHub Actions 远端执行。

## 7. 生产热修（2026-10-19，模型改名 + 知识库换绑）

中转站把 `cloudflare/bge-m3` 改名为 `BAAI/bge-m3`。旧模型被 2 个知识库绑着，按设计不允许原地改模型名
（会静默改变向量空间），而当时没有「把知识库换到新模型」的手段，所以换不上。

- 代码：`de6638a` 新增 `GET /api/admin/model-bindings` 与 `POST /api/admin/models/{id}/knowledge-bases`
  （必须显式 `vectorSpaceUnchanged=true`；LLM 目标、停用模型、未确认一律拒绝）。同一批还带上了
  `43a5204`（运行结果 fencing + 心跳隔离）与 `999a133`（冻结资产固定 LF）。
- 镜像：`exobrain:20261019-model-rebind`（JAR 62,942,144 字节，sha256 `764cfeea…`，`FROM exobrain:20261014` 覆盖 app.jar）。
  `compose.yaml` 的 `app.image` 已改到该镜像，容器 healthy，启动后 0 条 ERROR。
- 备份：`backups/pre-model-rebind-20261019-134814/`（旧 `compose.yaml`、`exobrain_model.csv`、`exobrain_kb_embedding.csv`）。
- 数据变更（经新增接口执行，非手写 SQL）：
  - `bge-m3` 的 `provider_model`：`BAAI/bge-m31`（录入时多了一个 `1`）→ `BAAI/bge-m3`。
  - 两个知识库（`ExoBrain 公开演示知识库`、`test`）从 `legacy-embedding` 换绑到 `bge-m3`，`rebound=2`。
  - `legacy-embedding` 保留未删（已无绑定，可随时删除）。
- 只上了后端：前端仍为 `releases/20261018-durable-runs`；工作区里的界面改动（主题、390px 修复、知识库列表排版、
  迁移按钮）**未提交、未发布**。
- **未能验证**：模型连通性测试连续 5 次失败，原因是中转站 `/v1/embeddings` 返回 `503 completion_backlog`
  （服务端 `curl` 用同一 Key 复现，**新旧两个模型名都 503**），不是配置或命名问题。同一原因导致用户在 13:19
  上传的 `TEST.MD` 导入 3/3 失败（`EMBEDDING_UNAVAILABLE`），需在中转站恢复后重试导入。
- 回滚：`sed -i 's#exobrain:20261019-model-rebind#exobrain:20261018-durable-runs#' compose.yaml && docker compose up -d app`；
  数据回滚用备份里的两个 CSV（换绑前的绑定关系）。

## 8. 第三轮独立验收（2026-10-19，R3）与修复

第三轮验收结论：**R2-01～R2-04 四项均通过**，新增 1 个 P2。本轮已修复（源码在工作区，待提交）：

| 编号 | 级别 | 问题 | 修复 |
| --- | --- | --- | --- |
| R3-01 | P2 | `checkpoint()` 遇 `BLOCKED` 直接放行；行锁等待跨过租约期限后，模型重试继续发请求（两次复现超出期限 2.608711 s / 2.606319 s，无迟到答案落库） | `checkpoint()` 在 `BLOCKED` 后按预算（租约 1/3，≤5 s）重试续租；预算耗尽改用不加锁 `findById` 确认：非 `RUNNING` / fencing 前进 / 租约过期 / 读不到 → `RunLeaseLostException`，`cancel_requested` → `RunCancelledException`，仅确认有效才放行 |

验证：`RunResultGuardIntegrationTest` **7 → 10 项全过**（新增“锁等待中租约到期即停止”“无法确认即停止且不续租”
“确认仍有效才放行”三条，均为真实 PostgreSQL）；单元 `-Punit` **271（267 通过 / 4 跳过 / 0 失败）**；
真实 PostgreSQL `-Ppostgres-it` **61 项，60 通过 / 0 失败 / 1 环境性错误**（仍是外部 Embedding 端点
`503 completion_backlog`，本轮该用例实际执行而非跳过）。

- 仍未完成：真实付费模型 / Embedding 对比（端点 503）、GitHub Actions 远端执行、验收方 R3 的 HTTP 故障注入脚本重跑。
- 前端 20 个文件（含主题与他人改动）仍未提交，按用户要求先不提交。

## 9. 生产：接入 SiliconFlow 向量模型（2026-10-19）

中转站 `emrank.tech` 的 `/v1/embeddings` 持续 `503 completion_backlog`（本轮再探仍是 503），用户新增了
SiliconFlow 的 `BAAI/bge-m3`。新条目当时是**按语言模型（LLM）登记的**，并且被设成了默认语言模型：
`kind=LLM`、`dimensions=NULL`，`default_model=true`。这有两个后果：向量入口根本不走它（`embed()` 只接受
`EMBEDDING`），同时默认语言模型指向了一个向量模型。两步修正：

- **类型不能改**：`ModelCatalogService.update` 明确拒绝修改已有模型的 `kind`；API Key 的 AES-GCM AAD 就是
  model id，所以按**同一 id** 删除 + 重建（沿用密文，无需明文）：`EMBEDDING` / `openai` /
  `https://api.siliconflow.cn/v1` / `BAAI/bge-m3` / `dimensions=1024` / 启用 / 非默认。同一事务里把默认
  语言模型还给 `deepseek-chat`。
- **设为默认向量模型**（`PATCH /api/admin/models/siliconflow-bge-m3 {"defaultModel":true}`）：新建知识库
  将绑定它。`ExoBrain 公开演示知识库` 仍绑 `bge-m3`（18 个既有向量来自中转站，不动）。
- **`test` 知识库换绑**（`POST /api/admin/models/siliconflow-bge-m3/knowledge-bases`，
  `vectorSpaceUnchanged=true`，`rebound=1`）：该库 0 chunk，不存在向量漂移。

验证（全部为生产真实调用）：

| 检查 | 结果 |
| --- | --- |
| `POST /api/admin/models/siliconflow-bge-m3/test`（管理员会话 + CSRF） | 200，`向量模型连接正常`，273 ms，`dimensions=1024` |
| 同一接口测 `bge-m3`（对照，中转站） | 200 但 `success=false`，`向量服务暂不可用`（914 ms） |
| `POST /api/documents/{id}/ingestion/retry`（document owner = demo，管理员身份 404 说明归属校验生效） | 2026-10-19 06:24:18Z 排队 → 06:24:20Z `SUCCEEDED`，attempts=1，`TEST.MD` 落 1 chunk / 1024 维，`index_version=body-v1`，活动 revision `cb5e9496-…` |
| 真实运行（新建一次性助手只挂 `test`，提问后跟踪 `exobrain_run`） | `SUCCEEDED`，8.66 s/2404 tokens；事件 `MODEL_CALL → TOOL_CALL(KnowledgeTool) → RETRIEVAL(OK) → MODEL_CALL → PERSIST_MESSAGE`；答复引用 `TEST.MD` 第 1 行、`excerpt="111"`、`indexRevision=cb5e9496-…` |

- 备份：`backups/pre-siliconflow-20261019-142138/`（`exobrain_model.csv`、`exobrain_kb_embedding.csv`、`agent.csv`）。
- 回滚：把三张 CSV 的对应行写回（`siliconflow-bge-m3` 恢复为 LLM 行 / `bge-m3` 恢复默认 /
  `test` 换回 `bge-m3`），`TEST.MD` 的 1 个 chunk 可删或重新导入。
- 验证用的临时助手与会话已删除（3 个助手、2 个会话），生产仍是 2 个助手、2 个知识库。
- **顺带发现（未改代码）**：`POST /api/agents` 缺 `chatOptions` 返回 500（`IllegalArgumentException:
  Chat options cannot be null`），`POST /api/chat-messages` 传 `role: "USER"` 这类大小写错误也返回 500
  （`HttpMessageNotReadableException` 无人处理）。两处都应该是 400。

## 10. 第四轮独立验收（2026-10-19，R4）与修复

第四轮验收结论：**R3-01 原始复现已通过**（两次复跑都只有 1 次模型请求、过期后 0 次），新增 1 个 P2。本轮已修复：

| 编号 | 级别 | 问题 | 修复 |
| --- | --- | --- | --- |
| R4-01 | P2 | 无锁确认通过后仍调用同步 `touch()`（摘要心跳 UPDATE 无 `lock_timeout`），行锁一挡就跨过租约期限，返回后不复查直接放行（两次实测超出 9.114683 s / 9.088870 s，无迟到答案落库） | 新增 `RunRepository.touchWithin`（独立连接 + `SET LOCAL lock_timeout`，被挡返回 0）；检查点改为“无锁确认 → 有界摘要写 → 再确认 → 放行”，最终确认后不再有任何阻塞写；心跳线程的摘要刷新也改为有界 |

验证：`RunResultGuardIntegrationTest` **10 → 12 项全过**（新增“摘要心跳被行锁挡住时按预算放弃”“摘要心跳把租约拖过期后检查点必须停止”两条，均为真实 PostgreSQL）；
单元 `-Punit` **271（267 通过 / 4 跳过 / 0 失败）**；真实 PostgreSQL `-Ppostgres-it` **63 项，62 通过 / 0 失败 / 1 环境性错误**
（仍是 `RetrievalIndexIntegrationTest.realEmbeddingAnswersBodyOnlyFacts` 撞中转站 503；生产已切 SiliconFlow，测试配置项未改）。

- 仍未完成：验收方 R4 的 HTTP 故障注入脚本重跑、真实付费模型效果对比、GitHub Actions 远端执行。
- 前端 20 个文件仍未提交，按用户要求先不提交。

## 11. 生产发布（2026-11-03，提交 `6b04814`）

**为什么发**：游客反馈「你是谁」返回 `INVALID_ANSWER_FORMAT`。定位为线上镜像
`exobrain:20261020-ux-6774aee` 仍用旧协议与旧提示词，模型在正文里写了超出自己
`citationIds` 列表的编号，服务端按设计拒绝整轮（`AnswerCitationFormatter.relabel`：
`Model answer references a source that could not be verified`）。

**发布内容**：

| 项 | 值 |
| --- | --- |
| 代码 | `6b04814`（含 10-28 起的编号契约统一、输入投影修复、grounded-v1、429 诊断、可取消的节流等待） |
| 后端镜像 | `exobrain:20261103-6b04814`（`FROM exobrain:20261020-ux-6774aee` + 覆盖 app.jar，JAR 62,984,060 字节） |
| 前端 | 同日从同一提交重建 `dist-public` + `dist-admin`，发布为 `releases/20261103-6b04814b`（`current` 已切到它）；`nginx -t` + reload 通过，静态资源 200 |
| 数据库 | 无 schema 迁移 |
| 助手提示词 | 换成统一编号契约版本（`[n]` = `citationIds` 第 n 项），语料日期按线上 10-19 版；写入前后 md5 校验一致 |
| compose | `image` 指向新镜像；新增 `extra_hosts: happycoding.xyz:163.181.78.207`（该中转域名 8 个 IP 中 2 个从本机不可达，Java 客户端不换 IP 重试，会卡满 10 s 连接超时） |

**验证（发布后，游客会话真实请求）**：

| 问题 | 结果 |
| --- | --- |
| 你是谁 | SUCCEEDED 6123 ms，552 字，3 条引用（01 L9-15 / L19-23 / L33-36） |
| 这个项目能做什么？ | SUCCEEDED 12188 ms，640 字，3 条引用（01 L3-5、03 L3-5、03 L22-31） |
| 网络慢时重复点击发送会怎么样？ | SUCCEEDED 7253 ms，747 字，2 条引用（02 L8-22、03 L44-48） |
| 引用里的编号怎么对应来源？ | SUCCEEDED 7669 ms，529 字，3 条引用（03 L22-31、01 L27-29、01 L9-15） |

入口 `/`、`/admin/`、`/health` 均 200；发布后 12 次运行全部 `SUCCEEDED`，应用日志 0 条新增
ERROR，无守卫拒绝、无模型 HTTP 失败；新代码的 `model input projection` 行已出现在日志中。

**回滚**：`/root/backups/exobrain-20261103-155404/`（compose、密钥配置、nginx 全量 dump、
`current` 指向、容器旧镜像 id、`pg_dump` 全库）。步骤：把 `compose.yaml` 的 `image` 改回
`exobrain:20261020-ux-6774aee` 并去掉 `extra_hosts`，`docker compose up -d app`；
提示词从备份恢复后再 `update agent set system_prompt = …`。

**仍未做**：默认消息窗口仍为 16；管理端登录未验证（`bootstrap-admin-password` 与实际口令可能已不一致）；
精选对话更新未做。

**更正**：本节初稿写的「前端未重建」是错的。10-28 之后 `ui/src` 有 UX-03/04/07/08 的界面改动与
引用卡片改版，发布当天已从 `6b04814` 重建并上线（`releases/20261103-6b04814b`），并用内置浏览器
实测端到端：推荐问题 → 带 3 条引用的回答 → 执行过程 已完成 13.9 s。

## 12. 失败提示改造（2026-11-03，提交 `ef7e531`，release `20261103-ef7e531`）

**为什么改**：运行失败时界面只给出一个红色「失败」和英文错误原文（如 `Failed to fetch`）。
访客（包括 HR）看到的是「系统报错了」，而不是「这次没成，你可以这样办」。

**改法**：

| 位置 | 改动 |
| --- | --- |
| `AgentChatHistory.failureText` | 按错误分类给「发生了什么 + 下一步」：内容核对未通过、模型无返回、检索不可用、登录失效、落库失败、未产出答复、已取消、已中断、兜底超时；未知分类只描述现象不猜原因 |
| 状态措辞 | `RUN_STATUS_LABELS.FAILED` 由「失败」改「未完成」，配色由红改琥珀 |
| 卡片 | 标题「这次没有拿到回答」，正文是下一步建议；可重试的场景给「重新提问」按钮，直接重发同一问题 |
| 错误码 | 只在展开「执行过程」后显示「错误分类 CODE · 中文」，正文不出现英文枚举 |
| `http.ts` `humanizeError` | 网络与 HTTP 失败翻成中文建议（`Failed to fetch` → 网络连接不稳定、请重试；5xx → 服务临时出错）；判断不出可读信息时用调用方的兜底文案，不原样抛出 |
| `AgentChatView` | 终态提示不再与卡片重复同一句话 |

**验证**：

- `npx tsc --noEmit`、`npm run lint`、`dist-public` / `dist-admin` 两套构建通过；产物中确认含新文案。
- 生产实测（内置浏览器，`releases/20261103-ef7e531`）：提问后点「停止」→ 卡片显示
  「这次没有拿到回答 / 已取消 / 耗时 5.1 s / 需要的话点下面的按钮重新提问。」+「重新提问」按钮，
  底部提示只有一句「本次已取消。」不再重复；无「失败」字样、无英文错误码。
- 点「重新提问」重发同一问题 → `SUCCEEDED` 11.0 s，「已完成」+ 2 条引用，来源卡片与执行过程未回归，
  控制台 0 条报错。
- `/`、`/admin/`、新老静态资源均 200；`nginx -t` 通过后 reload。

**回滚**：`ln -sfn releases/20261103-6b04814b current`（后端镜像与数据库本次未变）。
