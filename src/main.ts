import "./styles.css";
import { resolveGlobalClipboardAction } from "./clipboard-shortcuts";
import { createGalleryItemsFromAssets, markSelectedSource } from "./ai/gallery-store";
import {
  loadAiHistory,
  loadOutputDirectoryHandle,
  saveAiHistory,
  saveOutputDirectoryHandle,
} from "./ai/history-idb";
import { dataUrlToBlob } from "./ai/image-utils";
import { buildImageInput, canvasToPngBlob, imageBitmapToPngBlob } from "./ai/image-source";
import {
  downloadBlobFallback,
  ensureDirectoryPermission,
  formatOutputFilename,
  selectOutputDirectory,
  supportsDirectoryPicker,
  writeBlobToDirectory,
} from "./ai/fs-output";
import { runWithFallback } from "./ai/provider-router";
import { resolveFallbackProvider } from "./ai/request-config";
import { createTaskRecord, patchTaskRecord } from "./ai/task-store";
import { createGeminiAdapter } from "./ai/providers/gemini";
import { createOpenAIAdapter } from "./ai/providers/openai";
import type {
  AiSettings,
  GalleryItem,
  GenerateRequest,
  GenerationMode,
  ImageInput,
  ImageSourceKind,
  PersistedAiState,
  ProviderId,
  TaskRecord,
} from "./ai/types";

type LayerImage = ImageBitmap | HTMLCanvasElement;

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layer {
  id: number;
  name: string;
  image: LayerImage;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface DraggingGroupItem {
  id: number;
  startX: number;
  startY: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface FakeBgRemovalResult {
  removedPixels: number;
  adjustedPixels: number;
}

interface CheckerPattern {
  tile: number;
  offsetX: number;
  offsetY: number;
  invert: boolean;
  accuracy: number;
}

interface CropSelectionSlice {
  layer: Layer;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  worldX: number;
  worldY: number;
}

type ShortcutAction =
  | "toggleCropMode"
  | "clearCrop"
  | "createLayerFromCrop"
  | "copyCropSelection"
  | "pasteCropSelection"
  | "setPresetCropRect"
  | "removeFakePngBg"
  | "spreadLayers"
  | "alignHorizontal"
  | "alignVertical"
  | "deleteLayers"
  | "exportPng";

interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  defaultKey: string;
}

type ZoomModifier = "Alt" | "Ctrl" | "Meta" | "Shift" | "None";

const SHORTCUT_STORAGE_KEY = "spcrop.shortcuts.v1";
const ZOOM_MODIFIER_STORAGE_KEY = "spcrop.zoomModifier.v1";
const AI_SETTINGS_STORAGE_KEY = "spcrop.ai.settings.v1";

const DEFAULT_AI_SETTINGS: AiSettings = {
  openaiApiKey: "",
  openaiBaseUrl: "https://api.openai.com",
  openaiModel: "gpt-image-1",
  geminiApiKey: "",
  geminiBaseUrl: "https://generativelanguage.googleapis.com",
  geminiModel: "gemini-2.5-flash-image-preview",
  enableFallback: true,
  fallbackProvider: "",
  outputCount: 1,
};

interface AiRuntimeState {
  settings: AiSettings;
  tasks: TaskRecord[];
  gallery: GalleryItem[];
  selectedSourceKind: ImageSourceKind;
  outputDirHandle: FileSystemDirectoryHandle | null;
  outputDirReady: boolean;
  taskAbortControllers: Map<string, AbortController>;
  persistingHistory: Promise<void> | null;
}

const SHORTCUT_DEFS: ShortcutDef[] = [
  { action: "toggleCropMode", label: "开始/结束框选", defaultKey: "C" },
  { action: "clearCrop", label: "清除框选", defaultKey: "X" },
  { action: "createLayerFromCrop", label: "从框选生成新图层", defaultKey: "R" },
  { action: "copyCropSelection", label: "复制框选内容", defaultKey: "Ctrl+C" },
  { action: "pasteCropSelection", label: "粘贴框选内容", defaultKey: "Ctrl+V" },
  { action: "setPresetCropRect", label: "一键创建框选", defaultKey: "B" },
  { action: "removeFakePngBg", label: "去除仿 PNG 背景", defaultKey: "P" },
  { action: "spreadLayers", label: "自动散开图层", defaultKey: "G" },
  { action: "alignHorizontal", label: "横向排列", defaultKey: "H" },
  { action: "alignVertical", label: "纵向排列", defaultKey: "V" },
  { action: "deleteLayers", label: "删除选中图层", defaultKey: "Delete" },
  { action: "exportPng", label: "导出 PNG", defaultKey: "E" },
];

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface AppState {
  layers: Layer[];
  nextLayerId: number;
  activeLayerId: number | null;
  selectedLayerIds: Set<number>;
  cropMode: boolean;
  cropRect: Rect | null;
  selectingCrop: boolean;
  draggingCrop: boolean;
  cropStart: Point | null;
  cropDragOffset: Point | null;
  panningView: boolean;
  panStartScreen: Point | null;
  panStartOffset: Point | null;
  view: ViewState;
  zoomModifier: ZoomModifier;
  shortcutMap: Record<ShortcutAction, string>;
  capturingShortcutFor: ShortcutAction | null;
  draggingGroup: DraggingGroupItem[] | null;
  dragStartPointer: Point | null;
  clipboardImage: HTMLCanvasElement | null;
  clipboardPasteCursor: Point | null;
}

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`missing element: #${id}`);
  }
  return el as T;
}

const stage = mustGet<HTMLCanvasElement>("stage");
const rulerTop = mustGet<HTMLCanvasElement>("rulerTop");
const rulerLeft = mustGet<HTMLCanvasElement>("rulerLeft");
const ctxValue = stage.getContext("2d");
if (!ctxValue) {
  throw new Error("2D context not available");
}
const ctx: CanvasRenderingContext2D = ctxValue;
const rulerTopCtxValue = rulerTop.getContext("2d");
const rulerLeftCtxValue = rulerLeft.getContext("2d");
if (!rulerTopCtxValue || !rulerLeftCtxValue) {
  throw new Error("ruler context not available");
}
const rulerTopCtx: CanvasRenderingContext2D = rulerTopCtxValue;
const rulerLeftCtx: CanvasRenderingContext2D = rulerLeftCtxValue;

const dropZone = mustGet<HTMLDivElement>("dropZone");
const dropHint = mustGet<HTMLDivElement>("dropHint");
const statusText = mustGet<HTMLSpanElement>("statusText");

const cropModeBtn = mustGet<HTMLButtonElement>("cropModeBtn");
const clearCropBtn = mustGet<HTMLButtonElement>("clearCropBtn");
const createLayerBtn = mustGet<HTMLButtonElement>("createLayerBtn");
const copyCropBtn = mustGet<HTMLButtonElement>("copyCropBtn");
const pasteCropBtn = mustGet<HTMLButtonElement>("pasteCropBtn");
const setCropRectBtn = mustGet<HTMLButtonElement>("setCropRectBtn");
const removeFakeBgBtn = mustGet<HTMLButtonElement>("removeFakeBgBtn");
const spreadBtn = mustGet<HTMLButtonElement>("spreadBtn");
const alignHBtn = mustGet<HTMLButtonElement>("alignHBtn");
const alignVBtn = mustGet<HTMLButtonElement>("alignVBtn");
const deleteBtn = mustGet<HTMLButtonElement>("deleteBtn");
const exportBtn = mustGet<HTMLButtonElement>("exportBtn");
const targetWInput = mustGet<HTMLInputElement>("targetW");
const targetHInput = mustGet<HTMLInputElement>("targetH");
const zoomModifierSelect = mustGet<HTMLSelectElement>("zoomModifierSelect");
const layerList = mustGet<HTMLUListElement>("layerList");
const shortcutList = mustGet<HTMLDivElement>("shortcutList");
const resetShortcutBtn = mustGet<HTMLButtonElement>("resetShortcutBtn");
const aiProviderSelect = mustGet<HTMLSelectElement>("aiProvider");
const aiModeSelect = mustGet<HTMLSelectElement>("aiMode");
const aiSourceKindSelect = mustGet<HTMLSelectElement>("aiSourceKind");
const aiPromptInput = mustGet<HTMLTextAreaElement>("aiPrompt");
const aiNegativePromptInput = mustGet<HTMLTextAreaElement>("aiNegativePrompt");
const generateAiBtn = mustGet<HTMLButtonElement>("generateAiBtn");
const chooseOutputDirBtn = mustGet<HTMLButtonElement>("chooseOutputDirBtn");
const outputDirStatus = mustGet<HTMLDivElement>("outputDirStatus");
const aiTaskList = mustGet<HTMLDivElement>("aiTaskList");
const aiGallery = mustGet<HTMLDivElement>("aiGallery");
const openaiApiKeyInput = mustGet<HTMLInputElement>("openaiApiKey");
const openaiBaseUrlInput = mustGet<HTMLInputElement>("openaiBaseUrl");
const openaiModelInput = mustGet<HTMLInputElement>("openaiModel");
const geminiApiKeyInput = mustGet<HTMLInputElement>("geminiApiKey");
const geminiBaseUrlInput = mustGet<HTMLInputElement>("geminiBaseUrl");
const geminiModelInput = mustGet<HTMLInputElement>("geminiModel");
const aiOutputCountInput = mustGet<HTMLInputElement>("aiOutputCount");
const enableFallbackInput = mustGet<HTMLInputElement>("enableFallback");
const fallbackProviderSelect = mustGet<HTMLSelectElement>("fallbackProvider");

function defaultShortcutMap(): Record<ShortcutAction, string> {
  const map = {} as Record<ShortcutAction, string>;
  for (const def of SHORTCUT_DEFS) {
    map[def.action] = def.defaultKey;
  }
  return map;
}

const state: AppState = {
  layers: [],
  nextLayerId: 1,
  activeLayerId: null,
  selectedLayerIds: new Set<number>(),
  cropMode: false,
  cropRect: null,
  selectingCrop: false,
  draggingCrop: false,
  cropStart: null,
  cropDragOffset: null,
  panningView: false,
  panStartScreen: null,
  panStartOffset: null,
  view: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  },
  zoomModifier: "Alt",
  shortcutMap: defaultShortcutMap(),
  capturingShortcutFor: null,
  draggingGroup: null,
  dragStartPointer: null,
  clipboardImage: null,
  clipboardPasteCursor: null,
};

