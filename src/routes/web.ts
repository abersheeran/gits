import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { optionalSession } from "../middleware/auth";
import { AuthService } from "../services/auth-service";
import { RepositoryBrowserService } from "../services/repository-browser-service";
import { RepositoryService } from "../services/repository-service";
import { StorageService } from "../services/storage-service";
import type { AppEnv, AuthUser, RepositoryRecord } from "../types";
import { renderLoginPage, renderRegisterPage } from "../views/auth";
import {
  renderCollaboratorsPage,
  renderDashboardHome,
  renderNewRepositoryPage,
  renderRepoSettingsPage,
  renderTokensPage
} from "../views/dashboard";
import { renderHomePage } from "../views/home";
import { renderRepositoryPage } from "../views/repository";

const router = new Hono<AppEnv>();

const USERNAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,30}[A-Za-z0-9])?$/;
const REPO_NAME_REGEX = /^[A-Za-z0-9._-]{1,100}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormValue = string | File;
type ParsedForm = Record<string, FormValue | FormValue[]>;

function parseFormValue(
  body: ParsedForm,
  key: string,
  options?: { trim?: boolean; defaultValue?: string }
): string {
  const trim = options?.trim ?? true;
  const value = body[key];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return options?.defaultValue ?? "";
  }
  return trim ? raw.trim() : raw;
}

function parseCheckbox(body: ParsedForm, key: string): boolean {
  return parseFormValue(body, key, { trim: true }).length > 0;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function sessionCookieSecure(url: string): boolean {
  return new URL(url).protocol === "https:";
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string, requestUrl: string): void {
  setCookie(c, "session", token, {
    path: "/",
    httpOnly: true,
    secure: sessionCookieSecure(requestUrl),
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 7
  });
}

function getNotice(c: { req: { query(key: string): string | undefined } }) {
  const success = c.req.query("success");
  if (success) {
    return { tone: "success" as const, message: success };
  }
  const error = c.req.query("error");
  if (error) {
    return { tone: "error" as const, message: error };
  }
  const info = c.req.query("info");
  if (info) {
    return { tone: "info" as const, message: info };
  }
  return undefined;
}

function redirectWithNotice(
  c: {
    req: { url: string };
    redirect: (location: string, status?: 301 | 302 | 303 | 307 | 308) => Response;
  },
  path: string,
  tone: "success" | "error" | "info",
  message: string
): Response {
  const url = new URL(path, c.req.url);
  url.searchParams.set(tone, message);
  return c.redirect(`${url.pathname}${url.search}`, 303);
}

function requireWebSession(c: {
  get: (key: "sessionUser") => AuthUser | undefined;
  req: { url: string };
  redirect: (location: string, status?: 301 | 302 | 303 | 307 | 308) => Response;
}): AuthUser | Response {
  const user = c.get("sessionUser");
  if (!user) {
    return redirectWithNotice(c, "/auth/login", "error", "请先登录");
  }
  return user;
}

function assertUsername(value: string): void {
  if (!USERNAME_REGEX.test(value)) {
    throw new HTTPException(400, {
      message: "用户名不合法：长度 1-32，只允许字母数字与 ._-，且不能以标点开头或结尾"
    });
  }
}

function assertRepositoryName(value: string): void {
  if (!REPO_NAME_REGEX.test(value) || value.endsWith(".git")) {
    throw new HTTPException(400, {
      message: "仓库名不合法：长度 1-100，只允许字母数字与 ._-，且不能以 .git 结尾"
    });
  }
}

function assertEmail(value: string): void {
  if (!EMAIL_REGEX.test(value)) {
    throw new HTTPException(400, { message: "邮箱格式不正确" });
  }
}

async function requireOwnedRepository(
  repositoryService: RepositoryService,
  owner: string,
  repoName: string,
  user: AuthUser
): Promise<RepositoryRecord> {
  const repository = await repositoryService.findRepository(owner, repoName);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  if (repository.owner_id !== user.id) {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  return repository;
}

router.use("*", optionalSession);

router.get("/", async (c) => {
  const repositories = await new RepositoryService(c.env.DB).listPublicRepositories(50);
  return c.html(
    renderHomePage({
      repositories,
      user: c.get("sessionUser"),
      notice: getNotice(c)
    })
  );
});

router.get("/auth/login", (c) => {
  if (c.get("sessionUser")) {
    return c.redirect("/dashboard", 303);
  }
  return c.html(renderLoginPage({ notice: getNotice(c) }));
});

router.post("/auth/login", async (c) => {
  const body = (await c.req.parseBody()) as ParsedForm;
  const usernameOrEmailRaw = parseFormValue(body, "usernameOrEmail");
  const usernameOrEmail = usernameOrEmailRaw.includes("@")
    ? usernameOrEmailRaw.toLowerCase()
    : usernameOrEmailRaw;
  const password = parseFormValue(body, "password", { trim: false });

  if (!usernameOrEmail || !password) {
    return c.html(
      renderLoginPage({
        notice: { tone: "error", message: "请输入用户名/邮箱和密码" },
        values: { usernameOrEmail: usernameOrEmailRaw }
      }),
      400
    );
  }

  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  const user = await authService.verifyUserCredentials(usernameOrEmail, password);
  if (!user) {
    return c.html(
      renderLoginPage({
        notice: { tone: "error", message: "用户名/邮箱或密码错误" },
        values: { usernameOrEmail: usernameOrEmailRaw }
      }),
      401
    );
  }

  const sessionToken = await authService.createSessionToken(user);
  setSessionCookie(c, sessionToken, c.req.url);
  return redirectWithNotice(c, "/dashboard", "success", "登录成功");
});

router.get("/auth/register", (c) => {
  if (c.get("sessionUser")) {
    return c.redirect("/dashboard", 303);
  }
  return c.html(renderRegisterPage({ notice: getNotice(c) }));
});

router.post("/auth/register", async (c) => {
  const body = (await c.req.parseBody()) as ParsedForm;
  const username = parseFormValue(body, "username");
  const email = parseFormValue(body, "email").toLowerCase();
  const password = parseFormValue(body, "password", { trim: false });

  try {
    if (!username || !email || !password) {
      throw new HTTPException(400, { message: "用户名、邮箱、密码均为必填" });
    }
    assertUsername(username);
    assertEmail(email);
    if (password.length < 8) {
      throw new HTTPException(400, { message: "密码至少 8 位" });
    }

    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    const created = await authService.createUser({ username, email, password });
    const sessionToken = await authService.createSessionToken(created);
    setSessionCookie(c, sessionToken, c.req.url);
    return redirectWithNotice(c, "/dashboard", "success", "账号创建成功");
  } catch (error) {
    const message =
      isUniqueConstraintError(error)
        ? "用户名或邮箱已存在"
        : error instanceof HTTPException
          ? error.message
          : "注册失败，请稍后重试";

    return c.html(
      renderRegisterPage({
        notice: { tone: "error", message },
        values: { username, email }
      }),
      400
    );
  }
});

router.post("/auth/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return redirectWithNotice(c, "/", "success", "已退出登录");
});

router.get("/dashboard", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const repositories = await new RepositoryService(c.env.DB).listRepositoriesForUser(sessionUser.id);
  return c.html(
    renderDashboardHome({
      user: sessionUser,
      repositories,
      notice: getNotice(c)
    })
  );
});

