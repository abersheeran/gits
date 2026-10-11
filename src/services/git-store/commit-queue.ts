import type { ObjectStore } from "./object-store";

type Item = { value: ReturnType<ObjectStore["readCommit"]>; order: number };

export class CommitQueue {
  private readonly heap: Item[] = [];
  private order = 0;

  get length(): number {
    return this.heap.length;
  }

  private newer(a: Item, b: Item): boolean {
    const left = a.value.commit.committer.timestamp;
    const right = b.value.commit.committer.timestamp;
    return left > right || (left === right && a.order > b.order);
  }

  push(value: Item["value"]): void {
    const item = { value, order: this.order++ };
    let index = this.heap.length;
    this.heap.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.newer(item, this.heap[parent]!)) {
        break;
      }
      this.heap[index] = this.heap[parent]!;
      index = parent;
    }
    this.heap[index] = item;
  }

  pop(): Item["value"] {
    const result = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length) {
      let index = 0;
      while (index * 2 + 1 < this.heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.heap.length && this.newer(this.heap[child + 1]!, this.heap[child]!)) {
          child++;
        }
        if (!this.newer(this.heap[child]!, last)) {
          break;
        }
        this.heap[index] = this.heap[child]!;
        index = child;
      }
      this.heap[index] = last;
    }
    return result.value;
  }
}
