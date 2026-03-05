import { describe, expect, it } from "vitest";
import {
  accumulateRotation,
  findRotateHandleIndex,
  pointInRotatedRect,
  rotatedRectIntersectsAabb,
  type RotatableRect,
} from "../crop-rotation";

function deg(value: number): number {
  return (value * Math.PI) / 180;
}

describe("crop-rotation geometry", () => {
  it("detects points inside and outside a rotated rect", () => {
    const rect: RotatableRect = { x: 100, y: 100, w: 80, h: 40, rotation: deg(30) };

    expect(pointInRotatedRect({ x: 140, y: 120 }, rect)).toBe(true);
    expect(pointInRotatedRect({ x: 60, y: 60 }, rect)).toBe(false);
  });

  it("hits corner rotate handle with radius", () => {
    const rect: RotatableRect = { x: 20, y: 30, w: 100, h: 60, rotation: 0 };
    const idx = findRotateHandleIndex({ x: 22, y: 32 }, rect, 8);
    expect(idx).not.toBeNull();
  });

  it("detects intersection with axis-aligned layer bounds", () => {
    const rect: RotatableRect = { x: 90, y: 80, w: 120, h: 60, rotation: deg(35) };

    expect(rotatedRectIntersectsAabb(rect, { x: 140, y: 100, w: 80, h: 50 })).toBe(true);
    expect(rotatedRectIntersectsAabb(rect, { x: 280, y: 200, w: 40, h: 30 })).toBe(false);
  });

  it("accumulates angle across -PI/PI boundary smoothly", () => {
    const start = deg(170);
    const current = deg(-170);

    const next = accumulateRotation(0, start, current);
    expect(next).toBeCloseTo(deg(20), 6);
  });
});
