import {
  AuthService,
  HTTPException,
  RepositoryService,
  deleteCookie,
  mustSessionUser,
  optionalSession,
  requireSession,
  setCookie
} from "./deps";

import {
  assertEmail,
  assertString,
  assertUsername,
  isUniqueConstraintError,
  parseJsonObject,
  parseLimit,
  sessionCookieSecure,
  type ApiRouter
} from "./shared";

const userRegistrationEnabled = (flag: string | undefined): boolean =>
  typeof flag === "string" && flag.trim().length > 0;

export function registerPlatformRoutes(router: ApiRouter): void {
  router.get("/healthz", (c) => c.json({ ok: true }));

  router.post("/auth/register", async (c) => {
    if (!userRegistrationEnabled(c.env.ALLOW_USER_REGISTRATION)) {
      throw new HTTPException(403, { message: "User registration is disabled" });
    }

    const payload = await parseJsonObject(c.req.raw);
    const username = assertString(payload.username, "username");
    const email = assertString(payload.email, "email").toLowerCase();
    const password = assertString(payload.password, "password", { trim: false });

    assertUsername(username);
    assertEmail(email);

    if (password.length < 8) {
      throw new HTTPException(400, { message: "Password must be at least 8 characters" });
    }

    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    let user;
    try {
      user = await authService.createUser({
        username,
        email,
        password
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HTTPException(409, { message: "Username or email already exists" });
      }
      throw error;
    }

    const sessionToken = await authService.createSessionToken(user);
    setCookie(c, "session", sessionToken, {
      path: "/",
      httpOnly: true,
      secure: sessionCookieSecure(c.req.url),
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 7
    });

    return c.json({ user }, 201);
  });

  router.post("/auth/login", async (c) => {
    const payload = await parseJsonObject(c.req.raw);
    const usernameOrEmailInput = assertString(payload.usernameOrEmail, "usernameOrEmail");
    const usernameOrEmail = usernameOrEmailInput.includes("@")
      ? usernameOrEmailInput.toLowerCase()
      : usernameOrEmailInput;
    const password = assertString(payload.password, "password", { trim: false });

    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    const user = await authService.verifyUserCredentials(usernameOrEmail, password);
    if (!user) {
      throw new HTTPException(401, { message: "Invalid credentials" });
    }

    const sessionToken = await authService.createSessionToken(user);
    setCookie(c, "session", sessionToken, {
      path: "/",
      httpOnly: true,
      secure: sessionCookieSecure(c.req.url),
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 7
    });

    return c.json({ user });
  });

  router.post("/auth/logout", requireSession, async (c) => {
    deleteCookie(c, "session", {
      path: "/"
    });
    return c.json({ ok: true });
  });

  router.get("/me", optionalSession, async (c) => {
    const user = c.get("sessionUser") ?? null;
    return c.json({ user });
  });

  router.get("/public/repos", async (c) => {
    const repositoryService = new RepositoryService(c.env.DB);
    const repositories = await repositoryService.listPublicRepositories(
      parseLimit(c.req.query("limit"), 50)
    );
    return c.json({ repositories });
  });

  router.post("/auth/tokens", requireSession, async (c) => {
    const payload = await parseJsonObject(c.req.raw);
    const name = assertString(payload.name, "name");
    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    const sessionUser = mustSessionUser(c);

    const createTokenInput: { userId: string; name: string; expiresAt?: number } = {
      userId: sessionUser.id,
      name
    };
    if (payload.expiresAt !== undefined) {
      if (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt)) {
        throw new HTTPException(400, { message: "Field 'expiresAt' must be a timestamp number" });
      }
      createTokenInput.expiresAt = payload.expiresAt;
    }

    const created = await authService.createAccessToken(createTokenInput);

    return c.json(
      {
        token: created.token,
        tokenId: created.tokenId
      },
      201
    );
  });

  router.get("/auth/tokens", requireSession, async (c) => {
    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    const sessionUser = mustSessionUser(c);
    const tokens = await authService.listAccessTokens(sessionUser.id);
    return c.json({ tokens });
  });

  router.delete("/auth/tokens/:tokenId", requireSession, async (c) => {
    const authService = new AuthService(c.env.DB, c.env.JWT_SECRET);
    const sessionUser = mustSessionUser(c);
    const tokenId = assertString(c.req.param("tokenId"), "tokenId");
    const revoked = await authService.revokeAccessToken(sessionUser.id, tokenId);
    if (!revoked) {
      throw new HTTPException(404, { message: "Token not found" });
    }
    return c.json({ ok: true });
  });
}
