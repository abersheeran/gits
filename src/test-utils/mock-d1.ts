type MockHandler = {
  when: string | RegExp;
  run?: (params: unknown[]) => unknown;
  first?: (params: unknown[]) => unknown;
  all?: (params: unknown[]) => unknown[];
};

function isMatch(sql: string, matcher: string | RegExp): boolean {
  if (typeof matcher === "string") {
    return sql.includes(matcher);
  }
  return matcher.test(sql);
}

export function createMockD1Database(handlers: MockHandler[]): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const handler = handlers.find((item) => isMatch(sql, item.when));
          return {
            run: async () => {
              const result = handler?.run?.(params);
              return (result ?? { success: true }) as D1Result<unknown>;
            },
            first: async <T>() => {
              const result = handler?.first?.(params);
              return (result ?? null) as T | null;
            },
            all: async <T>() => {
              const results = handler?.all?.(params) ?? [];
              return { results } as D1Result<T>;
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}
