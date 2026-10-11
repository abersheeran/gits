import { importLegacyRepository } from "../services/git-store/legacy-import";
import { ObjectStore } from "../services/git-store/object-store";
import { RefStore } from "../services/git-store/ref-store";
import { StorageService } from "../services/storage-service";
import { createMockDurableObjectState } from "./mock-durable-object-state";
import { MockR2Bucket } from "./mock-r2";

export async function importTestRepository(bucket: MockR2Bucket, owner: string, repo: string) {
  const state = createMockDurableObjectState();
  const source = new StorageService(bucket as unknown as R2Bucket);
  await importLegacyRepository({ storage: state.storage, source, owner, repo });
  return { store: new ObjectStore(state.storage.sql), refs: new RefStore(state.storage), state };
}
