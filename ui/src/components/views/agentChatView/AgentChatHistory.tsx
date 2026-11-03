import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Bubble } from "@ant-design/x";
import XMarkdown from "@ant-design/x-markdown";
import {
  DownOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  RobotOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import type {
  AnswerCitation,
  ChatMessageVO,
  SseMessageType,
  ToolCall,
  ToolResponse,
} from "../../../types";
import DocumentPreviewDrawer from "../../modals/DocumentPreviewDrawer.tsx";
import { buildTurns, isReadableAnswer } from "./chatTurns.ts";
import { getRun, listSessionRuns } from "../../../api/execution.ts";
import type {
  RunEventType,
  RunEventView,
  RunStatus,
  RunSummaryView,
  ChatMessageMetadataWithRun,
} from "../../../types/execution.ts";

interface AgentChatHistoryProps {
  messages: ChatMessageVO[];
  /** 会话标识：用于按需读取服务端运行记录；缺省（例如公开精选）时不显示执行详情。 */
  sessionId?: string;
  refreshVersion?: number;
  waitStartedAt?: number | null;
  autoScroll?: boolean;
  displayAgentStatus?: boolean;
  agentStatusText?: string;
  agentStatusType?: SseMessageType;
  /** 相关追问：只有点击才发起新的运行，不随答案自动提交。 */
  onAskFollowUp?: (content: string) => void | Promise<boolean>;
  followUpPrompts?: readonly string[];
  /** 当前是否已有一轮在等待答复；等待期间追问不可点。 */
  busy?: boolean;
  /** 取消请求已登记但终态未确认时的活动状态文字。 */
  cancelling?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  KnowledgeTool: "知识库检索",
  getDate: "日期查询",
  directAnswer: "生成回答",
  terminate: "结束任务",
};

/** 超过这个字符数的回答默认折叠，保留完整 Markdown，只是把容器高度收起来。 */
const LONG_ANSWER_THRESHOLD = 1200;
/** 判定「用户还在跟随本轮」的底部容差。 */
const FOLLOW_THRESHOLD = 24;

function formatToolData(value: string | null | undefined): string {
  if (!value) return "无内容";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function messageRunId(message: ChatMessageVO | undefined): string | undefined {
  const metadata = message?.metadata as ChatMessageMetadataWithRun | undefined;
  return metadata?.runId ?? undefined;
}

function citationKey(citation: AnswerCitation, index: number): string {
  return `${citation.label}:${citation.citationId ?? citation.source.documentId}:${index}`;
}

function citationHeading(citation: AnswerCitation): string {
  const headingPath = citation.source.headingPath ?? [];
  return headingPath.filter(Boolean).join(" › ");
}

function citationPosition(citation: AnswerCitation): string {
  const { startLine, endLine } = citation.source;
  return startLine != null && endLine != null ? `第 ${startLine}–${endLine} 行` : "整份文档（无精确位置）";
}

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  // 面向访客用「未完成」：失败已经由下面的说明与重试按钮承接，不再用刺眼的「失败」当标题。
  FAILED: "未完成",
  CANCELLED: "已取消",
  INTERRUPTED: "已中断",
};

const RUN_STATUS_CLASSES: Record<RunStatus, string> = {
  QUEUED: "text-slate-500",
  RUNNING: "text-sky-700",
  SUCCEEDED: "text-teal-700",
  FAILED: "text-amber-700",
  CANCELLED: "text-amber-700",
  INTERRUPTED: "text-amber-700",
};

const RUN_EVENT_LABELS: Record<RunEventType, string> = {
  MODEL_CALL: "模型调用",
  MODEL_RETRY: "模型重试",
  TOOL_CALL: "工具调用",
  RETRIEVAL: "知识库检索",
  PERSIST_MESSAGE: "消息落库",
  STEP_LIMIT: "达到步数上限",
  ERROR: "执行错误",
};

/**
 * 错误码只在「查看过程」里作为技术细节出现，正文里不出现英文枚举。
 * 每个失败场景给一句人话说明 + 一句下一步建议，避免看起来像系统崩了。
 */
const RUN_ERROR_LABELS: Record<string, string> = {
  AUTHORIZATION_REVOKED: "登录状态失效",
  MODEL_UNAVAILABLE: "模型服务未响应（已自动重试）",
  MODEL_CALL_FAILED: "模型服务连接失败",
  UPSTREAM_BUSY: "模型服务繁忙",
  TOOL_FAILED: "工具执行失败",
  RETRIEVAL_UNAVAILABLE: "知识库检索不可用",
  RETRIEVAL_DENIED: "知识库检索被拒绝",
  MESSAGE_PERSISTENCE_FAILED: "答复保存失败",
  NO_ANSWER_PRODUCED: "未产出答复",
  INVALID_ANSWER_FORMAT: "答复未通过内容核对",
  EXECUTION_FAILED: "执行中断",
};

interface FailureText {
  /** 一句话说明发生了什么，不暴露内部枚举。 */
  title: string;
  /** 下一步该怎么做。 */
  hint: string;
  /** 是否值得让访客直接重试同一问题。 */
  retryable: boolean;
}

/** 按错误分类给出面向访客的说明；未知分类只描述现象，不猜测原因。 */
function failureText(errorCode: string | null | undefined, status: RunStatus): FailureText {
  switch (errorCode) {
    case "INVALID_ANSWER_FORMAT":
      return {
        title: "这次的回答没能通过自动核对，所以没有展示",
        hint: "回答里的引用编号和检索到的来源对不上时，系统会拦下整轮内容，避免给你看未经核实的出处。重新提问一次通常就正常。",
        retryable: true,
      };
    case "MODEL_UNAVAILABLE":
    case "MODEL_CALL_FAILED":
    case "UPSTREAM_BUSY":
      return {
        title: "模型服务这次没有返回结果",
        hint: "通常是服务商临时繁忙；系统已自动重试仍未成功。稍等几秒再问一次即可。",
        retryable: true,
      };
    case "RETRIEVAL_UNAVAILABLE":
    case "RETRIEVAL_DENIED":
      return {
        title: "这次没能检索到知识库内容",
        hint: "可以换个说法再问，或稍后再试一次。",
        retryable: true,
      };
    case "AUTHORIZATION_REVOKED":
      return {
        title: "登录状态已失效，这次没有继续执行",
        hint: "重新登录后再提问即可；知识库与历史记录都不受影响。",
        retryable: false,
      };
    case "MESSAGE_PERSISTENCE_FAILED":
      return {
        title: "回答已经生成，但没能保存下来",
        hint: "重新提问即可；如果反复出现，可以在「查看过程」里展开错误详情反馈。",
        retryable: true,
      };
    case "NO_ANSWER_PRODUCED":
      return {
        title: "这次没有产出可展示的回答",
        hint: "重新提问一次即可。",
        retryable: true,
      };
    default:
      if (status === "CANCELLED") {
        return { title: "这次运行在给出回答前被取消了", hint: "需要的话点下面的按钮重新提问。", retryable: true };
      }
      if (status === "INTERRUPTED") {
        return {
          title: "服务重启打断了这次运行，所以没有回答",
          hint: "系统不会自动重放已中断的请求，重新提问即可。",
          retryable: true,
        };
      }
      return {
        title: "这次没能在限定时间内给出回答",
        hint: "可能是网络或服务临时波动。重新提问即可；连续出现可在「查看过程」里展开错误详情反馈。",
        retryable: true,
      };
  }
}

/** 只格式化服务端记录的耗时；未知就是「未记录」，不用浏览器计时补齐。 */
function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "未记录";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatUsage(run: RunSummaryView): string | null {
  if (run.inputTokens == null && run.outputTokens == null && run.totalTokens == null) return null;
  const input = run.inputTokens == null ? "未提供" : String(run.inputTokens);
  const output = run.outputTokens == null ? "未提供" : String(run.outputTokens);
  const total = run.totalTokens == null ? null : String(run.totalTokens);
  return `用量 ${input} / ${output}${total ? `（共 ${total}）` : ""} tokens`;
}

function runEventDetail(event: RunEventView): string {
  if (event.type === "TOOL_CALL") {
    const name = event.toolName ? ` · ${event.toolName}` : "";
    const id = event.toolCallId ? ` · ${event.toolCallId}` : "";
    return `工具调用${name}${id}`;
  }
  if (event.type === "RETRIEVAL") {
    const state = event.detail ? ` · ${event.detail}` : "";
    const id = event.retrievalId ? ` · ${event.retrievalId}` : "";
    return `知识库检索${state}${id}`;
  }
  if (event.type === "MODEL_CALL" || event.type === "MODEL_RETRY") {
    return event.retryAttempt && event.retryAttempt > 1
      ? `${RUN_EVENT_LABELS[event.type]} · 第 ${event.retryAttempt} 次尝试`
      : RUN_EVENT_LABELS[event.type];
  }
  if (event.errorCode) return `${RUN_EVENT_LABELS[event.type]} · ${RUN_ERROR_LABELS[event.errorCode] ?? event.errorCode}`;
  return RUN_EVENT_LABELS[event.type];
}

/**
 * 仍在进行中的状态说明。终态说明统一由 {@link failureText} 给出，
 * 这里不再重复一遍，避免「标题」与「正文」说同一句话。
 */
function runInProgressDetail(run: RunSummaryView): string | null {
  const status: RunStatus = run.interrupted ? "INTERRUPTED" : run.status;
  if (status === "QUEUED") return "任务已受理，正在等待执行。";
  if (status === "RUNNING") return "正在执行；刷新页面不会中断它。";
  return null;
}

interface CitationGroup {
  key: string;
  documentId: string;
  documentName: string;
  sourceHash: string;
  citations: AnswerCitation[];
}

/** 按 documentId + sourceHash 分组：同名文档的不同版本不合并。 */
function groupCitations(citations: AnswerCitation[]): CitationGroup[] {
  const groups = new Map<string, CitationGroup>();
  for (const citation of citations) {
    const sourceHash = citation.source.sourceHash ?? "";
    const key = `${citation.source.documentId}|${sourceHash}`;
    const existing = groups.get(key);
    if (existing) {
      existing.citations.push(citation);
      continue;
    }
    groups.set(key, {
      key,
      documentId: citation.source.documentId,
      documentName: citation.source.documentName,
      sourceHash,
      citations: [citation],
    });
  }
  return [...groups.values()];
}

/**
 * 紧凑来源入口：默认只显示「来源：文档名 · 共 N 处引用」，展开后保留每一处不同的证据与位置。
 * 来源只来自服务端核验后写入的 metadata.citations；正文里的 [1] 或 Markdown 链接不会出现在这里。
 */
const CitationEntry: React.FC<{
  citations: AnswerCitation[];
  onOpen: (citation: AnswerCitation) => void;
}> = ({ citations, onOpen }) => {
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupCitations(citations), [citations]);
  const documentNames = useMemo(() => {
    const names: string[] = [];
    for (const group of groups) {
      if (!names.includes(group.documentName)) names.push(group.documentName);
    }
    return names;
  }, [groups]);
  const label = documentNames.slice(0, 3).join(" · ") + (documentNames.length > 3 ? ` 等 ${documentNames.length} 篇` : "");
  const panelId = `citations-${useId()}`;

  return (
    <section className="mt-3 min-w-0 max-w-full rounded-xl border border-teal-100 bg-teal-50/50 text-xs" aria-label="回答来源">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl px-3 py-2 text-left hover:bg-teal-100/60"
      >
        <FileSearchOutlined className="shrink-0 text-teal-700" />
        <span className="min-w-0 flex-1 break-words font-medium text-teal-800">来源：{label}</span>
        <span className="shrink-0 text-teal-700/80">共 {citations.length} 处引用</span>
        <span className="flex shrink-0 items-center gap-1 font-semibold text-teal-800">
          {expanded ? "收起来源" : "查看全部依据"}
          <DownOutlined className={expanded ? "rotate-180 transition-transform duration-200" : "transition-transform duration-200"} />
        </span>
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-teal-100 px-3 py-2">
          <ul className="flex flex-col gap-3">
            {groups.map((group) => (
              <li key={group.key} className="min-w-0">
                <p className="mb-1 break-all font-semibold text-slate-700">
                  {group.documentName}
                  <span className="ml-2 font-normal text-slate-400">本条文档 {group.citations.length} 处片段</span>
                </p>
                <ul className="flex flex-col gap-2">
                  {group.citations.map((citation, index) => (
                    <li key={citationKey(citation, index)} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpen(citation)}
                        aria-label={`打开来源 ${citation.label}：${citation.source.documentName}`}
                        className="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-transparent px-1.5 py-1 text-left hover:border-teal-200 hover:bg-teal-100/60"
                      >
                        <span className="font-mono font-medium text-teal-700">[{citation.label}]</span>
                        <span className="text-slate-600">{citationPosition(citation)}</span>
                        {citationHeading(citation) && (
                          <span className="min-w-0 break-words text-slate-500">{citationHeading(citation)}</span>
                        )}
                        <span className="ml-auto shrink-0 font-semibold text-teal-700">查看原文</span>
                      </button>
                      <p className="mt-0.5 break-words px-1.5 leading-5 text-slate-600">{citation.excerpt}</p>
                      <p className="mt-0.5 break-all px-1.5 font-mono text-[11px] text-slate-400">
                        哈希 {citation.source.sourceHash ? citation.source.sourceHash.slice(0, 16) : "无（旧版索引）"}
                        {citation.chunkId ? ` · 片段 ${citation.chunkId}` : ""}
                        {citation.indexVersion || citation.indexRevision
                          ? ` · 索引 ${[citation.indexVersion, citation.indexRevision].filter(Boolean).join(" / ")}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

/**
 * 超长回答的阅读容器：默认限制高度但保留完整 Markdown，展开后不截断。
 * 不复制、不摘要，不用「短答」伪装；展开状态通过 aria-expanded/aria-controls 暴露。
 */
const AnswerBody: React.FC<{ messageId: string; content: string }> = ({ messageId, content }) => {
  const [expanded, setExpanded] = useState(false);
  const collapsible = content.length > LONG_ANSWER_THRESHOLD;
  const panelId = `answer-body-${messageId}`;
  return (
    <div className="min-w-0">
      <div
        id={panelId}
        className={collapsible && !expanded
          ? "relative max-h-[60vh] min-w-0 overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-16 after:bg-gradient-to-t after:from-white after:to-transparent"
          : "min-w-0"}
      >
        <div className="answer-markdown min-w-0 max-w-full">
          <XMarkdown streaming={{ enableAnimation: false, hasNextChunk: false }}>{content}</XMarkdown>
        </div>
      </div>
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-sketch0 hover:underline"
        >
          <DownOutlined className={expanded ? "rotate-180 transition-transform duration-200" : "transition-transform duration-200"} />
          {expanded ? "收起回答" : `展开完整回答（共 ${content.length} 字）`}
        </button>
      )}
    </div>
  );
};

/** 运行详情时间线：自己维护 loading / ready / error，失败可重试，重试不清空已有内容。 */
const RunTimeline: React.FC<{ runId: string }> = ({ runId }) => {
  const [attempt, setAttempt] = useState(0);
  const [events, setEvents] = useState<RunEventView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getRun(runId).then((detail) => {
      if (!active) return;
      if (!detail || !Array.isArray(detail.events)) {
        setFailed(true);
        return;
      }
      setEvents(detail.events);
      setFailed(false);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [runId, attempt]);

  if (failed && events == null) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-slate-500">
        执行过程暂时无法读取。
        <Button size="small" type="link" icon={<ReloadOutlined />} onClick={() => setAttempt((value) => value + 1)}>
          重试
        </Button>
      </p>
    );
  }
  if (events == null) return <p className="text-slate-400">正在读取执行过程…</p>;
  if (events.length === 0) return <p className="text-slate-400">这次执行没有记录到步骤。</p>;
  return (
    <ol className="flex flex-col gap-1">
      {events.map((event) => (
        <li key={`${event.sequence}-${event.type}`} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-slate-400">#{event.sequence}</span>
          <span className="text-slate-700">{runEventDetail(event)}</span>
          <span className="text-slate-400">{formatDuration(event.durationMs)}</span>
          <span className={event.status === "SUCCEEDED" ? "text-teal-700" : "text-rose-700"}>
            {event.status === "SUCCEEDED" ? "成功" : event.status === "FAILED" ? "失败" : "已取消"}
          </span>
        </li>
      ))}
    </ol>
  );
};

/**
 * 一轮的执行过程：工具调用与工具结果合并到同一处，摘要只显示状态与真实耗时。
 * 展开后才读取服务端时间线；没有运行记录时如实说明，不补造步骤。
 */
const ProcessDisclosure: React.FC<{
  run?: RunSummaryView;
  sessionId?: string;
  toolCalls: ToolCall[];
  toolResponses: ToolResponse[];
}> = ({ run, sessionId, toolCalls, toolResponses }) => {
  const [opened, setOpened] = useState(false);
  const status: RunStatus | undefined = run ? (run.interrupted ? "INTERRUPTED" : run.status) : undefined;
  const toolCount = toolCalls.length + toolResponses.length;
  const canLoadTimeline = !!run && !!sessionId;

  return (
    <details
      className="mt-2 min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 text-xs"
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 leading-6">
        <RobotOutlined className="shrink-0 text-slate-400" />
        <span className="font-medium text-slate-700">{run ? "执行过程" : "工具记录"}</span>
        {status && <span className={RUN_STATUS_CLASSES[status]}>{RUN_STATUS_LABELS[status]}</span>}
        {run && <span className="text-slate-500">执行 {formatDuration(run.durationMs)}</span>}
        {run?.queueDurationMs != null && run.queueDurationMs >= 1000 && (
          <span className="text-slate-400">排队 {formatDuration(run.queueDurationMs)}</span>
        )}
        {toolCount > 0 && <span className="text-slate-400">{toolCalls.length} 次工具调用</span>}
        {run?.modelName && <span className="font-mono text-slate-400">{run.modelName}</span>}
        {run?.traceIncomplete && <span className="text-amber-600">执行详情不完整</span>}
        <span className="ml-auto shrink-0 text-slate-400">查看过程</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-2">
        {opened && run && canLoadTimeline && <RunTimeline runId={run.runId} />}
        {opened && run && !canLoadTimeline && <p className="text-slate-400">当前页面没有读取执行过程所需的信息。</p>}
        {opened && run && formatUsage(run) && <p className="text-slate-400">{formatUsage(run)}</p>}
        {/* 错误分类是给排查用的技术细节：只在展开后出现，正文里不展示英文枚举。 */}
        {opened && run?.errorCode && (
          <p className="break-all font-mono text-[11px] text-slate-400">
            错误分类 {run.errorCode} · {RUN_ERROR_LABELS[run.errorCode] ?? "未分类"}
          </p>
        )}
        {toolCalls.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="font-medium text-slate-600">工具调用</p>
            {toolCalls.map((toolCall) => (
              <details key={toolCall.id} className="min-w-0 rounded-lg border border-dashed border-sketch bg-white/70">
                <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 px-2 py-1 leading-6 text-slate-600">
                  <ToolOutlined className="shrink-0 text-sketch0" />
                  <span className="font-medium">{TOOL_LABELS[toolCall.name] || toolCall.name}</span>
                  <span className="font-mono text-slate-400">{toolCall.name}</span>
                </summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-dashed border-sketch px-2 py-1.5 leading-6 text-slate-600">
                  {formatToolData(toolCall.arguments)}
                </pre>
              </details>
            ))}
          </div>
        )}
        {toolResponses.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="font-medium text-slate-600">工具结果</p>
            {toolResponses.map((toolResponse) => (
              <details key={toolResponse.id} className="min-w-0 rounded-lg border border-dashed border-sketch bg-white/70">
                <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 px-2 py-1 leading-6 text-slate-600">
                  <FileSearchOutlined className="shrink-0 text-sketch0" />
                  <span className="font-medium">{TOOL_LABELS[toolResponse.name] || toolResponse.name}</span>
                  <span className="font-mono text-slate-400">{toolResponse.name}</span>
                </summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-dashed border-sketch px-2 py-1.5 leading-6 text-slate-600">
                  {formatToolData(toolResponse.responseData)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
};

/**
 * 没有 assistant 消息的终态运行也必须可见。提交前取消、首次模型调用失败、运行中进程崩溃
 * 都可能不产生 assistant 消息，状态只能来自持久化的运行记录。
 *
 * 访客看到的是「发生了什么 + 该怎么办 + 一个重试按钮」；英文错误码只留在展开后的过程详情里。
 */
const RunOutcomeNotice: React.FC<{ run: RunSummaryView; onRetry?: () => void }> = ({ run, onRetry }) => {
  const status: RunStatus = run.interrupted ? "INTERRUPTED" : run.status;
  const busy = status === "QUEUED" || status === "RUNNING";
  const failure = failureText(run.errorCode, status);
  return (
    <div
      role={busy ? "status" : "note"}
      className="mt-1 min-w-0 rounded-xl border border-dashed border-amber-200 bg-amber-50/70 px-3 py-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-700">{busy ? "本次回答" : "这次没有拿到回答"}</span>
        <span className={RUN_STATUS_CLASSES[status] ?? "text-slate-600"}>{RUN_STATUS_LABELS[status] ?? status}</span>
        {typeof run.durationMs === "number" && run.durationMs > 0 && (
          <span className="text-slate-400">耗时 {(run.durationMs / 1000).toFixed(1)} s</span>
        )}
      </div>
      <p className={(busy ? "mt-1" : "mt-1.5") + " leading-5 text-slate-600"}>
        {busy ? runInProgressDetail(run) : failure.hint}
      </p>
      {!busy && failure.retryable && onRetry && (
        <Button size="small" className="mt-2" icon={<ReloadOutlined />} onClick={onRetry}>
          重新提问
        </Button>
      )}
    </div>
  );
};

/** 读取状态提示：失败时给重试，不把故障解释成「没有记录」。 */
const RunLoadNotice: React.FC<{
  message: string;
  onRetry: () => void;
  stale?: boolean;
}> = ({ message, onRetry, stale }) => (
  <div
    role={stale ? "status" : "alert"}
    className={stale
      ? "mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-slate-600"
      : "mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/60 px-3 py-2 text-xs text-slate-700"}
  >
    <span className="min-w-0 flex-1">
      {stale ? `执行记录尚未更新：${message}` : `执行记录暂时无法读取：${message}`}
    </span>
    <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
      重试
    </Button>
  </div>
);

/** The timer measures elapsed waiting only; it never predicts provider progress. */
const ElapsedWait: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="text-xs text-slate-500" data-wait-seconds={seconds} aria-live="off">
      已等待 {seconds} 秒{seconds >= 10 ? " · 仍在处理中，可停止或稍后回来查看" : ""}
    </span>
  );
};

const AgentChatHistory: React.FC<AgentChatHistoryProps> = ({
  messages,
  sessionId,
  refreshVersion = 0,
  waitStartedAt = null,
  autoScroll = true,
  displayAgentStatus = false,
  agentStatusText = "",
  agentStatusType,
  onAskFollowUp,
  followUpPrompts = [],
  busy = false,
  cancelling = false,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const suppressScrollRef = useRef(0);
  const seenAnswerIdsRef = useRef<Set<string>>(new Set());
  const seenQuestionIdsRef = useRef<Set<string>>(new Set());
  const didInitialPositionRef = useRef(false);
  const requestSeqRef = useRef(0);
  const hadSuccessfulReadRef = useRef(false);

  const [newAnswerId, setNewAnswerId] = useState<string | null>(null);
  const [citedSource, setCitedSource] = useState<AnswerCitation | null>(null);
  // 打开引用预览前记录触发元素：抽屉关闭（含 Esc）后焦点必须回到它。
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const focusRestoreTimerRef = useRef<number | null>(null);
  const openCitation = useCallback((citation: AnswerCitation) => {
    // A new source may open before the previous drawer has restored focus.
    // Its pending callback must not move focus outside the new dialog.
    if (focusRestoreTimerRef.current !== null) window.clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = null;
    previewTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCitedSource(citation);
  }, []);
  const closeCitation = useCallback(() => {
    setCitedSource(null);
    const trigger = previewTriggerRef.current;
    previewTriggerRef.current = null;
    if (focusRestoreTimerRef.current !== null) window.clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = window.setTimeout(() => {
      focusRestoreTimerRef.current = null;
      if (trigger?.isConnected) trigger.focus();
    }, 60);
  }, []);
  useEffect(() => () => {
    if (focusRestoreTimerRef.current !== null) window.clearTimeout(focusRestoreTimerRef.current);
  }, []);

  // 数据与请求状态分开保存：失败不清空已取得的运行记录。
  const [runs, setRuns] = useState<RunSummaryView[]>([]);
  const [runLoad, setRunLoad] = useState<"idle" | "loading" | "ready" | "error">(sessionId ? "loading" : "idle");
  const [runError, setRunError] = useState("");
  const [runStale, setRunStale] = useState(false);

  // 初始状态已经按 sessionId 决定（聊天页对整个会话子树做了 key 重挂载），
  // 所以这里不需要「切换会话时同步清空」的 effect：新会话用的是全新的 state。
  const loadRuns = useCallback(async () => {
    if (!sessionId) return;
    const seq = ++requestSeqRef.current;
    const targetSession = sessionId;
    try {
      const response = await listSessionRuns(targetSession);
      // 切换会话后旧请求返回：丢弃，不更新当前视图。
      if (seq !== requestSeqRef.current || targetSession !== sessionId) return;
      const nextRuns = Array.isArray(response?.runs) ? response.runs : [];
      hadSuccessfulReadRef.current = true;
      setRuns(nextRuns);
      setRunLoad("ready");
      setRunError("");
      setRunStale(false);
    } catch (error) {
      if (seq !== requestSeqRef.current || targetSession !== sessionId) return;
      const message = error instanceof Error && error.message ? error.message : "暂时无法读取执行记录";
      setRunError(message);
      if (hadSuccessfulReadRef.current) {
        setRunLoad("ready");
        setRunStale(true);
      } else {
        setRunLoad("error");
      }
    }
  }, [sessionId]);

  const retryRuns = useCallback(() => {
    setRunLoad((previous) => (previous === "ready" ? previous : "loading"));
    setRunError("");
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!sessionId) return;
    // 放进定时器回调里触发：读取本身是异步的，失败也不会同步改状态。
    const timer = window.setTimeout(() => { void loadRuns(); }, 0);
    return () => {
      window.clearTimeout(timer);
      requestSeqRef.current += 1;
    };
  }, [loadRuns, messages.length, sessionId, refreshVersion]);

  // 轮询只用于可见页面里的活动运行；终态停止。
  const hasActiveRun = runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING");
  useEffect(() => {
    if (!sessionId || !hasActiveRun) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadRuns();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [sessionId, hasActiveRun, loadRuns]);

  const turns = useMemo(() => buildTurns(messages, runs), [messages, runs]);

  const markProgrammaticScroll = useCallback(() => {
    suppressScrollRef.current = performance.now() + 400;
  }, []);

  const scrollToElementTop = useCallback((element: HTMLElement | null) => {
    const container = scrollContainerRef.current;
    if (!container || !element) return;
    markProgrammaticScroll();
    const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop = Math.max(0, container.scrollTop + delta - 12);
  }, [markProgrammaticScroll]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    markProgrammaticScroll();
    container.scrollTop = container.scrollHeight;
  }, [markProgrammaticScroll]);

  const answerElement = useCallback((messageId: string): HTMLElement | null => {
    const container = scrollContainerRef.current;
    if (!container) return null;
    return container.querySelector<HTMLElement>(`[data-answer-id="${messageId}"]`);
  }, []);

  // 用户滚动：上滚或选择文字时不再跟随本轮，回到接近底部时恢复跟随。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearBottom = distance <= FOLLOW_THRESHOLD;
      if (performance.now() >= suppressScrollRef.current) {
        followRef.current = nearBottom;
      }
      if (nearBottom) setNewAnswerId((previous) => (previous ? null : previous));
    };
    const onSelection = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && container.contains(selection.anchorNode)) followRef.current = false;
    };
    const onInteraction = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("button, summary, a")) followRef.current = false;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        suppressScrollRef.current = 0;
        followRef.current = false;
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("pointerdown", onInteraction, { passive: true });
    document.addEventListener("selectionchange", onSelection);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onInteraction);
      document.removeEventListener("selectionchange", onSelection);
    };
  }, []);

  // Track real answer IDs, not the last message's role: a tool acknowledgement often
  // follows the final answer in the same snapshot. Mark IDs only after the scroll
  // callback actually runs, so a replaced render cannot silently cancel the anchor.
  useEffect(() => {
    if (!autoScroll || messages.length === 0) return;
    const timer = requestAnimationFrame(() => {
      const answers = messages.filter(isReadableAnswer);
      const questions = messages.filter((message) => message.role === "user");
      const newAnswers = answers.filter((message) => !seenAnswerIdsRef.current.has(message.id));
      const newQuestions = questions.filter((message) => !seenQuestionIdsRef.current.has(message.id));
      answers.forEach((message) => seenAnswerIdsRef.current.add(message.id));
      questions.forEach((message) => seenQuestionIdsRef.current.add(message.id));
      if (!didInitialPositionRef.current) {
        didInitialPositionRef.current = true;
        const last = answers.at(-1);
        if (last) scrollToElementTop(answerElement(last.id));
        else scrollToBottom();
        return;
      }
      if (newQuestions.length) {
        followRef.current = true;
        setNewAnswerId(null);
        scrollToBottom();
      }
      const last = newAnswers.at(-1);
      if (!last) return;
      if (followRef.current) scrollToElementTop(answerElement(last.id));
      else setNewAnswerId(last.id);
    });
    return () => cancelAnimationFrame(timer);
  }, [answerElement, autoScroll, messages, scrollToBottom, scrollToElementTop]);

  // 活动状态出现时，仍在跟随的访客能看到状态本身。
  useEffect(() => {
    if (!autoScroll || !displayAgentStatus || !followRef.current) return;
    const timer = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(timer);
  }, [autoScroll, displayAgentStatus, scrollToBottom]);

  const jumpToNewAnswer = useCallback(() => {
    if (!newAnswerId) return;
    followRef.current = true;
    scrollToElementTop(answerElement(newAnswerId));
    setNewAnswerId(null);
  }, [answerElement, newAnswerId, scrollToElementTop]);

  const statusLabel = (() => {
    if (cancelling) return "正在取消";
    switch (agentStatusType) {
      case "AI_PLANNING":
        return "正在进行";
      case "AI_THINKING":
        return "正在分析问题";
      case "AI_EXECUTING":
        return "正在执行操作";
      default:
        return "正在处理";
    }
  })();

  const lastTurn = turns[turns.length - 1];
  const showFollowUps = !!onAskFollowUp && !!lastTurn && lastTurn.answers.length > 0 &&
    !displayAgentStatus && followUpPrompts.length > 0;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-8 sm:py-5 lg:px-12"
      >
        {sessionId && runLoad === "error" && (
          <RunLoadNotice message={runError || "暂时无法读取执行记录"} onRetry={retryRuns} />
        )}
        {sessionId && runLoad === "ready" && runStale && (
          <RunLoadNotice message={runError || "网络或服务暂时不可用"} onRetry={retryRuns} stale />
        )}

        {turns.map((turn, turnIndex) => {
          const run = turn.run;
          const declaredRunId = messageRunId(turn.answers[0]) ?? messageRunId(turn.question);
          const answerlessRun = run && !run.answerMessageId && turn.answers.length === 0 ? run : undefined;
          const toolCalls = turn.traceMessages.flatMap((answer) => answer.metadata?.toolCalls ?? []);
          const toolResponses = turn.tools
            .map((message) => message.metadata?.toolResponse)
            .filter((response): response is ToolResponse => !!response);
          const busyRunStatus: RunStatus | null =
            run && (run.status === "QUEUED" || run.status === "RUNNING") ? run.status : null;
          const showProcess = !!run || toolCalls.length > 0 || toolResponses.length > 0;
          const runConfirmedMissing = !!sessionId && runLoad === "ready" && !runStale && !run;
          const missingAssociatedRun = !!sessionId && runLoad === "ready" && !runStale && !run && !!declaredRunId;

          return (
            <div key={turn.key} className="mb-5 min-w-0">
              {turn.systems.map((message) => (
                <div key={message.id} className="mb-2 flex justify-center">
                  <div className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                    <RobotOutlined />
                    <span className="break-words">{message.content}</span>
                  </div>
                </div>
              ))}

              {turn.question && (
                <div className="flex flex-col items-end gap-1">
                  <Bubble content={<span className="block min-w-0 break-words">{turn.question.content}</span>} placement="end" />
                  {answerlessRun && (
                    <div className="w-full max-w-3xl">
                      <RunOutcomeNotice
                        run={answerlessRun}
                        onRetry={onAskFollowUp && turn.question ? () => void onAskFollowUp(turn.question!.content) : undefined}
                      />
                    </div>
                  )}
                  {missingAssociatedRun && (
                    <p className="text-xs text-amber-700">未能读取这条问题对应的执行记录。</p>
                  )}
                </div>
              )}

              {turn.answers.map((answer) => {
                const citations = answer.metadata?.citations ?? [];
                const answerRun = run;
                const failedRun = answerRun && ["FAILED", "CANCELLED", "INTERRUPTED"].includes(
                  answerRun.interrupted ? "INTERRUPTED" : answerRun.status,
                ) ? answerRun : undefined;
                return (
                  <div key={answer.id} data-answer-id={answer.id} className="mt-2 min-w-0">
                    <Bubble
                      content={(
                        <div className="w-full min-w-0 break-words [&_a]:break-all">
                          {answer.content && <AnswerBody messageId={answer.id} content={answer.content} />}
                          {citations.length > 0 && <CitationEntry citations={citations} onOpen={openCitation} />}
                          {failedRun && (() => {
                            const status = failedRun.interrupted ? "INTERRUPTED" : failedRun.status;
                            const failure = failureText(failedRun.errorCode, status);
                            return (
                              <div className="mt-2 rounded-lg border border-dashed border-amber-200 bg-amber-50/70 px-2.5 py-2 text-xs">
                                <p className="font-medium leading-5 text-slate-700">{failure.title}</p>
                                <p className="mt-0.5 leading-5 text-slate-600">{failure.hint}</p>
                                {failure.retryable && onAskFollowUp && turn.question && (
                                  <Button
                                    size="small"
                                    className="mt-1.5"
                                    icon={<ReloadOutlined />}
                                    onClick={() => void onAskFollowUp(turn.question!.content)}
                                  >
                                    重新提问
                                  </Button>
                                )}
                              </div>
                            );
                          })()}
                          {runConfirmedMissing && !showProcess && (
                            <p className="mt-2 text-xs text-slate-400">这条历史消息没有执行记录</p>
                          )}
                        </div>
                      )}
                      placement="start"
                    />
                  </div>
                );
              })}

              {showProcess && (
                <div className="w-full min-w-0 max-w-3xl">
                  <ProcessDisclosure run={run} sessionId={sessionId} toolCalls={toolCalls} toolResponses={toolResponses} />
                </div>
              )}

              {/* 有运行记录但仍在执行、又没有答案消息时，把活动状态放在本轮下面 */}
              {answerlessRun && busyRunStatus && !displayAgentStatus && (
                <p className="mt-1 text-xs text-sky-700" role="status">
                  本轮仍在{RUN_STATUS_LABELS[busyRunStatus]}，刷新页面不会中断它。
                </p>
              )}

              {turnIndex === turns.length - 1 && showFollowUps && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="相关追问">
                  {followUpPrompts.slice(0, 2).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={busy}
                      onClick={() => void onAskFollowUp?.(prompt)}
                      className="min-h-11 max-w-full rounded-xl border border-dashed border-sketch bg-white/80 px-3 py-2 text-left text-xs font-semibold text-pencil transition-[background-color,border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-pencil/50 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {displayAgentStatus && (
          <div className="mb-3" role="status" aria-live="polite">
            <Bubble
              content={(
                <span className="flex flex-wrap items-center gap-2">
                  <span className="animate-pulse font-semibold text-sketch0">✨ {statusLabel}</span>
                  {agentStatusText && <span className="break-words text-gray-600">{agentStatusText}</span>}
                  {waitStartedAt != null && <ElapsedWait key={waitStartedAt} startedAt={waitStartedAt} />}
                </span>
              )}
              placement="start"
            />
          </div>
        )}
      </div>

      {newAnswerId && (
        <button
          type="button"
          onClick={jumpToNewAnswer}
          className="absolute bottom-3 left-1/2 z-10 flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-sketch bg-white px-4 py-2 text-xs font-semibold text-ink shadow-doodle transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5"
        >
          有新回答到达
          <DownOutlined />
        </button>
      )}

      {/* 引用原文：使用当前构建的授权原文接口，关闭即清理请求 */}
      {citedSource && (
        <DocumentPreviewDrawer
          document={{ id: citedSource.source.documentId, filename: citedSource.source.documentName }}
          citation={citedSource.source}
          onClose={closeCitation}
        />
      )}
    </div>
  );
};

export default AgentChatHistory;
