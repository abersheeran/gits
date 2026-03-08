import {
  HTTPException,
  IssueService,
  PullRequestService,
  RepositoryService,
  optionalSession
} from "./deps";

import {
  assertPositiveInteger,
  buildLatestPullRequestProvenancePayload,
  createWorkflowTaskFlowService,
  findReadableRepositoryOr404,
  parseActionRunSourceNumbers,
  parseLimit,
  parsePage,
  parsePullRequestListState,
  reconcileIssueNumbers,
  type ApiRouter
} from "./shared";

export function registerPullRequestQueryRoutes(router: ApiRouter): void {
    router.get("/repos/:owner/:repo/pulls", optionalSession, async (c) => {
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

      const pullRequestService = new PullRequestService(c.env.DB);
      const page = parsePage(c.req.query("page"));
      const pullRequestPage = await pullRequestService.listPullRequests(
        repository.id,
        parsePullRequestListState(c.req.query("state")),
        {
          limit: parseLimit(c.req.query("limit"), 50),
          page,
          ...(sessionUser ? { viewerId: sessionUser.id } : {})
        }
      );
      return c.json({
        pullRequests: pullRequestPage.items,
        pagination: {
          total: pullRequestPage.total,
          page: pullRequestPage.page,
          perPage: pullRequestPage.per_page,
          hasNextPage: pullRequestPage.has_next_page
        }
      });
    });

    router.get("/repos/:owner/:repo/pulls/provenance/latest", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const pullRequestNumbers = parseActionRunSourceNumbers(c.req.query("numbers"));
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const items = await buildLatestPullRequestProvenancePayload({
        db: c.env.DB,
        repository,
        owner,
        repo,
        pullRequestNumbers,
        ...(sessionUser ? { viewerId: sessionUser.id } : {})
      });

      return c.json({ items });
    });

    router.get("/repos/:owner/:repo/pulls/:number", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const number = assertPositiveInteger(c.req.param("number"), "number");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const pullRequestService = new PullRequestService(c.env.DB);
      const pullRequest = await pullRequestService.findPullRequestByNumber(
        repository.id,
        number,
        sessionUser?.id
      );
      if (!pullRequest) {
        throw new HTTPException(404, { message: "Pull request not found" });
      }
      const [reviewSummary, closingIssueNumbers] = await Promise.all([
        pullRequestService.summarizePullRequestReviews(repository.id, number),
        pullRequestService.listPullRequestClosingIssueNumbers(repository.id, number)
      ]);
      const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
      const issueService = new IssueService(c.env.DB);
      await reconcileIssueNumbers({
        workflowTaskFlowService,
        repository,
        issueNumbers: closingIssueNumbers,
        ...(sessionUser ? { viewerId: sessionUser.id } : {})
      });
      const closingIssues = await issueService.listIssuesByNumbers(
        repository.id,
        closingIssueNumbers,
        sessionUser?.id
      );
      const taskFlow = await workflowTaskFlowService.buildPullRequestTaskFlow({
        repository,
        pullRequest,
        closingIssueNumbers,
        closingIssues,
        reviewSummary
      });
      return c.json({
        pullRequest,
        reviewSummary,
        closingIssueNumbers,
        closingIssues,
        taskFlow
      });
    });

    router.get("/repos/:owner/:repo/pulls/:number/provenance", optionalSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const number = assertPositiveInteger(c.req.param("number"), "number");
      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = c.get("sessionUser");
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        ...(sessionUser ? { userId: sessionUser.id } : {})
      });

      const pullRequestService = new PullRequestService(c.env.DB);
      const pullRequest = await pullRequestService.findPullRequestByNumber(
        repository.id,
        number,
        sessionUser?.id
      );
      if (!pullRequest) {
        throw new HTTPException(404, { message: "Pull request not found" });
      }

      const [item] = await buildLatestPullRequestProvenancePayload({
        db: c.env.DB,
        repository,
        owner,
        repo,
        pullRequestNumbers: [number],
        ...(sessionUser ? { viewerId: sessionUser.id } : {})
      });
      return c.json({ latestSession: item?.latestSession ?? null });
    });
}
