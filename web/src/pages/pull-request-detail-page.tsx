import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionStatusBadge } from "@/components/repository/action-status-badge";
import { IssueTaskStatusBadge } from "@/components/repository/issue-task-status-badge";
import { MarkdownBody } from "@/components/repository/markdown-body";
import { MarkdownEditor } from "@/components/repository/markdown-editor";
import { ReactionStrip } from "@/components/repository/reaction-strip";
import {
  RepositoryDiffView,
  type RepositoryDiffLineRenderContext,
  type RepositoryDiffLineTarget
} from "@/components/repository/repository-diff-view";
import { RepositoryMetadataFields } from "@/components/repository/repository-metadata-fields";
import { RepositoryStateBadge } from "@/components/repository/repository-state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import { Textarea } from "@/components/ui/textarea";
import {
  addReaction,
  compareRepositoryRefs,
  createPullRequestReviewThread,
  createPullRequestReviewThreadComment,
  listLatestAgentSessionsBySource,
  listLatestActionRunsBySource,
  createPullRequestReview,
  formatApiError,
  getPullRequest,
  getPullRequestProvenance,
  getRepositoryDetail,
  listRepositoryLabels,
  listRepositoryMilestones,
  listRepositoryParticipants,
  listPullRequestReviews,
  listPullRequestReviewThreads,
  removeReaction,
  resumePullRequestAgent,
  resolvePullRequestReviewThread,
  updatePullRequest,
  type ActionAgentType,
  type ActionRunRecord,
  type AgentSessionDetail,
  type AgentSessionRecord,
  type AuthUser,
  type IssueRecord,
  type PullRequestDetailResponse,
  type PullRequestReviewDecision,
  type PullRequestReviewRecord,
  type PullRequestReviewSummary,
  type PullRequestReviewThreadRecord,
  type PullRequestReviewThreadSide,
  type PullRequestRecord,
  type PullRequestTaskFlowRecord,
  type ReactionContent,
  type RepositoryCompareResponse,
  type RepositoryDetailResponse,
  type RepositoryLabelRecord,
  type RepositoryMilestoneRecord,
  type RepositoryUserSummary,
  type TaskFlowWaitingOn
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  excerptText,
  formatDuration,
  highlightedValidationArtifacts,
  latestValidationStatus,
  validationCheckBadgeVariant,
  validationCheckStatusLabel
} from "@/lib/validation-summary";

type PullRequestDetailPageProps = {
  user: AuthUser | null;
};

const FALLBACK_AGENT_TYPES: ActionAgentType[] = ["codex", "claude_code"];

function stripHeadsRef(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

function applyComparisonToPullRequest(
  pullRequest: PullRequestRecord,
  comparison: RepositoryCompareResponse | null
): PullRequestRecord {
  return {
    ...pullRequest,
    mergeable: comparison?.mergeable,
    ahead_by: comparison?.aheadBy,
    behind_by: comparison?.behindBy,
    changed_files: comparison?.filesChanged,
    additions: comparison?.additions,
    deletions: comparison?.deletions
  };
}

function mergeabilityBadgeVariant(
  mergeable: RepositoryCompareResponse["mergeable"]
): "default" | "destructive" | "secondary" {
  if (mergeable === "mergeable") {
    return "default";
  }
  if (mergeable === "conflicting") {
    return "destructive";
  }
  return "secondary";
}

function mergeabilityLabel(mergeable: RepositoryCompareResponse["mergeable"]): string {
  if (mergeable === "mergeable") {
    return "Mergeable";
  }
  if (mergeable === "conflicting") {
    return "Conflicting";
  }
  return "Mergeability unknown";
}

function taskFlowWaitingLabel(waitingOn: TaskFlowWaitingOn): string {
  if (waitingOn === "agent") {
    return "Waiting on Agent";
  }
  if (waitingOn === "human") {
    return "Waiting on Human";
  }
  return "No active blocker";
}

function isPendingAgentSession(session: AgentSessionRecord | null): boolean {
  return session?.status === "queued" || session?.status === "running";
}

type SelectedReviewRange = {
  path: string;
  baseOid: string;
  headOid: string;
  hunkHeader: string;
  side: PullRequestReviewThreadSide;
  startLine: number;
  endLine: number;
  anchorLine: number;
};

function sortReviewThreads(threads: PullRequestReviewThreadRecord[]): PullRequestReviewThreadRecord[] {
  return [...threads].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "open" ? -1 : 1;
    }
    return left.created_at - right.created_at;
  });
}

function shortOid(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 7) : "-";
}

function formatReviewThreadRangeLabel(args: {
  path: string;
  startLine: number | null;
  endLine: number | null;
  side: PullRequestReviewThreadSide;
}): string {
  if (args.startLine === null || args.endLine === null) {
    return `${args.path} (unmapped ${args.side})`;
  }
  const range =
    args.startLine === args.endLine ? String(args.startLine) : `${args.startLine}-${args.endLine}`;
  return `${args.path}:${range} (${args.side})`;
}

function formatOriginalReviewThreadAnchor(thread: PullRequestReviewThreadRecord): string {
  return formatReviewThreadRangeLabel({
    path: thread.path,
    startLine: thread.start_line,
    endLine: thread.end_line,
    side: thread.start_side
  });
}

function getCurrentReviewThreadAnchor(thread: PullRequestReviewThreadRecord) {
  if (thread.anchor) {
    if (
      thread.anchor.status === "stale" ||
      thread.anchor.start_line === null ||
      thread.anchor.end_line === null
    ) {
      return null;
    }
    return thread.anchor;
  }
  return {
    path: thread.path,
    line: thread.line,
    side: thread.side,
    start_side: thread.start_side,
    start_line: thread.start_line,
    end_side: thread.end_side,
    end_line: thread.end_line,
    hunk_header: thread.hunk_header
  };
}

function formatReviewThreadAnchor(thread: PullRequestReviewThreadRecord): string {
  const currentAnchor = getCurrentReviewThreadAnchor(thread);
  if (!currentAnchor) {
    return formatOriginalReviewThreadAnchor(thread);
  }
  return formatReviewThreadRangeLabel({
    path: currentAnchor.path,
    startLine: currentAnchor.start_line,
    endLine: currentAnchor.end_line,
    side: currentAnchor.start_side
  });
}

function canSuggestChangeOnReviewThread(thread: PullRequestReviewThreadRecord): boolean {
  const currentAnchor = getCurrentReviewThreadAnchor(thread);
  return currentAnchor?.start_side === "head";
}

function formatSelectedReviewRange(range: SelectedReviewRange): string {
  const lineLabel =
    range.startLine === range.endLine ? String(range.startLine) : `${range.startLine}-${range.endLine}`;
  return `${range.path}:${lineLabel} (${range.side})`;
}

