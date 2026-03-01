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