const aiState: AiRuntimeState = {
  settings: { ...DEFAULT_AI_SETTINGS },
  tasks: [],
  gallery: [],
  selectedSourceKind: "crop",
  outputDirHandle: null,
  outputDirReady: false,
  taskAbortControllers: new Map<string, AbortController>(),
  persistingHistory: null,
};

function setStatus(text: string): void {
  statusText.textContent = text;
}

function resizeCanvas(): void {
  const rect = dropZone.getBoundingClientRect();
  stage.width = Math.max(400, Math.floor(rect.width));
  stage.height = Math.max(280, Math.floor(rect.height));
  rulerTop.width = stage.width;
  rulerTop.height = 24;
  rulerLeft.width = 24;
  rulerLeft.height = stage.height;
  render();
}

function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function normalizeSquareRect(start: Point, current: Point): Rect {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const endX = start.x + (dx >= 0 ? side : -side);
  const endY = start.y + (dy >= 0 ? side : -side);
  return normalizeRect(start, { x: endX, y: endY });
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pointInLayer(x: number, y: number, layer: Layer): boolean {
  return x >= layer.x && y >= layer.y && x <= layer.x + layer.width && y <= layer.y + layer.height;
}

function getPointerPos(event: MouseEvent | WheelEvent): Point {
  const rect = stage.getBoundingClientRect();
  const sx = stage.width / rect.width;
  const sy = stage.height / rect.height;
  return {
    x: (event.clientX - rect.left) * sx,
    y: (event.clientY - rect.top) * sy,
  };
}

function screenToWorld(screen: Point): Point {
  return {
    x: (screen.x - state.view.offsetX) / state.view.scale,
    y: (screen.y - state.view.offsetY) / state.view.scale,
  };
}

function worldToScreen(world: Point): Point {
  return {
    x: world.x * state.view.scale + state.view.offsetX,
    y: world.y * state.view.scale + state.view.offsetY,
  };
}

function hitTestLayer(x: number, y: number): Layer | null {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    if (pointInLayer(x, y, layer)) {
      return layer;
    }
  }
  return null;
}

function getLayerById(id: number): Layer | null {
  return state.layers.find((l) => l.id === id) ?? null;
}

