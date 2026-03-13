import {
  HTTPException,
  IssueService,
  PullRequestService,
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError,
  RepositoryService,
  createRepositoryObjectClient,
  mustSessionUser,
  optionalSession,
  requireSession
} from "./deps";

import {
  assertString,
  findReadableRepositoryOr404,
  parseLimit,
  parsePage,
  type ApiRouter
} from "./shared";

export function registerRepositoryBrowserRoutes(router: ApiRouter): void {
  router.get("/repos", requireSession, async (c) => {
    const repositoryService = new RepositoryService(c.env.DB);
    const sessionUser = mustSessionUser(c);
    const repositories = await repositoryService.listRepositoriesForUser(sessionUser.id);
    return c.json({ repositories });
  });

  router.get("/repos/:owner/:repo/branches", optionalSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await repositoryService.findRepository(owner, repo);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const sessionUser = c.get("sessionUser");
    const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
    if (!canRead) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const repositoryClient = createRepositoryObjectClient(c.env);
    const branches = await repositoryClient.listHeadRefs({
      repositoryId: repository.id,
      owner,
      repo
    });
    return c.json({ branches });
  });

  router.get("/repos/:owner/:repo", optionalSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repositoryService = new RepositoryService(c.env.DB);
    const sessionUser = c.get("sessionUser");
    const repository = await findReadableRepositoryOr404({
      repositoryService,
      owner,
      repo,
      ...(sessionUser ? { userId: sessionUser.id } : {})
    });

    const repositoryClient = createRepositoryObjectClient(c.env);
    const issueService = new IssueService(c.env.DB);
    const pullRequestService = new PullRequestService(c.env.DB);
    const detailInput: { owner: string; repo: string; ref?: string } = {
      owner,
      repo
    };
    const detailRef = c.req.query("ref");
    if (detailRef) {
      detailInput.ref = detailRef;
    }
    const [
      details,
      openIssueCount,
      openPullRequestCount,
      canCreateIssueOrPullRequest,
      canManageActions
    ] = await Promise.all([
      repositoryClient.getRepositoryDetail({
        repositoryId: repository.id,
        ...detailInput
      }),
      issueService.countOpenIssues(repository.id),
      pullRequestService.countOpenPullRequests(repository.id),
      repositoryService.isOwnerOrCollaborator(repository, sessionUser?.id),
      repositoryService.isOwnerOrCollaborator(repository, sessionUser?.id)
    ]);

    return c.json({
      repository,
      openIssueCount,
      openPullRequestCount,
      permissions: {
        canCreateIssueOrPullRequest,
        canRunAgents: canCreateIssueOrPullRequest,
        canManageActions
      },
      ...details
    });
  });

  router.get("/repos/:owner/:repo/commits", optionalSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await repositoryService.findRepository(owner, repo);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const sessionUser = c.get("sessionUser");
    const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
    if (!canRead) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const repositoryClient = createRepositoryObjectClient(c.env);
    const historyInput: { owner: string; repo: string; ref?: string; limit: number; page: number } = {
      owner,
      repo,
      limit: parseLimit(c.req.query("limit"), 20),
      page: parsePage(c.req.query("page"))
    };
    const historyRef = c.req.query("ref");
    if (historyRef) {
      historyInput.ref = historyRef;
    }
    const history = await repositoryClient.listCommitHistory({
      repositoryId: repository.id,
      ...historyInput
    });

    return c.json(history);
  });

  router.get("/repos/:owner/:repo/commits/:oid", optionalSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const oid = assertString(c.req.param("oid"), "oid");
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await repositoryService.findRepository(owner, repo);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const sessionUser = c.get("sessionUser");
    const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
    if (!canRead) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    try {
      const repositoryClient = createRepositoryObjectClient(c.env);
      const commit = await repositoryClient.getCommitDetail({
        repositoryId: repository.id,
        owner,
        repo,
        oid
      });
      return c.json(commit);
    } catch {
      throw new HTTPException(404, { message: "Commit not found" });
    }
  });

  router.get("/repos/:owner/:repo/history", optionalSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const path = assertString(c.req.query("path"), "path");
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await repositoryService.findRepository(owner, repo);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const sessionUser = c.get("sessionUser");
    const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
    if (!canRead) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const repositoryClient = createRepositoryObjectClient(c.env);
    try {
      const historyRef = c.req.query("ref");
      const history = await repositoryClient.listPathHistory({
        repositoryId: repository.id,
        owner,
        repo,
        path,
        ...(historyRef ? { ref: historyRef } : {}),
        limit: parseLimit(c.req.query("limit"), 20)
      });
      return c.json(history);
    } catch (error) {
      if (error instanceof RepositoryBrowseInvalidPathError) {
        throw new HTTPException(400, { message: "Invalid path" });
      }
      throw error;
    }
  });

  router.get("/repos/:owner/:repo/compare", optionalSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const baseRef = assertString(c.req.query("baseRef"), "baseRef");
    const headRef = assertString(c.req.query("headRef"), "headRef");
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await repositoryService.findRepository(owner, repo);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const sessionUser = c.get("sessionUser");
    const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
    if (!canRead) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    try {
      const repositoryClient = createRepositoryObjectClient(c.env);
      const comparison = await repositoryClient.compareRefs({
        repositoryId: repository.id,
        owner,
        repo,
        baseRef,
        headRef
      });
      return c.json(comparison);
    } catch {
      throw new HTTPException(404, { message: "Unable to compare refs" });
    }
  });

  router.get("/repos/:owner/:repo/contents", optionalSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repositoryService = new RepositoryService(c.env.DB);
    const repository = await repositoryService.findRepository(owner, repo);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const sessionUser = c.get("sessionUser");
    const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
    if (!canRead) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const repositoryClient = createRepositoryObjectClient(c.env);
    const browseInput: { owner: string; repo: string; ref?: string; path?: string } = {
      owner,
      repo
    };
    const browseRef = c.req.query("ref");
    if (browseRef) {
      browseInput.ref = browseRef;
    }
    const browsePath = c.req.query("path");
    if (browsePath) {
      browseInput.path = browsePath;
    }

    try {
      const contents = await repositoryClient.browseRepositoryContents({
        repositoryId: repository.id,
        ...browseInput
      });
      return c.json(contents);
    } catch (error) {
      if (error instanceof RepositoryBrowseInvalidPathError) {
        throw new HTTPException(400, { message: "Invalid path" });
      }
      if (error instanceof RepositoryBrowsePathNotFoundError) {
        throw new HTTPException(404, { message: "Path not found" });
      }
      throw error;
    }
  });
}
