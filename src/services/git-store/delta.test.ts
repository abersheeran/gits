import { expect, it } from "vitest";
import { applyDelta, deltaTargetSize } from "./delta";

it("applies copy and insert instructions and reads the target size", () => {
  const delta = Uint8Array.from([5, 7, 0x90, 5, 2, 33, 33]);
  expect(deltaTargetSize(delta)).toBe(7);
  expect(new TextDecoder().decode(applyDelta(new TextEncoder().encode("hello"), delta))).toBe(
    "hello!!"
  );
});

it("rejects source mismatch, out-of-bounds copy, malformed varints and instructions", () => {
  for (const bytes of [
    [4, 0],
    [5, 6, 0x90, 6],
    [5, 2, 0x91, 4, 2],
    [5, 2, 2, 65],
    [5, 1, 0],
    [5, 2, 1, 65],
    [128]
  ]) {
    expect(() => applyDelta(new Uint8Array(5), Uint8Array.from(bytes))).toThrow();
  }
});