function defaultLayerPosition(index: number): Point {
  const cell = 180;
  const padding = 16;
  const cols = Math.max(1, Math.floor((stage.width - padding * 2) / cell));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: padding + col * cell,
    y: padding + row * cell,
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function colorDistanceSq(a: RgbColor, b: RgbColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function layerToEditableCanvas(layer: Layer): HTMLCanvasElement | null {
  if (layer.image instanceof HTMLCanvasElement) {
    return layer.image;
  }

  const canvas = document.createElement("canvas");
  canvas.width = layer.width;
  canvas.height = layer.height;
  const cctx = canvas.getContext("2d");
  if (!cctx) {
    return null;
  }

  cctx.drawImage(layer.image, 0, 0, layer.width, layer.height);
  layer.image = canvas;
  return canvas;
}

function classifyPixelToBg(
  data: Uint8ClampedArray,
  pixelIndex: number,
  bgA: RgbColor,
  bgB: RgbColor,
  toleranceSq: number,
): number {
  const offset = pixelIndex * 4;
  if (data[offset + 3] < 220) {
    return -1;
  }
  const color: RgbColor = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
  const d1 = colorDistanceSq(color, bgA);
  const d2 = colorDistanceSq(color, bgB);
  const minDist = Math.min(d1, d2);
  if (minDist > toleranceSq) {
    return -1;
  }
  return d1 <= d2 ? 0 : 1;
}

function detectFakeBgColors(data: Uint8ClampedArray, width: number, height: number): [RgbColor, RgbColor] | null {
  if (width < 2 || height < 2) {
    return null;
  }

  const ALPHA_MIN = 220;
  const QUANT = 8;

  type Bucket = {
    count: number;
    sumR: number;
    sumG: number;
    sumB: number;
  };
  const buckets = new Map<string, Bucket>();

  const addSample = (x: number, y: number): void => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] < ALPHA_MIN) {
      return;
    }
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const qr = Math.round(r / QUANT) * QUANT;
    const qg = Math.round(g / QUANT) * QUANT;
    const qb = Math.round(b / QUANT) * QUANT;
    const key = `${qr},${qg},${qb}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.sumR += r;
      bucket.sumG += g;
      bucket.sumB += b;
      return;
    }
    buckets.set(key, {
      count: 1,
      sumR: r,
      sumG: g,
      sumB: b,
    });
  };

  for (let x = 0; x < width; x++) {
    addSample(x, 0);
    addSample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    addSample(0, y);
    addSample(width - 1, y);
  }

  if (buckets.size < 2) {
    return null;
  }

  const ranked = [...buckets.values()]
    .filter((b) => b.count >= 6)
    .sort((a, b) => b.count - a.count)
    .map((b) => ({
      count: b.count,
      color: {
        r: Math.round(b.sumR / b.count),
        g: Math.round(b.sumG / b.count),
        b: Math.round(b.sumB / b.count),
      },
    }));

  if (ranked.length < 2) {
    return null;
  }

  const first = ranked[0];
  const MIN_SECOND_COUNT = Math.max(6, Math.floor(first.count * 0.08));
  const MIN_PAIR_DISTANCE = 144; // 12^2

  for (let i = 1; i < ranked.length; i++) {
    const candidate = ranked[i];
    if (candidate.count < MIN_SECOND_COUNT) {
      continue;
    }
    if (colorDistanceSq(first.color, candidate.color) < MIN_PAIR_DISTANCE) {
      continue;
    }
    return [first.color, candidate.color];
  }

  return null;
}

function collectBorderRuns(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bgA: RgbColor,
  bgB: RgbColor,
  toleranceSq: number,
): number[] {
  const runs: number[] = [];

  const scanHorizontal = (y: number): void => {
    let prev = -1;
    let run = 0;
    for (let x = 0; x < width; x++) {
      const cls = classifyPixelToBg(data, y * width + x, bgA, bgB, toleranceSq);
      if (cls !== prev) {
        if (prev !== -1 && run >= 2) {
          runs.push(run);
        }
        prev = cls;
        run = cls === -1 ? 0 : 1;
        continue;
      }
      if (cls !== -1) {
        run += 1;
      }
    }
    if (prev !== -1 && run >= 2) {
      runs.push(run);
    }
  };

  const scanVertical = (x: number): void => {
    let prev = -1;
    let run = 0;
    for (let y = 0; y < height; y++) {
      const cls = classifyPixelToBg(data, y * width + x, bgA, bgB, toleranceSq);
      if (cls !== prev) {
        if (prev !== -1 && run >= 2) {
          runs.push(run);
        }
        prev = cls;
        run = cls === -1 ? 0 : 1;
        continue;
      }
      if (cls !== -1) {
        run += 1;
      }
    }
    if (prev !== -1 && run >= 2) {
      runs.push(run);
    }
  };

  scanHorizontal(0);
  if (height > 1) {
    scanHorizontal(height - 1);
  }
  scanVertical(0);
  if (width > 1) {
    scanVertical(width - 1);
  }

  return runs;
}

function buildTileCandidates(runs: number[], maxTile: number): number[] {
  const candidates = new Set<number>();
  const baseCandidates = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];
  for (const value of baseCandidates) {
    if (value <= maxTile) {
      candidates.add(value);
    }
  }

  const histogram = new Map<number, number>();
  for (const run of runs) {
    if (run < 2 || run > maxTile) {
      continue;
    }
    histogram.set(run, (histogram.get(run) ?? 0) + 1);
  }

  const topRuns = [...histogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([run]) => run);
  for (const run of topRuns) {
    for (const candidate of [run - 1, run, run + 1, run * 2]) {
      if (candidate >= 2 && candidate <= maxTile) {
        candidates.add(candidate);
      }
    }
  }

  return [...candidates].sort((a, b) => a - b);
}

function collectBorderSamples(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bgA: RgbColor,
  bgB: RgbColor,
  toleranceSq: number,
): Array<{ x: number; y: number; label: number }> {
  const raw: Array<{ x: number; y: number; label: number }> = [];
  const add = (x: number, y: number): void => {
    const label = classifyPixelToBg(data, y * width + x, bgA, bgB, toleranceSq);
    if (label === -1) {
      return;
    }
    raw.push({ x, y, label });
  };

  for (let x = 0; x < width; x++) {
    add(x, 0);
    if (height > 1) {
      add(x, height - 1);
    }
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    if (width > 1) {
      add(width - 1, y);
    }
  }

  if (raw.length <= 384) {
    return raw;
  }

  const step = Math.ceil(raw.length / 384);
  const compact: Array<{ x: number; y: number; label: number }> = [];
  for (let i = 0; i < raw.length; i += step) {
    compact.push(raw[i]);
  }
  return compact;
}

function findCheckerPattern(
  samples: Array<{ x: number; y: number; label: number }>,
  tileCandidates: number[],
): CheckerPattern | null {
  if (samples.length < 40 || tileCandidates.length === 0) {
    return null;
  }

  let best: CheckerPattern | null = null;

  for (const tile of tileCandidates) {
    for (let offsetX = 0; offsetX < tile; offsetX++) {
      for (let offsetY = 0; offsetY < tile; offsetY++) {
        let scoreNormal = 0;
        let scoreInvert = 0;
        for (const sample of samples) {
          const parity =
            (Math.floor((sample.x + offsetX) / tile) + Math.floor((sample.y + offsetY) / tile)) & 1;
          if (sample.label === parity) {
            scoreNormal += 1;
          } else {
            scoreInvert += 1;
          }
        }

        const score = Math.max(scoreNormal, scoreInvert);
        const invert = scoreInvert > scoreNormal;
        const accuracy = score / samples.length;
        if (!best || accuracy > best.accuracy) {
          best = {
            tile,
            offsetX,
            offsetY,
            invert,
            accuracy,
          };
        }
      }
    }
  }

  return best;
}

function predictBgIndex(x: number, y: number, pattern: CheckerPattern): number {
  const parity = (Math.floor((x + pattern.offsetX) / pattern.tile) + Math.floor((y + pattern.offsetY) / pattern.tile)) & 1;
  return pattern.invert ? (1 - parity) : parity;
}

function removeFakeCheckerBackground(layer: Layer): FakeBgRemovalResult | null {
  const canvas = layerToEditableCanvas(layer);
  if (!canvas) {
    return null;
  }

  const cctx = canvas.getContext("2d");
  if (!cctx) {
    return null;
  }

  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const imageData = cctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const colors = detectFakeBgColors(data, width, height);
  if (!colors) {
    return null;
  }

  const [bgA, bgB] = colors;
  const pairDistance = Math.sqrt(colorDistanceSq(bgA, bgB));
  const classifyTolerance = clamp(Math.round(pairDistance * 0.42), 12, 36);
  const classifyToleranceSq = classifyTolerance * classifyTolerance;

  const borderRuns = collectBorderRuns(data, width, height, bgA, bgB, classifyToleranceSq);
  const maxTile = clamp(Math.floor(Math.min(width, height) / 2), 8, 64);
  const tileCandidates = buildTileCandidates(borderRuns, maxTile);
  const borderSamples = collectBorderSamples(data, width, height, bgA, bgB, classifyToleranceSq);
  const checkerPattern = findCheckerPattern(borderSamples, tileCandidates);
  if (!checkerPattern || checkerPattern.accuracy < 0.82) {
    return null;
  }

  const removeTolerance = clamp(classifyTolerance + 7, 14, 44);
  const removeToleranceSq = removeTolerance * removeTolerance;

  const total = width * height;
  const candidate = new Uint8Array(total);
  const removed = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const alpha = data[idx + 3];
    if (alpha < 220) {
      continue;
    }
    const color: RgbColor = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
    const x = i % width;
    const y = (i - x) / width;
    const expected = predictBgIndex(x, y, checkerPattern);
    const expectedBg = expected === 0 ? bgA : bgB;
    if (colorDistanceSq(color, expectedBg) <= removeToleranceSq) {
      candidate[i] = 1;
    }
  }

  const queue: number[] = [];
  let queueHead = 0;
  const enqueue = (index: number): void => {
    if (!candidate[index] || removed[index]) {
      return;
    }
    removed[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + (width - 1));
  }

  while (queueHead < queue.length) {
    const index = queue[queueHead++];
    const x = index % width;
    const y = (index - x) / width;

    if (x > 0) {
      enqueue(index - 1);
    }
    if (x < width - 1) {
      enqueue(index + 1);
    }
    if (y > 0) {
      enqueue(index - width);
    }
    if (y < height - 1) {
      enqueue(index + width);
    }
  }

  let removedPixels = 0;
  for (let i = 0; i < total; i++) {
    if (!removed[i]) {
      continue;
    }
    const idx = i * 4;
    data[idx] = 0;
    data[idx + 1] = 0;
    data[idx + 2] = 0;
    data[idx + 3] = 0;
    removedPixels += 1;
  }

  if (removedPixels === 0) {
    return null;
  }

  const EDGE_TOLERANCE = Math.max(removeTolerance + 8, 28);
  const EDGE_TOLERANCE_SQ = EDGE_TOLERANCE * EDGE_TOLERANCE;
  let adjustedPixels = 0;

  const hasRemovedNeighbor = (index: number): boolean => {
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0 && removed[index - 1]) {
      return true;
    }
    if (x < width - 1 && removed[index + 1]) {
      return true;
    }
    if (y > 0 && removed[index - width]) {
      return true;
    }
    if (y < height - 1 && removed[index + width]) {
      return true;
    }
    return false;
  };

  for (let i = 0; i < total; i++) {
    if (removed[i] || !hasRemovedNeighbor(i)) {
      continue;
    }

    const idx = i * 4;
    const alpha = data[idx + 3];
    if (alpha === 0) {
      continue;
    }

    const src: RgbColor = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
    const x = i % width;
    const y = (i - x) / width;
    const expected = predictBgIndex(x, y, checkerPattern);
    const bg = expected === 0 ? bgA : bgB;
    const d = colorDistanceSq(src, bg);
    if (d > EDGE_TOLERANCE_SQ) {
      continue;
    }

    const estimateAlpha = clamp(Math.sqrt(d) / EDGE_TOLERANCE, 0.04, 1);
    const currentAlpha = alpha / 255;
    if (estimateAlpha >= currentAlpha) {
      continue;
    }

    const nextAlpha = estimateAlpha;
    const bgR = bg.r / 255;
    const bgG = bg.g / 255;
    const bgBv = bg.b / 255;
    const srcR = src.r / 255;
    const srcG = src.g / 255;
    const srcB = src.b / 255;

    const fgR = clamp((srcR - (1 - nextAlpha) * bgR) / nextAlpha, 0, 1);
    const fgG = clamp((srcG - (1 - nextAlpha) * bgG) / nextAlpha, 0, 1);
    const fgB = clamp((srcB - (1 - nextAlpha) * bgBv) / nextAlpha, 0, 1);

    data[idx] = clampByte(fgR * 255);
    data[idx + 1] = clampByte(fgG * 255);
    data[idx + 2] = clampByte(fgB * 255);
    data[idx + 3] = clampByte(nextAlpha * 255);
    adjustedPixels += 1;
  }

  cctx.putImageData(imageData, 0, 0);
  return {
    removedPixels,
    adjustedPixels,
  };
}

function refreshLayerList(): void {
  layerList.innerHTML = "";

  const layersInUI = [...state.layers].reverse();
  for (const layer of layersInUI) {
    const li = document.createElement("li");
    li.className = "layer-item";
    if (layer.id === state.activeLayerId) {
      li.classList.add("active");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedLayerIds.has(layer.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedLayerIds.add(layer.id);
      } else {
        state.selectedLayerIds.delete(layer.id);
      }
      if (state.selectedLayerIds.size === 0) {
        state.activeLayerId = null;
      }
      refreshLayerList();
      render();
    });

    const body = document.createElement("div");
    body.style.flex = "1";
    body.innerHTML = `<div>${layer.name}</div><div class="layer-meta">${layer.width}x${layer.height} @ (${Math.round(layer.x)}, ${Math.round(layer.y)})</div>`;
    body.addEventListener("click", () => {
      state.activeLayerId = layer.id;
      if (!state.selectedLayerIds.has(layer.id)) {
        state.selectedLayerIds.clear();
        state.selectedLayerIds.add(layer.id);
      }
      refreshLayerList();
      render();
    });

    li.appendChild(checkbox);
    li.appendChild(body);
    layerList.appendChild(li);
  }
}

function moveLayers(layers: Layer[], dx: number, dy: number): void {
  for (const layer of layers) {
    layer.x = Math.round(layer.x + dx);
    layer.y = Math.round(layer.y + dy);
  }
}

function pickRulerStep(scale: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
  for (const step of steps) {
    if (step * scale >= 8) {
      return step;
    }
  }
  return steps[steps.length - 1];
}

function drawRulers(): void {
  rulerTopCtx.clearRect(0, 0, rulerTop.width, rulerTop.height);
  rulerLeftCtx.clearRect(0, 0, rulerLeft.width, rulerLeft.height);

  rulerTopCtx.fillStyle = "#141a24";
  rulerTopCtx.fillRect(0, 0, rulerTop.width, rulerTop.height);
  rulerLeftCtx.fillStyle = "#141a24";
  rulerLeftCtx.fillRect(0, 0, rulerLeft.width, rulerLeft.height);

  const step = pickRulerStep(state.view.scale);
  const majorEvery = 5;

  const worldStartX = (0 - state.view.offsetX) / state.view.scale;
  const worldEndX = (stage.width - state.view.offsetX) / state.view.scale;
  const firstX = Math.floor(worldStartX / step) * step;

  rulerTopCtx.strokeStyle = "#8aa0c2";
  rulerTopCtx.fillStyle = "#cbd9ef";
  rulerTopCtx.font = "10px IBM Plex Sans, Segoe UI, sans-serif";
  for (let value = firstX, i = 0; value <= worldEndX + step; value += step, i++) {
    const sx = value * state.view.scale + state.view.offsetX;
    const major = i % majorEvery === 0;
    rulerTopCtx.beginPath();
    rulerTopCtx.moveTo(sx + 0.5, rulerTop.height);
    rulerTopCtx.lineTo(sx + 0.5, major ? 8 : 14);
    rulerTopCtx.stroke();
    if (major) {
      rulerTopCtx.fillText(String(Math.round(value)), sx + 2, 8);
    }
  }

  const worldStartY = (0 - state.view.offsetY) / state.view.scale;
  const worldEndY = (stage.height - state.view.offsetY) / state.view.scale;
  const firstY = Math.floor(worldStartY / step) * step;

  rulerLeftCtx.strokeStyle = "#8aa0c2";
  rulerLeftCtx.fillStyle = "#cbd9ef";
  rulerLeftCtx.font = "10px IBM Plex Sans, Segoe UI, sans-serif";
  for (let value = firstY, i = 0; value <= worldEndY + step; value += step, i++) {
    const sy = value * state.view.scale + state.view.offsetY;
    const major = i % majorEvery === 0;
    rulerLeftCtx.beginPath();
    rulerLeftCtx.moveTo(rulerLeft.width, sy + 0.5);
    rulerLeftCtx.lineTo(major ? 8 : 14, sy + 0.5);
    rulerLeftCtx.stroke();
    if (major) {
      rulerLeftCtx.save();
      rulerLeftCtx.translate(2, sy - 2);
      rulerLeftCtx.fillText(String(Math.round(value)), 0, 0);
      rulerLeftCtx.restore();
    }
  }
}

function render(): void {
  ctx.clearRect(0, 0, stage.width, stage.height);

  ctx.save();
  ctx.setTransform(state.view.scale, 0, 0, state.view.scale, state.view.offsetX, state.view.offsetY);

  for (const layer of state.layers) {
    ctx.drawImage(layer.image, layer.x, layer.y, layer.width, layer.height);

    if (state.selectedLayerIds.has(layer.id)) {
      ctx.save();
      ctx.strokeStyle = "#4bb3fd";
      ctx.lineWidth = Math.max(1, 2 / state.view.scale);
      ctx.strokeRect(layer.x + 1, layer.y + 1, layer.width - 2, layer.height - 2);
      ctx.restore();
    }

    if (layer.id === state.activeLayerId) {
      ctx.save();
      ctx.strokeStyle = "#ffb703";
      ctx.lineWidth = Math.max(1, 2 / state.view.scale);
      ctx.setLineDash([5 / state.view.scale, 4 / state.view.scale]);
      ctx.strokeRect(layer.x - 2, layer.y - 2, layer.width + 4, layer.height + 4);
      ctx.restore();
    }
  }

  if (state.cropRect && state.cropRect.w > 0 && state.cropRect.h > 0) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 183, 3, 0.18)";
    ctx.strokeStyle = "#ffb703";
    ctx.lineWidth = Math.max(1, 2 / state.view.scale);
    ctx.setLineDash([8 / state.view.scale, 5 / state.view.scale]);
    ctx.fillRect(state.cropRect.x, state.cropRect.y, state.cropRect.w, state.cropRect.h);
    ctx.strokeRect(state.cropRect.x, state.cropRect.y, state.cropRect.w, state.cropRect.h);
    ctx.restore();
  }

  ctx.restore();

  if (state.cropRect && state.cropRect.w > 0 && state.cropRect.h > 0) {
    const screen = worldToScreen({ x: state.cropRect.x, y: state.cropRect.y });
    const sw = state.cropRect.w * state.view.scale;
    const sh = state.cropRect.h * state.view.scale;
    const label = `${Math.round(state.cropRect.w)} x ${Math.round(state.cropRect.h)} px`;
    ctx.save();
    ctx.font = "12px IBM Plex Sans, Segoe UI, sans-serif";
    const textW = ctx.measureText(label).width;
    const labelX = Math.max(4, Math.min(stage.width - textW - 12, screen.x + 4));
    const labelY = screen.y > 20 ? screen.y - 8 : screen.y + Math.max(18, sh + 16);
    ctx.fillStyle = "rgba(17, 24, 38, 0.88)";
    ctx.fillRect(labelX - 4, labelY - 12, textW + 8, 16);
    ctx.fillStyle = "#ffdf9a";
    ctx.fillText(label, labelX, labelY);
    ctx.restore();
  }

  drawRulers();
}

async function addLayerFromFile(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const id = state.nextLayerId++;
  const index = state.layers.length;
  const pos = defaultLayerPosition(index);

  const layer: Layer = {
    id,
    name: `${file.name}#${id}`,
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    x: pos.x,
    y: pos.y,
  };

  state.layers.push(layer);
  state.activeLayerId = id;
  state.selectedLayerIds.clear();
  state.selectedLayerIds.add(id);
  refreshLayerList();
  render();
  setStatus(`已导入图层: ${layer.name}`);
}

