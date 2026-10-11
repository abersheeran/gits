import { inflate, inflateEnd, inflateInit2, inflateReset } from "pako/lib/zlib/inflate.js";
import ZStream from "pako/lib/zlib/zstream.js";

type InflateCallback = (bytes: Uint8Array) => void | boolean;

export class StreamingInflate {
  private readonly stream = new ZStream();
  private readonly output = new Uint8Array(64 * 1024);
  ended = false;
  stopped = false;
  consumed = 0;
  size = 0;

  // The callback must consume or copy bytes synchronously; the output buffer is reused.
  constructor(private onData: InflateCallback) {
    if (inflateInit2(this.stream, 15) !== 0) {
      throw new Error("Cannot initialize inflate");
    }
  }

  reset(onData: InflateCallback = this.onData): void {
    if (inflateReset(this.stream) !== 0) {
      throw new Error("Cannot reset inflate");
    }
    // pako 2.1.0 resets wsize but keeps the window; restore its capacity before reuse.
    const state = this.stream.state!;
    state.wsize = state.window?.length ?? 0;
    this.onData = onData;
    this.ended = false;
    this.stopped = false;
    this.consumed = 0;
    this.size = 0;
  }

  push(input: Uint8Array): number {
    if (this.ended || this.stopped) {
      throw new Error("Inflate already finished");
    }
    const stream = this.stream;
    stream.input = input;
    stream.next_in = 0;
    stream.avail_in = input.length;
    do {
      stream.output = this.output;
      stream.next_out = 0;
      stream.avail_out = this.output.length;
      const status = inflate(stream, 0);
      if (status !== 0 && status !== 1 && status !== -5) {
        throw new Error(`Invalid zlib stream: ${stream.msg}`);
      }
      if (stream.next_out) {
        this.size += stream.next_out;
        if (this.onData(this.output.subarray(0, stream.next_out)) === false) {
          this.stopped = true;
        }
      }
      if (status === 1) {
        this.ended = true;
      }
      if (this.ended || this.stopped) {
        break;
      }
      if (status === -5 && stream.avail_in) {
        throw new Error("Stalled zlib stream");
      }
    } while (stream.avail_in || stream.avail_out === 0);
    this.consumed += stream.next_in;
    return stream.next_in;
  }

  finish(): void {
    if (!this.ended) {
      throw new Error("Truncated zlib stream");
    }
  }

  dispose(): void {
    inflateEnd(this.stream);
  }
}

export function inflateChunks(chunks: Iterable<Uint8Array>, size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  const decoder = new StreamingInflate((bytes) => {
    if (offset + bytes.length > size) {
      throw new Error("Inflated size mismatch");
    }
    result.set(bytes, offset);
    offset += bytes.length;
  });
  try {
    for (const chunk of chunks) {
      if (decoder.ended || decoder.push(chunk) !== chunk.length) {
        throw new Error("Extra zlib bytes");
      }
    }
    decoder.finish();
    if (offset !== size) {
      throw new Error("Inflated size mismatch");
    }
    return result;
  } finally {
    decoder.dispose();
  }
}
