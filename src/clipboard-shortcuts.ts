export type GlobalClipboardAction = "copyCropSelection" | "pasteCropSelection";
export type PasteAction = "system_image" | "internal_crop";

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

export interface ResolvePasteActionInput {
  typing: boolean;
  hasSystemClipboardImage: boolean;
  hasInternalClipboardImage: boolean;
}

export function resolvePasteAction(input: ResolvePasteActionInput): PasteAction | null {
  if (input.typing) {
    return null;
  }
  if (input.hasInternalClipboardImage) {
    return "internal_crop";
  }
  if (input.hasSystemClipboardImage) {
    return "system_image";
  }
  return null;
}
