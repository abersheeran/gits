import { expect, it } from "vitest";
import { MockR2Bucket } from "../test-utils/mock-r2";
import { StorageService } from "./storage-service";

it("deletes multiple R2 pages in batches without skipping keys or other repositories", async () => {
  class BatchedBucket extends MockR2Bucket {
    override async delete(keys: string | string[]): Promise<void> {
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeLessThanOrEqual(1000);
      return super.delete(keys);
    }
  }
  const bucket = new BatchedBucket();
  for (let index = 0; index < 2505; index++) {
    await bucket.put(`a/b/objects/${index}`, "object");
  }
  await bucket.put("a/other/HEAD", "keep");
  const source = new StorageService(bucket as unknown as R2Bucket);
  await source.deleteRepository("a", "b");
  expect((await bucket.list({ prefix: "a/b/" })).objects).toEqual([]);
  expect(await (await bucket.get("a/other/HEAD"))?.text()).toBe("keep");
  await source.deleteRepository("a", "b");
});
