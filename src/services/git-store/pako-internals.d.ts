declare module "pako/lib/zlib/zstream.js" {
  export default class ZStream {
    input: Uint8Array;
    output: Uint8Array;
    next_in: number;
    avail_in: number;
    total_in: number;
    next_out: number;
    avail_out: number;
    total_out: number;
    msg: string;
    state: { window: Uint8Array | null; wsize: number } | null;
  }
}

declare module "pako/lib/zlib/inflate.js" {
  import ZStream from "pako/lib/zlib/zstream.js";
  export function inflateInit2(stream: ZStream, windowBits: number): number;
  export function inflate(stream: ZStream, flush: number): number;
  export function inflateReset(stream: ZStream): number;
  export function inflateEnd(stream: ZStream): number;
}
