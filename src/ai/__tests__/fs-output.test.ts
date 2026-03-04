import { describe, expect, it, vi } from "vitest";

import { formatOutputFilename } from "../fs-output";

describe("formatOutputFilename", () => {
  it("builds stable filename with provider, task id and index", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:34:56.000Z"));

    const name = formatOutputFilename({
      provider: "openai",
      taskId: "task-7",
      index: 2,
    });

    expect(name).toBe("20260304-123456-openai-task-7-02.png");
    vi.useRealTimers();
  });
});
