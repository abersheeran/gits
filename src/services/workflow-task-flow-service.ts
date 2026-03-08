import type {
  ActionRunRecord,
  AgentSessionRecord,
  IssueLinkedPullRequestRecord,
  IssueRecord,
  IssueTaskFlowRecord,
  PullRequestRecord,
  PullRequestReviewThreadRecord,
  PullRequestTaskFlowRecord,
  RepositoryRecord
} from "../types";
import { ActionsService } from "./actions-service";
import { AgentSessionService } from "./agent-session-service";
import { IssueService } from "./issue-service";
import { PullRequestService } from "./pull-request-service";
import {
  RepositoryBrowserService,
  type RepositoryCompareResult
} from "./repository-browser-service";
import { StorageService } from "./storage-service";

function latestExecutionStatus(
  latestRun: ActionRunRecord | null,
  latestSession: AgentSessionRecord | null
): ActionRunRecord["status"] | AgentSessionRecord["status"] | null {
  if (latestRun && latestSession) {
    return latestSession.updated_at > latestRun.updated_at
      ? latestSession.status
      : latestRun.status;
  }
  return latestRun?.status ?? latestSession?.status ?? null;
}

export class WorkflowTaskFlowService {
  private readonly actionsService: ActionsService;

  private readonly agentSessionService: AgentSessionService;

  private readonly issueService: IssueService;

  private readonly pullRequestService: PullRequestService;

  private readonly browserService: RepositoryBrowserService;

  constructor(
    private readonly db: D1Database,
    storage: StorageService
  ) {
    this.actionsService = new ActionsService(db);
    this.agentSessionService = new AgentSessionService(db);
    this.issueService = new IssueService(db);
    this.pullRequestService = new PullRequestService(db);
    this.browserService = new RepositoryBrowserService(storage);
  }

  private async listLatestSourceState(
    repositoryId: string,
    sourceType: "issue" | "pull_request",
    sourceNumber: number
  ): Promise<{
    latestRun: ActionRunRecord | null;
    latestSession: AgentSessionRecord | null;
    latestStatus: ActionRunRecord["status"] | AgentSessionRecord["status"] | null;
  }> {
    const [latestRuns, latestSessions] = await Promise.all([
      this.actionsService.listLatestRunsBySource(repositoryId, sourceType, [sourceNumber]),
      this.agentSessionService.listLatestSessionsBySource(repositoryId, sourceType, [sourceNumber])
    ]);
    const latestRun = latestRuns[0] ?? null;
    const latestSession = latestSessions[0] ?? null;
    return {
      latestRun,
      latestSession,
      latestStatus: latestExecutionStatus(latestRun, latestSession)
    };
  }

  private async comparePullRequest(
    repository: RepositoryRecord,
    pullRequest: Pick<PullRequestRecord, "base_ref" | "head_ref">
  ): Promise<Pick<RepositoryCompareResult, "mergeable"> | null> {
    try {
      const comparison = await this.browserService.compareRefs({
        owner: repository.owner_username,
        repo: repository.name,
        baseRef: pullRequest.base_ref,
        headRef: pullRequest.head_ref
      });
      return { mergeable: comparison.mergeable };
    } catch {
      return { mergeable: "unknown" };
    }
  }

