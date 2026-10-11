export function workerdFetch(implementation: typeof fetch): typeof fetch {
  return function (this: unknown, input, init) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Illegal invocation: function called with incorrect this reference");
    }
    const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : "follow");
    if (redirect !== "follow" && redirect !== "manual") {
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
    }
    return implementation(input, init);
  };
}
