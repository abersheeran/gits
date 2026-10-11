function readSize(
  delta: Uint8Array,
  cursor: {
    offset: number;
  }
): number {
  let value = 0;
  let factor = 1;
  for (;;) {
    const byte = delta[cursor.offset++];
    if (byte === undefined || !Number.isSafeInteger(factor)) {
      throw new Error("Invalid delta size");
    }
    value += (byte & 127) * factor;
    if (!Number.isSafeInteger(value)) {
      throw new Error("Invalid delta size");
    }
    if (!(byte & 128)) {
      return value;
    }
    factor *= 128;
  }
}

export function deltaTargetSize(delta: Uint8Array): number {
  const cursor = { offset: 0 };
  readSize(delta, cursor);
  return readSize(delta, cursor);
}

export function applyDelta(source: Uint8Array, delta: Uint8Array): Uint8Array {
  const cursor = { offset: 0 };
  if (readSize(delta, cursor) !== source.length) {
    throw new Error("Delta source size mismatch");
  }
  const targetSize = readSize(delta, cursor);
  const output = new Uint8Array(targetSize);
  let written = 0;
  const byte = () => {
    const value = delta[cursor.offset++];
    if (value === undefined) {
      throw new Error("Truncated delta instruction");
    }
    return value;
  };
  while (cursor.offset < delta.length) {
    const command = byte();
    if (!command) {
      throw new Error("Invalid delta opcode");
    }
    if (command & 128) {
      let offset = 0;
      let size = 0;
      for (let i = 0; i < 4; i++) {
        if (command & (1 << i)) {
          offset += byte() * 2 ** (8 * i);
        }
      }
      for (let i = 0; i < 3; i++) {
        if (command & (16 << i)) {
          size += byte() * 2 ** (8 * i);
        }
      }
      if (!size) {
        size = 65536;
      }
      if (offset + size > source.length || written + size > targetSize) {
        throw new Error("Delta copy out of bounds");
      }
      output.set(source.subarray(offset, offset + size), written);
      written += size;
    } else {
      if (cursor.offset + command > delta.length || written + command > targetSize) {
        throw new Error("Delta insert out of bounds");
      }
      output.set(delta.subarray(cursor.offset, cursor.offset + command), written);
      cursor.offset += command;
      written += command;
    }
  }
  if (written !== targetSize) {
    throw new Error("Delta target size mismatch");
  }
  return output;
}
