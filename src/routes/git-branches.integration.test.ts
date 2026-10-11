import { afterEach, expect, it, vi } from "vitest";
import app from "../app";
import { AuthService } from "../services/auth-service";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { createEnv, createPrivateOwnedRepositoryDb } from "../test-utils/git-integration-fixture";
import { cleanupTestGitFs } from "../test-utils/git-test-fs";
import { MockR2Bucket } from "../test-utils/mock-r2";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTestGitFs();
});

it("creates, switches, and deletes branches via repository APIs", async () => {
  vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
    id: "user-1",
    username: "alice"
  });

  const bucket = new MockR2Bucket();
  await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const db = createPrivateOwnedRepositoryDb("alice", "demo");
  const env = createEnv(db, bucket as unknown as R2Bucket);

  const initialDetailResponse = await app.fetch(
    new Request("http://localhost/api/repos/alice/demo", {
      headers: {
        authorization: "Bearer session-ok"
      }
    }),
    env
  );
  expect(initialDetailResponse.status).toBe(200);
  const initialDetail = (await initialDetailResponse.json()) as {
    headOid: string;
    defaultBranch: string | null;
    branches: Array<{ name: string; oid: string }>;
  };
  expect(initialDetail.headOid).toBeTruthy();
  expect(initialDetail.defaultBranch).toBe("main");

  const createResponse = await app.fetch(
    new Request("http://localhost/api/repos/alice/demo/branches", {
      method: "POST",
      headers: {
        authorization: "Bearer session-ok",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        branchName: "develop",
        sourceOid: initialDetail.headOid
      })
    }),
    env
  );
  expect(createResponse.status).toBe(201);
  const created = (await createResponse.json()) as {
    branches: Array<{ name: string }>;
  };
  expect(created.branches.some((item) => item.name === "refs/heads/develop")).toBe(true);

  const setDefaultResponse = await app.fetch(
    new Request("http://localhost/api/repos/alice/demo/default-branch", {
      method: "PATCH",
      headers: {
        authorization: "Bearer session-ok",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        branchName: "develop"
      })
    }),
    env
  );
  expect(setDefaultResponse.status).toBe(200);
  const updatedDefault = (await setDefaultResponse.json()) as {
    defaultBranch: string | null;
  };
  expect(updatedDefault.defaultBranch).toBe("develop");

  const deleteDefaultResponse = await app.fetch(
    new Request("http://localhost/api/repos/alice/demo/branches/develop", {
      method: "DELETE",
      headers: {
        authorization: "Bearer session-ok"
      }
    }),
    env
  );
  expect(deleteDefaultResponse.status).toBe(409);

  const resetDefaultResponse = await app.fetch(
    new Request("http://localhost/api/repos/alice/demo/default-branch", {
      method: "PATCH",
      headers: {
        authorization: "Bearer session-ok",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        branchName: "main"
      })
    }),
    env
  );
  expect(resetDefaultResponse.status).toBe(200);

  const deleteResponse = await app.fetch(
    new Request("http://localhost/api/repos/alice/demo/branches/develop", {
      method: "DELETE",
      headers: {
        authorization: "Bearer session-ok"
      }
    }),
    env
  );
  expect(deleteResponse.status).toBe(200);
  const afterDelete = (await deleteResponse.json()) as {
    branches: Array<{ name: string }>;
    defaultBranch: string | null;
  };
  expect(afterDelete.defaultBranch).toBe("main");
  expect(afterDelete.branches.some((item) => item.name === "refs/heads/develop")).toBe(false);
});
