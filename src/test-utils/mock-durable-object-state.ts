function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export class MockDurableObjectStorage {
  private readonly values = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.values.has(key)) {
      return undefined;
    }
    return cloneValue(this.values.get(key) as T);
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.values.set(key, cloneValue(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? "";
    const entries = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, cloneValue(value) as T] as const);
    return new Map(entries);
  }
}

export function createMockDurableObjectState(): DurableObjectState<unknown> & {
  storage: MockDurableObjectStorage;
} {
  const storage = new MockDurableObjectStorage();
  return {
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback()
  } as DurableObjectState<unknown> & {
    storage: MockDurableObjectStorage;
  };
}