  async buildPullRequestTaskFlow(args: {
    repository: RepositoryRecord;
    pullRequest: Pick<PullRequestRecord, "number" | "state" | "title" | "base_ref" | "head_ref">;
    closingIssueNumbers?: number[];
    reviewSummary?: { approvals: number; changeRequests: number; comments: number };
    reviewThreads?: PullRequestReviewThreadRecord[];
    comparison?: Pick<RepositoryCompareResult, "mergeable"> | null;
  }): Promise<PullRequestTaskFlowRecord> {
    const [reviewSummary, reviewThreads, closingIssueNumbers, sourceState, comparison] =
      await Promise.all([
        args.reviewSummary ??
          this.pullRequestService.summarizePullRequestReviews(
            args.repository.id,
            args.pullRequest.number
          ),
        args.reviewThreads ??
          this.pullRequestService.listPullRequestReviewThreads(
            args.repository.id,
            args.pullRequest.number
          ),
        args.closingIssueNumbers ??
          this.pullRequestService.listPullRequestClosingIssueNumbers(
            args.repository.id,
            args.pullRequest.number
          ),
        this.listLatestSourceState(args.repository.id, "pull_request", args.pullRequest.number),
        args.comparison ?? this.comparePullRequest(args.repository, args.pullRequest)
      ]);

    const primaryIssueNumber = closingIssueNumbers[0] ?? null;
    const openReviewThreads = [...reviewThreads]
      .filter((thread) => thread.status === "open")
      .sort((left, right) => left.created_at - right.created_at);
    const suggestedReviewThreadId = openReviewThreads[0]?.id ?? null;

    if (args.pullRequest.state === "merged") {
      return {
        waiting_on: "none",
        headline: "当前 PR 已合并，主流程应当收敛到已完成状态。",
        detail: primaryIssueNumber
          ? `关联 Issue #${primaryIssueNumber} 应已进入 done。`
          : "后续动作应以回看产物或继续其他任务为主。",
        primary_issue_number: primaryIssueNumber,
        suggested_review_thread_id: null
      };
    }

    if (args.pullRequest.state === "closed") {
      return {
        waiting_on: "none",
        headline: "当前 PR 已关闭，暂不处于活跃交付链路中。",
        detail: primaryIssueNumber
          ? `若仍需完成 Issue #${primaryIssueNumber}，需要重新开启新的交付分支或 PR。`
          : "如需继续推进，应重新发起新的交付动作。",
        primary_issue_number: primaryIssueNumber,
        suggested_review_thread_id: null
      };
    }

    if (sourceState.latestStatus === "queued" || sourceState.latestStatus === "running") {
      return {
        waiting_on: "agent",
        headline: "Agent 正在更新当前 PR。",
        detail: suggestedReviewThreadId
          ? "本轮交付结束后应优先检查最早的未解决 review thread。"
          : "等待本轮代码修改、验证结果和交付摘要回写。",
        primary_issue_number: primaryIssueNumber,
        suggested_review_thread_id: suggestedReviewThreadId
      };
    }

    if (comparison?.mergeable !== "mergeable") {
      return {
        waiting_on: "agent",
        headline: "PR 仍有冲突或 mergeability 未确认，下一步属于 Agent。",
        detail: "需要先把当前分支整理到可继续评审的状态，再进入人工审校。",
        primary_issue_number: primaryIssueNumber,
        suggested_review_thread_id: suggestedReviewThreadId
      };
    }

    if (openReviewThreads.length > 0) {
      return {
        waiting_on: "agent",
        headline: `PR 还有 ${openReviewThreads.length} 条未解决 review thread。`,
        detail: suggestedReviewThreadId
          ? "优先从最早的未解决 review thread 继续 Agent，消化当前反馈。"
          : "需要先处理 review 反馈，再继续最终合并判断。",
        primary_issue_number: primaryIssueNumber,
        suggested_review_thread_id: suggestedReviewThreadId
      };
    }

    if (reviewSummary.changeRequests > 0) {
      return {
        waiting_on: "agent",
        headline: "当前 PR 仍有 change request 待处理。",
        detail: "需要先完成被要求的修改，再回到人工最终审校。",
        primary_issue_number: primaryIssueNumber,
        suggested_review_thread_id: suggestedReviewThreadId
      };
    }

    if (sourceState.latestStatus !== "success") {
      return {
        waiting_on: "agent",
        headline:
          sourceState.latestStatus === null
            ? "当前 PR 还没有可用于最终判断的验证结果。"
            : `当前 PR 的最新验证状态为 ${sourceState.latestStatus}。`,
        detail: "需要先完成一轮可审校的 Agent 交付和验证，再进入人工合并判断。",
        primary_issue_number: primaryIssueNumber,
        suggested_review_thread_id: suggestedReviewThreadId
      };
    }

    return {
      waiting_on: "human",
      headline: "当前 PR 已进入待人工审校/合并阶段。",
      detail: primaryIssueNumber
        ? `关联 Issue #${primaryIssueNumber} 的当前交付已收敛到人工确认阶段。`
        : "当前 review、验证和 mergeability 已对齐，等待人工决定是否合并。",
      primary_issue_number: primaryIssueNumber,
      suggested_review_thread_id: suggestedReviewThreadId
    };
  }

