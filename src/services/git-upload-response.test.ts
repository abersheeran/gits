import { expect, it } from "vitest";

import { createUploadPackResponse } from "./git-upload-response";

async function read(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

it("preserves ACK, shallow, progress and pack bytes in every side-band mode", async () => {
  const packfile = new Uint8Array(150000).fill(42);
  for (const capabilities of [
    new Set<string>(),
    new Set(["side-band"]),
    new Set(["side-band-64k"])
  ]) {
    const args = {
      capabilities,
      ackOids: ["a".repeat(40)],
      shallowOids: ["b".repeat(40)],
      progressMessages: ["counting objects\n", "pack complete\n"]
    };
    const actual = await read(
      createUploadPackResponse({
        ...args,
        pack: new Response(packfile).body!
      })
    );
    let offset = 0;
    function packet(): Uint8Array | null {
      const length = Number.parseInt(
        new TextDecoder().decode(actual.subarray(offset, offset + 4)),
        16
      );
      offset += 4;
      if (!length) {
        return null;
      }
      const payload = actual.subarray(offset, offset + length - 4);
      offset += length - 4;
      return payload;
    }
    expect(new TextDecoder().decode(packet()!)).toBe(`ACK ${"a".repeat(40)}\n`);
    expect(new TextDecoder().decode(packet()!)).toBe(`shallow ${"b".repeat(40)}\n`);
    if (!capabilities.size) {
      expect(actual.subarray(offset)).toEqual(packfile);
      continue;
    }
    const data: Uint8Array[] = [];
    const progress: Uint8Array[] = [];
    let flushed = false;
    while (offset < actual.length) {
      const payload = packet();
      if (payload === null) {
        flushed = true;
        break;
      }
      expect(payload.length - 1).toBeLessThanOrEqual(
        capabilities.has("side-band-64k") ? 65515 : 999
      );
      (payload[0] === 1 ? data : progress).push(payload.subarray(1));
    }
    expect(flushed).toBe(true);
    expect(offset).toBe(actual.length);
    expect(Buffer.concat(data)).toEqual(Buffer.from(packfile));
    expect(Buffer.concat(progress).toString()).toBe(args.progressMessages.join(""));
  }
});

it("reports a pack stream error on band 3, and aborts an unframed stream", async () => {
  const failing = () =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("broken pack"));
      }
    });
  const args = { ackOids: [], shallowOids: [], progressMessages: [] };
  const multiplexed = await read(
    createUploadPackResponse({
      ...args,
      capabilities: new Set(["side-band-64k"]),
      pack: failing()
    })
  );
  const text = new TextDecoder().decode(multiplexed);
  expect(text).toContain("\x03ERR broken pack\n");
  expect(text.endsWith("0000")).toBe(true);
  await expect(
    read(
      createUploadPackResponse({
        ...args,
        capabilities: new Set(),
        pack: failing()
      })
    )
  ).rejects.toThrow("broken pack");
});

it("cancels the underlying pack even before the first pull", async () => {
  let cancelled = false;
  const pack = new ReadableStream<Uint8Array>(
    {
      cancel() {
        cancelled = true;
      }
    },
    { highWaterMark: 0 }
  );
  const response = createUploadPackResponse({
    pack,
    capabilities: new Set(),
    ackOids: [],
    shallowOids: [],
    progressMessages: []
  });
  await response.cancel();
  expect(cancelled).toBe(true);
});
