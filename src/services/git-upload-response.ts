import {
  encodeAckNak,
  encodeFlushPktLine,
  encodeProtocolError,
  encodeShallowLines,
  encodeSideBandChunks,
  encodeTextPktLine,
  sideBandChunkSize,
  supportsSideBand
} from "./git-protocol";

export function createUploadPackResponse(args: {
  capabilities: Set<string>;
  preamble?: Uint8Array[];
  ackOids: string[];
  ackLines?: string[];
  shallowOids: string[];
  pack: ReadableStream<Uint8Array>;
  progressMessages: string[];
}): ReadableStream<Uint8Array> {
  const sideBand = supportsSideBand(args.capabilities);
  const size = sideBandChunkSize(args.capabilities);
  let started = false;
  async function* bytes(): AsyncGenerator<Uint8Array> {
    started = true;
    const reader = args.pack.getReader();
    try {
      yield* args.preamble ?? [];
      yield* args.ackLines?.map(encodeTextPktLine) ?? encodeAckNak(args.ackOids);
      yield* encodeShallowLines(args.shallowOids);
      if (sideBand) {
        for (const message of args.progressMessages) {
          yield* encodeSideBandChunks(2, new TextEncoder().encode(message), size);
        }
      }
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) {
            break;
          }
          if (sideBand) {
            yield* encodeSideBandChunks(1, next.value, size);
          } else {
            yield next.value;
          }
        }
      } catch (error) {
        if (!sideBand) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "pack generation failed";
        yield encodeProtocolError(message, args.capabilities);
        return;
      }
      if (sideBand) {
        yield encodeFlushPktLine();
      }
    } finally {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
  }
  const iterator = bytes();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        if (!started) {
          await args.pack.cancel();
        }
        await iterator.return(undefined);
      }
    },
    { highWaterMark: 0 }
  );
}
