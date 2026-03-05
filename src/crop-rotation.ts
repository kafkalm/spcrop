export interface Point {
  x: number;
  y: number;
}

export interface AxisRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RotatableRect extends AxisRect {
  rotation: number;
}

const EPSILON = 1e-6;

export function normalizeAngle(angle: number): number {
  const full = Math.PI * 2;
  let value = angle % full;
  if (value <= -Math.PI) {
    value += full;
  }
  if (value > Math.PI) {
    value -= full;
  }
  return value;
}

export function getRotatableRectCenter(rect: RotatableRect): Point {
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  };
}

export function rotatePointAroundCenter(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function getRotatedRectCorners(rect: RotatableRect): Point[] {
  const center = getRotatableRectCenter(rect);
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  return corners.map((point) => rotatePointAroundCenter(point, center, rect.rotation));
}

export function pointInRotatedRect(point: Point, rect: RotatableRect): boolean {
  if (rect.w <= 0 || rect.h <= 0) {
    return false;
  }
  const center = getRotatableRectCenter(rect);
  const local = rotatePointAroundCenter(point, center, -rect.rotation);
  return local.x >= rect.x - EPSILON
    && local.x <= rect.x + rect.w + EPSILON
    && local.y >= rect.y - EPSILON
    && local.y <= rect.y + rect.h + EPSILON;
}

export function findRotateHandleIndex(point: Point, rect: RotatableRect, handleRadius: number): number | null {
  if (handleRadius <= 0) {
    return null;
  }
  const corners = getRotatedRectCorners(rect);
  const threshold2 = handleRadius * handleRadius;
  for (let i = 0; i < corners.length; i++) {
    const dx = point.x - corners[i].x;
    const dy = point.y - corners[i].y;
    if (dx * dx + dy * dy <= threshold2) {
      return i;
    }
  }
  return null;
}

function pointInAxisRect(point: Point, rect: AxisRect): boolean {
  return point.x >= rect.x - EPSILON
    && point.x <= rect.x + rect.w + EPSILON
    && point.y >= rect.y - EPSILON
    && point.y <= rect.y + rect.h + EPSILON;
}

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < EPSILON) {
    return 0;
  }
  return value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return b.x <= Math.max(a.x, c.x) + EPSILON
    && b.x + EPSILON >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y) + EPSILON
    && b.y + EPSILON >= Math.min(a.y, c.y);
}

function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  if (o1 === 0 && onSegment(p1, p2, q1)) {
    return true;
  }
  if (o2 === 0 && onSegment(p1, q2, q1)) {
    return true;
  }
  if (o3 === 0 && onSegment(p2, p1, q2)) {
    return true;
  }
  if (o4 === 0 && onSegment(p2, q1, q2)) {
    return true;
  }

  return false;
}

export function rotatedRectIntersectsAabb(rect: RotatableRect, aabb: AxisRect): boolean {
  if (rect.w <= 0 || rect.h <= 0 || aabb.w <= 0 || aabb.h <= 0) {
    return false;
  }

  const rectCorners = getRotatedRectCorners(rect);
  const aabbCorners: Point[] = [
    { x: aabb.x, y: aabb.y },
    { x: aabb.x + aabb.w, y: aabb.y },
    { x: aabb.x + aabb.w, y: aabb.y + aabb.h },
    { x: aabb.x, y: aabb.y + aabb.h },
  ];

  if (rectCorners.some((point) => pointInAxisRect(point, aabb))) {
    return true;
  }
  if (aabbCorners.some((point) => pointInRotatedRect(point, rect))) {
    return true;
  }

  for (let i = 0; i < 4; i++) {
    const r1 = rectCorners[i];
    const r2 = rectCorners[(i + 1) % 4];
    for (let j = 0; j < 4; j++) {
      const a1 = aabbCorners[j];
      const a2 = aabbCorners[(j + 1) % 4];
      if (segmentsIntersect(r1, r2, a1, a2)) {
        return true;
      }
    }
  }

  return false;
}

export function accumulateRotation(previousRotation: number, previousPointerAngle: number, currentPointerAngle: number): number {
  const delta = normalizeAngle(currentPointerAngle - previousPointerAngle);
  return previousRotation + delta;
}
