import { describe, expect, it } from "vitest";
import {
  applyLayerResizeDrag,
  hitTestLayerResizeHandle,
  type LayerBox,
} from "../layer-transform";

describe("layer transform", () => {
  it("hits corner and edge resize handles", () => {
    const layer: LayerBox = { x: 100, y: 80, width: 120, height: 60 };
    expect(hitTestLayerResizeHandle({ x: 100, y: 80 }, layer, 8)).toBe("nw");
    expect(hitTestLayerResizeHandle({ x: 220, y: 110 }, layer, 8)).toBe("e");
  });

  it("resizes east handle freely without shift", () => {
    const next = applyLayerResizeDrag({
      start: { x: 100, y: 100, width: 80, height: 40 },
      handle: "e",
      deltaX: 30,
      deltaY: 999,
      keepAspect: false,
      minSize: 1,
    });

    expect(next.x).toBe(100);
    expect(next.width).toBe(110);
    expect(next.height).toBe(40);
  });

  it("keeps aspect ratio with corner drag when shift is pressed", () => {
    const next = applyLayerResizeDrag({
      start: { x: 50, y: 50, width: 120, height: 60 },
      handle: "se",
      deltaX: 30,
      deltaY: 2,
      keepAspect: true,
      minSize: 1,
    });

    expect(next.width / next.height).toBeCloseTo(2, 6);
  });

  it("prevents inversion and clamps to min size", () => {
    const next = applyLayerResizeDrag({
      start: { x: 40, y: 40, width: 50, height: 40 },
      handle: "w",
      deltaX: 100,
      deltaY: 0,
      keepAspect: false,
      minSize: 8,
    });

    expect(next.width).toBe(8);
    expect(next.x).toBe(82);
  });
});