async function addLayerFromBlob(blob: Blob, baseName: string): Promise<void> {
  const ext = blob.type.includes("jpeg") ? "jpg" : "png";
  const file = new File([blob], `${baseName}.${ext}`, { type: blob.type || "image/png" });
  await addLayerFromFile(file);
}

async function handleFiles(files: File[]): Promise<void> {
  const imageFiles = files.filter((f) => f.type.startsWith("image/"));
  if (imageFiles.length === 0) {
    setStatus("未检测到图片文件");
    return;
  }
  for (const file of imageFiles) {
    // eslint-disable-next-line no-await-in-loop
    await addLayerFromFile(file);
  }
}

function selectedLayersByOrder(): Layer[] {
  if (state.selectedLayerIds.size === 0) {
    return [];
  }
  return state.layers.filter((layer) => state.selectedLayerIds.has(layer.id));
}

function getActiveCropSlice(): CropSelectionSlice | null {
  const active = state.activeLayerId !== null ? getLayerById(state.activeLayerId) : null;
  if (!active || !state.cropRect || state.cropRect.w < 1 || state.cropRect.h < 1) {
    return null;
  }

  const left = Math.max(state.cropRect.x, active.x);
  const top = Math.max(state.cropRect.y, active.y);
  const right = Math.min(state.cropRect.x + state.cropRect.w, active.x + active.width);
  const bottom = Math.min(state.cropRect.y + state.cropRect.h, active.y + active.height);
  if (right <= left || bottom <= top) {
    return null;
  }

  const sx = clamp(Math.floor(left - active.x), 0, active.width);
  const sy = clamp(Math.floor(top - active.y), 0, active.height);
  const ex = clamp(Math.ceil(right - active.x), 0, active.width);
  const ey = clamp(Math.ceil(bottom - active.y), 0, active.height);
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw <= 0 || sh <= 0) {
    return null;
  }

  return {
    layer: active,
    sx,
    sy,
    sw,
    sh,
    worldX: active.x + sx,
    worldY: active.y + sy,
  };
}

function cloneCanvasImage(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const octx = out.getContext("2d");
  if (!octx) {
    return null;
  }
  octx.drawImage(source, 0, 0);
  return out;
}

function eraseActiveLayerCropContent(): boolean {
  const slice = getActiveCropSlice();
  if (!slice) {
    return false;
  }

  const canvas = layerToEditableCanvas(slice.layer);
  if (!canvas) {
    setStatus("删除失败：图层不可编辑");
    return false;
  }
  const cctx = canvas.getContext("2d");
  if (!cctx) {
    setStatus("删除失败：2D 上下文不可用");
    return false;
  }

  cctx.clearRect(slice.sx, slice.sy, slice.sw, slice.sh);
  render();
  setStatus(`已删除框选内容: ${slice.sw}x${slice.sh}`);
  return true;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isZoomModifier(value: string): value is ZoomModifier {
  return value === "Alt" || value === "Ctrl" || value === "Meta" || value === "Shift" || value === "None";
}

function loadZoomModifier(): void {
  try {
    const raw = window.localStorage.getItem(ZOOM_MODIFIER_STORAGE_KEY);
    if (raw && isZoomModifier(raw)) {
      state.zoomModifier = raw;
      return;
    }
  } catch {
    // Ignore localStorage failures.
  }
  state.zoomModifier = "Alt";
}

function saveZoomModifier(): void {
  try {
    window.localStorage.setItem(ZOOM_MODIFIER_STORAGE_KEY, state.zoomModifier);
  } catch {
    // Ignore localStorage failures.
  }
}

function syncZoomModifierUI(): void {
  zoomModifierSelect.value = state.zoomModifier;
}

function zoomModifierLabel(modifier: ZoomModifier): string {
  if (modifier === "Alt") {
    return "Alt/Option(⌥)";
  }
  if (modifier === "Meta") {
    return "Meta/Command(⌘)";
  }
  return modifier;
}

function hasZoomModifier(event: WheelEvent): boolean {
  if (state.zoomModifier === "Alt") {
    return event.altKey || event.getModifierState("Alt");
  }
  if (state.zoomModifier === "Ctrl") {
    return event.ctrlKey || event.getModifierState("Control");
  }
  if (state.zoomModifier === "Meta") {
    return event.metaKey || event.getModifierState("Meta");
  }
  if (state.zoomModifier === "Shift") {
    return event.shiftKey || event.getModifierState("Shift");
  }
  return true;
}

function normalizeBaseKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  if (key === "Esc") {
    return "Escape";
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
}

function eventToShortcut(event: KeyboardEvent): string | null {
  if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.metaKey) {
    parts.push("Meta");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(normalizeBaseKey(event.key));
  return parts.join("+");
}

function normalizeShortcutString(raw: string): string {
  const tokens = raw
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }

  let hasCtrl = false;
  let hasMeta = false;
  let hasAlt = false;
  let hasShift = false;
  let base = "";

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      hasCtrl = true;
      continue;
    }
    if (lower === "meta" || lower === "cmd" || lower === "command") {
      hasMeta = true;
      continue;
    }
    if (lower === "alt" || lower === "option") {
      hasAlt = true;
      continue;
    }
    if (lower === "shift") {
      hasShift = true;
      continue;
    }
    base = normalizeBaseKey(token);
  }

  if (!base) {
    return "";
  }
  const parts: string[] = [];
  if (hasCtrl) {
    parts.push("Ctrl");
  }
  if (hasMeta) {
    parts.push("Meta");
  }
  if (hasAlt) {
    parts.push("Alt");
  }
  if (hasShift) {
    parts.push("Shift");
  }
  parts.push(base);
  return parts.join("+");
}

function saveShortcutMap(): void {
  try {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(state.shortcutMap));
  } catch {
    // Ignore localStorage failures.
  }
}

function loadShortcutMap(): void {
  const defaults = defaultShortcutMap();
  try {
    const raw = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    if (!raw) {
      state.shortcutMap = defaults;
      return;
    }
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutAction, string>>;
    const next = { ...defaults };
    for (const def of SHORTCUT_DEFS) {
      const value = parsed[def.action];
      if (typeof value === "string" && value.trim() !== "") {
        next[def.action] = normalizeShortcutString(value);
      }
    }
    state.shortcutMap = next;
  } catch {
    state.shortcutMap = defaults;
  }
}

function assignShortcut(action: ShortcutAction, shortcut: string): void {
  const normalized = normalizeShortcutString(shortcut);
  if (!normalized) {
    return;
  }
  for (const def of SHORTCUT_DEFS) {
    if (def.action !== action && state.shortcutMap[def.action] === normalized) {
      state.shortcutMap[def.action] = "";
    }
  }
  state.shortcutMap[action] = normalized;
  saveShortcutMap();
}

function triggerShortcutAction(action: ShortcutAction): void {
  if (action === "toggleCropMode") {
    cropModeBtn.click();
    return;
  }
  if (action === "clearCrop") {
    clearCropBtn.click();
    return;
  }
  if (action === "createLayerFromCrop") {
    createLayerBtn.click();
    return;
  }
  if (action === "copyCropSelection") {
    copyCropBtn.click();
    return;
  }
  if (action === "pasteCropSelection") {
    pasteCropBtn.click();
    return;
  }
  if (action === "setPresetCropRect") {
    setCropRectBtn.click();
    return;
  }
  if (action === "removeFakePngBg") {
    removeFakeBgBtn.click();
    return;
  }
  if (action === "spreadLayers") {
    spreadBtn.click();
    return;
  }
  if (action === "alignHorizontal") {
    alignHBtn.click();
    return;
  }
  if (action === "alignVertical") {
    alignVBtn.click();
    return;
  }
  if (action === "deleteLayers") {
    deleteBtn.click();
    return;
  }
  if (action === "exportPng") {
    exportBtn.click();
  }
}

