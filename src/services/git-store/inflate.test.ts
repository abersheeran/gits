import { deflate } from "pako";
import { expect, it } from "vitest";
import { StreamingInflate } from "./inflate";

it("reuses its output buffer and resets for independent zlib streams", () => {
  const first = new Uint8Array(200000).map((_, index) => index % 251);
  const received: Uint8Array[] = [];
  const buffers: ArrayBufferLike[] = [];
  const decoder = new StreamingInflate((bytes) => {
    buffers.push(bytes.buffer);
    received.push(bytes.slice());
  });
  decoder.push(deflate(first));
  decoder.finish();
  expect(Buffer.concat(received)).toEqual(Buffer.from(first));
  expect(buffers.length).toBeGreaterThan(1);
  expect(new Set(buffers).size).toBe(1);
  const second = new Uint8Array(120000).fill(97);
  received.length = 0;
  decoder.reset((bytes) => {
    expect(bytes.buffer).toBe(buffers[0]);
    received.push(bytes.slice());
  });
  const compressed = deflate(second);
  for (let i = 0; i < compressed.length; i += 11) {
    decoder.push(compressed.subarray(i, i + 11));
  }
  decoder.finish();
  expect(decoder.consumed).toBe(compressed.length);
  expect(decoder.size).toBe(second.length);
  expect(Buffer.concat(received)).toEqual(Buffer.from(second));
  decoder.dispose();
});
