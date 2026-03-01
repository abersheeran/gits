import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  console.error("Unhandled application error", err);
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "Internal server error"
      }
    },
    500
  );
};