function findActionByShortcut(shortcut: string): ShortcutAction | null {
  for (const def of SHORTCUT_DEFS) {
    if (state.shortcutMap[def.action] === shortcut) {
      return def.action;
    }
  }
  return null;
}

function renderShortcutEditor(): void {
  shortcutList.innerHTML = "";
  for (const def of SHORTCUT_DEFS) {
    const row = document.createElement("div");
    row.className = "shortcut-item";

    const label = document.createElement("span");
    label.className = "shortcut-label";
    label.textContent = def.label;

    const keyBtn = document.createElement("button");
    keyBtn.type = "button";
    keyBtn.className = "shortcut-key";
    const capturing = state.capturingShortcutFor === def.action;
    if (capturing) {
      keyBtn.classList.add("capturing");
    }
    keyBtn.textContent = capturing ? "按键中..." : (state.shortcutMap[def.action] || "未设置");
    keyBtn.addEventListener("click", () => {
      state.capturingShortcutFor = capturing ? null : def.action;
      renderShortcutEditor();
      if (state.capturingShortcutFor) {
        setStatus(`正在设置快捷键：${def.label}（按下新按键）`);
      } else {
        setStatus("已取消快捷键录制");
      }
    });

    row.appendChild(label);
    row.appendChild(keyBtn);
    shortcutList.appendChild(row);
  }
}

function shortcutText(action: ShortcutAction): string {
  return state.shortcutMap[action] || "-";
}

function refreshActionButtonLabels(): void {
  cropModeBtn.textContent = `${state.cropMode ? "结束框选" : "开始框选"} (${shortcutText("toggleCropMode")})`;
  clearCropBtn.textContent = `清除框选 (${shortcutText("clearCrop")})`;
  createLayerBtn.textContent = `从框选生成新图层 (${shortcutText("createLayerFromCrop")})`;
  copyCropBtn.textContent = `复制框选内容 (${shortcutText("copyCropSelection")} / Cmd+C)`;
  pasteCropBtn.textContent = `粘贴为新图层 (${shortcutText("pasteCropSelection")} / Cmd+V)`;
  setCropRectBtn.textContent = `一键创建框选 (${shortcutText("setPresetCropRect")})`;
  removeFakeBgBtn.textContent = `去除仿PNG背景（选中优先） (${shortcutText("removeFakePngBg")})`;
  spreadBtn.textContent = `自动散开图层（选中优先） (${shortcutText("spreadLayers")})`;
  alignHBtn.textContent = `选中图层横向排列 (${shortcutText("alignHorizontal")})`;
  alignVBtn.textContent = `选中图层纵向排列 (${shortcutText("alignVertical")})`;
  deleteBtn.textContent = `删除选中图层 (${shortcutText("deleteLayers")})`;
  exportBtn.textContent = `导出 PNG（选中优先） (${shortcutText("exportPng")})`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function isProviderId(value: string): value is ProviderId {
  return value === "openai" || value === "gemini";
}

function isGenerationMode(value: string): value is GenerationMode {
  return value === "text_to_image" || value === "image_to_image";
}

function isImageSourceKind(value: string): value is ImageSourceKind {
  return value === "crop" || value === "active_layer" || value === "gallery_item";
}

function loadAiSettings(): void {
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      aiState.settings = { ...DEFAULT_AI_SETTINGS };
      return;
    }
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    aiState.settings = {
      ...DEFAULT_AI_SETTINGS,
      ...parsed,
      outputCount: clamp(Number(parsed.outputCount ?? DEFAULT_AI_SETTINGS.outputCount), 1, 4),
      fallbackProvider: parsed.fallbackProvider === "openai" || parsed.fallbackProvider === "gemini"
        ? parsed.fallbackProvider
        : "",
    };
  } catch {
    aiState.settings = { ...DEFAULT_AI_SETTINGS };
  }
}

function saveAiSettings(): void {
  try {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(aiState.settings));
  } catch {
    // Ignore localStorage failures.
  }
}

function syncAiSettingsToUI(): void {
  openaiApiKeyInput.value = aiState.settings.openaiApiKey;
  openaiBaseUrlInput.value = aiState.settings.openaiBaseUrl;
  openaiModelInput.value = aiState.settings.openaiModel;
  geminiApiKeyInput.value = aiState.settings.geminiApiKey;
  geminiBaseUrlInput.value = aiState.settings.geminiBaseUrl;
  geminiModelInput.value = aiState.settings.geminiModel;
  aiOutputCountInput.value = String(aiState.settings.outputCount);
  enableFallbackInput.checked = aiState.settings.enableFallback;
  fallbackProviderSelect.value = aiState.settings.fallbackProvider;
}

function syncAiSettingsFromUI(): void {
  aiState.settings.openaiApiKey = openaiApiKeyInput.value.trim();
  aiState.settings.openaiBaseUrl = openaiBaseUrlInput.value.trim() || DEFAULT_AI_SETTINGS.openaiBaseUrl;
  aiState.settings.openaiModel = openaiModelInput.value.trim() || DEFAULT_AI_SETTINGS.openaiModel;
  aiState.settings.geminiApiKey = geminiApiKeyInput.value.trim();
  aiState.settings.geminiBaseUrl = geminiBaseUrlInput.value.trim() || DEFAULT_AI_SETTINGS.geminiBaseUrl;
  aiState.settings.geminiModel = geminiModelInput.value.trim() || DEFAULT_AI_SETTINGS.geminiModel;
  aiState.settings.outputCount = clamp(Number(aiOutputCountInput.value) || 1, 1, 4);
  aiState.settings.enableFallback = enableFallbackInput.checked;
  const fallbackValue = fallbackProviderSelect.value;
  aiState.settings.fallbackProvider = isProviderId(fallbackValue) ? fallbackValue : "";
  saveAiSettings();
}

function getActiveProvider(): ProviderId {
  const raw = aiProviderSelect.value;
  return isProviderId(raw) ? raw : "openai";
}

function getActiveMode(): GenerationMode {
  const raw = aiModeSelect.value;
  return isGenerationMode(raw) ? raw : "text_to_image";
}

function getSelectedSourceKind(): ImageSourceKind {
  const raw = aiSourceKindSelect.value;
  return isImageSourceKind(raw) ? raw : "crop";
}

function makeProviderRequest(req: GenerateRequest): GenerateRequest {
  const fallbackProvider = resolveFallbackProvider({
    primaryProvider: req.provider,
    enableFallback: aiState.settings.enableFallback,
    fallbackProvider: aiState.settings.fallbackProvider,
  });
  return {
    ...req,
    fallbackProvider,
  };
}

const openaiAdapter = createOpenAIAdapter(() => ({
  apiKey: aiState.settings.openaiApiKey,
  baseUrl: aiState.settings.openaiBaseUrl,
}));

const geminiAdapter = createGeminiAdapter(() => ({
  apiKey: aiState.settings.geminiApiKey,
  baseUrl: aiState.settings.geminiBaseUrl,
}));

function refreshOutputDirStatus(): void {
  if (!supportsDirectoryPicker()) {
    outputDirStatus.textContent = "输出目录：浏览器不支持目录授权，将回退为下载";
    return;
  }
  if (!aiState.outputDirHandle) {
    outputDirStatus.textContent = "输出目录：未设置（将回退为下载）";
    return;
  }
  outputDirStatus.textContent = aiState.outputDirReady
    ? "输出目录：已授权，可直接写入"
    : "输出目录：句柄已记住，但当前未授权（将回退下载）";
}

function taskErrorToMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "任务已取消";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "任务失败";
}

function renderAiTaskList(): void {
  aiTaskList.innerHTML = "";
  const tasks = [...aiState.tasks].sort((a, b) => b.createdAt - a.createdAt);
  for (const task of tasks) {
    const item = document.createElement("div");
    item.className = "ai-task-item";

    const title = document.createElement("div");
    title.className = "ai-task-title";
    title.textContent = `[${task.provider}] ${task.status}`;

    const meta = document.createElement("div");
    meta.className = "ai-task-meta";
    meta.textContent = `${new Date(task.createdAt).toLocaleString()} · ${task.mode} · ${task.prompt}`;
    item.appendChild(title);
    item.appendChild(meta);

    if (task.error) {
      const err = document.createElement("div");
      err.className = "ai-task-meta";
      err.textContent = `错误：${task.error}`;
      item.appendChild(err);
    }

    const actions = document.createElement("div");
    actions.className = "ai-task-actions";

    if (task.status === "running") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "取消";
      cancelBtn.addEventListener("click", () => {
        const controller = aiState.taskAbortControllers.get(task.id);
        if (controller) {
          controller.abort();
        }
      });
      actions.appendChild(cancelBtn);
    }

    if (task.status === "failed" || task.status === "canceled") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.textContent = "重试（当前设置）";
      retryBtn.addEventListener("click", () => {
        aiPromptInput.value = task.prompt;
        aiModeSelect.value = task.mode;
        aiProviderSelect.value = task.provider;
        generateAiBtn.click();
      });
      actions.appendChild(retryBtn);
    }

    if (actions.childElementCount > 0) {
      item.appendChild(actions);
    }
    aiTaskList.appendChild(item);
  }
}

function ensureAssetBlob(item: GalleryItem): Blob {
  if (item.asset.blob instanceof Blob) {
    return item.asset.blob;
  }
  return dataUrlToBlob(item.asset.thumbDataUrl);
}

async function persistAiHistory(): Promise<void> {
  const snapshot: PersistedAiState = {
    tasks: aiState.tasks,
    gallery: aiState.gallery,
  };
  const run = async () => {
    try {
      await saveAiHistory(snapshot);
    } catch {
      // Ignore persistence errors.
    }
  };
  aiState.persistingHistory = (aiState.persistingHistory ?? Promise.resolve()).then(run, run);
  await aiState.persistingHistory;
}

