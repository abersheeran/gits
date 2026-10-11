import type { RepositoryDetailResponse } from "@/lib/api";

type RepositoryLayoutSnapshot = Pick<
  RepositoryDetailResponse["repository"],
  "is_private" | "description"
> & Pick<RepositoryDetailResponse, "viewerPermission">;

export const repositoryLayoutCache = new Map<string, RepositoryLayoutSnapshot>();
