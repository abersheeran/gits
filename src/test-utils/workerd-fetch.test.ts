import { expect, it, vi } from "vitest";
import { workerdFetch } from "./workerd-fetch";

it("rejects object receivers before invoking the fetch implementation", () => {
  const implementation = vi.fn<typeof fetch>();
  const client = { fetch: workerdFetch(implementation) };
  expect(() => client.fetch("https://example.test"))
    .toThrow("Illegal invocation: function called with incorrect this reference");
  expect(implementation).not.toHaveBeenCalled();
});

it("rejects unsupported redirect modes in init or Request", () => {
  const implementation = vi.fn<typeof fetch>();
  const fetcher = workerdFetch(implementation);
  const message = 'Invalid redirect value, must be one of "follow" or "manual"';
  expect(() => fetcher("https://example.test", { redirect: "error" })).toThrow(message);
  expect(() => fetcher(new Request("https://example.test", { redirect: "error" })))
    .toThrow(message);
  expect(implementation).not.toHaveBeenCalled();
});

it("allows bare and global calls, default redirects, and explicit supported modes", async () => {
  const implementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
  const fetcher = workerdFetch(implementation);
  await fetcher("https://example.test");
  await fetcher.call(globalThis, "https://example.test", { redirect: "follow" });
  await fetcher("https://example.test", { redirect: "manual" });
  expect(implementation).toHaveBeenCalledTimes(3);
});
