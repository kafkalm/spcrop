import { describe, expect, it } from "vitest";

import { resolveGlobalClipboardAction } from "../clipboard-shortcuts";

describe("resolveGlobalClipboardAction", () => {
  it("does not hijack Cmd/Ctrl+C when page text is selected", () => {
    const action = resolveGlobalClipboardAction({
      key: "c",
      ctrlOrMeta: true,
      altKey: false,
      typing: false,
      hasTextSelection: true,
    });

    expect(action).toBeNull();
  });

  it("keeps crop copy shortcut when no text is selected", () => {
    const action = resolveGlobalClipboardAction({
      key: "c",
      ctrlOrMeta: true,
      altKey: false,
      typing: false,
      hasTextSelection: false,
    });

    expect(action).toBe("copyCropSelection");
  });

  it("keeps crop paste shortcut behavior", () => {
    const action = resolveGlobalClipboardAction({
      key: "v",
      ctrlOrMeta: true,
      altKey: false,
      typing: false,
      hasTextSelection: true,
    });

    expect(action).toBe("pasteCropSelection");
  });
});
