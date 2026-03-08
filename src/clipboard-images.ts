interface ClipboardDataLike {
  files?: ArrayLike<File>;
  items?: ArrayLike<{
    kind: string;
    type: string;
    getAsFile(): File | null;
  }>;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function fileSignature(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`;
}

export function extractClipboardImageFiles(data: ClipboardDataLike | null): File[] {
  if (!data) {
    return [];
  }
  const out: File[] = [];
  const seen = new Set<string>();

  const append = (file: File | null): void => {
    if (!file || !isImageFile(file)) {
      return;
    }
    const sig = fileSignature(file);
    if (seen.has(sig)) {
      return;
    }
    seen.add(sig);
    out.push(file);
  };

  for (const file of Array.from(data.files ?? [])) {
    append(file);
  }
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }
    append(item.getAsFile());
  }
  return out;
}
