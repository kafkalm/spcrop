import { describe, expect, it } from "vitest";

import { extractClipboardImageFiles } from "../clipboard-images";

interface MockClipboardItem {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

describe("extractClipboardImageFiles", () => {
  it("returns all image files from clipboard files list", () => {
    const imageA = new File(["a"], "a.png", { type: "image/png" });
    const imageB = new File(["b"], "b.jpg", { type: "image/jpeg" });
    const text = new File(["t"], "t.txt", { type: "text/plain" });
    const output = extractClipboardImageFiles({
      files: [imageA, text, imageB],
      items: [],
    });
    expect(output).toEqual([imageA, imageB]);
  });

  it("reads image files from clipboard items when files list is empty", () => {
    const imageA = new File(["a"], "a.png", { type: "image/png" });
    const items: MockClipboardItem[] = [
      {
        kind: "string",
        type: "text/plain",
        getAsFile: () => null,
      },
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => imageA,
      },
    ];
    const output = extractClipboardImageFiles({
      files: [],
      items,
    });
    expect(output).toEqual([imageA]);
  });

  it("deduplicates same file metadata while preserving order", () => {
    const imageA = new File(["a"], "a.png", { type: "image/png", lastModified: 1 });
    const imageB = new File(["b"], "b.png", { type: "image/png", lastModified: 2 });
    const duplicateOfA = new File(["a"], "a.png", { type: "image/png", lastModified: 1 });
    const items: MockClipboardItem[] = [
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => duplicateOfA,
      },
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => imageB,
      },
    ];
    const output = extractClipboardImageFiles({
      files: [imageA],
      items,
    });
    expect(output).toEqual([imageA, imageB]);
  });
});
