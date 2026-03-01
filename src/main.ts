import "./styles.css";

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

type ShortcutAction =
  | "toggleCropMode"
  | "clearCrop"
  | "createLayerFromCrop"
  | "setPresetCropRect"
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

const SHORTCUT_DEFS: ShortcutDef[] = [
  { action: "toggleCropMode", label: "开始/结束框选", defaultKey: "C" },
  { action: "clearCrop", label: "清除框选", defaultKey: "X" },
  { action: "createLayerFromCrop", label: "从框选生成新图层", defaultKey: "R" },
  { action: "setPresetCropRect", label: "一键创建框选", defaultKey: "B" },
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
const setCropRectBtn = mustGet<HTMLButtonElement>("setCropRectBtn");
const spreadBtn = mustGet<HTMLButtonElement>("spreadBtn");
const alignHBtn = mustGet<HTMLButtonElement>("alignHBtn");
const alignVBtn = mustGet<HTMLButtonElement>("alignVBtn");
const deleteBtn = mustGet<HTMLButtonElement>("deleteBtn");
const exportBtn = mustGet<HTMLButtonElement>("exportBtn");
const targetWInput = mustGet<HTMLInputElement>("targetW");
const targetHInput = mustGet<HTMLInputElement>("targetH");
const cropPresetWInput = mustGet<HTMLInputElement>("cropPresetW");
const cropPresetHInput = mustGet<HTMLInputElement>("cropPresetH");
const zoomModifierSelect = mustGet<HTMLSelectElement>("zoomModifierSelect");
const layerList = mustGet<HTMLUListElement>("layerList");
const shortcutList = mustGet<HTMLDivElement>("shortcutList");
const resetShortcutBtn = mustGet<HTMLButtonElement>("resetShortcutBtn");

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
  if (action === "setPresetCropRect") {
    setCropRectBtn.click();
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
  setCropRectBtn.textContent = `一键创建框选 (${shortcutText("setPresetCropRect")})`;
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
  const presetW = Number(cropPresetWInput.value);
  const presetH = Number(cropPresetHInput.value);
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
  state.activeLayerId = hit.id;

  if (event.shiftKey) {
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
