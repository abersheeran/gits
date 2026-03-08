import {
  HTTPException,
  PullRequestService,
  RepositoryService,
  createRepositoryObjectClient,
  enrichPullRequestReviewThreads,
  mustSessionUser,
  optionalSession,
  requireSession
} from "./deps";

import {
  assertCommitOid,
  assertDiffBoundPullRequestThreadInput,
  assertOptionalString,
  assertOptionalSuggestedCode,
  assertPositiveInteger,
  assertPositiveIntegerInput,
  assertPullRequestReviewDecision,
  assertPullRequestReviewThreadSide,
  assertString,
  buildPullRequestReviewThreadSuggestion,
  createWorkflowTaskFlowService,
  findReadableRepositoryOr404,
  parseJsonObject,
  type ApiRouter,
  type CreatePullRequestReviewInput,
  type CreatePullRequestReviewThreadCommentInput,
  type CreatePullRequestReviewThreadInput
} from "./shared";

export function registerPullRequestReviewRoutes(router: ApiRouter): void {
    router.get("/repos/:owner/:repo/pulls/:number/reviews", optionalSession, async (c) => {
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

      const [reviews, reviewSummary] = await Promise.all([
        pullRequestService.listPullRequestReviews(repository.id, number, sessionUser?.id),
        pullRequestService.summarizePullRequestReviews(repository.id, number)
      ]);
      return c.json({ reviews, reviewSummary });
    });

    router.post("/repos/:owner/:repo/pulls/:number/reviews", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const number = assertPositiveInteger(c.req.param("number"), "number");
      const payload = await parseJsonObject(c.req.raw);
      const input: CreatePullRequestReviewInput = {
        decision: assertPullRequestReviewDecision(payload.decision)
      };
      if (payload.body !== undefined) {
        input.body = assertOptionalString(payload.body, "body") ?? "";
      }

      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = mustSessionUser(c);
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        userId: sessionUser.id
      });
      const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
        repository,
        sessionUser.id
      );
      if (!canReviewPullRequest) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const pullRequestService = new PullRequestService(c.env.DB);
      const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
      if (!pullRequest) {
        throw new HTTPException(404, { message: "Pull request not found" });
      }

      const review = await pullRequestService.createPullRequestReview({
        repositoryId: repository.id,
        pullRequestId: pullRequest.id,
        pullRequestNumber: number,
        reviewerId: sessionUser.id,
        decision: input.decision,
        ...(input.body !== undefined ? { body: input.body } : {})
      });
      const nextReviewSummary = await pullRequestService.summarizePullRequestReviews(repository.id, number);
      const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
      await workflowTaskFlowService.reconcileIssuesForPullRequest({
        repository,
        pullRequestNumber: number,
        viewerId: sessionUser.id
      });
      return c.json({ review, reviewSummary: nextReviewSummary }, 201);
    });

    router.get("/repos/:owner/:repo/pulls/:number/review-threads", optionalSession, async (c) => {
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

      const reviewThreads = await enrichPullRequestReviewThreads({
        browserService: createRepositoryObjectClient(c.env),
        repositoryId: repository.id,
        owner,
        repo,
        pullRequest,
        threads: await pullRequestService.listPullRequestReviewThreads(repository.id, number)
      });
      return c.json({ reviewThreads });
    });

    router.post("/repos/:owner/:repo/pulls/:number/review-threads", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const number = assertPositiveInteger(c.req.param("number"), "number");
      const payload = await parseJsonObject(c.req.raw);
      const input: CreatePullRequestReviewThreadInput = {
        path: assertString(payload.path, "path"),
        baseOid: assertCommitOid(payload.baseOid, "baseOid"),
        headOid: assertCommitOid(payload.headOid, "headOid"),
        startSide: assertPullRequestReviewThreadSide(payload.startSide),
        startLine: assertPositiveIntegerInput(payload.startLine, "startLine"),
        endSide: assertPullRequestReviewThreadSide(payload.endSide),
        endLine: assertPositiveIntegerInput(payload.endLine, "endLine"),
        hunkHeader: assertString(payload.hunkHeader, "hunkHeader")
      };
      const body = assertOptionalString(payload.body, "body");
      if (body !== undefined && body.length > 0) {
        input.body = body;
      }
      const suggestedCode = assertOptionalSuggestedCode(payload.suggestedCode);
      if (suggestedCode !== undefined) {
        input.suggestedCode = suggestedCode;
      }
      if (!input.body && !input.suggestedCode) {
        throw new HTTPException(400, {
          message: "Review threads require either a body or suggestedCode"
        });
      }

      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = mustSessionUser(c);
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        userId: sessionUser.id
      });
      const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
        repository,
        sessionUser.id
      );
      if (!canReviewPullRequest) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const pullRequestService = new PullRequestService(c.env.DB);
      const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
      if (!pullRequest) {
        throw new HTTPException(404, { message: "Pull request not found" });
      }
      if (pullRequest.state !== "open") {
        throw new HTTPException(409, { message: "Pull request must be open to create a review thread" });
      }
      const repositoryClient = createRepositoryObjectClient(c.env);
      const comparison = await repositoryClient.compareRefs({
        repositoryId: repository.id,
        owner,
        repo,
        baseRef: pullRequest.base_ref,
        headRef: pullRequest.head_ref
      });
      const legacyLocation = assertDiffBoundPullRequestThreadInput({
        comparison,
        input
      });
      const suggestion = buildPullRequestReviewThreadSuggestion({
        side: input.startSide,
        startLine: input.startLine,
        endLine: input.endLine,
        ...(input.suggestedCode !== undefined ? { suggestedCode: input.suggestedCode } : {})
      });

      const reviewThread = await pullRequestService.createPullRequestReviewThread({
        repositoryId: repository.id,
        pullRequestId: pullRequest.id,
        pullRequestNumber: number,
        authorId: sessionUser.id,
        path: input.path,
        line: legacyLocation.line,
        side: legacyLocation.side,
        body: input.body ?? "",
        baseOid: input.baseOid,
        headOid: input.headOid,
        startSide: input.startSide,
        startLine: input.startLine,
        endSide: input.endSide,
        endLine: input.endLine,
        hunkHeader: input.hunkHeader,
        suggestion
      });
      const [enrichedReviewThread] = await enrichPullRequestReviewThreads({
        browserService: repositoryClient,
        repositoryId: repository.id,
        owner,
        repo,
        pullRequest,
        threads: [reviewThread]
      });
      const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
      await workflowTaskFlowService.reconcileIssuesForPullRequest({
        repository,
        pullRequestNumber: number,
        viewerId: sessionUser.id
      });
      return c.json({ reviewThread: enrichedReviewThread ?? reviewThread }, 201);
    });

    router.post(
      "/repos/:owner/:repo/pulls/:number/review-threads/:threadId/comments",
      requireSession,
      async (c) => {
        const owner = c.req.param("owner");
        const repo = c.req.param("repo");
        const number = assertPositiveInteger(c.req.param("number"), "number");
        const threadId = assertString(c.req.param("threadId"), "threadId");
        const payload = await parseJsonObject(c.req.raw);
        const input: CreatePullRequestReviewThreadCommentInput = {};
        const body = assertOptionalString(payload.body, "body");
        if (body !== undefined && body.length > 0) {
          input.body = body;
        }
        const suggestedCode = assertOptionalSuggestedCode(payload.suggestedCode);
        if (suggestedCode !== undefined) {
          input.suggestedCode = suggestedCode;
        }
        if (!input.body && !input.suggestedCode) {
          throw new HTTPException(400, {
            message: "Review thread comments require either a body or suggestedCode"
          });
        }

        const repositoryService = new RepositoryService(c.env.DB);
        const sessionUser = mustSessionUser(c);
        const repository = await findReadableRepositoryOr404({
          repositoryService,
          owner,
          repo,
          userId: sessionUser.id
        });
        const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
          repository,
          sessionUser.id
        );
        if (!canReviewPullRequest) {
          throw new HTTPException(403, { message: "Forbidden" });
        }

        const pullRequestService = new PullRequestService(c.env.DB);
        const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
        if (!pullRequest) {
          throw new HTTPException(404, { message: "Pull request not found" });
        }
        if (pullRequest.state !== "open") {
          throw new HTTPException(409, {
            message: "Pull request must be open to comment on a review thread"
          });
        }

        const existingThread = await pullRequestService.findPullRequestReviewThreadById(
          repository.id,
          number,
          threadId
        );
        if (!existingThread) {
          throw new HTTPException(404, { message: "Review thread not found" });
        }
        if (existingThread.status === "resolved") {
          throw new HTTPException(409, { message: "Resolved review threads cannot be updated" });
        }
        const repositoryClient = createRepositoryObjectClient(c.env);
        const [threadWithAnchor] =
          input.suggestedCode !== undefined
            ? await enrichPullRequestReviewThreads({
                browserService: repositoryClient,
                repositoryId: repository.id,
                owner,
                repo,
                pullRequest,
                threads: [existingThread]
              })
            : [existingThread];
        const suggestedAnchor = threadWithAnchor?.anchor;
        if (
          input.suggestedCode !== undefined &&
          (!suggestedAnchor ||
            suggestedAnchor.status === "stale" ||
            suggestedAnchor.start_side !== "head" ||
            suggestedAnchor.start_line === null ||
            suggestedAnchor.end_line === null)
        ) {
          throw new HTTPException(409, {
            message: "Suggested changes require a review thread that still maps to the current head diff"
          });
        }

        const comment = await pullRequestService.createPullRequestReviewThreadComment({
          repositoryId: repository.id,
          pullRequestId: pullRequest.id,
          pullRequestNumber: number,
          threadId,
          authorId: sessionUser.id,
          body: input.body ?? "",
          suggestion: buildPullRequestReviewThreadSuggestion({
            side: suggestedAnchor?.start_side ?? existingThread.start_side,
            startLine: suggestedAnchor?.start_line ?? existingThread.start_line,
            endLine: suggestedAnchor?.end_line ?? existingThread.end_line,
            ...(input.suggestedCode !== undefined ? { suggestedCode: input.suggestedCode } : {})
          })
        });
        const reviewThread = await pullRequestService.findPullRequestReviewThreadById(
          repository.id,
          number,
          threadId
        );
        if (!reviewThread) {
          throw new HTTPException(404, { message: "Review thread not found" });
        }

        const [enrichedReviewThread] = await enrichPullRequestReviewThreads({
          browserService: repositoryClient,
          repositoryId: repository.id,
          owner,
          repo,
          pullRequest,
          threads: [reviewThread]
        });

        const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
        await workflowTaskFlowService.reconcileIssuesForPullRequest({
          repository,
          pullRequestNumber: number,
          viewerId: sessionUser.id
        });

        return c.json({ comment, reviewThread: enrichedReviewThread ?? reviewThread }, 201);
      }
    );

    router.post(
      "/repos/:owner/:repo/pulls/:number/review-threads/:threadId/resolve",
      requireSession,
      async (c) => {
        const owner = c.req.param("owner");
        const repo = c.req.param("repo");
        const number = assertPositiveInteger(c.req.param("number"), "number");
        const threadId = assertString(c.req.param("threadId"), "threadId");

        const repositoryService = new RepositoryService(c.env.DB);
        const sessionUser = mustSessionUser(c);
        const repository = await findReadableRepositoryOr404({
          repositoryService,
          owner,
          repo,
          userId: sessionUser.id
        });
        const canReviewPullRequest = await repositoryService.isOwnerOrCollaborator(
          repository,
          sessionUser.id
        );
        if (!canReviewPullRequest) {
          throw new HTTPException(403, { message: "Forbidden" });
        }

        const pullRequestService = new PullRequestService(c.env.DB);
        const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
        if (!pullRequest) {
          throw new HTTPException(404, { message: "Pull request not found" });
        }

        const existingThread = await pullRequestService.findPullRequestReviewThreadById(
          repository.id,
          number,
          threadId
        );
        if (!existingThread) {
          throw new HTTPException(404, { message: "Review thread not found" });
        }
        if (existingThread.status === "resolved") {
          const [enrichedExistingThread] = await enrichPullRequestReviewThreads({
            browserService: createRepositoryObjectClient(c.env),
            repositoryId: repository.id,
            owner,
            repo,
            pullRequest,
            threads: [existingThread]
          });
          return c.json({ reviewThread: enrichedExistingThread ?? existingThread });
        }

        const reviewThread = await pullRequestService.resolvePullRequestReviewThread({
          repositoryId: repository.id,
          pullRequestNumber: number,
          threadId,
          resolvedBy: sessionUser.id
        });
        if (!reviewThread) {
          throw new HTTPException(404, { message: "Review thread not found" });
        }

        const [enrichedReviewThread] = await enrichPullRequestReviewThreads({
          browserService: createRepositoryObjectClient(c.env),
          repositoryId: repository.id,
          owner,
          repo,
          pullRequest,
          threads: [reviewThread]
        });

        const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
        await workflowTaskFlowService.reconcileIssuesForPullRequest({
          repository,
          pullRequestNumber: number,
          viewerId: sessionUser.id
        });

        return c.json({ reviewThread: enrichedReviewThread ?? reviewThread });
      }
    );
}
