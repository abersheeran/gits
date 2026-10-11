const encoder = new TextEncoder();

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("gits:github-token:salt:v1"),
      info: encoder.encode("gits:github-token:aes-256-gcm:v1")
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function encryptToken(token: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await deriveKey(secret), encoder.encode(token)
  );
  return `v1:${base64(iv)}:${base64(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(value: string, secret: string): Promise<string> {
  try {
    const [version, iv, ciphertext, extra] = value.split(":");
    if (version !== "v1" || !iv || !ciphertext || extra !== undefined) {
      throw new Error();
    }
    const nonce = decode(iv);
    if (nonce.length !== 12) {
      throw new Error();
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce }, await deriveKey(secret), decode(ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Cannot decrypt GitHub token. Replace the saved token.");
  }
}
