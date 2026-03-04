import type { GalleryItem, GeneratedAsset, ProviderId } from "./types";

export function createGalleryItemsFromAssets(args: {
  taskId: string;
  provider: ProviderId;
  prompt: string;
  assets: GeneratedAsset[];
  createdAt?: number;
}): GalleryItem[] {
  const now = args.createdAt ?? Date.now();
  return args.assets.map((asset, index) => ({
    id: `${args.taskId}-${index}`,
    taskId: args.taskId,
    provider: args.provider,
    prompt: args.prompt,
    createdAt: now + index,
    asset,
    selectedAsSource: false,
  }));
}

export function markSelectedSource(items: GalleryItem[], itemId: string): GalleryItem[] {
  return items.map((item) => ({
    ...item,
    selectedAsSource: item.id === itemId,
  }));
}
