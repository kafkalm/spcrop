export type GlobalClipboardAction = "copyCropSelection" | "pasteCropSelection";

export interface ResolveGlobalClipboardActionInput {
  key: string;
  ctrlOrMeta: boolean;
  altKey: boolean;
  typing: boolean;
  hasTextSelection: boolean;
}

export function resolveGlobalClipboardAction(
  input: ResolveGlobalClipboardActionInput,
): GlobalClipboardAction | null {
  if (input.typing || !input.ctrlOrMeta || input.altKey) {
    return null;
  }

  const lowerKey = input.key.toLowerCase();
  if (lowerKey === "c") {
    if (input.hasTextSelection) {
      return null;
    }
    return "copyCropSelection";
  }

  if (lowerKey === "v") {
    return "pasteCropSelection";
  }

  return null;
}
