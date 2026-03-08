import { describe, expect, it } from "vitest";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { createMockDurableObjectState } from "../test-utils/mock-durable-object-state";
import { MockR2Bucket } from "../test-utils/mock-r2";
import type { AppBindings } from "../types";
import { RepositoryObject } from "./repository-object";

function createEnv(bucket: MockR2Bucket): AppBindings {
  return {
    GIT_BUCKET: bucket as unknown as R2Bucket
  } as AppBindings;
}

function createJsonRequest(operation: string, payload: Record<string, unknown>): Request {
  return new Request("https://repository-object/json", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      operation,
      payload
    })
  });
}

describe("RepositoryObject snapshots", () => {
  it("restores repository context from durable object storage after recycle", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const state = createMockDurableObjectState();
    const env = createEnv(bucket);

    const warmObject = new RepositoryObject(state, env);
    const warmResponse = await warmObject.fetch(
      createJsonRequest("browse-repository-contents", {
        owner: "alice",
        repo: "demo"
      })
    );

    expect(warmResponse.ok).toBe(true);
    const snapshotEntries = await state.storage.list({ prefix: "repository-snapshot/files/" });
    expect(snapshotEntries.size).toBeGreaterThan(0);

    bucket.clear();

    const recycledObject = new RepositoryObject(state, env);
    const response = await recycledObject.fetch(
      createJsonRequest("browse-repository-contents", {
        owner: "alice",
        repo: "demo"
      })
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as {
      readme: { path: string; content: string } | null;
      entries: Array<{ path: string }>;
    };
    expect(result.readme?.path).toBe("README.md");
    expect(result.readme?.content).toContain("Updated");
    expect(result.entries.some((entry) => entry.path === "README.md")).toBe(true);
  });

  it("clears the durable object snapshot when the repository is deleted", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const state = createMockDurableObjectState();
    const env = createEnv(bucket);

    const repositoryObject = new RepositoryObject(state, env);
    await repositoryObject.fetch(
      createJsonRequest("browse-repository-contents", {
        owner: "alice",
        repo: "demo"
      })
    );

    expect((await state.storage.list({ prefix: "repository-snapshot/" })).size).toBeGreaterThan(0);

    const deleteResponse = await repositoryObject.fetch(
      createJsonRequest("delete-repository", {
        owner: "alice",
        repo: "demo"
      })
    );

    expect(deleteResponse.ok).toBe(true);
    expect((await state.storage.list({ prefix: "repository-snapshot/" })).size).toBe(0);
  });
});
