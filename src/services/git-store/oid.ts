export function oidToBytes(oid: string): Uint8Array {
  if (!/^[0-9a-f]{40}$/i.test(oid)) {
    throw new Error(`Invalid OID: ${oid}`);
  }
  return Uint8Array.from(Buffer.from(oid, "hex"));
}

export function bytesToOid(bytes: ArrayBuffer | Uint8Array): string {
  const value = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (value.byteLength !== 20) {
    throw new Error("OID must contain 20 bytes");
  }
  return Buffer.from(value).toString("hex");
}
