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

export type RepositoryListRecord = RepositoryRecord & { is_mirror: 0 | 1 };

export type CollaboratorPermission = "read" | "write" | "admin";

export type AppBindings = {
  DB: D1Database;
  GIT_BUCKET: R2Bucket;
  REPOSITORY_OBJECTS: DurableObjectNamespace;
  ASSETS?: Fetcher;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_WEBHOOK_SECRET?: string;
  githubHttp?: import("./services/github/types").GithubHttpOptions;
  ALLOW_USER_REGISTRATION?: string;
  UPLOAD_PACK_MAX_BODY_BYTES?: string;
  RECEIVE_PACK_MAX_BODY_BYTES?: string;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    sessionUser?: AuthUser;
    sessionId?: string;
    basicAuthUser?: AuthUser;
  };
};