function renderAiGallery(): void {
  aiGallery.innerHTML = "";
  const items = [...aiState.gallery].sort((a, b) => b.createdAt - a.createdAt);
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "ai-gallery-item";
    if (item.selectedAsSource) {
      card.classList.add("selected-source");
    }

    const img = document.createElement("img");
    img.className = "ai-gallery-thumb";
    img.src = item.asset.thumbDataUrl;
    img.alt = item.prompt.slice(0, 60);

    const meta = document.createElement("div");
    meta.className = "ai-gallery-meta";
    meta.textContent = `${item.provider} · ${new Date(item.createdAt).toLocaleTimeString()}`;

    const actions = document.createElement("div");
    actions.className = "ai-gallery-actions";

    const addLayerBtn = document.createElement("button");
    addLayerBtn.type = "button";
    addLayerBtn.textContent = "加入图层";
    addLayerBtn.addEventListener("click", async () => {
      const blob = ensureAssetBlob(item);
      await addLayerFromBlob(blob, `ai-${item.provider}-${item.id}`);
      setStatus("已将候选图加入图层");
    });

    const selectSourceBtn = document.createElement("button");
    selectSourceBtn.type = "button";
    selectSourceBtn.textContent = "设为图生图来源";
    selectSourceBtn.addEventListener("click", () => {
      aiState.gallery = markSelectedSource(aiState.gallery, item.id);
      aiSourceKindSelect.value = "gallery_item";
      aiState.selectedSourceKind = "gallery_item";
      renderAiGallery();
      persistAiHistory();
      setStatus("已设置素材来源：候选区选中图");
    });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "保存到输出目录";
    saveBtn.addEventListener("click", async () => {
      const blob = ensureAssetBlob(item);
      const index = Math.max(1, Number(item.id.split("-").pop() ?? "1") + 1);
      const filename = formatOutputFilename({
        provider: item.provider,
        taskId: item.taskId,
        index,
      });
      if (aiState.outputDirHandle && aiState.outputDirReady) {
        try {
          await writeBlobToDirectory(aiState.outputDirHandle, blob, filename);
          setStatus(`已保存：${filename}`);
          return;
        } catch {
          aiState.outputDirReady = false;
          refreshOutputDirStatus();
        }
      }
      downloadBlobFallback(blob, filename);
      setStatus(`目录不可写，已下载：${filename}`);
    });

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.textContent = "下载";
    downloadBtn.addEventListener("click", () => {
      const blob = ensureAssetBlob(item);
      const index = Math.max(1, Number(item.id.split("-").pop() ?? "1") + 1);
      const filename = formatOutputFilename({
        provider: item.provider,
        taskId: item.taskId,
        index,
      });
      downloadBlobFallback(blob, filename);
      setStatus(`已下载：${filename}`);
    });

    actions.appendChild(addLayerBtn);
    actions.appendChild(selectSourceBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(downloadBtn);
    card.appendChild(img);
    card.appendChild(meta);
    card.appendChild(actions);
    aiGallery.appendChild(card);
  }
}

async function resolveImageSource(kind: ImageSourceKind): Promise<ImageInput> {
  if (kind === "crop") {
    const slice = getActiveCropSlice();
    if (!slice) {
      throw new Error("当前没有可用框选区域");
    }
    const canvas = document.createElement("canvas");
    canvas.width = slice.sw;
    canvas.height = slice.sh;
    const cctx = canvas.getContext("2d");
    if (!cctx) {
      throw new Error("2D 上下文不可用");
    }
    cctx.drawImage(slice.layer.image, slice.sx, slice.sy, slice.sw, slice.sh, 0, 0, slice.sw, slice.sh);
    const blob = await canvasToPngBlob(canvas);
    return buildImageInput("crop", blob, "crop-source.png");
  }

  if (kind === "active_layer") {
    const active = state.activeLayerId !== null ? getLayerById(state.activeLayerId) : null;
    if (!active) {
      throw new Error("请先选中活动图层");
    }
    const blob = active.image instanceof HTMLCanvasElement
      ? await canvasToPngBlob(active.image)
      : await imageBitmapToPngBlob(active.image);
    return buildImageInput("active_layer", blob, "active-layer.png");
  }

  const selected = aiState.gallery.find((item) => item.selectedAsSource);
  if (!selected) {
    throw new Error("请先在素材候选区选择一张来源图");
  }
  const blob = ensureAssetBlob(selected);
  return buildImageInput("gallery_item", blob, "gallery-source.png");
}

async function writeOutputByPolicy(blob: Blob, provider: ProviderId, taskId: string, index: number): Promise<string> {
  const filename = formatOutputFilename({
    provider,
    taskId,
    index,
  });
  if (aiState.outputDirHandle && aiState.outputDirReady) {
    try {
      await writeBlobToDirectory(aiState.outputDirHandle, blob, filename);
      return filename;
    } catch {
      aiState.outputDirReady = false;
      refreshOutputDirStatus();
    }
  }
  downloadBlobFallback(blob, filename);
  return `download:${filename}`;
}

function upsertTask(task: TaskRecord): void {
  const index = aiState.tasks.findIndex((x) => x.id === task.id);
  if (index === -1) {
    aiState.tasks.push(task);
    return;
  }
  aiState.tasks[index] = task;
}

async function createGenerateRequestFromUI(): Promise<GenerateRequest> {
  syncAiSettingsFromUI();
  const provider = getActiveProvider();
  const mode = getActiveMode();
  const prompt = aiPromptInput.value.trim();
  const negativePrompt = aiNegativePromptInput.value.trim();
  const sourceKind = getSelectedSourceKind();
  aiState.selectedSourceKind = sourceKind;

  if (!prompt) {
    throw new Error("Prompt 不能为空");
  }

  let imageSource: ImageInput | undefined;
  if (mode === "image_to_image") {
    imageSource = await resolveImageSource(sourceKind);
  }

  const model = provider === "openai" ? aiState.settings.openaiModel : aiState.settings.geminiModel;
  const request = makeProviderRequest({
    provider,
    mode,
    prompt,
    negativePrompt: negativePrompt || undefined,
    imageSource,
    model,
    outputCount: aiState.settings.outputCount,
  });
  return request;
}

async function runGenerateTask(request: GenerateRequest): Promise<void> {
  const baseTask = createTaskRecord(request);
  upsertTask(baseTask);
  renderAiTaskList();
  await persistAiHistory();

  const runningTask = patchTaskRecord(baseTask, {
    status: "running",
    startedAt: Date.now(),
    error: undefined,
  });
  upsertTask(runningTask);
  renderAiTaskList();

  const controller = new AbortController();
  aiState.taskAbortControllers.set(baseTask.id, controller);

  try {
    const result = await runWithFallback(request, { openai: openaiAdapter, gemini: geminiAdapter }, controller.signal);
    const outputFiles: string[] = [];
    for (let i = 0; i < result.assets.length; i++) {
      const asset = result.assets[i];
      // eslint-disable-next-line no-await-in-loop
      const file = await writeOutputByPolicy(asset.blob, result.providerUsed, baseTask.id, i + 1);
      outputFiles.push(file);
    }

    const succeeded = patchTaskRecord(runningTask, {
      status: "succeeded",
      finishedAt: Date.now(),
      fallbackFrom: result.fallbackFrom ?? undefined,
      outputFiles,
    });
    succeeded.provider = result.providerUsed;
    succeeded.outputs = result.assets;
    upsertTask(succeeded);

    const galleryItems = createGalleryItemsFromAssets({
      taskId: baseTask.id,
      provider: result.providerUsed,
      prompt: request.prompt,
      assets: result.assets,
    });
    aiState.gallery = [...galleryItems, ...aiState.gallery].slice(0, 500);

    setStatus(`AI 生成完成：${result.assets.length} 张 (${result.providerUsed})`);
  } catch (error) {
    const message = taskErrorToMessage(error);
    const failed = patchTaskRecord(runningTask, {
      status: message === "任务已取消" ? "canceled" : "failed",
      error: message,
      finishedAt: Date.now(),
    });
    upsertTask(failed);
    setStatus(`AI 任务失败：${message}`);
  } finally {
    aiState.taskAbortControllers.delete(baseTask.id);
    renderAiTaskList();
    renderAiGallery();
    await persistAiHistory();
  }
}

async function restoreAiState(): Promise<void> {
  loadAiSettings();
  syncAiSettingsToUI();
  aiState.selectedSourceKind = getSelectedSourceKind();

  try {
    const history = await loadAiHistory();
    aiState.tasks = history.tasks;
    aiState.gallery = history.gallery.map((item) => {
      const blob = item.asset.blob instanceof Blob ? item.asset.blob : dataUrlToBlob(item.asset.thumbDataUrl);
      return {
        ...item,
        asset: {
          ...item.asset,
          blob,
        },
      };
    });
  } catch {
    aiState.tasks = [];
    aiState.gallery = [];
  }

  try {
    const handle = await loadOutputDirectoryHandle();
    if (handle) {
      aiState.outputDirHandle = handle;
      aiState.outputDirReady = await ensureDirectoryPermission(handle);
    }
  } catch {
    aiState.outputDirHandle = null;
    aiState.outputDirReady = false;
  }

  refreshOutputDirStatus();
  renderAiTaskList();
  renderAiGallery();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropHint.classList.add("visible");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (eventName === "drop") {
      dropHint.classList.remove("visible");
    }
  });
});

dropZone.addEventListener("drop", async (event: DragEvent) => {
  const files = event.dataTransfer?.files;
  if (!files) {
    return;
  }
  await handleFiles(Array.from(files));
});

stage.addEventListener("wheel", (event: WheelEvent) => {
  event.preventDefault();
  if (hasZoomModifier(event)) {
    const screenPos = getPointerPos(event);
    const before = screenToWorld(screenPos);
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextScale = clamp(state.view.scale * zoomFactor, 0.2, 8);
    state.view.scale = nextScale;
    state.view.offsetX = screenPos.x - before.x * nextScale;
    state.view.offsetY = screenPos.y - before.y * nextScale;
    render();
    return;
  }

  let dx = event.deltaX;
  let dy = event.deltaY;
  if (event.shiftKey && state.zoomModifier !== "Shift" && Math.abs(dx) < 0.001) {
    dx = event.deltaY;
    dy = 0;
  }
  // Normalize line/page delta to pixels.
  if (event.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  } else if (event.deltaMode === 2) {
    dx *= stage.width;
    dy *= stage.height;
  }
  state.view.offsetX -= dx;
  state.view.offsetY -= dy;
  render();
}, { passive: false });

