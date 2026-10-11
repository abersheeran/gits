import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "../types";
import { assertRepositoryName } from "../routes/api/validation";
import { createRepositoryObjectClient } from "./repository-object-client";
import { RepositoryService } from "./repository-service";

export async function createInitializedRepository(env: AppBindings, input: {
  ownerId: string;
  owner: string;
  name: string;
  description?: string;
  isPrivate: boolean;
}) {
  assertRepositoryName(input.name);
  const service = new RepositoryService(env.DB);
  const client = createRepositoryObjectClient(env);
  let id: string | undefined;
  try {
    const created = await service.createRepository(input);
    id = created.id;
    await client.initializeRepository({ repositoryId: id, owner: input.owner, repo: input.name });
    return created;
  } catch (error) {
    if (id) {
      await service.deleteRepositoryById(id).catch(() => undefined);
      await client.deleteRepository({ repositoryId: id, owner: input.owner, repo: input.name })
        .catch(() => undefined);
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new HTTPException(409, { message: "Repository already exists" });
    }
    throw error;
  }
}
