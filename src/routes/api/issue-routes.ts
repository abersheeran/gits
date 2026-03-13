import {
  AuthService,
  HTTPException,
  IssueService,
  RepositoryService,
  containsActionsMention,
  createRepositoryObjectClient,
  mustSessionUser,
  optionalSession,
  requireSession,
  triggerActionWorkflows,
  triggerInteractiveAgentSession,
  triggerMentionActionRun
} from "./deps";

import {
  assertActionAgentType,
  assertIssueState,
  assertIssueTaskStatus,
  assertOptionalString,
  assertPositiveInteger,
  assertString,
  buildInteractiveIssueAgentPrompt,
  buildIssueCommentMentionPrompt,
  buildIssueConversationHistory,
  buildIssueCreatedAgentPrompt,
  buildMentionPrompt,
  createWorkflowTaskFlowService,
  executionCtxArg,
  findReadableRepositoryOr404,
  parseIssueListState,
  parseJsonObject,
  parseLimit,
  parsePage,
  reconcileIssueRecords,
  resolveDefaultBranchTarget,
  type ApiRouter,
  type CreateIssueCommentInput,
  type CreateIssueInput,
  type TriggerRepositoryAgentInput,
  type UpdateIssueInput
} from "./shared";

export function registerIssueRoutes(router: ApiRouter): void {
  const unsupportedIssueMetadataMessage =
    "Issue labels, milestones, assignees have been removed; use acceptance criteria instead.";

  router.get("/repos/:owner/:repo/issues", optionalSession, async (c) => {
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

    const issueService = new IssueService(c.env.DB);
    const page = parsePage(c.req.query("page"));
    const issuePage = await issueService.listIssues(
      repository.id,
      parseIssueListState(c.req.query("state")),
      {
        limit: parseLimit(c.req.query("limit"), 50),
        page,
        ...(sessionUser ? { viewerId: sessionUser.id } : {})
      }
    );
    const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
    const issues = await reconcileIssueRecords({
      workflowTaskFlowService,
      repository,
      issues: issuePage.items,
      ...(sessionUser ? { viewerId: sessionUser.id } : {})
    });
    return c.json({
      issues,
      pagination: {
        total: issuePage.total,
        page: issuePage.page,
        perPage: issuePage.per_page,
        hasNextPage: issuePage.has_next_page
      }
    });
  });

  router.get("/repos/:owner/:repo/issues/:number", optionalSession, async (c) => {
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

    const issueService = new IssueService(c.env.DB);
    const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
    const issue =
      (await workflowTaskFlowService.reconcileIssueTaskStatus({
        repository,
        issueNumber: number,
        ...(sessionUser ? { viewerId: sessionUser.id } : {})
      })) ?? null;
    if (!issue) {
      throw new HTTPException(404, { message: "Issue not found" });
    }
    const linkedPullRequests = await issueService.listLinkedPullRequestsForIssue(repository.id, number);
    const taskFlow = await workflowTaskFlowService.buildIssueTaskFlow({
      repository,
      issue,
      linkedPullRequests
    });
    return c.json({ issue, linkedPullRequests, taskFlow });
  });

  router.get("/repos/:owner/:repo/issues/:number/comments", optionalSession, async (c) => {
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

    const issueService = new IssueService(c.env.DB);
    const issue = await issueService.findIssueByNumber(repository.id, number, sessionUser?.id);
    if (!issue) {
      throw new HTTPException(404, { message: "Issue not found" });
    }
    const comments = await issueService.listIssueComments(repository.id, number, sessionUser?.id);
    return c.json({ comments });
  });

  router.post("/repos/:owner/:repo/issues", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const input: CreateIssueInput = {
      title: assertString(payload.title, "title")
    };
    if (payload.body !== undefined) {
      input.body = assertOptionalString(payload.body, "body") ?? "";
    }
    if (payload.acceptanceCriteria !== undefined) {
      input.acceptanceCriteria =
        assertOptionalString(payload.acceptanceCriteria, "acceptanceCriteria") ?? "";
    }
    if (payload.labelIds !== undefined || payload.milestoneId !== undefined) {
      throw new HTTPException(400, { message: unsupportedIssueMetadataMessage });
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

    const issueService = new IssueService(c.env.DB);
    const createdIssue = await issueService.createIssue({
      repositoryId: repository.id,
      authorId: sessionUser.id,
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: input.acceptanceCriteria }
        : {})
    });
    const issue =
      (await issueService.findIssueByNumber(repository.id, createdIssue.number, sessionUser.id)) ??
      createdIssue;
    const issueConversationHistory = buildIssueConversationHistory({
      issueAuthorUsername: issue.author_username,
      issueBody: issue.body,
      issueAcceptanceCriteria: issue.acceptance_criteria,
      comments: []
    });
    const repositoryClient = createRepositoryObjectClient(c.env);
    const defaultBranchTarget = await resolveDefaultBranchTarget(repositoryClient, repository);
    const requestOrigin = new URL(c.req.url).origin;

    await triggerActionWorkflows({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      triggerEvent: "issue_created",
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggeredByUser: sessionUser,
      requestOrigin,
      buildPrompt: (workflow) =>
        buildIssueCreatedAgentPrompt({
          workflowPrompt: workflow.prompt,
          owner,
          repo,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueBody: issue.body,
          acceptanceCriteria: issue.acceptance_criteria,
          issueConversationHistory,
          triggerReason: "issue_created",
          defaultBranchRef: defaultBranchTarget.ref,
          requestOrigin,
          triggeredByUsername: sessionUser.username
        })
    });
    if (containsActionsMention({ title: issue.title, body: issue.body })) {
      await triggerMentionActionRun({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        prompt: buildMentionPrompt({ title: issue.title, body: issue.body }),
        ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
        ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
        triggerSourceType: "issue",
        triggerSourceNumber: issue.number,
        triggeredByUser: sessionUser,
        requestOrigin
      });
    }

    return c.json({ issue }, 201);
  });

  router.patch("/repos/:owner/:repo/issues/:number", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const number = assertPositiveInteger(c.req.param("number"), "number");
    const payload = await parseJsonObject(c.req.raw);
    const patch: UpdateIssueInput = {};
    if (payload.title !== undefined) {
      patch.title = assertString(payload.title, "title");
    }
    if (payload.body !== undefined) {
      patch.body = assertOptionalString(payload.body, "body") ?? "";
    }
    if (payload.state !== undefined) {
      patch.state = assertIssueState(payload.state);
    }
    if (payload.taskStatus !== undefined) {
      patch.taskStatus = assertIssueTaskStatus(payload.taskStatus);
    }
    if (payload.acceptanceCriteria !== undefined) {
      patch.acceptanceCriteria =
        assertOptionalString(payload.acceptanceCriteria, "acceptanceCriteria") ?? "";
    }
    if (payload.labelIds !== undefined || payload.milestoneId !== undefined) {
      throw new HTTPException(400, { message: unsupportedIssueMetadataMessage });
    }
    if (
      patch.title === undefined &&
      patch.body === undefined &&
      patch.state === undefined &&
      patch.taskStatus === undefined &&
      patch.acceptanceCriteria === undefined
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

    const issueService = new IssueService(c.env.DB);
    const existingIssue = await issueService.findIssueByNumber(repository.id, number, sessionUser.id);
    if (!existingIssue) {
      throw new HTTPException(404, { message: "Issue not found" });
    }
    const hadActionsMention = containsActionsMention({
      title: existingIssue.title,
      body: existingIssue.body
    });

    const updatedIssue = await issueService.updateIssue(repository.id, number, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.taskStatus !== undefined ? { taskStatus: patch.taskStatus } : {}),
      ...(patch.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: patch.acceptanceCriteria }
        : {})
    });
    if (!updatedIssue) {
      throw new HTTPException(404, { message: "Issue not found" });
    }
    let issue =
      (await issueService.findIssueByNumber(repository.id, number, sessionUser.id)) ?? updatedIssue;
    if (patch.state !== undefined) {
      const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
      issue =
        (await workflowTaskFlowService.reconcileIssueTaskStatus({
          repository,
          issueNumber: issue.number,
          viewerId: sessionUser.id
        })) ?? issue;
    }
    const hasActionsMention = containsActionsMention({ title: issue.title, body: issue.body });
    if (!hadActionsMention && hasActionsMention) {
      const repositoryClient = createRepositoryObjectClient(c.env);
      const defaultBranchTarget = await resolveDefaultBranchTarget(repositoryClient, repository);
      await triggerMentionActionRun({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        prompt: buildMentionPrompt({ title: issue.title, body: issue.body }),
        ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
        ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
        triggerSourceType: "issue",
        triggerSourceNumber: issue.number,
        triggeredByUser: sessionUser,
        requestOrigin: new URL(c.req.url).origin
      });
    }

    return c.json({ issue });
  });

  router.post("/repos/:owner/:repo/issues/:number/comments", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const number = assertPositiveInteger(c.req.param("number"), "number");
    const payload = await parseJsonObject(c.req.raw);
    const input: CreateIssueCommentInput = {
      body: assertString(payload.body, "body")
    };

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

    const issueService = new IssueService(c.env.DB);
    const issue = await issueService.findIssueByNumber(repository.id, number);
    if (!issue) {
      throw new HTTPException(404, { message: "Issue not found" });
    }

    let commentAuthorId = sessionUser.id;
    const accessTokenContext = c.get("accessTokenContext");
    const isActionsComment = accessTokenContext?.displayAsActions === true;
    if (isActionsComment) {
      const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
      const actionsUser = await authService.getOrCreateActionsUser();
      commentAuthorId = actionsUser.id;
    }

    const comment = await issueService.createIssueComment({
      repositoryId: repository.id,
      issueId: issue.id,
      issueNumber: issue.number,
      authorId: commentAuthorId,
      body: input.body
    });
    const comments = await issueService.listIssueComments(repository.id, issue.number);
    const issueConversationHistory = buildIssueConversationHistory({
      issueAuthorUsername: issue.author_username,
      issueBody: issue.body,
      issueAcceptanceCriteria: issue.acceptance_criteria,
      comments
    });
    const repositoryClient = createRepositoryObjectClient(c.env);
    const defaultBranchTarget = await resolveDefaultBranchTarget(repositoryClient, repository);
    const requestOrigin = new URL(c.req.url).origin;

    if (!isActionsComment) {
      await triggerActionWorkflows({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        triggerEvent: "issue_created",
        ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
        ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
        triggerSourceType: "issue",
        triggerSourceNumber: issue.number,
        triggerSourceCommentId: comment.id,
        triggeredByUser: sessionUser,
        requestOrigin,
        buildPrompt: (workflow) =>
          buildIssueCreatedAgentPrompt({
            workflowPrompt: workflow.prompt,
            owner,
            repo,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueBody: issue.body,
            acceptanceCriteria: issue.acceptance_criteria,
            issueConversationHistory,
            triggerReason: "issue_comment_added",
            triggerCommentId: comment.id,
            triggerCommentAuthorUsername: comment.author_username,
            defaultBranchRef: defaultBranchTarget.ref,
            requestOrigin,
            triggeredByUsername: sessionUser.username
          })
      });
    }

    if (!isActionsComment && containsActionsMention({ title: issue.title, body: comment.body })) {
      await triggerMentionActionRun({
        env: c.env,
        ...executionCtxArg(c),
        repository,
        prompt: buildIssueCommentMentionPrompt({
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueConversationHistory
        }),
        ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
        ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
        triggerSourceType: "issue",
        triggerSourceNumber: issue.number,
        triggerSourceCommentId: comment.id,
        triggeredByUser: sessionUser,
        requestOrigin
      });
    }

    return c.json({ comment }, 201);
  });

  router.post("/repos/:owner/:repo/issues/:number/assign-agent", requireSession, async (c) => {
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
      const threadId = assertOptionalString(payload.threadId, "threadId");
      if (threadId !== undefined) {
        input.threadId = threadId;
      }
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

    const issueService = new IssueService(c.env.DB);
    const issue = await issueService.findIssueByNumber(repository.id, number);
    if (!issue) {
      throw new HTTPException(404, { message: "Issue not found" });
    }
    if (issue.state !== "open") {
      throw new HTTPException(409, { message: "Issue must be open to assign an agent" });
    }

    const comments = await issueService.listIssueComments(repository.id, issue.number);
    const issueConversationHistory = buildIssueConversationHistory({
      issueAuthorUsername: issue.author_username,
      issueBody: issue.body,
      issueAcceptanceCriteria: issue.acceptance_criteria,
      comments
    });
    const repositoryClient = createRepositoryObjectClient(c.env);
    const defaultBranchTarget = await resolveDefaultBranchTarget(repositoryClient, repository);
    const agentType = input.agentType ?? "codex";

    const execution = await triggerInteractiveAgentSession({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      origin: "issue_assign",
      agentType,
      prompt: buildInteractiveIssueAgentPrompt({
        owner,
        repo,
        issueNumber: issue.number,
        issueTitle: issue.title,
        acceptanceCriteria: issue.acceptance_criteria,
        issueConversationHistory,
        reason: "assign",
        ...(input.prompt !== undefined ? { instruction: input.prompt } : {})
      }),
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggeredByUser: sessionUser,
      requestOrigin: new URL(c.req.url).origin
    });

    const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
    const updatedIssue =
      (await workflowTaskFlowService.reconcileIssueTaskStatus({
        repository,
        issueNumber: issue.number,
        viewerId: sessionUser.id
      })) ?? issue;

    return c.json({ ...execution, issue: updatedIssue }, 202);
  });

  router.post("/repos/:owner/:repo/issues/:number/resume-agent", requireSession, async (c) => {
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

    const issueService = new IssueService(c.env.DB);
    const issue = await issueService.findIssueByNumber(repository.id, number);
    if (!issue) {
      throw new HTTPException(404, { message: "Issue not found" });
    }
    if (issue.state !== "open") {
      throw new HTTPException(409, { message: "Issue must be open to resume an agent" });
    }

    const comments = await issueService.listIssueComments(repository.id, issue.number);
    const issueConversationHistory = buildIssueConversationHistory({
      issueAuthorUsername: issue.author_username,
      issueBody: issue.body,
      issueAcceptanceCriteria: issue.acceptance_criteria,
      comments
    });
    const repositoryClient = createRepositoryObjectClient(c.env);
    const defaultBranchTarget = await resolveDefaultBranchTarget(repositoryClient, repository);
    const agentType = input.agentType ?? "codex";

    const execution = await triggerInteractiveAgentSession({
      env: c.env,
      ...executionCtxArg(c),
      repository,
      origin: "issue_resume",
      agentType,
      prompt: buildInteractiveIssueAgentPrompt({
        owner,
        repo,
        issueNumber: issue.number,
        issueTitle: issue.title,
        acceptanceCriteria: issue.acceptance_criteria,
        issueConversationHistory,
        reason: "resume",
        ...(input.prompt !== undefined ? { instruction: input.prompt } : {})
      }),
      ...(defaultBranchTarget.ref ? { triggerRef: defaultBranchTarget.ref } : {}),
      ...(defaultBranchTarget.sha ? { triggerSha: defaultBranchTarget.sha } : {}),
      triggerSourceType: "issue",
      triggerSourceNumber: issue.number,
      triggeredByUser: sessionUser,
      requestOrigin: new URL(c.req.url).origin
    });

    const workflowTaskFlowService = createWorkflowTaskFlowService(c.env);
    const updatedIssue =
      (await workflowTaskFlowService.reconcileIssueTaskStatus({
        repository,
        issueNumber: issue.number,
        viewerId: sessionUser.id
      })) ?? issue;

    return c.json({ ...execution, issue: updatedIssue }, 202);
  });
}
