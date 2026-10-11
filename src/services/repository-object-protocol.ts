export type RepositoryObjectJsonOperation =
  | "browse-repository-contents"
  | "schedule-mirror-sync"
  | "cancel-mirror-sync"
  | "create-branch"
  | "delete-repository"
  | "delete-branch"
  | "get-commit-detail"
  | "get-repository-detail"
  | "initialize-repository"
  | "list-commit-history"
  | "list-head-refs"
  | "list-path-history"
  | "rename-repository"
  | "set-default-branch";

export type RepositoryObjectJsonRequest = {
  operation: RepositoryObjectJsonOperation;
  payload: Record<string, unknown>;
};

export type RepositoryHeadRef = { name: string; oid: string };

export type RepositoryBranchMutationResult = {
  defaultBranch: string | null;
  branches: RepositoryHeadRef[];
};

export type RepositoryObjectErrorCode =
  | "bad_request"
  | "git_service_invalid"
  | "path_invalid"
  | "path_not_found";

export type RepositoryObjectErrorPayload = {
  error: RepositoryObjectErrorCode;
  message: string;
};