router.get("/dashboard/repos/new", (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }
  return c.html(renderNewRepositoryPage({ user: sessionUser, notice: getNotice(c) }));
});

router.post("/dashboard/repos", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = (await c.req.parseBody()) as ParsedForm;
  const name = parseFormValue(body, "name");
  const description = parseFormValue(body, "description");
  const isPrivate = parseCheckbox(body, "isPrivate");
  const repositoryService = new RepositoryService(c.env.DB);
  const storageService = new StorageService(c.env.GIT_BUCKET);

  let createdRepoId: string | null = null;

  try {
    if (!name) {
      throw new HTTPException(400, { message: "仓库名不能为空" });
    }
    assertRepositoryName(name);

    const created = await repositoryService.createRepository({
      ownerId: sessionUser.id,
      name,
      isPrivate,
      ...(description ? { description } : {})
    });
    createdRepoId = created.id;
    await storageService.initializeRepository(sessionUser.username, name);

    return redirectWithNotice(
      c,
      `/${sessionUser.username}/${name}`,
      "success",
      "仓库创建成功"
    );
  } catch (error) {
    if (createdRepoId) {
      await repositoryService.deleteRepositoryById(createdRepoId).catch(() => undefined);
      await storageService.deleteRepository(sessionUser.username, name).catch(() => undefined);
    }

    const message =
      isUniqueConstraintError(error)
        ? "仓库已存在"
        : error instanceof HTTPException
          ? error.message
          : "创建仓库失败";

    return c.html(
      renderNewRepositoryPage({
        user: sessionUser,
        notice: { tone: "error", message },
        values: { name, description, isPrivate }
      }),
      400
    );
  }
});

router.get("/dashboard/repos/:owner/:repo/settings", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await requireOwnedRepository(repositoryService, owner, repoName, sessionUser);
  const requestOrigin = new URL(c.req.url).origin;
  const appOrigin = c.env.APP_ORIGIN === "auto" ? requestOrigin : c.env.APP_ORIGIN;

  return c.html(
    renderRepoSettingsPage({
      user: sessionUser,
      repo: repository,
      appOrigin,
      notice: getNotice(c)
    })
  );
});

