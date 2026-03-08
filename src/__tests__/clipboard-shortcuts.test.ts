import { describe, expect, it } from "vitest";

import { resolveGlobalClipboardAction, resolvePasteAction } from "../clipboard-shortcuts";

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

describe("resolvePasteAction", () => {
  it("prefers internal clipboard image", () => {
    const action = resolvePasteAction({
      typing: false,
      hasSystemClipboardImage: true,
      hasInternalClipboardImage: true,
    });

    expect(action).toBe("internal_crop");
  });

  it("falls back to system clipboard image when internal clipboard is empty", () => {
    const action = resolvePasteAction({
      typing: false,
      hasSystemClipboardImage: true,
      hasInternalClipboardImage: false,
    });

    expect(action).toBe("system_image");
  });

  it("does not intercept paste while typing", () => {
    const action = resolvePasteAction({
      typing: true,
      hasSystemClipboardImage: true,
      hasInternalClipboardImage: true,
    });

    expect(action).toBeNull();
  });
});
