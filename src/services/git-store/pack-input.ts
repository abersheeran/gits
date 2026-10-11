import { createHash } from "node:crypto";
import { GitPackTooLargeError } from "./object-format";

export type PackInput = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

async function* streamChunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let completed = false;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        completed = true;
        return;
      }
      yield result.value;
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => {
      });
    }
    reader.releaseLock();
  }
}

export class PackReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array(0);
  private position = 0;
  private received = 0;
  readonly hash = createHash("sha1");
  offset = 0;

  constructor(
    input: PackInput,
    private readonly maxBytes?: number
  ) {
    this.iterator = (Symbol.asyncIterator in input ? input : streamChunks(input))[
      Symbol.asyncIterator
    ]();
  }

  async peek(): Promise<Uint8Array> {
    while (this.position === this.chunk.length) {
      const next = await this.iterator.next();
      if (next.done) {
        return new Uint8Array();
      }
      this.chunk = next.value;
      this.position = 0;
      this.received += this.chunk.length;
      if (this.maxBytes !== undefined && this.received > this.maxBytes) {
        throw new GitPackTooLargeError(this.maxBytes);
      }
    }
    return this.chunk.subarray(this.position, this.position + 64 * 1024);
  }

  consume(size: number, hash = true): void {
    const bytes = this.chunk.subarray(this.position, this.position + size);
    if (hash) {
      this.hash.update(bytes);
    }
    this.position += size;
    this.offset += size;
  }

  async bytes(size: number, hash = true): Promise<Uint8Array> {
    const output = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const chunk = await this.peek();
      if (!chunk.length) {
        throw new Error("Truncated pack");
      }
      const length = Math.min(size - offset, chunk.length);
      output.set(chunk.subarray(0, length), offset);
      this.consume(length, hash);
      offset += length;
    }
    return output;
  }

  async byte(): Promise<number> {
    return (await this.bytes(1))[0]!;
  }

  async close(): Promise<void> {
    await this.iterator.return?.();
  }
}

export class PackOffsets {
  private readonly offsets: Float64Array;
  private readonly oids: Uint8Array;
  private readonly resolved: Uint8Array;

  constructor(count: number) {
    this.offsets = new Float64Array(count);
    this.oids = new Uint8Array(count * 20);
    this.resolved = new Uint8Array(Math.ceil(count / 8));
  }

  setOffset(index: number, offset: number): void {
    this.offsets[index] = offset;
  }

  setOid(index: number, oid: Uint8Array): void {
    this.oids.set(oid, index * 20);
    this.resolved[index >> 3]! |= 1 << (index & 7);
  }

  getOid(index: number): Uint8Array | null {
    return this.resolved[index >> 3]! & (1 << (index & 7))
      ? this.oids.subarray(index * 20, index * 20 + 20)
      : null;
  }

  find(offset: number, before: number): number {
    let low = 0;
    let high = before - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = this.offsets[mid]!;
      if (value === offset) {
        return mid;
      }
      if (value < offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    throw new Error("Invalid OFS_DELTA base offset");
  }
}
