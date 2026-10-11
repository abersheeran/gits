let generated: Promise<{ privateKey: string; publicKey: CryptoKey }> | undefined;

export function githubAppKeys() {
  generated ??= (async () => {
    const pair = await crypto.subtle.generateKey({
      name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
    }, true, ["sign", "verify"]);
    const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const privateKey = "-----BEGIN PRIVATE KEY-----\n"
      + btoa(String.fromCharCode(...bytes)) + "\n-----END PRIVATE KEY-----";
    return { privateKey, publicKey: pair.publicKey };
  })();
  return generated;
}
