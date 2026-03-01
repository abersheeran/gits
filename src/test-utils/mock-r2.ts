const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function normalizeBody(
  body: string | ArrayBuffer | ArrayBufferView | ReadableStream
): Promise<Uint8Array> {
  if (typeof body === "string") {
    return textEncoder.encode(body);
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return toUint8Array(body);
  }
  const bytes = await new Response(body).arrayBuffer();
  return new Uint8Array(bytes);
}

type StoredObject = {
  key: string;
  bytes: Uint8Array;
  uploaded: Date;
};

export class MockR2Bucket {
  private readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream
  ): Promise<void> {
    const bytes = await normalizeBody(value);
    this.objects.set(key, {
      key,
      bytes,
      uploaded: new Date()
    });
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.objects.get(key);
    if (!item) {
      return null;
    }

    const bytes = item.bytes;
    return {
      key,
      size: bytes.byteLength,
      uploaded: item.uploaded,
      etag: `etag-${key}`,
      checksums: {},
      text: async () => textDecoder.decode(bytes),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    } as unknown as R2ObjectBody;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? "";
    const cursor = Number.parseInt(options?.cursor ?? "0", 10);
    const start = Number.isFinite(cursor) ? cursor : 0;
    const limit = options?.limit ?? 1000;

    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const sliced = keys.slice(start, start + limit);
    const nextIndex = start + sliced.length;

    return {
      objects: sliced.map((key) => {
        const item = this.objects.get(key);
        return {
          key,
          size: item?.bytes.byteLength ?? 0,
          etag: `etag-${key}`,
          uploaded: item?.uploaded ?? new Date(),
          checksums: {}
        };
      }),
      truncated: nextIndex < keys.length,
      cursor: nextIndex < keys.length ? String(nextIndex) : "",
      delimitedPrefixes: []
    } as unknown as R2Objects;
  }
}
