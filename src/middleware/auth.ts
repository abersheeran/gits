import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { AuthService } from "../services/auth-service";
import type { AppEnv, AuthUser } from "../types";

function parseBearerToken(headerValue: string | null): string | null {
  if (!headerValue || !headerValue.startsWith("Bearer ")) {
    return null;
  }
  const token = headerValue.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function parseBasicAuthHeader(headerValue: string | null): {
  username: string;
  token: string;
} | null {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }

  const encoded = headerValue.slice("Basic ".length).trim();
  try {
    const decoded = atob(encoded);
    const separator = decoded.indexOf(":");
    if (separator <= 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separator),
      token: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function authServiceFromContext(c: Context<AppEnv>) {
  return new AuthService(c.env.DB, c.env.JWT_SECRET);
}

export const optionalSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("authorization") ?? null;
  const bearerToken = parseBearerToken(authHeader);
  const cookieToken = getCookie(c, "session");
  const authService = authServiceFromContext(c);
  let user: AuthUser | null = null;

  if (bearerToken) {
    user = await authService.verifySessionToken(bearerToken);
    if (!user) {
      try {
        const verified = await authService.verifyAccessTokenWithMetadata(bearerToken);
        user = verified?.user ?? null;
        if (verified?.context) {
          c.set("accessTokenContext", verified.context);
        }
      } catch {
        user = null;
      }
    }
  }

  if (!user && cookieToken) {
    user = await authService.verifySessionToken(cookieToken);
  }

  if (user) {
    c.set("sessionUser", user);
  }

  await next();
};

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  await optionalSession(c, async () => {
    const user = c.get("sessionUser");
    if (!user) {
      throw new HTTPException(401, {
        message: "Unauthorized"
      });
    }
    await next();
  });
};

export const requireGitBasicAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const basic = parseBasicAuthHeader(c.req.header("authorization") ?? null);
  if (!basic) {
    throw new HTTPException(401, {
      message: "Missing credentials",
      res: new Response("Authentication required", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Git service"'
        }
      })
    });
  }

  const authService = authServiceFromContext(c);
  const user = await authService.verifyAccessToken(basic.token);
  if (!user || user.username !== basic.username) {
    throw new HTTPException(401, {
      message: "Invalid token",
      res: new Response("Invalid credentials", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Git service"'
        }
      })
    });
  }

  c.set("basicAuthUser", user);
  await next();
};

export function mustSessionUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("sessionUser");
  if (!user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return user;
}