stage.addEventListener("auxclick", (event: MouseEvent) => {
  if (event.button === 1) {
    event.preventDefault();
  }
});

cropModeBtn.addEventListener("click", () => {
  state.cropMode = !state.cropMode;
  refreshActionButtonLabels();
  setStatus(state.cropMode ? "框选模式: 在画布拖拽选择区域" : "框选模式已关闭");
});

clearCropBtn.addEventListener("click", () => {
  state.cropRect = null;
  render();
  setStatus("框选已清除");
});

setCropRectBtn.addEventListener("click", () => {
  const presetW = Number(targetWInput.value);
  const presetH = Number(targetHInput.value);
  if (!Number.isFinite(presetW) || !Number.isFinite(presetH) || presetW <= 0 || presetH <= 0) {
    setStatus("框选尺寸无效");
    return;
  }

  let x = screenToWorld({ x: 16, y: 16 }).x;
  let y = screenToWorld({ x: 16, y: 16 }).y;
  if (state.cropRect) {
    x = state.cropRect.x;
    y = state.cropRect.y;
  } else if (state.activeLayerId !== null) {
    const active = getLayerById(state.activeLayerId);
    if (active) {
      x = active.x;
      y = active.y;
    }
  }

  state.cropRect = { x, y, w: presetW, h: presetH };
  state.cropMode = true;
  refreshActionButtonLabels();
  render();
  setStatus(`已创建框选: ${Math.round(presetW)} x ${Math.round(presetH)} px`);
});

