export type GitServiceName = "git-upload-pack" | "git-receive-pack";

export type AuthUser = {
  id: string;
  username: string;
};

export type RepositoryRecord = {
  id: string;
  owner_id: string;
  owner_username: string;
  name: string;
  description: string | null;
  is_private: number;
  created_at: number;
};

export type CollaboratorPermission = "read" | "write" | "admin";

export type IssueState = "open" | "closed";

export type PullRequestState = "open" | "closed" | "merged";

export type PullRequestReviewDecision = "comment" | "approve" | "request_changes";

export type IssueRecord = {
  id: string;
  repository_id: string;
  number: number;
  author_id: string;
  author_username: string;
  title: string;
  body: string;
  state: IssueState;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export type PullRequestRecord = {
  id: string;
  repository_id: string;
  number: number;
  author_id: string;
  author_username: string;
  title: string;
  body: string;
  state: PullRequestState;
  base_ref: string;
  head_ref: string;
  base_oid: string;
  head_oid: string;
  merge_commit_oid: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  merged_at: number | null;
};

export type PullRequestReviewRecord = {
  id: string;
  repository_id: string;
  pull_request_id: string;
  pull_request_number: number;
  reviewer_id: string;
  reviewer_username: string;
  decision: PullRequestReviewDecision;
  body: string;
  created_at: number;
};

export type AppBindings = {
  DB: D1Database;
  GIT_BUCKET: R2Bucket;
  ASSETS?: Fetcher;
  JWT_SECRET: string;
  APP_ORIGIN: string;
  UPLOAD_PACK_MAX_BODY_BYTES?: string;
  RECEIVE_PACK_MAX_BODY_BYTES?: string;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    sessionUser?: AuthUser;
    basicAuthUser?: AuthUser;
  };
};
