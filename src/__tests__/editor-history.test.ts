import { describe, expect, it } from "vitest";
import { createHistory, popHistory, pushHistory } from "../editor-history";

describe("editor-history", () => {
  it("pushes and pops snapshots in LIFO order", () => {
    const history = createHistory<number>(10);
    pushHistory(history, 1);
    pushHistory(history, 2);

    expect(popHistory(history)).toBe(2);
    expect(popHistory(history)).toBe(1);
    expect(popHistory(history)).toBeNull();
  });

  it("respects history limit by dropping oldest snapshots", () => {
    const history = createHistory<number>(2);
    pushHistory(history, 1);
    pushHistory(history, 2);
    pushHistory(history, 3);

    expect(popHistory(history)).toBe(3);
    expect(popHistory(history)).toBe(2);
    expect(popHistory(history)).toBeNull();
  });
});
