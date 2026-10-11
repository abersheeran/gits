import { RepositoryObject } from "../services/repository-object";
import type { AppBindings } from "../types";
import { createMockDurableObjectState } from "./mock-durable-object-state";

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) {
    return input;
  }
  return new Request(String(input), init);
}

const namespaceStates = new WeakMap<
  DurableObjectNamespace,
  Map<string, ReturnType<typeof createMockDurableObjectState>>
>();

export function repositoryState(namespace: DurableObjectNamespace, id: string) {
  const state = namespaceStates.get(namespace)?.get(id);
  if (!state) {
    throw new Error(`Repository state not found: ${id}`);
  }
  return state;
}

export function createMockRepositoryObjectNamespace(
  getEnv: () => AppBindings
): DurableObjectNamespace {
  const instances = new Map<string, RepositoryObject>();
  const states = new Map<string, ReturnType<typeof createMockDurableObjectState>>();

  const namespace = {
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
  namespaceStates.set(namespace, states);
  return namespace;
}