  async buildIssueTaskFlow(args: {
    repository: RepositoryRecord;
    issue: IssueRecord;
    linkedPullRequests?: IssueLinkedPullRequestRecord[];
  }): Promise<IssueTaskFlowRecord> {
    if (args.issue.state === "closed") {
      return {
        status: "done",
        waiting_on: "none",
        headline: "当前 Issue 已关闭，主流程已收敛。",
        detail: "后续动作应以回看交付结果或继续其他任务为主。",
        driver_pull_request_number: null
      };
    }

    const linkedPullRequests =
      args.linkedPullRequests ??
      (await this.issueService.listLinkedPullRequestsForIssue(
        args.repository.id,
        args.issue.number
      ));
    const openLinkedPullRequests = [...linkedPullRequests]
      .filter((pullRequest) => pullRequest.state === "open")
      .sort((left, right) => left.number - right.number);

    if (openLinkedPullRequests.length > 0) {
      const flows = await Promise.all(
        openLinkedPullRequests.map(async (pullRequest) => ({
          pullRequest,
          flow: await this.buildPullRequestTaskFlow({
            repository: args.repository,
            pullRequest,
            closingIssueNumbers: [args.issue.number]
          })
        }))
      );

      const waitingOnAgent = flows.find((entry) => entry.flow.waiting_on === "agent");
      if (waitingOnAgent) {
        return {
          status: "agent-working",
          waiting_on: "agent",
          headline: `PR #${waitingOnAgent.pullRequest.number} 正在推进当前 Issue。`,
          detail: waitingOnAgent.flow.detail,
          driver_pull_request_number: waitingOnAgent.pullRequest.number
        };
      }

      const waitingOnHuman = flows.find((entry) => entry.flow.waiting_on === "human");
      if (waitingOnHuman) {
        return {
          status: "waiting-human",
          waiting_on: "human",
          headline: `PR #${waitingOnHuman.pullRequest.number} 已进入待人工确认阶段。`,
          detail: waitingOnHuman.flow.detail,
          driver_pull_request_number: waitingOnHuman.pullRequest.number
        };
      }
    }

    const sourceState = await this.listLatestSourceState(args.repository.id, "issue", args.issue.number);
    if (sourceState.latestStatus === "queued" || sourceState.latestStatus === "running") {
      return {
        status: "agent-working",
        waiting_on: "agent",
        headline: "Agent 正在直接推进当前 Issue。",
        detail: "等待本轮实现、提问或交付结果回写。",
        driver_pull_request_number: null
      };
    }

    if (sourceState.latestStatus !== null) {
      return {
        status: "waiting-human",
        waiting_on: "human",
        headline: "Issue 的上一轮 Agent 交付已经结束。",
        detail: "下一步需要人类确认结果、补充信息，或决定是否继续让 Agent 推进。",
        driver_pull_request_number: null
      };
    }

    return {
      status: "open",
      waiting_on: "none",
      headline: "当前 Issue 还没有进入活跃交付阶段。",
      detail: "下一步可以补充验收标准，或直接分配 / 继续 Agent。",
      driver_pull_request_number: null
    };
  }

  async reconcileIssueTaskStatus(args: {
    repository: RepositoryRecord;
    issueNumber: number;
    viewerId?: string;
  }): Promise<IssueRecord | null> {
    const issue = await this.issueService.findIssueByNumber(
      args.repository.id,
      args.issueNumber,
      args.viewerId
    );
    if (!issue) {
      return null;
    }

    const linkedPullRequests = await this.issueService.listLinkedPullRequestsForIssue(
      args.repository.id,
      args.issueNumber
    );
    const taskFlow = await this.buildIssueTaskFlow({
      repository: args.repository,
      issue,
      linkedPullRequests
    });
    if (issue.task_status === taskFlow.status) {
      return issue;
    }
    return this.issueService.updateIssue(args.repository.id, args.issueNumber, {
      taskStatus: taskFlow.status
    });
  }

  async reconcileIssuesForPullRequest(args: {
    repository: RepositoryRecord;
    pullRequestNumber: number;
    viewerId?: string;
  }): Promise<IssueRecord[]> {
    const closingIssueNumbers = await this.pullRequestService.listPullRequestClosingIssueNumbers(
      args.repository.id,
      args.pullRequestNumber
    );
    if (closingIssueNumbers.length === 0) {
      return [];
    }
    const reconciled = await Promise.all(
      closingIssueNumbers.map((issueNumber) =>
        this.reconcileIssueTaskStatus({
          repository: args.repository,
          issueNumber,
          ...(args.viewerId ? { viewerId: args.viewerId } : {})
        })
      )
    );
    return reconciled.filter((issue): issue is IssueRecord => issue !== null);
  }

  async reconcileSourceTaskStatus(args: {
    repository: RepositoryRecord;
    sourceType: "issue" | "pull_request";
    sourceNumber: number;
  }): Promise<IssueRecord[]> {
    if (args.sourceType === "issue") {
      const reconciled = await this.reconcileIssueTaskStatus({
        repository: args.repository,
        issueNumber: args.sourceNumber
      });
      return reconciled ? [reconciled] : [];
    }

    return this.reconcileIssuesForPullRequest({
      repository: args.repository,
      pullRequestNumber: args.sourceNumber
    });
  }
}
