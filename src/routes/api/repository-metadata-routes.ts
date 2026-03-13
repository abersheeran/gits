import { RepositoryService, mustSessionUser, requireSession } from "./deps";

import {
  findReadableRepositoryOr404,
  listRepositoryParticipants,
  type ApiRouter
} from "./shared";

export function registerRepositoryMetadataRoutes(router: ApiRouter): void {
  router.get("/repos/:owner/:repo/participants", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      userId: sessionUser.id
    });
    const participants = await listRepositoryParticipants(repositoryService, repository);
    return c.json({ participants });
  });
}
