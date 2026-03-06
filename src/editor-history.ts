export interface EditorHistory<T> {
  readonly limit: number;
  stack: T[];
}

export function createHistory<T>(limit = 50): EditorHistory<T> {
  const normalized = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  return {
    limit: normalized,
    stack: [],
  };
}

export function pushHistory<T>(history: EditorHistory<T>, snapshot: T): void {
  history.stack.push(snapshot);
  while (history.stack.length > history.limit) {
    history.stack.shift();
  }
}

export function popHistory<T>(history: EditorHistory<T>): T | null {
  if (history.stack.length === 0) {
    return null;
  }
  return history.stack.pop() ?? null;
}
