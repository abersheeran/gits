import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const key = process.argv[2]?.trim();
  if (!key) {
    console.error("Usage: node scripts/set-local-secret.mjs <KEY> [ENV_FILE]");
    process.exit(1);
  }

  const envFileArg = process.argv[3]?.trim();
  const envFile = envFileArg && envFileArg.length > 0 ? envFileArg : ".env";
  const envPath = path.resolve(process.cwd(), envFile);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const value = (await rl.question(`Input ${key} for local development: `)).trim();
  rl.close();

  if (!value) {
    console.error(`Secret value for ${key} must not be empty.`);
    process.exit(1);
  }

  let current = "";
  try {
    current = await readFile(envPath, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const normalized = current.replace(/\r\n/g, "\n");
  const keyPattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const nextLine = `${key}=${value}`;

  let next = "";
  if (!normalized) {
    next = `${nextLine}\n`;
  } else if (keyPattern.test(normalized)) {
    next = normalized.replace(keyPattern, nextLine);
    if (!next.endsWith("\n")) {
      next += "\n";
    }
  } else {
    const withTrailingNewline = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    next = `${withTrailingNewline}${nextLine}\n`;
  }

  await writeFile(envPath, next, "utf8");
  console.log(`Updated ${key} in ${envPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
