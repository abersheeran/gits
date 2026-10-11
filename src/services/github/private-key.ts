const keys = new Map<string, CryptoKey>();

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function der(tag: number, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  let length = bytes.length;
  const encoded = [];
  do {
    encoded.unshift(length & 255);
    length = Math.floor(length / 256);
  } while (length);
  const header = bytes.length < 128 ? [tag, bytes.length] : [tag, 128 | encoded.length, ...encoded];
  const result = new Uint8Array(header.length + bytes.length);
  result.set(header);
  result.set(bytes, header.length);
  return result;
}

function wrapPkcs1(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const versionAndAlgorithm = new Uint8Array([
    2, 1, 0, 48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0
  ]);
  const octets = der(4, bytes);
  const sequence = new Uint8Array(versionAndAlgorithm.length + octets.length);
  sequence.set(versionAndAlgorithm);
  sequence.set(octets, versionAndAlgorithm.length);
  return der(48, sequence);
}

export async function importAppPrivateKey(value: string): Promise<CryptoKey> {
  const cached = keys.get(value);
  if (cached) {
    return cached;
  }
  try {
    const pem = value.trim().startsWith("-----BEGIN") ? value.trim() : atob(value.trim());
    const match = pem.match(
      /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s+([\s\S]+?)\s+-----END \1-----\s*$/
    );
    if (!match) {
      throw new Error();
    }
    const bytes = decode(match[2]!.replace(/\s/g, ""));
    const key = await crypto.subtle.importKey(
      "pkcs8", match[1] === "RSA PRIVATE KEY" ? wrapPkcs1(bytes) : bytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
    );
    if (keys.size >= 8) {
      keys.clear();
    }
    keys.set(value, key);
    return key;
  } catch {
    throw new Error("Invalid GitHub App private key");
  }
}
