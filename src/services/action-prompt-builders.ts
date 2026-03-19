import { ISSUE_PR_CREATE_TOKEN_PLACEHOLDER } from "./action-runner-prompt-tokens";
import { createRepositoryObjectClient } from "./repository-object";
import type {
  IssueCommentRecord,
  PullRequestReviewDecision,
  PullRequestReviewThreadRecord,
  RepositoryRecord
} from "../types";

export function buildMentionPrompt(input: { title: string; body: string }): string {
  if (!input.body.trim()) {
    return input.title;
  }
  return `${input.title}\n\n${input.body}`;
}

export function buildIssueConversationHistory(input: {
  issueAuthorUsername: string;
  issueBody: string;
  issueAcceptanceCriteria: string;
  comments: readonly IssueCommentRecord[];
}): string {
  const sections: string[] = [];
  sections.push(`[Issue Description by @${input.issueAuthorUsername}]`);
  sections.push(input.issueBody.trim() ? input.issueBody : "(empty)");
  sections.push("");
  sections.push("[Acceptance Criteria]");
  const acceptanceCriteria = input.issueAcceptanceCriteria ?? "";
  sections.push(acceptanceCriteria.trim() ? acceptanceCriteria : "(none)");

  if (input.comments.length === 0) {
    sections.push("");
    sections.push("[Comments]");
    sections.push("(none)");
    return sections.join("\n");
  }

  sections.push("");
  sections.push("[Comments]");
  for (const comment of input.comments) {
    sections.push(`- comment_id: ${comment.id}`);
    sections.push(`  author: @${comment.author_username}`);
    sections.push("  body:");
    const body = comment.body.trim() ? comment.body : "(empty)";
    for (const line of body.split("\n")) {
      sections.push(`    ${line}`);
    }
  }
  return sections.join("\n");
}

export function buildIssueCommentMentionPrompt(input: {
  issueNumber: number;
  issueTitle: string;
  issueConversationHistory: string;
}): string {
  return `Issue #${input.issueNumber}: ${input.issueTitle}\n\nFull conversation history:\n${input.issueConversationHistory}`;
}

export function buildInteractiveIssueAgentPrompt(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  acceptanceCriteria: string;
  issueConversationHistory: string;
  reason: "assign" | "resume";
  instruction?: string;
}): string {
  const taskInstruction =
    input.instruction?.trim() ||
    "Review the issue, implement a fix if the request is actionable, push a branch, and open a pull request. If information is missing, reply with focused follow-up questions.";
  return [
    input.reason === "assign"
      ? "You are taking ownership of a repository issue."
      : "Continue the existing work for this repository issue.",
    `Repository: ${input.owner}/${input.repo}`,
    "",
    buildIssueCommentMentionPrompt({
      issueNumber: input.issueNumber,
      issueTitle: input.issueTitle,
      issueConversationHistory: input.issueConversationHistory
    }),
    "",
    "[Platform Tools]",
    "If MCP tools are available, prefer them for platform interaction:",
    "- gits_issue_reply: reply to this issue",
    "- gits_create_pull_request: create a pull request (supports closeIssueNumbers)",
    "",
    "[Branch Naming]",
    `Use the pattern: fix/issue-${input.issueNumber} or feat/issue-${input.issueNumber} based on the task type.`,
    "",
    "[Instruction]",
    taskInstruction
  ].join("\n");
}

export function buildPullRequestReviewHistory(input: {
  reviews: ReadonlyArray<{
    reviewer_username: string;
    decision: PullRequestReviewDecision;
    body: string;
  }>;
}): string {
  if (input.reviews.length === 0) {
    return "(none)";
  }

  return input.reviews
    .map((review) => {
      const body = review.body.trim() || "(empty)";
      return [
        `- reviewer: @${review.reviewer_username}`,
        `  decision: ${review.decision}`,
        "  body:",
        ...body.split("\n").map((line) => `    ${line}`)
      ].join("\n");
    })
    .join("\n");
}

export function buildPullRequestReviewThreadHistory(input: {
  threads: ReadonlyArray<
    Pick<
      PullRequestReviewThreadRecord,
      | "author_username"
      | "path"
      | "body"
      | "status"
      | "base_oid"
      | "head_oid"
      | "start_side"
      | "start_line"
      | "end_side"
      | "end_line"
      | "hunk_header"
      | "anchor"
      | "comments"
    >
  >;
}): string {
  if (input.threads.length === 0) {
    return "(none)";
  }

  return input.threads
    .map((thread) => {
      const anchor = thread.anchor;
      const anchorLabel =
        thread.start_line === thread.end_line && thread.start_side === thread.end_side
          ? `${thread.path}:${thread.start_line} (${thread.start_side})`
          : `${thread.path}:${thread.start_line}-${thread.end_line} (${thread.start_side})`;
      const sections = [
        `- status: ${thread.status}`,
        `  author: @${thread.author_username}`,
        `  location: ${anchorLabel}`
      ];
      if (thread.base_oid && thread.head_oid) {
        sections.push(`  compare_range: ${thread.base_oid}..${thread.head_oid}`);
      }
      if (thread.hunk_header) {
        sections.push(`  hunk: ${thread.hunk_header}`);
      }
      if (anchor) {
        sections.push(`  anchor_status: ${anchor.status}`);
        if (anchor.patchset_changed) {
          sections.push("  patchset: newer commits detected");
        }
        if (anchor.start_line !== null && anchor.end_line !== null) {
          const currentAnchorLabel =
            anchor.start_line === anchor.end_line && anchor.start_side === anchor.end_side
              ? `${anchor.path}:${anchor.start_line} (${anchor.start_side})`
              : `${anchor.path}:${anchor.start_line}-${anchor.end_line} (${anchor.start_side})`;
          sections.push(`  current_location: ${currentAnchorLabel}`);
        }
        sections.push(`  anchor_note: ${anchor.message}`);
      }

      if (thread.comments.length === 0) {
        sections.push("  body:");
        sections.push(...(thread.body.trim() || "(empty)").split("\n").map((line) => `    ${line}`));
        return sections.join("\n");
      }

      sections.push("  comments:");
      for (const comment of thread.comments) {
        sections.push(`    - author: @${comment.author_username}`);
        sections.push("      body:");
        const body = comment.body.trim() || "(empty)";
        sections.push(...body.split("\n").map((line) => `        ${line}`));
        if (comment.suggestion) {
          sections.push(
            `      suggestion (${comment.suggestion.side} ${comment.suggestion.start_line}-${comment.suggestion.end_line}):`
          );
          sections.push(...comment.suggestion.code.split("\n").map((line) => `        ${line}`));
        }
      }
      return sections.join("\n");
    })
    .join("\n");
}

