import { Hono } from "hono";
import { vi } from "vitest";
import { errorHandler } from "../../middleware/error-handler";
import type { AppEnv } from "../../types";
import apiRoutes from "./index";

export function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route("/api", apiRoutes);
  return app;
}

export function createBaseEnv(db: D1Database): AppEnv["Bindings"] {
  return {
    DB: db,
    GIT_BUCKET: {} as R2Bucket,
    REPOSITORY_OBJECTS: {
      getByName: vi.fn()
    } as unknown as DurableObjectNamespace,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  };
}

export function buildRepositoryRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "repo-1",
    owner_id: "owner-1",
    owner_username: "alice",
    name: "demo",
    description: "demo repo",
    is_private: 1,
    created_at: Date.now(),
    ...(overrides ?? {})
  };
}

export function buildActionRunRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "run-1",
    repository_id: "repo-1",
    run_number: 1,
    workflow_id: "workflow-1",
    workflow_name: "CI",
    trigger_event: "pull_request_created",
    trigger_ref: "refs/heads/feature",
    trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    trigger_source_type: "pull_request",
    trigger_source_number: 1,
    trigger_source_comment_id: null,
    triggered_by: "user-2",
    triggered_by_username: "bob",
    status: "queued",
    agent_type: "codex",
    instance_type: "lite",
    prompt: "请执行测试并修复失败。",
    logs: "",
    exit_code: null,
    container_instance: null,
    created_at: now,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    updated_at: now,
    ...(overrides ?? {})
  };
}

export function buildAgentSessionRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "session-1",
    repository_id: "repo-1",
    source_type: "pull_request",
    source_number: 1,
    source_comment_id: null,
    origin: "rerun",
    status: "queued",
    agent_type: "codex",
    prompt: "请执行测试并修复失败。",
    branch_ref: "refs/heads/agent/session-1",
    trigger_ref: "refs/heads/feature",
    trigger_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    workflow_id: "workflow-1",
    workflow_name: "CI",
    linked_run_id: "run-2",
    created_by: "user-2",
    created_by_username: "bob",
    delegated_from_user_id: "user-2",
    delegated_from_username: "bob",
    created_at: now,
    started_at: null,
    completed_at: null,
    updated_at: now,
    ...(overrides ?? {})
  };
}

export function buildPullRequestReviewThreadRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "thread-1",
    repository_id: "repo-1",
    pull_request_id: "pr-1",
    pull_request_number: 1,
    author_id: "user-2",
    author_username: "bob",
    path: "src/app.ts",
    line: 12,
    side: "head",
    body: "Please handle null path.",
    base_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    head_oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    start_side: "head",
    start_line: 12,
    end_side: "head",
    end_line: 12,
    hunk_header: "@@ -10,3 +10,4 @@",
    status: "open",
    resolved_by: null,
    resolved_by_username: null,
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ...(overrides ?? {})
  };
}

export function buildPullRequestReviewThreadCommentRow(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    id: "thread-comment-1",
    repository_id: "repo-1",
    pull_request_id: "pr-1",
    pull_request_number: 1,
    thread_id: "thread-1",
    author_id: "user-2",
    author_username: "bob",
    body: "Please handle null path.",
    suggested_start_line: null,
    suggested_end_line: null,
    suggested_side: null,
    suggested_code: null,
    created_at: now,
    updated_at: now,
    ...(overrides ?? {})
  };
}
