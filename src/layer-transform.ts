export interface Point {
  x: number;
  y: number;
}

export interface LayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayerResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const HANDLE_ORDER: LayerResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function clamp(value: number, min: number): number {
  return Math.max(min, value);
}

export function getLayerResizeHandlePoints(layer: LayerBox): Record<LayerResizeHandle, Point> {
  const left = layer.x;
  const top = layer.y;
  const right = layer.x + layer.width;
  const bottom = layer.y + layer.height;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return {
    nw: { x: left, y: top },
    n: { x: cx, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: cy },
    se: { x: right, y: bottom },
    s: { x: cx, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: cy },
  };
}

export function hitTestLayerResizeHandle(point: Point, layer: LayerBox, radius: number): LayerResizeHandle | null {
  if (radius <= 0) {
    return null;
  }
  const threshold2 = radius * radius;
  const handles = getLayerResizeHandlePoints(layer);
  for (const handle of HANDLE_ORDER) {
    const target = handles[handle];
    const dx = point.x - target.x;
    const dy = point.y - target.y;
    if (dx * dx + dy * dy <= threshold2) {
      return handle;
    }
  }
  return null;
}

interface ResizeInput {
  start: LayerBox;
  handle: LayerResizeHandle;
  deltaX: number;
  deltaY: number;
  keepAspect: boolean;
  minSize: number;
}

interface MutableEdges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function startEdges(start: LayerBox): MutableEdges {
  return {
    left: start.x,
    right: start.x + start.width,
    top: start.y,
    bottom: start.y + start.height,
  };
}

function applyFreeformResize(input: ResizeInput): LayerBox {
  const edges = startEdges(input.start);

  if (input.handle.includes("w")) {
    edges.left += input.deltaX;
  }
  if (input.handle.includes("e")) {
    edges.right += input.deltaX;
  }
  if (input.handle.includes("n")) {
    edges.top += input.deltaY;
  }
  if (input.handle.includes("s")) {
    edges.bottom += input.deltaY;
  }

  const min = clamp(input.minSize, 1);
  if (edges.right - edges.left < min) {
    if (input.handle.includes("w") && !input.handle.includes("e")) {
      edges.left = edges.right - min;
    } else {
      edges.right = edges.left + min;
    }
  }

  if (edges.bottom - edges.top < min) {
    if (input.handle.includes("n") && !input.handle.includes("s")) {
      edges.top = edges.bottom - min;
    } else {
      edges.bottom = edges.top + min;
    }
  }

  return {
    x: edges.left,
    y: edges.top,
    width: edges.right - edges.left,
    height: edges.bottom - edges.top,
  };
}

function applyKeepAspectResize(input: ResizeInput): LayerBox {
  const min = clamp(input.minSize, 1);
  const ratio = input.start.width > 0 && input.start.height > 0
    ? input.start.width / input.start.height
    : 1;

  const left = input.start.x;
  const right = input.start.x + input.start.width;
  const top = input.start.y;
  const bottom = input.start.y + input.start.height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  if (input.handle === "e" || input.handle === "w") {
    const anchorX = input.handle === "e" ? left : right;
    const anchorY = centerY;
    const movedX = (input.handle === "e" ? right : left) + input.deltaX;
    let width = clamp(Math.abs(movedX - anchorX), min);
    let height = clamp(width / ratio, min);
    width = height * ratio;

    if (input.handle === "e") {
      return { x: anchorX, y: anchorY - height / 2, width, height };
    }
    return { x: anchorX - width, y: anchorY - height / 2, width, height };
  }

  if (input.handle === "n" || input.handle === "s") {
    const anchorY = input.handle === "s" ? top : bottom;
    const anchorX = centerX;
    const movedY = (input.handle === "s" ? bottom : top) + input.deltaY;
    let height = clamp(Math.abs(movedY - anchorY), min);
    let width = clamp(height * ratio, min);
    height = width / ratio;

    if (input.handle === "s") {
      return { x: anchorX - width / 2, y: anchorY, width, height };
    }
    return { x: anchorX - width / 2, y: anchorY - height, width, height };
  }

  const anchor = {
    x: input.handle.includes("w") ? right : left,
    y: input.handle.includes("n") ? bottom : top,
  };

  const moved = {
    x: (input.handle.includes("w") ? left : right) + input.deltaX,
    y: (input.handle.includes("n") ? top : bottom) + input.deltaY,
  };

  let width = Math.abs(moved.x - anchor.x);
  let height = Math.abs(moved.y - anchor.y);
  if (width < min && height < min) {
    width = min;
    height = min / ratio;
  }

  if (height <= 0 || width / Math.max(height, 1e-9) > ratio) {
    height = clamp(width / ratio, min);
    width = height * ratio;
  } else {
    width = clamp(height * ratio, min);
    height = width / ratio;
  }

  const outLeft = input.handle.includes("w") ? anchor.x - width : anchor.x;
  const outTop = input.handle.includes("n") ? anchor.y - height : anchor.y;
  return {
    x: outLeft,
    y: outTop,
    width,
    height,
  };
}

export function applyLayerResizeDrag(input: ResizeInput): LayerBox {
  if (!input.keepAspect) {
    return applyFreeformResize(input);
  }
  return applyKeepAspectResize(input);
}