export function buildInteractivePullRequestAgentPrompt(input: {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestTitle: string;
  pullRequestBody: string;
  baseRef: string;
  headRef: string;
  reviews: ReadonlyArray<{
    reviewer_username: string;
    decision: PullRequestReviewDecision;
    body: string;
  }>;
  reviewThreads: ReadonlyArray<PullRequestReviewThreadRecord>;
  focusedThread?: PullRequestReviewThreadRecord | null;
  instruction?: string;
}): string {
  const taskInstruction =
    input.instruction?.trim() ||
    (input.focusedThread
      ? "Resolve the focused review thread, update the pull request branch with the required changes, and keep the pull request intent intact."
      : "Review the feedback, update the pull request branch with the required changes, and preserve the existing intent of the pull request.");
  return [
    "Continue work on an existing pull request.",
    `Repository: ${input.owner}/${input.repo}`,
    `Pull request: #${input.pullRequestNumber} ${input.pullRequestTitle}`,
    `Base ref: ${input.baseRef}`,
    `Head ref: ${input.headRef}`,
    "",
    "[Pull Request Body]",
    input.pullRequestBody.trim() || "(empty)",
    "",
    "[Reviews]",
    buildPullRequestReviewHistory({ reviews: input.reviews }),
    "",
    "[Review Threads]",
    buildPullRequestReviewThreadHistory({ threads: input.reviewThreads }),
    "",
    ...(input.focusedThread
      ? [
          "[Focused Review Thread]",
          buildPullRequestReviewThreadHistory({
            threads: [input.focusedThread]
          }),
          ""
        ]
      : []),
    ...(input.focusedThread
      ? [
          "[Focus Requirement]",
          "Prioritize fixing the focused review thread first, then address other still-open review threads if they are directly related.",
          ""
        ]
      : []),
    "[Platform Tools]",
    "If MCP tools are available, prefer them for platform interaction:",
    "- gits_issue_reply: reply to related issues",
    "- gits_create_pull_request: create a pull request (supports closeIssueNumbers)",
    "",
    "[Instruction]",
    taskInstruction
  ].join("\n");
}

export async function resolveDefaultBranchTarget(
  repositoryClient: ReturnType<typeof createRepositoryObjectClient>,
  repository: Pick<RepositoryRecord, "id" | "owner_username" | "name">
): Promise<{ ref: string | null; sha: string | null }> {
  try {
    return await repositoryClient.resolveDefaultBranchTarget({
      repositoryId: repository.id,
      owner: repository.owner_username,
      repo: repository.name
    });
  } catch {
    return { ref: null, sha: null };
  }
}

export function buildIssueCreatedAgentPrompt(input: {
  workflowPrompt: string;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  acceptanceCriteria: string;
  issueConversationHistory: string;
  triggerReason: "issue_created" | "issue_comment_added";
  triggerCommentId?: string;
  triggerCommentAuthorUsername?: string;
  defaultBranchRef: string | null;
  requestOrigin: string;
  triggeredByUsername: string;
}): string {
  const defaultBranchName = input.defaultBranchRef?.replace(/^refs\/heads\//, "") ?? "main";
  const triggerCommentLines = [
    input.triggerCommentId ? `trigger_comment_id: ${input.triggerCommentId}` : "",
    input.triggerCommentAuthorUsername
      ? `trigger_comment_author: @${input.triggerCommentAuthorUsername}`
      : ""
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return `${input.workflowPrompt}

[Issue Context]
type: issue
repository: ${input.owner}/${input.repo}
issue_number: #${input.issueNumber}
issue_title: ${input.issueTitle}
trigger_reason: ${input.triggerReason}
${triggerCommentLines ? `${triggerCommentLines}\n` : ""}default_branch: ${defaultBranchName}

[Issue Body]
${input.issueBody || "(empty)"}

[Acceptance Criteria]
${input.acceptanceCriteria || "(none)"}

[Conversation History]
${input.issueConversationHistory}

[Required Decision]
1. If the issue is actionable, implement a fix, push a branch, and create a PR that closes #${input.issueNumber}.
2. If information is missing, reply with concrete follow-up questions.

[Platform Tools]
Use the registered MCP tools to interact with the platform:
- gits_issue_reply: reply to this issue
- gits_create_pull_request: create a pull request (supports closeIssueNumbers)

[Branch Naming]
Use the pattern: fix/issue-${input.issueNumber} or feat/issue-${input.issueNumber} based on the task type.

[Git Push Credentials]
username: ${input.triggeredByUsername}
token_for_git_push: ${ISSUE_PR_CREATE_TOKEN_PLACEHOLDER}
remote: ${input.requestOrigin}/${input.owner}/${input.repo}.git`;
}
