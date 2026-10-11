import { createHash, type Hash } from "node:crypto";
import { Deflate } from "pako";
import { StreamingInflate } from "./inflate";
import { MAX_RESOLVE_BYTES, objectHeader, TYPE_CODES, type ObjectType } from "./object-format";
import { ObjectStore } from "./object-store";
import { PackReader } from "./pack-input";
import { PayloadWriter } from "./payload-store";

export async function importLooseObject(
  store: ObjectStore,
  oid: string,
  stream: ReadableStream<Uint8Array>
): Promise<void> {
  const reader = new PackReader(stream);
  const header: number[] = [];
  let type: ObjectType | undefined;
  let size = 0;
  let written = 0;
  let content: Uint8Array | undefined;
  let hash: Hash | undefined;
  let encoder: Deflate | undefined;
  let writer: PayloadWriter | undefined;
  const decoder = new StreamingInflate((bytes) => {
    let offset = 0;
    if (!type) {
      while (offset < bytes.length && bytes[offset] !== 0) {
        header.push(bytes[offset++]!);
        if (header.length > 100) {
          throw new Error("Invalid loose object header");
        }
      }
      if (offset === bytes.length) {
        return;
      }
      offset++;
      const match = /^(commit|tree|blob|tag) (0|[1-9][0-9]*)$/.exec(
        new TextDecoder().decode(Uint8Array.from(header))
      );
      if (!match || !Number.isSafeInteger(Number(match[2]))) {
        throw new Error("Invalid loose object header");
      }
      type = match[1] as ObjectType;
      size = Number(match[2]);
      hash = createHash("sha1").update(objectHeader(type, size));
      if (size <= MAX_RESOLVE_BYTES) {
        content = new Uint8Array(size);
      } else {
        writer = new PayloadWriter(store.sql);
        encoder = new Deflate();
        encoder.onData = (chunk) => writer!.write(chunk as Uint8Array);
      }
    }
    const data = bytes.subarray(offset);
    if (written + data.length > size) {
      throw new Error("Loose object size mismatch");
    }
    hash!.update(data);
    if (content) {
      content.set(data, written);
    } else {
      encoder!.push(data, false);
    }
    written += data.length;
  });
  try {
    for (;;) {
      const chunk = await reader.peek();
      if (!chunk.length) {
        break;
      }
      if (decoder.ended || decoder.push(chunk) !== chunk.length) {
        throw new Error("Extra loose object bytes");
      }
      reader.consume(chunk.length, false);
    }
    decoder.finish();
    if (!type || written !== size || hash!.digest("hex") !== oid) {
      throw new Error("Loose object OID or size mismatch");
    }
    if (content) {
      store.writeFullObject(type, content);
    } else {
      encoder!.push(new Uint8Array(), true);
      if (encoder!.err) {
        throw new Error(encoder!.msg);
      }
      store.insert(
        { oid, type: TYPE_CODES[type], size, baseOid: null, depth: 0, payload_size: size },
        writer!.finish()
      );
    }
  } finally {
    decoder.dispose();
    await reader.close();
  }
}