export function PullRequestDetailPage({ user }: PullRequestDetailPageProps) {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const number = Number.parseInt(params.number ?? "", 10);

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestRecord | null>(null);
  const [reviews, setReviews] = useState<PullRequestReviewRecord[]>([]);
  const [reviewThreads, setReviewThreads] = useState<PullRequestReviewThreadRecord[]>([]);
  const [availableLabels, setAvailableLabels] = useState<RepositoryLabelRecord[]>([]);
  const [availableMilestones, setAvailableMilestones] = useState<RepositoryMilestoneRecord[]>([]);
  const [participants, setParticipants] = useState<RepositoryUserSummary[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([]);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [latestActionRun, setLatestActionRun] = useState<ActionRunRecord | null>(null);
  const [latestAgentSession, setLatestAgentSession] = useState<AgentSessionRecord | null>(null);
  const [provenanceDetail, setProvenanceDetail] = useState<AgentSessionDetail | null>(null);
  const [taskFlow, setTaskFlow] = useState<PullRequestTaskFlowRecord | null>(null);
  const [selectedAgentType, setSelectedAgentType] = useState<ActionAgentType>("codex");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [closingIssues, setClosingIssues] = useState<IssueRecord[]>([]);
  const [comparison, setComparison] = useState<RepositoryCompareResponse | null>(null);
  const [reviewSummary, setReviewSummary] = useState<PullRequestReviewSummary>({
    approvals: 0,
    changeRequests: 0,
    comments: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateIntent, setUpdateIntent] = useState<"open" | "closed" | "merged" | null>(null);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [reactionPendingKey, setReactionPendingKey] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<PullRequestReviewDecision>("comment");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [selectedReviewRange, setSelectedReviewRange] = useState<SelectedReviewRange | null>(null);
  const [reviewThreadBody, setReviewThreadBody] = useState("");
  const [reviewThreadSuggestedCode, setReviewThreadSuggestedCode] = useState("");
  const [reviewThreadSubmitting, setReviewThreadSubmitting] = useState(false);
  const [threadReplyBodies, setThreadReplyBodies] = useState<Record<string, string>>({});
  const [threadReplySuggestedCodes, setThreadReplySuggestedCodes] = useState<Record<string, string>>(
    {}
  );
  const [replySubmittingThreadId, setReplySubmittingThreadId] = useState<string | null>(null);
  const [resolvingThreadId, setResolvingThreadId] = useState<string | null>(null);
  const [agentResumeThreadId, setAgentResumeThreadId] = useState<string | null>(null);

  async function refreshPullRequestDetail(): Promise<PullRequestDetailResponse | null> {
    if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
      return null;
    }
    const [nextPullRequestDetail, nextReviews, nextReviewThreads] = await Promise.all([
      getPullRequest(owner, repo, number),
      listPullRequestReviews(owner, repo, number),
      listPullRequestReviewThreads(owner, repo, number)
    ]);
    const nextComparison = await compareRepositoryRefs(owner, repo, {
      baseRef: nextPullRequestDetail.pullRequest.base_ref,
      headRef: nextPullRequestDetail.pullRequest.head_ref
    }).catch(() => null);
    setPullRequest(applyComparisonToPullRequest(nextPullRequestDetail.pullRequest, nextComparison));
    setClosingIssues(nextPullRequestDetail.closingIssues);
    setTaskFlow(nextPullRequestDetail.taskFlow);
    setComparison(nextComparison);
    setReviews(nextReviews.reviews);
    setReviewSummary(nextReviews.reviewSummary);
    setReviewThreads(nextReviewThreads);
    return nextPullRequestDetail;
  }

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [
          nextDetail,
          nextPullRequestDetail,
          nextProvenance,
          nextReviews,
          nextReviewThreads,
          nextLabels,
          nextMilestones,
          nextParticipants
        ] = await Promise.all([
          getRepositoryDetail(owner, repo),
          getPullRequest(owner, repo, number),
          getPullRequestProvenance(owner, repo, number),
          listPullRequestReviews(owner, repo, number),
          listPullRequestReviewThreads(owner, repo, number),
          listRepositoryLabels(owner, repo),
          listRepositoryMilestones(owner, repo),
          user ? listRepositoryParticipants(owner, repo) : Promise.resolve([])
        ]);
        const nextComparison = await compareRepositoryRefs(owner, repo, {
          baseRef: nextPullRequestDetail.pullRequest.base_ref,
          headRef: nextPullRequestDetail.pullRequest.head_ref
        }).catch(() => null);
        const [latestRunItems, latestSessionItems] = await Promise.all([
          listLatestActionRunsBySource(owner, repo, {
            sourceType: "pull_request",
            numbers: [number]
          }),
          listLatestAgentSessionsBySource(owner, repo, {
            sourceType: "pull_request",
            numbers: [number]
          })
        ]);
        if (canceled) {
          return;
        }
        setDetail(nextDetail);
        setPullRequest(applyComparisonToPullRequest(nextPullRequestDetail.pullRequest, nextComparison));
        setClosingIssues(nextPullRequestDetail.closingIssues);
        setTaskFlow(nextPullRequestDetail.taskFlow);
        setProvenanceDetail(nextProvenance.latestSession);
        setReviews(nextReviews.reviews);
        setReviewSummary(nextReviews.reviewSummary);
        setReviewThreads(nextReviewThreads);
        setAvailableLabels(nextLabels);
        setAvailableMilestones(nextMilestones);
        setParticipants(nextParticipants);
        setComparison(nextComparison);
        setLatestActionRun(latestRunItems[0]?.run ?? null);
        setLatestAgentSession(latestSessionItems[0]?.session ?? null);
      } catch (loadError) {
        if (!canceled) {
          setError(formatApiError(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [number, owner, repo, user]);

  useEffect(() => {
    if (!pullRequest) {
      return;
    }
    setSelectedLabelIds(pullRequest.labels.map((label) => label.id));
    setSelectedAssigneeIds(pullRequest.assignees.map((assignee) => assignee.id));
    setSelectedReviewerIds(pullRequest.requested_reviewers.map((reviewer) => reviewer.id));
    setSelectedMilestoneId(pullRequest.milestone?.id ?? null);
    setDraft(pullRequest.draft);
  }, [pullRequest]);

  useEffect(() => {
    setSelectedReviewRange(null);
  }, [comparison?.mergeBaseOid, comparison?.baseOid, comparison?.headOid]);

  useEffect(() => {
    if (selectedReviewRange?.side !== "head" && reviewThreadSuggestedCode) {
      setReviewThreadSuggestedCode("");
    }
  }, [reviewThreadSuggestedCode, selectedReviewRange?.side]);

  const hasPendingRun =
    latestActionRun !== null &&
    (latestActionRun.status === "queued" || latestActionRun.status === "running");
  const hasPendingAgentSession = isPendingAgentSession(latestAgentSession);

  useEffect(() => {
    if (
      (!hasPendingRun && !hasPendingAgentSession) ||
      !owner ||
      !repo ||
      !Number.isInteger(number) ||
      number <= 0
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const [latestRunItems, latestSessionItems, nextProvenance] = await Promise.all([
          listLatestActionRunsBySource(owner, repo, {
            sourceType: "pull_request",
            numbers: [number]
          }),
          listLatestAgentSessionsBySource(owner, repo, {
            sourceType: "pull_request",
            numbers: [number]
          }),
          getPullRequestProvenance(owner, repo, number).catch(() => null)
        ]);
        await refreshPullRequestDetail();
        setLatestActionRun(latestRunItems[0]?.run ?? null);
        setLatestAgentSession(latestSessionItems[0]?.session ?? null);
        setProvenanceDetail(nextProvenance?.latestSession ?? null);
      } catch {
        // Ignore transient polling errors.
      }
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingAgentSession, hasPendingRun, number, owner, repo]);

  if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>PR 编号无效。</AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !detail || !pullRequest || !taskFlow) {
    return (
      <PageLoadingState
        title="Loading pull request"
        description={`Fetching pull request #${number}, reviews, checks, and diff data.`}
      />
    );
  }

  const canUpdate = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canReview = detail.permissions.canCreateIssueOrPullRequest && Boolean(user);
  const canReact = Boolean(user);
  const canRunAgents = detail.permissions.canRunAgents && Boolean(user);
  const allowedAgentTypes = FALLBACK_AGENT_TYPES;
  const currentTaskFlow: PullRequestTaskFlowRecord = taskFlow;

  async function saveMetadata() {
    if (metadataSaving) {
      return;
    }
    setMetadataSaving(true);
    setError(null);
    try {
      const updated = await updatePullRequest(owner, repo, number, {
        draft,
        labelIds: selectedLabelIds,
        assigneeUserIds: selectedAssigneeIds,
        requestedReviewerIds: selectedReviewerIds,
        milestoneId: selectedMilestoneId
      });
      const nextComparison = await compareRepositoryRefs(owner, repo, {
        baseRef: updated.base_ref,
        headRef: updated.head_ref
      }).catch(() => null);
      setPullRequest(applyComparisonToPullRequest(updated, nextComparison));
      setComparison(nextComparison);
    } catch (error) {
      setError(formatApiError(error));
    } finally {
      setMetadataSaving(false);
    }
  }

  async function changeState(nextState: "open" | "closed" | "merged") {
    if (updating) {
      return;
    }
    setUpdating(true);
    setUpdateIntent(nextState);
    setError(null);
    try {
      const updated = await updatePullRequest(owner, repo, number, {
        state: nextState
      });
      const nextComparison = await compareRepositoryRefs(owner, repo, {
        baseRef: updated.base_ref,
        headRef: updated.head_ref
      }).catch(() => null);
      setPullRequest(applyComparisonToPullRequest(updated, nextComparison));
      setComparison(nextComparison);
      await refreshPullRequestDetail();
    } catch (updateError) {
      setError(formatApiError(updateError));
    } finally {
      setUpdating(false);
      setUpdateIntent(null);
    }
  }

  async function submitReview() {
    if (reviewSubmitting) {
      return;
    }
    setReviewSubmitting(true);
    setError(null);
    try {
      const created = await createPullRequestReview(owner, repo, number, {
        decision: reviewDecision,
        body: reviewBody
      });
      setReviews((previous) => [...previous, created.review]);
      setReviewSummary(created.reviewSummary);
      setReviewBody("");
      setReviewDecision("comment");
      await refreshPullRequestDetail();
    } catch (submitError) {
      setError(formatApiError(submitError));
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function submitReviewThread() {
    if (
      !canReview ||
      !pullRequest ||
      !selectedReviewRange ||
      pullRequest.state !== "open" ||
      reviewThreadSubmitting
    ) {
      return;
    }

    const trimmedBody = reviewThreadBody.trim();
    const trimmedSuggestedCode =
      selectedReviewRange.side === "head" ? reviewThreadSuggestedCode.trim() : "";
    if (!trimmedBody && !trimmedSuggestedCode) {
      setError("Review threads require either a comment or suggested code.");
      return;
    }

    setReviewThreadSubmitting(true);
    setError(null);
    try {
      const created = await createPullRequestReviewThread(owner, repo, number, {
        path: selectedReviewRange.path,
        baseOid: selectedReviewRange.baseOid,
        headOid: selectedReviewRange.headOid,
        startSide: selectedReviewRange.side,
        startLine: selectedReviewRange.startLine,
        endSide: selectedReviewRange.side,
        endLine: selectedReviewRange.endLine,
        hunkHeader: selectedReviewRange.hunkHeader,
        ...(trimmedBody ? { body: trimmedBody } : {}),
        ...(trimmedSuggestedCode ? { suggestedCode: trimmedSuggestedCode } : {})
      });
      setReviewThreads((previous) => sortReviewThreads([...previous, created]));
      setSelectedReviewRange(null);
      setReviewThreadBody("");
      setReviewThreadSuggestedCode("");
      await refreshPullRequestDetail();
    } catch (submitError) {
      setError(formatApiError(submitError));
    } finally {
      setReviewThreadSubmitting(false);
    }
  }

  function handleDiffLineSelection(target: RepositoryDiffLineTarget) {
    const baseOid = comparison?.mergeBaseOid ?? comparison?.baseOid;
    const headOid = comparison?.headOid;
    if (!baseOid || !headOid) {
      return;
    }

    setSelectedReviewRange((current) => {
      const matchesCurrent =
        current &&
        current.path === target.change.path &&
        current.hunkHeader === target.hunk.header &&
        current.side === target.side &&
        current.baseOid === baseOid &&
        current.headOid === headOid;

      if (!matchesCurrent) {
        return {
          path: target.change.path,
          baseOid,
          headOid,
          hunkHeader: target.hunk.header,
          side: target.side,
          startLine: target.lineNumber,
          endLine: target.lineNumber,
          anchorLine: target.lineNumber
        };
      }

      if (
        current.startLine === current.endLine &&
        current.anchorLine === target.lineNumber &&
        current.startLine === target.lineNumber
      ) {
        return null;
      }

      return {
        ...current,
        startLine: Math.min(current.anchorLine, target.lineNumber),
        endLine: Math.max(current.anchorLine, target.lineNumber)
      };
    });
  }

  function isSelectedDiffLine(target: RepositoryDiffLineTarget): boolean {
    if (!selectedReviewRange) {
      return false;
    }
    return (
      selectedReviewRange.path === target.change.path &&
      selectedReviewRange.hunkHeader === target.hunk.header &&
      selectedReviewRange.side === target.side &&
      selectedReviewRange.baseOid === (comparison?.mergeBaseOid ?? comparison?.baseOid) &&
      selectedReviewRange.headOid === comparison?.headOid &&
      target.lineNumber >= selectedReviewRange.startLine &&
      target.lineNumber <= selectedReviewRange.endLine
    );
  }

  async function submitReviewThreadComment(thread: PullRequestReviewThreadRecord) {
    if (
      !pullRequest ||
      !canReview ||
      thread.status !== "open" ||
      pullRequest.state !== "open" ||
      replySubmittingThreadId !== null
    ) {
      return;
    }

    const trimmedBody = (threadReplyBodies[thread.id] ?? "").trim();
    const trimmedSuggestedCode =
      canSuggestChangeOnReviewThread(thread)
        ? (threadReplySuggestedCodes[thread.id] ?? "").trim()
        : "";
    if (!trimmedBody && !trimmedSuggestedCode) {
      setError("Review thread replies require either a comment or suggested code.");
      return;
    }

    setReplySubmittingThreadId(thread.id);
    setError(null);
    try {
      const updatedThread = await createPullRequestReviewThreadComment(owner, repo, number, thread.id, {
        ...(trimmedBody ? { body: trimmedBody } : {}),
        ...(trimmedSuggestedCode ? { suggestedCode: trimmedSuggestedCode } : {})
      });
      setReviewThreads((previous) =>
        sortReviewThreads(
          previous.map((currentThread) =>
            currentThread.id === thread.id ? updatedThread : currentThread
          )
        )
      );
      setThreadReplyBodies((previous) => ({ ...previous, [thread.id]: "" }));
      setThreadReplySuggestedCodes((previous) => ({ ...previous, [thread.id]: "" }));
      await refreshPullRequestDetail();
    } catch (replyError) {
      setError(formatApiError(replyError));
    } finally {
      setReplySubmittingThreadId(null);
    }
  }

  function renderInlineReviewThreads(context: RepositoryDiffLineRenderContext) {
    const matchingThreads = reviewThreads.filter((thread) => {
      const currentAnchor = getCurrentReviewThreadAnchor(thread);
      if (!currentAnchor || currentAnchor.path !== context.change.path) {
        return false;
      }
      if (currentAnchor.hunk_header && currentAnchor.hunk_header !== context.hunk.header) {
        return false;
      }
      const lineNumber =
        currentAnchor.end_side === "base" ? context.line.oldLineNumber : context.line.newLineNumber;
      return lineNumber !== null && lineNumber === currentAnchor.end_line;
    });

    if (matchingThreads.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {matchingThreads.map((thread) => (
          <div
            key={thread.id}
            className="rounded-md border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground"
          >
            <span className="font-medium text-foreground">{thread.status}</span>{" "}
            <span>{formatReviewThreadAnchor(thread)}</span>
            {thread.anchor?.status === "reanchored" ? (
              <span className="ml-1 text-foreground">reanchored</span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  async function handleResolveReviewThread(threadId: string) {
    if (!canReview || resolvingThreadId) {
      return;
    }

    setResolvingThreadId(threadId);
    setError(null);
    try {
      const resolved = await resolvePullRequestReviewThread(owner, repo, number, threadId);
      setReviewThreads((previous) =>
        sortReviewThreads(
          previous.map((thread) => (thread.id === threadId ? resolved : thread))
        )
      );
      await refreshPullRequestDetail();
    } catch (resolveError) {
      setError(formatApiError(resolveError));
    } finally {
      setResolvingThreadId(null);
    }
  }

  async function togglePullRequestReaction(content: ReactionContent, viewerReacted: boolean) {
    if (!pullRequest || !canReact) {
      return;
    }
    const reactionKey = `pull:${pullRequest.id}`;
    setReactionPendingKey(reactionKey);
    setError(null);
    try {
      const reactions = viewerReacted
        ? await removeReaction(owner, repo, {
            subjectType: "pull_request",
            subjectId: pullRequest.id,
            content
          })
        : await addReaction(owner, repo, {
            subjectType: "pull_request",
            subjectId: pullRequest.id,
            content
          });
      setPullRequest((previous) => (previous ? { ...previous, reactions } : previous));
    } catch (error) {
      setError(formatApiError(error));
    } finally {
      setReactionPendingKey(null);
    }
  }

  async function toggleReviewReaction(
    reviewId: string,
    content: ReactionContent,
    viewerReacted: boolean
  ) {
    if (!canReact) {
      return;
    }
    const reactionKey = `review:${reviewId}`;
    setReactionPendingKey(reactionKey);
    setError(null);
    try {
      const reactions = viewerReacted
        ? await removeReaction(owner, repo, {
            subjectType: "pull_request_review",
            subjectId: reviewId,
            content
          })
        : await addReaction(owner, repo, {
            subjectType: "pull_request_review",
            subjectId: reviewId,
            content
          });
      setReviews((previous) =>
        previous.map((review) => (review.id === reviewId ? { ...review, reactions } : review))
      );
    } catch (error) {
      setError(formatApiError(error));
    } finally {
      setReactionPendingKey(null);
    }
  }

  async function handleResumeAgent(threadId?: string) {
    if (!canRunAgents || !pullRequest || pullRequest.state !== "open" || agentSubmitting) {
      return;
    }

    setAgentSubmitting(true);
    setAgentResumeThreadId(threadId ?? null);
    setError(null);
    try {
      const response = await resumePullRequestAgent(owner, repo, number, {
        agentType: selectedAgentType,
        ...(threadId ? { threadId } : {}),
        ...(agentInstruction.trim() ? { prompt: agentInstruction.trim() } : {})
      });
      const nextProvenance = await getPullRequestProvenance(owner, repo, number).catch(() => null);
      setLatestAgentSession(response.session);
      setLatestActionRun(response.run);
      if (nextProvenance) {
        setProvenanceDetail(nextProvenance.latestSession);
      }
      await refreshPullRequestDetail();
      setAgentInstruction("");
    } catch (resumeError) {
      setError(formatApiError(resumeError));
    } finally {
      setAgentSubmitting(false);
      setAgentResumeThreadId(null);
    }
  }

  const openReviewThreadCount = reviewThreads.filter((thread) => thread.status === "open").length;
  const resolvedReviewThreadCount = reviewThreads.length - openReviewThreadCount;
  const selectedRangeSupportsSuggestion = selectedReviewRange?.side === "head";
  const latestValidationRun = provenanceDetail?.linkedRun ?? latestActionRun;
  const latestValidationSession = provenanceDetail?.session ?? latestAgentSession;
  const latestValidationState = latestValidationStatus(
    provenanceDetail,
    latestActionRun,
    latestAgentSession
  );
  const validationSummary = provenanceDetail?.validationSummary ?? null;
  const validationPassed = latestValidationState === "success";
  const validationDurationMs = validationSummary?.duration_ms ?? null;
  const validationExitCode = validationSummary?.exit_code ?? null;
  const validationStdoutChars = validationSummary?.stdout_chars ?? null;
  const validationStderrChars = validationSummary?.stderr_chars ?? null;
  const highlightedArtifacts = highlightedValidationArtifacts(provenanceDetail);
  const unresolvedClosingIssues = closingIssues.filter((issue) => issue.task_status !== "done");
  const suggestedReviewThread =
    currentTaskFlow.suggested_review_thread_id !== null
      ? reviewThreads.find((thread) => thread.id === currentTaskFlow.suggested_review_thread_id) ??
        null
      : null;
  const primaryResumeThreadId = suggestedReviewThread?.id ?? null;
  const primaryResumeLabel =
    primaryResumeThreadId !== null ? "继续 Agent 处理 review thread" : "继续 Agent 处理当前 PR";
  const mergeReady =
    pullRequest.state === "open" &&
    comparison?.mergeable === "mergeable" &&
    openReviewThreadCount === 0 &&
    reviewSummary.changeRequests === 0 &&
    validationPassed &&
    unresolvedClosingIssues.length === 0;
  const mergeSummaryHeadline =
    pullRequest.state !== "open"
      ? "This pull request is no longer open."
      : mergeReady
        ? "The pull request is in a merge-ready shape for human review."
        : "The pull request still has open items before merge.";
  const mergeSummaryDetail =
    pullRequest.state !== "open"
      ? "Further review should focus on historical context rather than merge readiness."
      : comparison?.mergeable !== "mergeable"
        ? "Resolve merge conflicts before a human decides to merge."
        : openReviewThreadCount > 0
          ? "Resolve or explicitly acknowledge the remaining open review threads."
          : reviewSummary.changeRequests > 0
            ? "There are still change-request reviews that need a follow-up pass."
            : unresolvedClosingIssues.length > 0
              ? "Linked issues still have unfinished task states or acceptance criteria to review."
            : !validationPassed
              ? "Run one more successful validation pass so the final reviewer can judge the latest code state."
              : "Validation, review threads, and mergeability all look aligned for a final human decision.";

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <header className="space-y-2 rounded-md border bg-[#f6f8fa] p-4">
        <h1 className="text-xl font-semibold">
          {pullRequest.title} <span className="text-muted-foreground">#{pullRequest.number}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <RepositoryStateBadge state={pullRequest.state} kind="pull_request" />
          <span>{pullRequest.author_username}</span>
          <span>opened {formatRelativeTime(pullRequest.created_at)}</span>
          <span>updated {formatDateTime(pullRequest.updated_at)}</span>
          {latestActionRun ? (
            <Link
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              to={`/repo/${owner}/${repo}/actions?runId=${latestActionRun.id}`}
            >
              <ActionStatusBadge status={latestActionRun.status} withDot className="border-0 bg-transparent p-0 text-[11px] font-normal text-inherit shadow-none" />
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {stripHeadsRef(pullRequest.head_ref)} → {stripHeadsRef(pullRequest.base_ref)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Approvals: {reviewSummary.approvals}</Badge>
          <Badge variant="outline">Changes requested: {reviewSummary.changeRequests}</Badge>
          <Badge variant="outline">Comments: {reviewSummary.comments}</Badge>
          <Badge variant={mergeReady ? "default" : "secondary"}>
            {mergeReady ? "Ready for human merge review" : "Needs attention"}
          </Badge>
          {comparison ? (
            <>
              <Badge variant={mergeabilityBadgeVariant(comparison.mergeable)}>
                {mergeabilityLabel(comparison.mergeable)}
              </Badge>
              <Badge variant="outline">Ahead: {comparison.aheadBy}</Badge>
              <Badge variant="outline">Behind: {comparison.behindBy}</Badge>
              <Badge variant="outline">Files changed: {comparison.filesChanged}</Badge>
              <Badge variant="outline">+{comparison.additions}</Badge>
              <Badge variant="outline">-{comparison.deletions}</Badge>
            </>
          ) : null}
        </div>
        {closingIssues.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Will close on merge:</span>
            {closingIssues.map((issue) => (
              <Link
                key={issue.id}
                className="text-[#0969da] hover:underline"
                to={`/repo/${owner}/${repo}/issues/${issue.number}`}
              >
                #{issue.number}
              </Link>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to={`/repo/${owner}/${repo}/pulls`}>返回 Pull requests</Link>
          </Button>
          {canUpdate ? (
            <PendingButton
              variant={pullRequest.state === "open" ? "secondary" : "default"}
              pending={updateIntent === "closed" || updateIntent === "open"}
              disabled={updating && updateIntent === "merged"}
              pendingText={
                updateIntent === "closed" ? "Closing pull request..." : "Reopening pull request..."
              }
              onClick={() => {
                void changeState(pullRequest.state === "open" ? "closed" : "open");
              }}
            >
              {pullRequest.state === "open" ? "Close pull request" : "Reopen pull request"}
            </PendingButton>
          ) : null}
          {canUpdate && pullRequest.state === "open" ? (
            <PendingButton
              pending={updateIntent === "merged"}
              disabled={updating && updateIntent !== "merged"}
              pendingText="Merging pull request..."
              onClick={() => {
                void changeState("merged");
              }}
            >
              Squash and merge
            </PendingButton>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-md border p-4">
            <MarkdownBody content={pullRequest.body} emptyText="(no description)" />
            <ReactionStrip
              reactions={pullRequest.reactions}
              disabled={reactionPendingKey === `pull:${pullRequest.id}`}
              onToggle={
                canReact
                  ? (content, viewerReacted) => {
                      void togglePullRequestReaction(content, viewerReacted);
                    }
                  : undefined
              }
            />
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Validation summary</h2>
                <p className="text-sm text-muted-foreground">
                  直接展示最近一轮 Agent 交付、验证结果和关键 artifact，不再要求先跳到 Session 页。
                </p>
              </div>
              {latestValidationState ? <ActionStatusBadge status={latestValidationState} /> : null}
            </div>
            {latestValidationRun || latestValidationSession ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                    <p className="text-sm font-medium">Latest validation run</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {latestValidationRun ? (
                        <>
                          <Badge variant="outline">
                            {latestValidationRun.workflow_name || "Run"} #{latestValidationRun.run_number}
                          </Badge>
                          <Badge variant="outline">agent: {latestValidationRun.agent_type}</Badge>
                        </>
                      ) : null}
                      {validationDurationMs !== null ? (
                        <Badge variant="outline">{Math.round(validationDurationMs)} ms</Badge>
                      ) : null}
                      {validationExitCode !== null ? (
                        <Badge variant="outline">exit: {Math.round(validationExitCode)}</Badge>
                      ) : null}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>Updated: {formatDateTime(latestValidationRun?.updated_at ?? latestValidationSession?.updated_at ?? null)}</p>
                      <p>
                        Duration:{" "}
                        {formatDuration(
                          latestValidationRun?.started_at ?? latestValidationSession?.started_at ?? null,
                          latestValidationRun?.completed_at ?? latestValidationSession?.completed_at ?? null
                        )}
                      </p>
                      {latestValidationRun ? (
                        <p>
                          {latestValidationRun.trigger_ref ?? "-"} · triggered by{" "}
                          {latestValidationRun.triggered_by_username ?? "system"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                    <p className="text-sm font-medium">Latest agent update</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {latestValidationSession ? (
                        <>
                          <Badge variant="outline">{latestValidationSession.origin}</Badge>
                          <Badge variant="outline">{latestValidationSession.agent_type}</Badge>
                        </>
                      ) : null}
                      {provenanceDetail ? (
                        <Badge variant="outline">
                          interventions: {provenanceDetail.interventions.length}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {latestValidationSession ? <p>Session: {latestValidationSession.id}</p> : null}
                      <p>Branch: {latestValidationSession?.branch_ref ?? pullRequest.head_ref}</p>
                      <p>Triggered by: {latestValidationSession?.created_by_username ?? "system"}</p>
                      <p>Updated: {formatDateTime(latestValidationSession?.updated_at ?? null)}</p>
                    </div>
                  </div>
                </div>
                {provenanceDetail ? (
                  <>
                    <div className="space-y-2 rounded-md border bg-background/70 p-3">
                      <p className="text-sm font-medium">
                        {validationSummary?.headline ?? "Structured validation summary unavailable."}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {validationSummary?.detail ??
                          "The latest validation output has not been turned into a reviewable summary yet."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">
                        artifacts: {provenanceDetail.artifacts.length}
                      </Badge>
                      <Badge variant="outline">
                        stdout: {validationStdoutChars !== null ? Math.round(validationStdoutChars).toLocaleString() : "-"} chars
                      </Badge>
                      <Badge variant="outline">
                        stderr: {validationStderrChars !== null ? Math.round(validationStderrChars).toLocaleString() : "-"} chars
                      </Badge>
                    </div>
                    {validationSummary?.checks.length ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        {validationSummary.checks.map((check) => (
                          <div
                            key={`${check.kind}:${check.scope ?? ""}:${check.command}`}
                            className="space-y-2 rounded-md border bg-background/70 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={validationCheckBadgeVariant(check.status)}>
                                {validationCheckStatusLabel(check)}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium">{check.command}</p>
                            <p className="text-xs text-muted-foreground">{check.summary}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        当前还没有从输出中识别出明确的 test / build / lint 命令。
                      </p>
                    )}
                    {highlightedArtifacts.length > 0 ? (
                      <div className="space-y-3">
                        {highlightedArtifacts.map((artifact) => (
                          <div key={artifact.id} className="space-y-1 rounded-md border bg-background/70 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline">{artifact.kind}</Badge>
                              <span>{artifact.title}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {excerptText(artifact.content_text, 220) || "(empty artifact)"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">暂无关键 artifact 摘要。</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    当前只拿到最新 run / session 状态，尚无更完整的 provenance 摘要。
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">当前 PR 还没有可用的验证结果。</p>
            )}
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Merge summary</h2>
              <p className="text-sm text-muted-foreground">
                在一个地方汇总 mergeability、review 反馈、验证状态和关联 Issue 的完成度。
              </p>
            </div>
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <p className="text-sm font-medium">{mergeSummaryHeadline}</p>
              <p className="text-sm text-muted-foreground">{mergeSummaryDetail}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {comparison ? (
                  <Badge variant={mergeabilityBadgeVariant(comparison.mergeable)}>
                    {mergeabilityLabel(comparison.mergeable)}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Mergeability unknown</Badge>
                )}
                <Badge variant="outline">Open threads: {openReviewThreadCount}</Badge>
                <Badge variant="outline">Change requests: {reviewSummary.changeRequests}</Badge>
                <Badge variant="outline">
                  Validation: {latestValidationState ?? "missing"}
                </Badge>
                <Badge variant="outline">Linked issues: {closingIssues.length}</Badge>
                <Badge variant="outline">
                  Issues not done: {unresolvedClosingIssues.length}
                </Badge>
              </div>
            </div>
            {closingIssues.length > 0 ? (
              <div className="space-y-3">
                {closingIssues.map((issue) => (
                  <div key={issue.id} className="space-y-2 rounded-md border bg-background/70 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="text-sm font-medium gh-link"
                        to={`/repo/${owner}/${repo}/issues/${issue.number}`}
                      >
                        Issue #{issue.number} {issue.title}
                      </Link>
                      <IssueTaskStatusBadge status={issue.task_status} />
                      <RepositoryStateBadge state={issue.state} kind="issue" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Acceptance criteria:{" "}
                      {issue.acceptance_criteria.trim()
                        ? excerptText(issue.acceptance_criteria, 180)
                        : "(none)"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">当前 PR 没有关联关闭的 Issue。</p>
            )}
          </section>

          {comparison ? (
            <section className="space-y-3 rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Files changed</h2>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{comparison.filesChanged} files</Badge>
                  <Badge variant="outline">+{comparison.additions}</Badge>
                  <Badge variant="outline">-{comparison.deletions}</Badge>
                </div>
              </div>
              {canReview ? (
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">Selected diff range</h3>
                      {selectedReviewRange ? (
                        <>
                          <p className="font-mono text-xs text-foreground">
                            {formatSelectedReviewRange(selectedReviewRange)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Compare {shortOid(selectedReviewRange.baseOid)}..{shortOid(selectedReviewRange.headOid)} ·{" "}
                            {selectedReviewRange.hunkHeader}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Click a diff line number to start a thread. Click another line on the same side and hunk
                          to expand the range.
                        </p>
                      )}
                    </div>
                    {selectedReviewRange ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedReviewRange(null);
                          setReviewThreadSuggestedCode("");
                        }}
                      >
                        Clear selection
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-3">
                    <MarkdownEditor
                      label="Thread body"
                      value={reviewThreadBody}
                      onChange={setReviewThreadBody}
                      rows={4}
                      placeholder="Describe the requested change for this diff range"
                      previewEmptyText="Nothing to preview."
                    />
                    <div className="space-y-2">
                      <Label htmlFor="review-thread-suggested-code">Suggested change</Label>
                      <Textarea
                        id="review-thread-suggested-code"
                        value={reviewThreadSuggestedCode}
                        onChange={(event) => setReviewThreadSuggestedCode(event.target.value)}
                        rows={6}
                        disabled={!selectedRangeSupportsSuggestion}
                        placeholder={
                          selectedRangeSupportsSuggestion
                            ? "Optional replacement code for the selected head-side range"
                            : "Suggested changes are only available for head-side ranges"
                        }
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <PendingButton
                        onClick={() => {
                          void submitReviewThread();
                        }}
                        pending={reviewThreadSubmitting}
                        disabled={
                          reviewThreadSubmitting || pullRequest.state !== "open" || !selectedReviewRange
                        }
                        pendingText="Creating thread..."
                      >
                        Create review thread
                      </PendingButton>
                    </div>
                  </div>
                </div>
              ) : null}
              <RepositoryDiffView
                changes={comparison.changes}
                onDiffLineClick={canReview ? handleDiffLineSelection : undefined}
                isDiffLineSelected={selectedReviewRange ? isSelectedDiffLine : undefined}
                renderAfterDiffLine={renderInlineReviewThreads}
              />
            </section>
          ) : null}

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-base font-semibold">Reviews</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无 review。</p>
            ) : (
              <ul className="space-y-3">
                {reviews.map((review) => (
                  <li key={review.id} className="rounded-md border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant={
                          review.decision === "approve"
                            ? "default"
                            : review.decision === "request_changes"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {review.decision}
                      </Badge>
                      <span>{review.reviewer_username}</span>
                      <span>reviewed {formatRelativeTime(review.created_at)}</span>
                      <span>{formatDateTime(review.created_at)}</span>
                    </div>
                    <div className="mt-2">
                      <MarkdownBody content={review.body} emptyText="(no comment)" />
                    </div>
                    <div className="mt-3">
                      <ReactionStrip
                        reactions={review.reactions}
                        disabled={reactionPendingKey === `review:${review.id}`}
                        onToggle={
                          canReact
                            ? (content, viewerReacted) => {
                                void toggleReviewReaction(review.id, content, viewerReacted);
                              }
                            : undefined
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Review threads</h2>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Open: {openReviewThreadCount}</Badge>
                <Badge variant="outline">Resolved: {resolvedReviewThreadCount}</Badge>
              </div>
            </div>
            {reviewThreads.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无行级 review thread。</p>
            ) : (
              <ul className="space-y-3">
                {reviewThreads.map((thread) => (
                  <li
                    key={thread.id}
                    id={`review-thread-${thread.id}`}
                    className="rounded-md border bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={thread.status === "open" ? "secondary" : "outline"}>
                        {thread.status}
                      </Badge>
                      {thread.anchor?.status === "reanchored" ? (
                        <Badge variant="outline">reanchored</Badge>
                      ) : null}
                      {thread.anchor?.status === "stale" ? (
                        <Badge variant="destructive">stale</Badge>
                      ) : null}
                      {thread.anchor?.patchset_changed ? (
                        <Badge variant="outline">new commits</Badge>
                      ) : null}
                      <span>{thread.author_username}</span>
                      <span>{formatReviewThreadAnchor(thread)}</span>
                      {thread.base_oid && thread.head_oid ? (
                        <span>
                          {shortOid(thread.base_oid)}..{shortOid(thread.head_oid)}
                        </span>
                      ) : null}
                      {(thread.anchor?.hunk_header ?? thread.hunk_header) ? (
                        <span>{thread.anchor?.hunk_header ?? thread.hunk_header}</span>
                      ) : null}
                      <span>created {formatRelativeTime(thread.created_at)}</span>
                      <span>{formatDateTime(thread.created_at)}</span>
                    </div>
                    {thread.anchor ? (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {thread.anchor.status !== "current" || thread.anchor.patchset_changed ? (
                          <p>{thread.anchor.message}</p>
                        ) : null}
                        {thread.anchor.status !== "current" ? (
                          <p>Original anchor: {formatOriginalReviewThreadAnchor(thread)}</p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-3">
                      {thread.comments.map((comment) => (
                        <div key={comment.id} className="rounded-md border bg-background/80 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{comment.author_username}</span>
                            <span>{formatRelativeTime(comment.created_at)}</span>
                            <span>{formatDateTime(comment.created_at)}</span>
                          </div>
                          <div className="mt-2">
                            <MarkdownBody content={comment.body} emptyText="(no comment)" />
                          </div>
                          {comment.suggestion ? (
                            <div className="mt-3 space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                              <p className="text-xs font-medium text-foreground">
                                Suggested change · {comment.suggestion.side} {comment.suggestion.start_line}-
                                {comment.suggestion.end_line}
                              </p>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-background px-3 py-2 font-mono text-xs text-foreground">
                                {comment.suggestion.code}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {thread.status === "resolved" ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Resolved by {thread.resolved_by_username ?? "unknown"}{" "}
                        {thread.resolved_at ? formatRelativeTime(thread.resolved_at) : ""}.
                      </p>
                    ) : null}
                    {thread.status === "open" ? (
                      <div className="mt-3 space-y-3">
                        {canReview ? (
                          <div className="space-y-3 rounded-md border bg-background/70 p-3">
                            <MarkdownEditor
                              label="Reply"
                              value={threadReplyBodies[thread.id] ?? ""}
                              onChange={(value) =>
                                setThreadReplyBodies((previous) => ({ ...previous, [thread.id]: value }))
                              }
                              rows={4}
                              placeholder="Add context or explain the requested change"
                              previewEmptyText="Nothing to preview."
                            />
                            <div className="space-y-2">
                              <Label htmlFor={`thread-suggested-code-${thread.id}`}>Suggested change</Label>
                              <Textarea
                                id={`thread-suggested-code-${thread.id}`}
                                value={threadReplySuggestedCodes[thread.id] ?? ""}
                                onChange={(event) =>
                                  setThreadReplySuggestedCodes((previous) => ({
                                    ...previous,
                                    [thread.id]: event.target.value
                                  }))
                                }
                                rows={5}
                                disabled={!canSuggestChangeOnReviewThread(thread)}
                                placeholder={
                                  canSuggestChangeOnReviewThread(thread)
                                    ? "Optional replacement code for this anchored range"
                                    : thread.anchor?.status === "stale"
                                      ? "Suggested changes are disabled until this thread maps to the current diff"
                                      : "Suggested changes are only available for head-side ranges"
                                }
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <PendingButton
                                size="sm"
                                pending={replySubmittingThreadId === thread.id}
                                disabled={replySubmittingThreadId !== null || pullRequest.state !== "open"}
                                pendingText="Replying..."
                                onClick={() => {
                                  void submitReviewThreadComment(thread);
                                }}
                              >
                                Reply
                              </PendingButton>
                              {canRunAgents ? (
                                <PendingButton
                                  size="sm"
                                  variant="outline"
                                  pending={agentSubmitting && agentResumeThreadId === thread.id}
                                  disabled={agentSubmitting || pullRequest.state !== "open"}
                                  pendingText="Resuming agent..."
                                  onClick={() => {
                                    void handleResumeAgent(thread.id);
                                  }}
                                >
                                  继续 Agent 处理 review thread
                                </PendingButton>
                              ) : null}
                              <PendingButton
                                size="sm"
                                variant="outline"
                                pending={resolvingThreadId === thread.id}
                                disabled={Boolean(resolvingThreadId)}
                                pendingText="Resolving..."
                                onClick={() => {
                                  void handleResolveReviewThread(thread.id);
                                }}
                              >
                                Resolve
                              </PendingButton>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {canRunAgents ? (
                              <PendingButton
                                size="sm"
                                variant="outline"
                                pending={agentSubmitting && agentResumeThreadId === thread.id}
                                disabled={agentSubmitting || pullRequest.state !== "open"}
                                pendingText="Resuming agent..."
                                onClick={() => {
                                  void handleResumeAgent(thread.id);
                                }}
                              >
                                继续 Agent 处理 review thread
                              </PendingButton>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canReview ? (
            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-base font-semibold">Submit review</h2>
              <div className="space-y-2">
                <Label htmlFor="review-decision">Decision</Label>
                <select
                  id="review-decision"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={reviewDecision}
                  onChange={(event) => setReviewDecision(event.target.value as PullRequestReviewDecision)}
                >
                  <option value="comment">Comment</option>
                  <option value="approve">Approve</option>
                  <option value="request_changes">Request changes</option>
                </select>
              </div>
              <MarkdownEditor
                label="Body"
                value={reviewBody}
                onChange={setReviewBody}
                rows={6}
                placeholder="Leave your review comments"
                previewEmptyText="Nothing to preview."
              />
              <div className="flex flex-wrap gap-2">
                <PendingButton
                  onClick={() => {
                    void submitReview();
                  }}
                  pending={reviewSubmitting}
                  disabled={reviewSubmitting}
                  pendingText="Submitting review..."
                >
                  Submit review
                </PendingButton>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="space-y-4 rounded-md border p-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Task chain / Handoff</h2>
              <p className="text-sm text-muted-foreground">
                将 linked issue、review/validation 状态和下一步 handoff 收拢到同一处。
              </p>
            </div>
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{taskFlowWaitingLabel(currentTaskFlow.waiting_on)}</Badge>
                {comparison ? (
                  <Badge variant={mergeabilityBadgeVariant(comparison.mergeable)}>
                    {mergeabilityLabel(comparison.mergeable)}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Mergeability unknown</Badge>
                )}
                <Badge variant="outline">Open threads: {openReviewThreadCount}</Badge>
                <Badge variant="outline">Change requests: {reviewSummary.changeRequests}</Badge>
                <Badge variant="outline">Validation: {latestValidationState ?? "missing"}</Badge>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{currentTaskFlow.headline}</p>
                <p className="text-sm text-muted-foreground">{currentTaskFlow.detail}</p>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {currentTaskFlow.primary_issue_number !== null ? (
                  <p>
                    Primary issue:{" "}
                    <Link
                      className="gh-link"
                      to={`/repo/${owner}/${repo}/issues/${currentTaskFlow.primary_issue_number}`}
                    >
                      #{currentTaskFlow.primary_issue_number}
                    </Link>
                  </p>
                ) : null}
                {suggestedReviewThread ? (
                  <p>
                    Default handoff thread:{" "}
                    <button
                      type="button"
                      className="gh-link text-left"
                      onClick={() => {
                        const element = document.getElementById(
                          `review-thread-${suggestedReviewThread.id}`
                        );
                        element?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      {formatReviewThreadAnchor(suggestedReviewThread)}
                    </button>
                  </p>
                ) : null}
                <p>
                  Main CTA:{" "}
                  {primaryResumeThreadId !== null
                    ? "默认继续最早的未解决 review thread。"
                    : "继续整个 PR 的下一轮 Agent 交付。"}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-md border p-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Agent handoff</h2>
              <p className="text-sm text-muted-foreground">
                最近一轮 session、验证摘要和继续 Agent 的主入口都收在这里。
              </p>
            </div>

            {provenanceDetail || latestAgentSession ? (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge
                    status={(provenanceDetail?.session ?? latestAgentSession)?.status ?? "queued"}
                  />
                  <span className="rounded-full border px-2 py-0.5 text-[11px]">
                    {(provenanceDetail?.session ?? latestAgentSession)?.agent_type}
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-[11px]">
                    {(provenanceDetail?.session ?? latestAgentSession)?.origin}
                  </span>
                  <Badge variant="outline">{taskFlowWaitingLabel(currentTaskFlow.waiting_on)}</Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Session: {(provenanceDetail?.session ?? latestAgentSession)?.id ?? "-"}</p>
                  <p>Branch: {(provenanceDetail?.session ?? latestAgentSession)?.branch_ref ?? "-"}</p>
                  <p>Source: {provenanceDetail?.sourceContext.title ?? "Current pull request"}</p>
                  <p>
                    Triggered by:{" "}
                    {(provenanceDetail?.session ?? latestAgentSession)?.created_by_username ?? "system"}
                  </p>
                  <p>
                    Updated:{" "}
                    {formatDateTime(
                      (provenanceDetail?.session ?? latestAgentSession)?.updated_at ?? null
                    )}
                  </p>
                </div>
                {validationSummary ? (
                  <div className="space-y-2 rounded-md border bg-background/70 p-3">
                    <p className="text-sm font-medium">{validationSummary.headline}</p>
                    <p className="text-xs text-muted-foreground">{validationSummary.detail}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">validation: {latestValidationState ?? "missing"}</Badge>
                      {validationDurationMs !== null ? (
                        <Badge variant="outline">{Math.round(validationDurationMs)} ms</Badge>
                      ) : null}
                      {validationExitCode !== null ? (
                        <Badge variant="outline">exit: {Math.round(validationExitCode)}</Badge>
                      ) : null}
                    </div>
                    {highlightedArtifacts.length > 0 ? (
                      <div className="space-y-2">
                        {highlightedArtifacts.slice(0, 2).map((artifact) => (
                          <div key={artifact.id} className="rounded-md border bg-muted/20 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline">{artifact.kind}</Badge>
                              <span>{artifact.title}</span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {excerptText(artifact.content_text, 160) || "(empty excerpt)"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      to={`/repo/${owner}/${repo}/agent-sessions/${(provenanceDetail?.session ?? latestAgentSession)?.id}`}
                    >
                      查看 session
                    </Link>
                  </Button>
                  {(provenanceDetail?.session ?? latestAgentSession)?.linked_run_id ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to={`/repo/${owner}/${repo}/actions?runId=${(provenanceDetail?.session ?? latestAgentSession)?.linked_run_id}`}
                      >
                        查看对应 run
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">当前 PR 还没有可展示的 Agent handoff。</p>
            )}

            {canRunAgents ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="pull-request-agent-type">Agent</Label>
                  <select
                    id="pull-request-agent-type"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={selectedAgentType}
                    onChange={(event) =>
                      setSelectedAgentType(event.target.value as ActionAgentType)
                    }
                  >
                    {allowedAgentTypes.map((agentType) => (
                      <option key={agentType} value={agentType}>
                        {agentType}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pull-request-agent-instruction">Extra instruction</Label>
                  <Textarea
                    id="pull-request-agent-instruction"
                    value={agentInstruction}
                    onChange={(event) => setAgentInstruction(event.target.value)}
                    rows={5}
                    placeholder="Optional guidance for the next iteration"
                  />
                </div>
                <PendingButton
                  pending={agentSubmitting && agentResumeThreadId === primaryResumeThreadId}
                  disabled={agentSubmitting || pullRequest.state !== "open"}
                  pendingText="Resuming agent..."
                  onClick={() => {
                    void handleResumeAgent(primaryResumeThreadId ?? undefined);
                  }}
                >
                  {primaryResumeLabel}
                </PendingButton>
                <p className="text-xs text-muted-foreground">
                  新 session 会继承当前 PR 标题、描述、Review 历史和 head 分支上下文。
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                仅仓库所有者或协作者可以从当前 PR 继续 Agent。
              </p>
            )}
          </section>

          <section className="rounded-md border p-4">
            <RepositoryMetadataFields
              canEdit={canUpdate}
              labels={availableLabels}
              selectedLabelIds={selectedLabelIds}
              onSelectedLabelIdsChange={setSelectedLabelIds}
              participants={participants}
              assigneeIds={selectedAssigneeIds}
              onAssigneeIdsChange={setSelectedAssigneeIds}
              reviewerIds={selectedReviewerIds}
              onReviewerIdsChange={setSelectedReviewerIds}
              milestones={availableMilestones}
              milestoneId={selectedMilestoneId}
              onMilestoneIdChange={setSelectedMilestoneId}
              draft={draft}
              onDraftChange={setDraft}
              onSave={() => {
                void saveMetadata();
              }}
              saving={metadataSaving}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
