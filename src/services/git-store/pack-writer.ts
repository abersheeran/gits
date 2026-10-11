import { createHash } from "node:crypto";
import { TYPE_CODES } from "./object-format";
import { ObjectStore } from "./object-store";
import { bytesToOid } from "./oid";
import { coalesceChunks, deflateContent, packEntryHeader } from "./pack-output";
import { selectPackRows, type PackSelection } from "./pack-selection";
import { readPayload } from "./payload-store";

export { packEntryHeader } from "./pack-output";

export type { PackSelection } from "./pack-selection";

export function createPackStream(
  store: ObjectStore,
  selection: PackSelection
): { count: number; stream: ReadableStream<Uint8Array> } {
  const { count, rows } = selectPackRows(store, selection);
  function* body(): Generator<Uint8Array> {
    const header = new Uint8Array(12);
    header.set([80, 65, 67, 75]);
    const view = new DataView(header.buffer);
    view.setUint32(4, 2);
    view.setUint32(8, count);
    yield header;
    for (const row of rows) {
      if (row.base_oid && !row.base_included) {
        const object = store.read(bytesToOid(row.oid));
        yield packEntryHeader(TYPE_CODES[object.type], object.content.length);
        yield* deflateContent(object.content);
      } else {
        yield packEntryHeader(
          row.base_oid ? 7 : row.type,
          row.base_oid ? row.payload_size : row.size
        );
        if (row.base_oid) {
          yield new Uint8Array(row.base_oid);
        }
        const payload =
          row.data === null && row.chunk_id === null ? store.getRow(bytesToOid(row.oid)) : row;
        yield* readPayload(store.sql, payload);
      }
    }
  }
  function* pack(): Generator<Uint8Array> {
    const hash = createHash("sha1");
    for (const bytes of body()) {
      hash.update(bytes);
      yield bytes;
    }
    yield new Uint8Array(hash.digest());
  }
  const iterator = coalesceChunks(pack());
  return {
    count,
    stream: new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          try {
            const next = iterator.next();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            iterator.return(undefined);
            controller.error(error);
          }
        },
        cancel() {
          iterator.return(undefined);
        }
      },
      { highWaterMark: 0 }
    )
  };
}
