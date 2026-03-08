import { RepositoryObject } from "../services/repository-object";
import type { AppBindings } from "../types";

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) {
    return input;
  }
  return new Request(String(input), init);
}

export function createMockRepositoryObjectNamespace(
  getEnv: () => AppBindings
): DurableObjectNamespace {
  const instances = new Map<string, RepositoryObject>();

  return {
    getByName(name: string) {
      let instance = instances.get(name);
      if (!instance) {
        instance = new RepositoryObject({} as DurableObjectState<unknown>, getEnv());
        instances.set(name, instance);
      }
      return {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          return instance.fetch(toRequest(input, init));
        }
      } as DurableObjectStub;
    }
  } as DurableObjectNamespace;
}

