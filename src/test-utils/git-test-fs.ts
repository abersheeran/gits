import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];

export function createTestGitFs() {
  const dir = fs.mkdtempSync(join(tmpdir(), "gits-test-"));
  directories.push(dir);
  return { fs, dir };
}

export function cleanupTestGitFs(): void {
  for (const dir of directories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
