import {
  AuthService,
  DuplicateOpenPullRequestError,
  HTTPException,
  IssueService,
  PullRequestMergeBranchNotFoundError,
  PullRequestMergeConflictError,
  PullRequestMergeNotSupportedError,
  PullRequestService,
  RepositoryService,
  containsActionsMention,
  createRepositoryObjectClient,
  enrichPullRequestReviewThreads,
  mustSessionUser,
  requireSession,
  triggerActionWorkflows,
  triggerInteractiveAgentSession,
  triggerMentionActionRun
} from "./deps";

import {
  assertActionAgentType,
  assertOptionalBoolean,
  assertOptionalIssueNumberArray,
  assertOptionalString,
  assertPositiveInteger,
  assertPullRequestState,
  assertString,
  buildInteractivePullRequestAgentPrompt,
  buildMentionPrompt,
  createWorkflowTaskFlowService,
  executionCtxArg,
  findReadableRepositoryOr404,
  normalizeBranchRef,
  parseJsonObject,
  reconcileIssueNumbers,
  type ApiRouter,
  type CreatePullRequestInput,
  type TriggerRepositoryAgentInput,
  type UpdatePullRequestInput
} from "./shared";

export function registerPullRequestCommandRoutes(router: ApiRouter): void {
    const unsupportedPullRequestMetadataMessage =
      "Pull request labels, milestones, assignees, and reviewers have been removed; use draft state instead.";

    router.post("/repos/:owner/:repo/pulls/:number/resume-agent", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const number = assertPositiveInteger(c.req.param("number"), "number");
      const payload = await parseJsonObject(c.req.raw);
      const input: TriggerRepositoryAgentInput = {};
      if (payload.agentType !== undefined) {
        input.agentType = assertActionAgentType(payload.agentType, "agentType");
      }
      if (payload.prompt !== undefined) {
        const prompt = assertOptionalString(payload.prompt, "prompt");
        if (prompt !== undefined) {
          input.prompt = prompt;
        }
      }
      if (payload.threadId !== undefined) {
        input.threadId = assertString(payload.threadId, "threadId");
      }

      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = mustSessionUser(c);
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        userId: sessionUser.id
      });
      const canRunAgents = await repositoryService.isOwnerOrCollaborator(repository, sessionUser.id);
      if (!canRunAgents) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const pullRequestService = new PullRequestService(c.env.DB);
      const pullRequest = await pullRequestService.findPullRequestByNumber(repository.id, number);
      if (!pullRequest) {
        throw new HTTPException(404, { message: "Pull request not found" });
      }
      if (pullRequest.state !== "open") {
        throw new HTTPException(409, { message: "Pull request must be open to resume an agent" });
      }

      const [reviews, rawReviewThreads] = await Promise.all([
        pullRequestService.listPullRequestReviews(repository.id, number),
        pullRequestService.listPullRequestReviewThreads(repository.id, number)
      ]);
      const reviewThreads = await enrichPullRequestReviewThreads({
        browserService: createRepositoryObjectClient(c.env),
        repositoryId: repository.id,
        owner,
        repo,
        pullRequest,
        threads: rawReviewThreads
      });
      const focusedThread = input.threadId
        ? reviewThreads.find((thread) => thread.id === input.threadId) ?? null
        : null;
      if (input.threadId && !focusedThread) {
        throw new HTTPException(404, { message: "Review thread not found" });
      }
      if (focusedThread?.status === "resolved") {
        throw new HTTPException(409, { message: "Resolved review threads cannot resume an agent" });
      }
      const agentType = input.agentType ?? "codex";

      const execution = await triggerInteractiveAgentSession({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        origin: "pull_request_resume",
        agentType,
        prompt: buildInteractivePullRequestAgentPrompt({
          owner,
          repo,
          pullRequestNumber: pullRequest.number,
          pullRequestTitle: pullRequest.title,
          pullRequestBody: pullRequest.body,
          baseRef: pullRequest.base_ref,
          headRef: pullRequest.head_ref,
          reviews,
          reviewThreads,
          ...(focusedThread ? { focusedThread } : {}),
          ...(input.prompt !== undefined ? { instruction: input.prompt } : {})
        }),
        ...(pullRequest.head_ref ? { triggerRef: pullRequest.head_ref } : {}),
        ...(pullRequest.head_oid ? { triggerSha: pullRequest.head_oid } : {}),
        triggerSourceType: "pull_request",
        triggerSourceNumber: pullRequest.number,
        triggeredByUser: sessionUser,
        requestOrigin: new URL(c.req.url).origin
      });

      const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
      await workflowTaskFlowService.reconcileIssuesForPullRequest({
        repository,
        pullRequestNumber: pullRequest.number,
        viewerId: sessionUser.id
      });

      return c.json(execution, 202);
    });

    router.post("/repos/:owner/:repo/pulls", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const payload = await parseJsonObject(c.req.raw);
      const input: CreatePullRequestInput = {
        title: assertString(payload.title, "title"),
        baseRef: normalizeBranchRef(payload.baseRef, "baseRef"),
        headRef: normalizeBranchRef(payload.headRef, "headRef")
      };
      if (payload.body !== undefined) {
        input.body = assertOptionalString(payload.body, "body") ?? "";
      }
      const closeIssueNumbers = assertOptionalIssueNumberArray(payload.closeIssueNumbers, "closeIssueNumbers");
      if (closeIssueNumbers !== undefined) {
        input.closeIssueNumbers = closeIssueNumbers;
      }
      if (payload.draft !== undefined) {
        const draft = assertOptionalBoolean(payload.draft, "draft");
        if (draft === undefined) {
          throw new HTTPException(400, { message: "Field 'draft' is required" });
        }
        input.draft = draft;
      }
      if (payload.labelIds !== undefined || payload.milestoneId !== undefined) {
        throw new HTTPException(400, { message: unsupportedPullRequestMetadataMessage });
      }
      if (input.baseRef === input.headRef) {
        throw new HTTPException(400, { message: "Field 'headRef' must differ from 'baseRef'" });
      }

      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = mustSessionUser(c);
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        userId: sessionUser.id
      });
      const canCreateIssueOrPullRequest = await repositoryService.isOwnerOrCollaborator(
        repository,
        sessionUser.id
      );
      if (!canCreateIssueOrPullRequest) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const repositoryClient = createRepositoryObjectClient(c.env);
      const branchRefs = await repositoryClient.listHeadRefs({
        repositoryId: repository.id,
        owner,
        repo
      });
      const baseRef = branchRefs.find((item) => item.name === input.baseRef);
      if (!baseRef) {
        throw new HTTPException(400, { message: "Base branch not found" });
      }
      const headRef = branchRefs.find((item) => item.name === input.headRef);
      if (!headRef) {
        throw new HTTPException(400, { message: "Head branch not found" });
      }

      const pullRequestService = new PullRequestService(c.env.DB);
      const issueService = new IssueService(c.env.DB);
      if (input.closeIssueNumbers && input.closeIssueNumbers.length > 0) {
        const existingIssueNumbers = await issueService.listIssueNumbers(repository.id, input.closeIssueNumbers);
        if (existingIssueNumbers.length !== input.closeIssueNumbers.length) {
          const existingSet = new Set(existingIssueNumbers);
          const missing = input.closeIssueNumbers.filter((item) => !existingSet.has(item));
          throw new HTTPException(404, {
            message: `Issues not found: ${missing.map((item) => `#${item}`).join(", ")}`
          });
        }
      }
      try {
        let pullRequestAuthorId = sessionUser.id;
        const accessTokenContext = c.get("accessTokenContext");
        const isActionsPullRequest = accessTokenContext?.displayAsActions === true;
        if (isActionsPullRequest) {
          const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
          const actionsUser = await authService.getOrCreateActionsUser();
          pullRequestAuthorId = actionsUser.id;
        }

        const createdPullRequest = await pullRequestService.createPullRequest({
          repositoryId: repository.id,
          authorId: pullRequestAuthorId,
          title: input.title,
          ...(input.body !== undefined ? { body: input.body } : {}),
          baseRef: baseRef.name,
          headRef: headRef.name,
          baseOid: baseRef.oid,
          headOid: headRef.oid,
          ...(input.draft !== undefined ? { draft: input.draft } : {})
        });
        const closingIssueNumbers = await pullRequestService.replacePullRequestClosingIssueNumbers({
          repositoryId: repository.id,
          pullRequestId: createdPullRequest.id,
          pullRequestNumber: createdPullRequest.number,
          issueNumbers: input.closeIssueNumbers ?? []
        });
        const pullRequest =
          (await pullRequestService.findPullRequestByNumber(
            repository.id,
            createdPullRequest.number,
            sessionUser.id
          )) ?? createdPullRequest;

        const actionRuns = await triggerActionWorkflows({
          env: c.env,
          ...executionCtxArg(c),
          repository,
          triggerEvent: "pull_request_created",
          triggerRef: pullRequest.head_ref,
          triggerSha: pullRequest.head_oid,
          triggerSourceType: "pull_request",
          triggerSourceNumber: pullRequest.number,
          triggeredByUser: sessionUser,
          requestOrigin: new URL(c.req.url).origin
        });
        if (containsActionsMention({ title: pullRequest.title, body: pullRequest.body })) {
          const mentionRun = await triggerMentionActionRun({
            env: c.env,
            ...executionCtxArg(c),
            repository,
            prompt: buildMentionPrompt({ title: pullRequest.title, body: pullRequest.body }),
            triggerRef: pullRequest.head_ref,
            triggerSha: pullRequest.head_oid,
            triggerSourceType: "pull_request",
            triggerSourceNumber: pullRequest.number,
            triggeredByUser: sessionUser,
            requestOrigin: new URL(c.req.url).origin
          });
          if (mentionRun) {
            actionRuns.push(mentionRun);
          }
        }

        const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
        await workflowTaskFlowService.reconcileIssuesForPullRequest({
          repository,
          pullRequestNumber: pullRequest.number,
          viewerId: sessionUser.id
        });

        return c.json({ pullRequest, closingIssueNumbers, actionRuns }, 201);
      } catch (error) {
        if (error instanceof DuplicateOpenPullRequestError) {
          throw new HTTPException(409, { message: error.message });
        }
        throw error;
      }
    });

    router.patch("/repos/:owner/:repo/pulls/:number", requireSession, async (c) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const number = assertPositiveInteger(c.req.param("number"), "number");
      const payload = await parseJsonObject(c.req.raw);
      const patch: UpdatePullRequestInput = {};
      if (payload.title !== undefined) {
        patch.title = assertString(payload.title, "title");
      }
      if (payload.body !== undefined) {
        patch.body = assertOptionalString(payload.body, "body") ?? "";
      }
      const closeIssueNumbers = assertOptionalIssueNumberArray(payload.closeIssueNumbers, "closeIssueNumbers");
      if (closeIssueNumbers !== undefined) {
        patch.closeIssueNumbers = closeIssueNumbers;
      }
      if (payload.draft !== undefined) {
        const draft = assertOptionalBoolean(payload.draft, "draft");
        if (draft === undefined) {
          throw new HTTPException(400, { message: "Field 'draft' is required" });
        }
        patch.draft = draft;
      }
      if (payload.labelIds !== undefined || payload.milestoneId !== undefined) {
        throw new HTTPException(400, { message: unsupportedPullRequestMetadataMessage });
      }
      if (payload.state !== undefined) {
        const nextState = assertPullRequestState(payload.state);
        patch.state = nextState;
      }
      if (
        patch.title === undefined &&
        patch.body === undefined &&
        patch.state === undefined &&
        patch.closeIssueNumbers === undefined &&
        patch.draft === undefined
      ) {
        throw new HTTPException(400, { message: "No updatable fields provided" });
      }

      const repositoryService = new RepositoryService(c.env.DB);
      const sessionUser = mustSessionUser(c);
      const repository = await findReadableRepositoryOr404({
        repositoryService,
        owner,
        repo,
        userId: sessionUser.id
      });
      const canCreateIssueOrPullRequest = await repositoryService.isOwnerOrCollaborator(
        repository,
        sessionUser.id
      );
      if (!canCreateIssueOrPullRequest) {
        throw new HTTPException(403, { message: "Forbidden" });
      }

      const pullRequestService = new PullRequestService(c.env.DB);
      const issueService = new IssueService(c.env.DB);
      const existingPullRequest = await pullRequestService.findPullRequestByNumber(
        repository.id,
        number,
        sessionUser.id
      );
      if (!existingPullRequest) {
        throw new HTTPException(404, { message: "Pull request not found" });
      }
      const hadActionsMention = containsActionsMention({
        title: existingPullRequest.title,
        body: existingPullRequest.body
      });
      const previousClosingIssueNumbers =
        patch.closeIssueNumbers !== undefined || patch.state !== undefined
          ? await pullRequestService.listPullRequestClosingIssueNumbers(repository.id, number)
          : [];
      const requestOrigin = new URL(c.req.url).origin;
      if (patch.closeIssueNumbers !== undefined) {
        const existingIssueNumbers = await issueService.listIssueNumbers(repository.id, patch.closeIssueNumbers);
        if (existingIssueNumbers.length !== patch.closeIssueNumbers.length) {
          const existingSet = new Set(existingIssueNumbers);
          const missing = patch.closeIssueNumbers.filter((item) => !existingSet.has(item));
          throw new HTTPException(404, {
            message: `Issues not found: ${missing.map((item) => `#${item}`).join(", ")}`
          });
        }
      }
      let mergeResult: {
        baseOid: string;
        headOid: string;
        mergeCommitOid: string;
        createdCommit: boolean;
      } | null = null;
      if (patch.state === "merged") {
        if (existingPullRequest.state !== "open") {
          throw new HTTPException(409, { message: "Only open pull requests can be merged" });
        }
        const repositoryClient = createRepositoryObjectClient(c.env);
        try {
          mergeResult = await repositoryClient.squashMergePullRequest({
            repositoryId: repository.id,
            owner,
            repo,
            pullRequest: {
              ...existingPullRequest,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.body !== undefined ? { body: patch.body } : {})
            },
            mergedBy: sessionUser
          });
        } catch (error) {
          if (
            error instanceof PullRequestMergeConflictError ||
            error instanceof PullRequestMergeBranchNotFoundError ||
            error instanceof PullRequestMergeNotSupportedError
          ) {
            throw new HTTPException(409, { message: error.message });
          }
          throw error;
        }
        if (existingPullRequest.head_ref !== existingPullRequest.base_ref) {
          try {
            await repositoryClient.deleteBranch({
              repositoryId: repository.id,
              owner,
              repo,
              branchName: existingPullRequest.head_ref
            });
          } catch {}
        }
      }
      if (patch.closeIssueNumbers !== undefined) {
        await pullRequestService.replacePullRequestClosingIssueNumbers({
          repositoryId: repository.id,
          pullRequestId: existingPullRequest.id,
          pullRequestNumber: number,
          issueNumbers: patch.closeIssueNumbers
        });
      }

      const updatedPullRequest = await pullRequestService.updatePullRequest(repository.id, number, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.draft !== undefined ? { draft: patch.draft } : {}),
        ...(mergeResult
          ? {
              mergeCommitOid: mergeResult.mergeCommitOid,
              baseOid: mergeResult.baseOid,
              headOid: mergeResult.headOid
            }
          : {})
      });
      if (!updatedPullRequest) {
        throw new HTTPException(404, { message: "Pull request not found" });
      }
      const closingIssueNumbers = await pullRequestService.listPullRequestClosingIssueNumbers(repository.id, number);
      const pullRequest =
        (await pullRequestService.findPullRequestByNumber(repository.id, number, sessionUser.id)) ??
        updatedPullRequest;
      if (patch.state === "merged" && closingIssueNumbers.length > 0) {
        await issueService.closeIssuesByNumbers(repository.id, closingIssueNumbers);
      }
      if (patch.state === "merged" && mergeResult?.createdCommit) {
        await triggerActionWorkflows({
          env: c.env,
          ...executionCtxArg(c),
          repository,
          triggerEvent: "push",
          triggerRef: pullRequest.base_ref,
          triggerSha: mergeResult.mergeCommitOid,
          triggeredByUser: sessionUser,
          requestOrigin
        });
      }
      const hasActionsMention = containsActionsMention({ title: pullRequest.title, body: pullRequest.body });
      if (!hadActionsMention && hasActionsMention) {
        await triggerMentionActionRun({
          env: c.env,
          ...executionCtxArg(c),
          repository,
          prompt: buildMentionPrompt({ title: pullRequest.title, body: pullRequest.body }),
          triggerRef: pullRequest.head_ref,
          triggerSha: pullRequest.head_oid,
          triggerSourceType: "pull_request",
          triggerSourceNumber: pullRequest.number,
          triggeredByUser: sessionUser,
          requestOrigin
        });
      }
      if (patch.state !== undefined || patch.closeIssueNumbers !== undefined) {
        const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
        await reconcileIssueNumbers({
          workflowTaskFlowService,
          repository,
          issueNumbers:
            patch.closeIssueNumbers !== undefined
              ? [...previousClosingIssueNumbers, ...closingIssueNumbers]
              : closingIssueNumbers,
          viewerId: sessionUser.id
        });
      }

      return c.json({ pullRequest, closingIssueNumbers });
    });
}
