import { describe, expect, it } from "vitest";

import type { TaskRecord } from "../types";
import { trimTaskHistory } from "../history-idb";

function makeTask(i: number): TaskRecord {
  return {
    id: `t-${i}`,
    provider: i % 2 === 0 ? "openai" : "gemini",
    mode: "text_to_image",
    prompt: `prompt-${i}`,
    status: "succeeded",
    createdAt: i,
    outputs: [],
    outputFiles: [],
  };
}

describe("trimTaskHistory", () => {
  it("keeps newest N tasks by createdAt", () => {
    const tasks = [makeTask(1), makeTask(5), makeTask(2), makeTask(4), makeTask(3)];
    const trimmed = trimTaskHistory(tasks, 3);

    expect(trimmed.map((t) => t.id)).toEqual(["t-5", "t-4", "t-3"]);
  });

  it("returns all tasks when within cap", () => {
    const tasks = [makeTask(1), makeTask(2)];
    const trimmed = trimTaskHistory(tasks, 10);

    expect(trimmed.map((t) => t.id)).toEqual(["t-2", "t-1"]);
  });
});
