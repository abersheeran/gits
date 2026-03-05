import { describe, expect, it } from "vitest";
import { createMockD1Database } from "../test-utils/mock-d1";
import { AuthService } from "./auth-service";

describe("AuthService token lifecycle", () => {
  it("lists access tokens for a user", async () => {
    const db = createMockD1Database([
      {
        when: /FROM access_tokens[\s\S]*WHERE user_id = \? AND is_internal = 0/,
        all: () => [
          {
            id: "tok-1",
            token_prefix: "gts_abc",
            name: "dev",
            created_at: 1,
            expires_at: null,
            last_used_at: null,
            revoked_at: null
          }
        ]
      }
    ]);
    const service = new AuthService(db, "test-secret");
    const tokens = await service.listAccessTokens("user-1");

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.id).toBe("tok-1");
  });

  it("returns false when revoking unknown token", async () => {
    const db = createMockD1Database([
      {
        when: /SELECT\s+id\s+FROM access_tokens/,
        first: () => null
      }
    ]);
    const service = new AuthService(db, "test-secret");
    const result = await service.revokeAccessToken("user-1", "tok-missing");
    expect(result).toBe(false);
  });

  it("revokes token owned by user", async () => {
    let updated = false;
    const db = createMockD1Database([
      {
        when: /SELECT\s+id\s+FROM access_tokens/,
        first: () => ({ id: "tok-1" })
      },
      {
        when: "UPDATE access_tokens",
        run: () => {
          updated = true;
          return { success: true };
        }
      }
    ]);
    const service = new AuthService(db, "test-secret");
    const result = await service.revokeAccessToken("user-1", "tok-1");

    expect(result).toBe(true);
    expect(updated).toBe(true);
  });
});
