export type PendingRequestSlot<T> = {
  put(request: T): void;
  peek(): T | null;
  take(): T | null;
  clear(): void;
};

export function createPendingRequestSlot<T>(): PendingRequestSlot<T> {
  let pending: T | null = null;

  return {
    put(request) {
      pending = request;
    },
    peek() {
      return pending;
    },
    take() {
      const request = pending;
      pending = null;
      return request;
    },
    clear() {
      pending = null;
    }
  };
}