router.post("/dashboard/repos/:owner/:repo/settings", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const body = (await c.req.parseBody()) as ParsedForm;

  const nameRaw = parseFormValue(body, "name");
  const descriptionRaw = parseFormValue(body, "description");
  const isPrivate = parseCheckbox(body, "isPrivate");

  const repositoryService = new RepositoryService(c.env.DB);
  const storageService = new StorageService(c.env.GIT_BUCKET);

  const repository = await requireOwnedRepository(repositoryService, owner, repoName, sessionUser);

  const nextName = nameRaw && nameRaw !== repoName ? nameRaw : undefined;
  if (nextName) {
    assertRepositoryName(nextName);
  }

  const descriptionPatch = descriptionRaw.length > 0 ? descriptionRaw : null;
  let renamed = false;

  try {
    if (nextName) {
      await storageService.renameRepository(owner, repoName, nextName);
      renamed = true;
    }

    await repositoryService.updateRepository(repository.id, {
      ...(nextName !== undefined ? { name: nextName } : {}),
      description: descriptionPatch,
      isPrivate
    });

    const redirectName = nextName ?? repoName;
    return redirectWithNotice(
      c,
      `/dashboard/repos/${owner}/${redirectName}/settings`,
      "success",
      "仓库设置已更新"
    );
  } catch (error) {
    if (renamed && nextName) {
      await storageService.renameRepository(owner, nextName, repoName).catch(() => undefined);
    }

    const requestOrigin = new URL(c.req.url).origin;
    const appOrigin = c.env.APP_ORIGIN === "auto" ? requestOrigin : c.env.APP_ORIGIN;
    const message =
      isUniqueConstraintError(error)
        ? "仓库名已存在"
        : error instanceof HTTPException
          ? error.message
          : "更新仓库失败";

    return c.html(
      renderRepoSettingsPage({
        user: sessionUser,
        repo: repository,
        appOrigin,
        notice: { tone: "error", message },
        values: {
          name: nameRaw,
          description: descriptionRaw,
          isPrivate
        }
      }),
      400
    );
  }
});

router.post("/dashboard/repos/:owner/:repo/delete", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const body = (await c.req.parseBody()) as ParsedForm;
  const confirmRepoName = parseFormValue(body, "confirmRepoName");

  const repositoryService = new RepositoryService(c.env.DB);
  const storageService = new StorageService(c.env.GIT_BUCKET);
  const repository = await requireOwnedRepository(repositoryService, owner, repoName, sessionUser);

  if (confirmRepoName !== repoName) {
    return redirectWithNotice(
      c,
      `/dashboard/repos/${owner}/${repoName}/settings`,
      "error",
      "确认名不匹配，未删除"
    );
  }

  await storageService.deleteRepository(owner, repoName);
  await repositoryService.deleteRepositoryById(repository.id);
  return redirectWithNotice(c, "/dashboard", "success", `已删除 ${owner}/${repoName}`);
});

router.get("/dashboard/repos/:owner/:repo/collaborators", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
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

  return c.html(
    renderCollaboratorsPage({
      user: sessionUser,
      repo: repository,
      collaborators,
      notice: getNotice(c)
    })
  );
});

router.post("/dashboard/repos/:owner/:repo/collaborators", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const body = (await c.req.parseBody()) as ParsedForm;
  const username = parseFormValue(body, "username");
  const permissionRaw = parseFormValue(body, "permission");

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

  try {
    if (!username) {
      throw new HTTPException(400, { message: "用户名不能为空" });
    }

    if (permissionRaw !== "read" && permissionRaw !== "write" && permissionRaw !== "admin") {
      throw new HTTPException(400, { message: "权限必须是 read/write/admin" });
    }

    const collaborator = await repositoryService.findUserByUsername(username);
    if (!collaborator) {
      throw new HTTPException(404, { message: "用户不存在" });
    }
    if (collaborator.id === repository.owner_id) {
      throw new HTTPException(400, { message: "owner 已拥有完整权限" });
    }

    await repositoryService.upsertCollaborator({
      repositoryId: repository.id,
      userId: collaborator.id,
      permission: permissionRaw
    });

    return redirectWithNotice(
      c,
      `/dashboard/repos/${owner}/${repoName}/collaborators`,
      "success",
      "协作者已更新"
    );
  } catch (error) {
    const message = error instanceof HTTPException ? error.message : "更新协作者失败";
    return c.html(
      renderCollaboratorsPage({
        user: sessionUser,
        repo: repository,
        collaborators,
        notice: { tone: "error", message },
        values: {
          username,
          permission:
            permissionRaw === "read" || permissionRaw === "write" || permissionRaw === "admin"
              ? permissionRaw
              : "read"
        }
      }),
      400
    );
  }
});

