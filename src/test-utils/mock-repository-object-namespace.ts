import { RepositoryObject } from "../services/repository-object";
import type { AppBindings } from "../types";
import { createMockDurableObjectState } from "./mock-durable-object-state";

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
  const states = new Map<string, DurableObjectState<unknown>>();

  return {
    getByName(name: string) {
      let state = states.get(name);
      if (!state) {
        state = createMockDurableObjectState();
        states.set(name, state);
      }
      let instance = instances.get(name);
      if (!instance) {
        instance = new RepositoryObject(state, getEnv());
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
