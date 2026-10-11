import { Deflate } from "pako";

const OUTPUT_BYTES = 64 * 1024;

export function packEntryHeader(type: number, size: number): Uint8Array {
  let value = size;
  const bytes = [(type << 4) | value % 16];
  value = Math.floor(value / 16);
  while (value) {
    bytes[bytes.length - 1]! |= 128;
    bytes.push(value % 128);
    value = Math.floor(value / 128);
  }
  return Uint8Array.from(bytes);
}

export function* deflateContent(content: Uint8Array): Generator<Uint8Array> {
  const encoder = new Deflate({ chunkSize: OUTPUT_BYTES });
  let chunks: Uint8Array[] = [];
  encoder.onData = (bytes) => chunks.push(bytes as Uint8Array);
  for (let offset = 0; offset < content.length; offset += OUTPUT_BYTES) {
    encoder.push(content.subarray(offset, offset + OUTPUT_BYTES), false);
    yield* chunks;
    chunks = [];
  }
  encoder.push(new Uint8Array(), true);
  if (encoder.err) {
    throw new Error(encoder.msg);
  }
  yield* chunks;
}

export function* coalesceChunks(input: Iterable<Uint8Array>): Generator<Uint8Array> {
  let buffer: Uint8Array | null = null;
  let used = 0;
  for (const chunk of input) {
    if (!used && chunk.length >= OUTPUT_BYTES) {
      yield chunk;
      continue;
    }
    let offset = 0;
    while (offset < chunk.length) {
      buffer ??= new Uint8Array(OUTPUT_BYTES);
      const length = Math.min(OUTPUT_BYTES - used, chunk.length - offset);
      buffer.set(chunk.subarray(offset, offset + length), used);
      used += length;
      offset += length;
      if (used === OUTPUT_BYTES) {
        yield buffer;
        buffer = null;
        used = 0;
        if (chunk.length - offset >= OUTPUT_BYTES) {
          yield chunk.subarray(offset);
          offset = chunk.length;
        }
      }
    }
  }
  if (used) {
    yield buffer!.subarray(0, used);
  }
}
