import { createInitializedRepository } from "../../services/repository-creation";
import { stopMirror } from "../../services/github/removal";
import {
  HTTPException,
  RepositoryService,
  createRepositoryObjectClient,
  mustSessionUser,
  requireSession
} from "./deps";

import {
  assertCollaboratorPermission,
  assertOptionalBoolean,
  assertOptionalString,
  normalizeBranchRef,
  assertRepositoryName,
  assertString,
  isUniqueConstraintError,
  parseJsonObject,
  type ApiRouter
} from "./shared";

export function registerRepositoryAdminRoutes(router: ApiRouter): void {
  router.post("/repos", requireSession, async (c) => {
    const payload = await parseJsonObject(c.req.raw);
    const name = assertString(payload.name, "name");
    assertRepositoryName(name);
    const sessionUser = mustSessionUser(c);
    const description = payload.description === undefined
      ? undefined : assertString(payload.description, "description");
    await createInitializedRepository(c.env, {
      ownerId: sessionUser.id,
      owner: sessionUser.username,
      name,
      isPrivate: assertOptionalBoolean(payload.isPrivate, "isPrivate") ?? true,
      ...(description ? { description } : {})
    });

    return c.json({ ok: true }, 201);
  });

  router.patch("/repos/:owner/:repo", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repositoryClient = createRepositoryObjectClient(c.env);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    if (repository.owner_id !== sessionUser.id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    if ((payload.description !== undefined || payload.isPrivate !== undefined)
      && await repositoryService.findMirror(repository.id)) {
      throw new HTTPException(409, { message: "Mirror metadata is managed by GitHub" });
    }

    const nextNameRaw = assertOptionalString(payload.name, "name");
    const nextDescriptionRaw = assertOptionalString(payload.description, "description");
    const nextVisibility = assertOptionalBoolean(payload.isPrivate, "isPrivate");

    const nextName = nextNameRaw && nextNameRaw !== repoName ? nextNameRaw : undefined;
    if (nextName) {
      assertRepositoryName(nextName);
    }

    const descriptionPatch =
      payload.description === undefined
        ? undefined
        : nextDescriptionRaw && nextDescriptionRaw.length > 0
          ? nextDescriptionRaw
          : null;
    const isPrivatePatch = nextVisibility;

    let renamed = false;
    if (nextName) {
      await repositoryClient.renameRepository({
        repositoryId: repository.id,
        owner,
        repo: repoName,
        nextRepo: nextName
      });
      renamed = true;
    }

    try {
      await repositoryService.updateRepository(repository.id, {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(descriptionPatch !== undefined ? { description: descriptionPatch } : {}),
        ...(isPrivatePatch !== undefined ? { isPrivate: isPrivatePatch } : {})
      });
    } catch (error) {
      if (renamed && nextName) {
        await repositoryClient
          .renameRepository({
            repositoryId: repository.id,
            owner,
            repo: nextName,
            nextRepo: repoName
          })
          .catch(() => undefined);
      }
      if (isUniqueConstraintError(error)) {
        throw new HTTPException(409, { message: "Repository already exists" });
      }
      throw error;
    }

    return c.json({ ok: true });
  });

  router.delete("/repos/:owner/:repo", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repositoryClient = createRepositoryObjectClient(c.env);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    if (repository.owner_id !== sessionUser.id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const mirror = await repositoryService.findMirror(repository.id);
    if (mirror) {
      await stopMirror(c.env, mirror);
    }
    await repositoryClient.deleteRepository({
      repositoryId: repository.id,
      owner,
      repo: repoName
    });
    await repositoryService.deleteRepositoryById(repository.id);
    return c.json({ ok: true });
  });

  router.post("/repos/:owner/:repo/branches", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repositoryClient = createRepositoryObjectClient(c.env);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    if (repository.owner_id !== sessionUser.id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    if (await repositoryService.findMirror(repository.id)) {
      throw new HTTPException(409, { message: "Mirror branches are read-only" });
    }
    const branchName = normalizeBranchRef(payload.branchName, "branchName");
    const sourceOid = assertString(payload.sourceOid, "sourceOid").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(sourceOid)) {
      throw new HTTPException(400, {
        message: "Field 'sourceOid' must be a 40-character commit oid"
      });
    }

    const result = await repositoryClient.createBranch({
      repositoryId: repository.id,
      owner,
      repo: repoName,
      branchName,
      sourceOid
    });
    return c.json(result, 201);
  });

  router.patch("/repos/:owner/:repo/default-branch", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repositoryClient = createRepositoryObjectClient(c.env);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    if (repository.owner_id !== sessionUser.id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    if (await repositoryService.findMirror(repository.id)) {
      throw new HTTPException(409, { message: "Mirror branches are read-only" });
    }
    const branchName = normalizeBranchRef(payload.branchName, "branchName");
    const result = await repositoryClient.setDefaultBranch({
      repositoryId: repository.id,
      owner,
      repo: repoName,
      branchName
    });
    return c.json(result);
  });

  router.delete("/repos/:owner/:repo/branches/:branch", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const branchParam = c.req.param("branch");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);
    const repositoryClient = createRepositoryObjectClient(c.env);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    if (repository.owner_id !== sessionUser.id) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    if (await repositoryService.findMirror(repository.id)) {
      throw new HTTPException(409, { message: "Mirror branches are read-only" });
    }
    const branchName = normalizeBranchRef(branchParam, "branch");
    const result = await repositoryClient.deleteBranch({
      repositoryId: repository.id,
      owner,
      repo: repoName,
      branchName
    });
    return c.json(result);
  });

  router.get("/repos/:owner/:repo/collaborators", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const canAdmin = await repositoryService.canAdminRepository(repository, sessionUser.id);
    if (!canAdmin) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const collaborators = await repositoryService.listCollaborators(repository.id);
    return c.json({ collaborators });
  });

  router.put("/repos/:owner/:repo/collaborators", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const payload = await parseJsonObject(c.req.raw);
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    const canAdmin = await repositoryService.canAdminRepository(repository, sessionUser.id);
    if (!canAdmin) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const username = assertString(payload.username, "username");
    const permission = assertCollaboratorPermission(payload.permission);
    const collaborator = await repositoryService.findUserByUsername(username);
    if (!collaborator) {
      throw new HTTPException(404, { message: "User not found" });
    }
    if (collaborator.id === repository.owner_id) {
      throw new HTTPException(400, { message: "Owner is already a full-access member" });
    }

    await repositoryService.upsertCollaborator({
      repositoryId: repository.id,
      userId: collaborator.id,
      permission
    });
    return c.json({ ok: true });
  });

  router.delete("/repos/:owner/:repo/collaborators/:username", requireSession, async (c) => {
    const owner = c.req.param("owner");
    const repoName = c.req.param("repo");
    const username = assertString(c.req.param("username"), "username");
    const sessionUser = mustSessionUser(c);
    const repositoryService = new RepositoryService(c.env.DB);

    const repository = await repositoryService.findRepository(owner, repoName);
    if (!repository) {
      throw new HTTPException(404, { message: "Repository not found" });
    }
    const canAdmin = await repositoryService.canAdminRepository(repository, sessionUser.id);
    if (!canAdmin) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    const collaborator = await repositoryService.findUserByUsername(username);
    if (!collaborator) {
      throw new HTTPException(404, { message: "User not found" });
    }
    if (collaborator.id === repository.owner_id) {
      throw new HTTPException(400, { message: "Cannot remove repository owner" });
    }

    await repositoryService.removeCollaborator(repository.id, collaborator.id);
    return c.json({ ok: true });
  });
}