router.post("/dashboard/repos/:owner/:repo/collaborators/:username/delete", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const owner = c.req.param("owner");
  const repoName = c.req.param("repo");
  const username = c.req.param("username");

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
    return redirectWithNotice(
      c,
      `/dashboard/repos/${owner}/${repoName}/collaborators`,
      "error",
      "用户不存在"
    );
  }

  if (collaborator.id === repository.owner_id) {
    return redirectWithNotice(
      c,
      `/dashboard/repos/${owner}/${repoName}/collaborators`,
      "error",
      "不能移除 owner"
    );
  }

  await repositoryService.removeCollaborator(repository.id, collaborator.id);
  return redirectWithNotice(
    c,
    `/dashboard/repos/${owner}/${repoName}/collaborators`,
    "success",
    `已移除协作者 ${username}`
  );
});

router.get("/dashboard/tokens", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  const tokens = await authService.listAccessTokens(sessionUser.id);
  return c.html(
    renderTokensPage({
      user: sessionUser,
      tokens,
      notice: getNotice(c)
    })
  );
});

router.post("/dashboard/tokens", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const body = (await c.req.parseBody()) as ParsedForm;
  const name = parseFormValue(body, "name");
  const expiresAtRaw = parseFormValue(body, "expiresAt");

  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);

  try {
    if (!name) {
      throw new HTTPException(400, { message: "Token 名称不能为空" });
    }

    let expiresAt: number | undefined;
    if (expiresAtRaw) {
      const parsed = Number.parseInt(expiresAtRaw, 10);
      if (!Number.isFinite(parsed)) {
        throw new HTTPException(400, { message: "过期时间必须是毫秒时间戳" });
      }
      expiresAt = parsed;
    }

    const created = await authService.createAccessToken({
      userId: sessionUser.id,
      name,
      ...(expiresAt !== undefined ? { expiresAt } : {})
    });

    const tokens = await authService.listAccessTokens(sessionUser.id);
    return c.html(
      renderTokensPage({
        user: sessionUser,
        tokens,
        createdToken: created.token,
        notice: { tone: "success", message: "Token 创建成功，请立即保存" }
      })
    );
  } catch (error) {
    const message = error instanceof HTTPException ? error.message : "Token 创建失败";
    const tokens = await authService.listAccessTokens(sessionUser.id);
    return c.html(
      renderTokensPage({
        user: sessionUser,
        tokens,
        notice: { tone: "error", message },
        values: { name, expiresAt: expiresAtRaw }
      }),
      400
    );
  }
});

router.post("/dashboard/tokens/:tokenId/revoke", async (c) => {
  const sessionUser = requireWebSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const tokenId = c.req.param("tokenId");
  const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
  const revoked = await authService.revokeAccessToken(sessionUser.id, tokenId);
  if (!revoked) {
    return redirectWithNotice(c, "/dashboard/tokens", "error", "Token 不存在");
  }
  return redirectWithNotice(c, "/dashboard/tokens", "success", "Token 已吊销");
});

router.get("/:owner/:repo", async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const sessionUser = c.get("sessionUser");
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await repositoryService.findRepository(owner, repo);

  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const canRead = await repositoryService.canReadRepository(repository, sessionUser?.id);
  if (!canRead) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const browserService = new RepositoryBrowserService(new StorageService(c.env.GIT_BUCKET));
  const detailInput: { owner: string; repo: string; ref?: string } = { owner, repo };
  const detailRef = c.req.query("ref");
  if (detailRef) {
    detailInput.ref = detailRef;
  }

  const details = await browserService.getRepositoryDetail(detailInput);
  const history = await browserService.listCommitHistory({
    owner,
    repo,
    limit: 20,
    ...(details.selectedRef ? { ref: details.selectedRef } : {})
  });

  const requestOrigin = new URL(c.req.url).origin;
  const appOrigin = c.env.APP_ORIGIN === "auto" ? requestOrigin : c.env.APP_ORIGIN;

  return c.html(
    renderRepositoryPage({
      repo: repository,
      user: sessionUser,
      notice: getNotice(c),
      appOrigin,
      defaultBranch: details.defaultBranch,
      selectedRef: details.selectedRef,
      branches: details.branches,
      readme: details.readme,
      commits: history.commits.map((commit) => ({
        oid: commit.oid,
        message: commit.message,
        author: {
          timestamp: commit.author.timestamp,
          name: commit.author.name
        }
      }))
    })
  );
});

export default router;