copyCropBtn.addEventListener("click", () => {
  if (state.activeLayerId === null) {
    setStatus("请先选中一个活动图层");
    return;
  }
  if (!state.cropRect || state.cropRect.w < 1 || state.cropRect.h < 1) {
    setStatus("请先框选区域");
    return;
  }

  const slice = getActiveCropSlice();
  if (!slice) {
    setStatus("框选区域没有覆盖到活动图层");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = slice.sw;
  canvas.height = slice.sh;
  const cctx = canvas.getContext("2d");
  if (!cctx) {
    setStatus("复制失败：2D 上下文不可用");
    return;
  }

  cctx.clearRect(0, 0, slice.sw, slice.sh);
  cctx.drawImage(slice.layer.image, slice.sx, slice.sy, slice.sw, slice.sh, 0, 0, slice.sw, slice.sh);
  state.clipboardImage = canvas;
  state.clipboardPasteCursor = { x: slice.worldX, y: slice.worldY };
  setStatus(`已复制框选内容: ${slice.sw}x${slice.sh}`);
});

pasteCropBtn.addEventListener("click", () => {
  if (!state.clipboardImage) {
    setStatus("剪贴板为空，请先复制框选内容");
    return;
  }

  const pastedImage = cloneCanvasImage(state.clipboardImage);
  if (!pastedImage) {
    setStatus("粘贴失败：2D 上下文不可用");
    return;
  }

  let pasteX = screenToWorld({ x: 16, y: 16 }).x;
  let pasteY = screenToWorld({ x: 16, y: 16 }).y;
  if (state.cropRect) {
    pasteX = state.cropRect.x;
    pasteY = state.cropRect.y;
  } else if (state.clipboardPasteCursor) {
    pasteX = state.clipboardPasteCursor.x;
    pasteY = state.clipboardPasteCursor.y;
  } else if (state.activeLayerId !== null) {
    const active = getLayerById(state.activeLayerId);
    if (active) {
      pasteX = active.x + 24;
      pasteY = active.y + 24;
    }
  }

  const id = state.nextLayerId++;
  const newLayer: Layer = {
    id,
    name: `pasted-${pastedImage.width}x${pastedImage.height}#${id}`,
    image: pastedImage,
    width: pastedImage.width,
    height: pastedImage.height,
    x: Math.round(pasteX),
    y: Math.round(pasteY),
  };

  state.layers.push(newLayer);
  state.activeLayerId = id;
  state.selectedLayerIds.clear();
  state.selectedLayerIds.add(id);
  state.clipboardPasteCursor = { x: newLayer.x + 16, y: newLayer.y + 16 };

  refreshLayerList();
  render();
  setStatus(`已粘贴新图层: ${newLayer.name}`);
});

removeFakeBgBtn.addEventListener("click", () => {
  const selected = selectedLayersByOrder();
  const targets = selected.length > 0 ? selected : state.layers;
  if (targets.length === 0) {
    setStatus("没有可处理的图层");
    return;
  }

  let processed = 0;
  let removedPixels = 0;
  let adjustedPixels = 0;
  for (const layer of targets) {
    const result = removeFakeCheckerBackground(layer);
    if (!result) {
      continue;
    }
    processed += 1;
    removedPixels += result.removedPixels;
    adjustedPixels += result.adjustedPixels;
  }

  if (processed === 0) {
    setStatus("未检测到可去除的仿 PNG 棋盘背景");
    return;
  }

  render();
  setStatus(`已处理 ${processed}/${targets.length} 个图层：去除 ${removedPixels} 像素，修复边缘 ${adjustedPixels} 像素`);
});

resetShortcutBtn.addEventListener("click", () => {
  state.shortcutMap = defaultShortcutMap();
  state.capturingShortcutFor = null;
  saveShortcutMap();
  renderShortcutEditor();
  refreshActionButtonLabels();
  setStatus("快捷键已恢复默认");
});

zoomModifierSelect.addEventListener("change", () => {
  const value = zoomModifierSelect.value;
  if (!isZoomModifier(value)) {
    return;
  }
  state.zoomModifier = value;
  saveZoomModifier();
  setStatus(`已更新缩放修饰键：${zoomModifierLabel(state.zoomModifier)} + 滚轮`);
});

aiModeSelect.addEventListener("change", () => {
  const mode = getActiveMode();
  const imageMode = mode === "image_to_image";
  aiSourceKindSelect.disabled = !imageMode;
  setStatus(imageMode ? "AI 模式：图生图（需要来源图）" : "AI 模式：文生图");
});

aiSourceKindSelect.addEventListener("change", () => {
  aiState.selectedSourceKind = getSelectedSourceKind();
});

[
  openaiApiKeyInput,
  openaiBaseUrlInput,
  openaiModelInput,
  geminiApiKeyInput,
  geminiBaseUrlInput,
  geminiModelInput,
  aiOutputCountInput,
  enableFallbackInput,
  fallbackProviderSelect,
].forEach((el) => {
  el.addEventListener("change", () => {
    syncAiSettingsFromUI();
  });
});

chooseOutputDirBtn.addEventListener("click", async () => {
  if (!supportsDirectoryPicker()) {
    setStatus("当前浏览器不支持目录授权写入，将继续使用下载回退");
    refreshOutputDirStatus();
    return;
  }
  try {
    const handle = await selectOutputDirectory();
    const granted = await ensureDirectoryPermission(handle);
    aiState.outputDirHandle = handle;
    aiState.outputDirReady = granted;
    await saveOutputDirectoryHandle(handle);
    refreshOutputDirStatus();
    setStatus(granted ? "输出目录已设置并授权" : "已记住目录句柄，但未获取写入权限");
  } catch (error) {
    const message = taskErrorToMessage(error);
    setStatus(`设置输出目录失败：${message}`);
  }
});

generateAiBtn.addEventListener("click", async () => {
  try {
    const request = await createGenerateRequestFromUI();
    await runGenerateTask(request);
  } catch (error) {
    const message = taskErrorToMessage(error);
    setStatus(`无法开始 AI 任务：${message}`);
  }
});

stage.addEventListener("mousedown", (event: MouseEvent) => {
  const screenPos = getPointerPos(event);

  if (event.button === 1) {
    event.preventDefault();
    state.panningView = true;
    state.panStartScreen = screenPos;
    state.panStartOffset = { x: state.view.offsetX, y: state.view.offsetY };
    return;
  }

  if (event.button !== 0) {
    return;
  }

  const pos = screenToWorld(screenPos);

  if (state.cropMode) {
    if (state.cropRect && state.cropRect.w > 0 && state.cropRect.h > 0 && pointInRect(pos.x, pos.y, state.cropRect)) {
      state.draggingCrop = true;
      state.selectingCrop = false;
      state.cropStart = null;
      state.cropDragOffset = { x: pos.x - state.cropRect.x, y: pos.y - state.cropRect.y };
      return;
    }
    state.draggingCrop = false;
    state.cropDragOffset = null;
    state.selectingCrop = true;
    state.cropStart = pos;
    state.cropRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    render();
    return;
  }

  const hit = hitTestLayer(pos.x, pos.y);
  if (!hit) {
    if (!event.shiftKey) {
      state.selectedLayerIds.clear();
      state.activeLayerId = null;
      refreshLayerList();
      render();
    }
    return;
  }

  const hitSelectedBefore = state.selectedLayerIds.has(hit.id);
  const toggleMultiSelect = event.shiftKey || event.altKey;
  state.activeLayerId = hit.id;

  if (toggleMultiSelect) {
    if (state.selectedLayerIds.has(hit.id)) {
      state.selectedLayerIds.delete(hit.id);
    } else {
      state.selectedLayerIds.add(hit.id);
    }
  } else if (!(hitSelectedBefore && state.selectedLayerIds.size > 1)) {
    state.selectedLayerIds.clear();
    state.selectedLayerIds.add(hit.id);
  }

  const draggingIds = state.selectedLayerIds.has(hit.id) ? [...state.selectedLayerIds] : [hit.id];
  state.draggingGroup = draggingIds
    .map((id) => getLayerById(id))
    .filter((layer): layer is Layer => layer !== null)
    .map((layer) => ({ id: layer.id, startX: layer.x, startY: layer.y }));
  state.dragStartPointer = pos;

  refreshLayerList();
  render();
});

stage.addEventListener("mousemove", (event: MouseEvent) => {
  const screenPos = getPointerPos(event);

  if (state.panningView && state.panStartScreen && state.panStartOffset) {
    state.view.offsetX = state.panStartOffset.x + (screenPos.x - state.panStartScreen.x);
    state.view.offsetY = state.panStartOffset.y + (screenPos.y - state.panStartScreen.y);
    render();
    return;
  }

  const pos = screenToWorld(screenPos);

  if (state.draggingCrop && state.cropRect && state.cropDragOffset) {
    const visibleMin = screenToWorld({ x: 0, y: 0 });
    const visibleMax = screenToWorld({ x: stage.width, y: stage.height });
    const maxX = visibleMax.x - state.cropRect.w;
    const maxY = visibleMax.y - state.cropRect.h;
    state.cropRect.x = clamp(pos.x - state.cropDragOffset.x, visibleMin.x, Math.max(visibleMin.x, maxX));
    state.cropRect.y = clamp(pos.y - state.cropDragOffset.y, visibleMin.y, Math.max(visibleMin.y, maxY));
    render();
    return;
  }

  if (state.selectingCrop && state.cropStart) {
    state.cropRect = event.shiftKey
      ? normalizeSquareRect(state.cropStart, pos)
      : normalizeRect(state.cropStart, pos);
    render();
    return;
  }

  if (state.draggingGroup && state.dragStartPointer) {
    const dx = pos.x - state.dragStartPointer.x;
    const dy = pos.y - state.dragStartPointer.y;
    for (const item of state.draggingGroup) {
      const layer = getLayerById(item.id);
      if (!layer) {
        continue;
      }
      layer.x = Math.round(item.startX + dx);
      layer.y = Math.round(item.startY + dy);
    }
    refreshLayerList();
    render();
  }
});

stage.addEventListener("mouseup", () => {
  state.selectingCrop = false;
  state.draggingCrop = false;
  state.cropStart = null;
  state.cropDragOffset = null;
  state.panningView = false;
  state.panStartScreen = null;
  state.panStartOffset = null;
  state.draggingGroup = null;
  state.dragStartPointer = null;
});

stage.addEventListener("mouseleave", () => {
  state.selectingCrop = false;
  state.draggingCrop = false;
  state.cropStart = null;
  state.cropDragOffset = null;
  state.panningView = false;
  state.panStartScreen = null;
  state.panStartOffset = null;
  state.draggingGroup = null;
  state.dragStartPointer = null;
});

createLayerBtn.addEventListener("click", () => {
  const active = state.activeLayerId !== null ? getLayerById(state.activeLayerId) : null;
  if (!active) {
    setStatus("请先选中一个活动图层");
    return;
  }
  if (!state.cropRect || state.cropRect.w < 1 || state.cropRect.h < 1) {
    setStatus("请先框选区域");
    return;
  }

  const targetW = Number(targetWInput.value);
  const targetH = Number(targetHInput.value);
  if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) {
    setStatus("目标尺寸无效");
    return;
  }

  const left = Math.max(state.cropRect.x, active.x);
  const top = Math.max(state.cropRect.y, active.y);
  const right = Math.min(state.cropRect.x + state.cropRect.w, active.x + active.width);
  const bottom = Math.min(state.cropRect.y + state.cropRect.h, active.y + active.height);

  const sw = Math.round(right - left);
  const sh = Math.round(bottom - top);
  if (sw <= 0 || sh <= 0) {
    setStatus("框选区域没有覆盖到活动图层");
    return;
  }

  const sx = Math.round(left - active.x);
  const sy = Math.round(top - active.y);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const cctx = canvas.getContext("2d");
  if (!cctx) {
    setStatus("创建图层失败：2D 上下文不可用");
    return;
  }

  const scale = Math.min(targetW / sw, targetH / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const dx = Math.floor((targetW - dw) / 2);
  const dy = Math.floor((targetH - dh) / 2);

  cctx.clearRect(0, 0, targetW, targetH);
  cctx.drawImage(active.image, sx, sy, sw, sh, dx, dy, dw, dh);

  const id = state.nextLayerId++;
  const newLayer: Layer = {
    id,
    name: `resized-${targetW}x${targetH}#${id}`,
    image: canvas,
    width: targetW,
    height: targetH,
    x: active.x + 24,
    y: active.y + 24,
  };

  state.layers.push(newLayer);
  state.activeLayerId = active.id;
  state.selectedLayerIds.clear();
  state.selectedLayerIds.add(active.id);

  refreshLayerList();
  render();
  setStatus(`已创建新图层: ${newLayer.name}，并保持原图层与框选状态`);
});

spreadBtn.addEventListener("click", () => {
  const selected = selectedLayersByOrder();
  const targets = selected.length > 0 ? selected : state.layers;
  if (targets.length === 0) {
    setStatus("没有可散开的图层");
    return;
  }

  const maxW = Math.max(...targets.map((l) => l.width));
  const maxH = Math.max(...targets.map((l) => l.height));
  const gap = 12;
  const cols = Math.max(1, Math.floor((stage.width + gap) / (maxW + gap)));

  for (let i = 0; i < targets.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    targets[i].x = col * (maxW + gap);
    targets[i].y = row * (maxH + gap);
  }

  refreshLayerList();
  render();
  setStatus(`已散开 ${targets.length} 个图层`);
});

alignHBtn.addEventListener("click", () => {
  const selected = selectedLayersByOrder();
  if (selected.length === 0) {
    setStatus("请先在图层列表勾选要排列的图层");
    return;
  }
  let x = 0;
  for (const layer of selected) {
    layer.x = x;
    layer.y = 0;
    x += layer.width;
  }
  refreshLayerList();
  render();
  setStatus(`已横向排列 ${selected.length} 个图层`);
});

alignVBtn.addEventListener("click", () => {
  const selected = selectedLayersByOrder();
  if (selected.length === 0) {
    setStatus("请先在图层列表勾选要排列的图层");
    return;
  }
  let y = 0;
  for (const layer of selected) {
    layer.x = 0;
    layer.y = y;
    y += layer.height;
  }
  refreshLayerList();
  render();
  setStatus(`已纵向排列 ${selected.length} 个图层`);
});

deleteBtn.addEventListener("click", () => {
  if (state.selectedLayerIds.size === 0) {
    setStatus("没有选中图层");
    return;
  }

  state.layers = state.layers.filter((layer) => !state.selectedLayerIds.has(layer.id));
  state.selectedLayerIds.clear();
  state.activeLayerId = null;
  state.cropRect = null;

  refreshLayerList();
  render();
  setStatus("已删除选中图层");
});

exportBtn.addEventListener("click", () => {
  const selected = selectedLayersByOrder();
  const layersToExport = selected.length > 0 ? selected : state.layers;
  if (layersToExport.length === 0) {
    setStatus("没有可导出的图层");
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const layer of layersToExport) {
    minX = Math.min(minX, layer.x);
    minY = Math.min(minY, layer.y);
    maxX = Math.max(maxX, layer.x + layer.width);
    maxY = Math.max(maxY, layer.y + layer.height);
  }

  const outW = Math.max(1, Math.ceil(maxX - minX));
  const outH = Math.max(1, Math.ceil(maxY - minY));

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;

  const octx = outCanvas.getContext("2d");
  if (!octx) {
    setStatus("导出失败：2D 上下文不可用");
    return;
  }

  for (const layer of layersToExport) {
    octx.drawImage(layer.image, layer.x - minX, layer.y - minY, layer.width, layer.height);
  }

  outCanvas.toBlob((blob) => {
    if (!blob) {
      setStatus("导出失败");
      return;
    }
    downloadBlob(blob, `sprite-export-${outW}x${outH}.png`);
    setStatus(`导出完成: ${outW}x${outH}`);
  }, "image/png");
});

window.addEventListener("keydown", (event: KeyboardEvent) => {
  const typing = isTypingTarget(event.target);
  const shortcut = eventToShortcut(event);

  if (state.capturingShortcutFor) {
    if (!shortcut) {
      return;
    }
    event.preventDefault();
    const editingAction = state.capturingShortcutFor;
    assignShortcut(editingAction, shortcut);
    state.capturingShortcutFor = null;
    renderShortcutEditor();
    refreshActionButtonLabels();
    const def = SHORTCUT_DEFS.find((d) => d.action === editingAction);
    const label = def ? def.label : editingAction;
    setStatus(`快捷键已更新：${label} -> ${normalizeShortcutString(shortcut)}`);
    return;
  }

  const selection = window.getSelection();
  const hasTextSelection = Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
  const clipboardAction = resolveGlobalClipboardAction({
    key: event.key,
    ctrlOrMeta: event.ctrlKey || event.metaKey,
    altKey: event.altKey,
    typing,
    hasTextSelection,
  });

  if (clipboardAction === "copyCropSelection") {
    event.preventDefault();
    copyCropBtn.click();
    return;
  }

  if (clipboardAction === "pasteCropSelection") {
    event.preventDefault();
    pasteCropBtn.click();
    return;
  }

  if (!typing && event.key === "Backspace") {
    event.preventDefault();
    const hasCrop = Boolean(state.cropRect && state.cropRect.w > 0 && state.cropRect.h > 0);
    if (hasCrop) {
      if (eraseActiveLayerCropContent()) {
        return;
      }
      setStatus("框选区域未覆盖活动图层，已取消删除");
      return;
    }
    if (state.selectedLayerIds.size > 0) {
      deleteBtn.click();
      return;
    }
  }

  if (!typing && shortcut) {
    const action = findActionByShortcut(shortcut);
    if (action) {
      event.preventDefault();
      triggerShortcutAction(action);
      return;
    }
  }

  if (typing || state.selectedLayerIds.size === 0) {
    return;
  }

  const step = event.shiftKey ? 10 : 1;
  let dx = 0;
  let dy = 0;

  if (event.key === "ArrowLeft") {
    dx = -step;
  } else if (event.key === "ArrowRight") {
    dx = step;
  } else if (event.key === "ArrowUp") {
    dy = -step;
  } else if (event.key === "ArrowDown") {
    dy = step;
  } else {
    return;
  }

  event.preventDefault();
  moveLayers(selectedLayersByOrder(), dx, dy);
  refreshLayerList();
  render();
  setStatus(`已移动 ${state.selectedLayerIds.size} 个图层 (${dx}, ${dy})`);
});

loadShortcutMap();
loadZoomModifier();
syncZoomModifierUI();
renderShortcutEditor();
refreshActionButtonLabels();
setStatus(`拖入图片开始编辑。滚轮平移，${zoomModifierLabel(state.zoomModifier)}+滚轮缩放；可在右侧快捷键设置中自定义按键。`);
refreshLayerList();
render();

restoreAiState()
  .then(() => {
    aiModeSelect.dispatchEvent(new Event("change"));
  })
  .catch(() => {
    refreshOutputDirStatus();
  });
