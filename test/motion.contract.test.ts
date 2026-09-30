/**
 * The pure motion-math modules under src/stages/h-render/motion/ --
 * these drive every real GraphicScene component (Week 5). All pure
 * functions of frame, so fully unit-testable without React/Remotion at
 * all: boundary conditions (frame 0, frame = duration, frame past
 * duration), determinism (same input -> same output), and monotonicity
 * where it should hold.
 */
import { describe, expect, test } from "bun:test";
import { clamp01, easeInOutCubic, easeOutBack, easeOutCubic, frameProgress } from "../src/stages/h-render/motion/easing";
import { computeKenBurnsTransform, pickKenBurnsDirection } from "../src/stages/h-render/motion/kenBurns";
import { computeCountUpValue, formatCountUpValue } from "../src/stages/h-render/motion/countUp";
import { computeNodeRevealProgress, computeNodeRevealState } from "../src/stages/h-render/motion/diagramReveal";

describe("easing", () => {
  test("clamp01 clamps out-of-range input", () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(5)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });

  test("easeOutCubic starts at 0, ends at 1, monotonically increases", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.1) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test("easeInOutCubic starts at 0, ends at 1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  test("easeOutBack overshoots past 1 before settling (the 'tumble in' feel)", () => {
    let maxValue = 0;
    for (let t = 0; t <= 1; t += 0.02) maxValue = Math.max(maxValue, easeOutBack(t));
    expect(maxValue).toBeGreaterThan(1);
    expect(easeOutBack(1)).toBeCloseTo(1, 5);
  });

  test("frameProgress clamps before start and after the window", () => {
    expect(frameProgress(-10, 0, 30)).toBe(0);
    expect(frameProgress(0, 0, 30)).toBe(0);
    expect(frameProgress(15, 0, 30)).toBe(0.5);
    expect(frameProgress(30, 0, 30)).toBe(1);
    expect(frameProgress(100, 0, 30)).toBe(1);
  });

  test("frameProgress handles a zero-length window without dividing by zero", () => {
    expect(frameProgress(5, 0, 0)).toBe(1);
  });
});

describe("Ken Burns", () => {
  test("starts at scale 1 with no translation, ends at endScale with full drift", () => {
    const start = computeKenBurnsTransform(0, 100, { endScale: 1.2, direction: "bottom-right" });
    expect(start.scale).toBeCloseTo(1, 5);
    expect(start.translateXPct).toBeCloseTo(0, 5);
    expect(start.translateYPct).toBeCloseTo(0, 5);

    const end = computeKenBurnsTransform(100, 100, { endScale: 1.2, direction: "bottom-right" });
    expect(end.scale).toBeCloseTo(1.2, 5);
    expect(end.translateXPct).toBeGreaterThan(0);
    expect(end.translateYPct).toBeGreaterThan(0);
  });

  test("direction sign controls which way the image drifts", () => {
    const topLeft = computeKenBurnsTransform(100, 100, { direction: "top-left" });
    expect(topLeft.translateXPct).toBeLessThan(0);
    expect(topLeft.translateYPct).toBeLessThan(0);

    const center = computeKenBurnsTransform(100, 100, { direction: "center" });
    expect(center.translateXPct).toBe(0);
    expect(center.translateYPct).toBe(0);
  });

  test("handles a zero-length duration without dividing by zero", () => {
    const result = computeKenBurnsTransform(0, 0, { endScale: 1.3 });
    expect(Number.isNaN(result.scale)).toBe(false);
    expect(result.scale).toBeCloseTo(1.3, 5);
  });

  test("pickKenBurnsDirection is deterministic for the same key", () => {
    expect(pickKenBurnsDirection("scene-3-still-a")).toBe(pickKenBurnsDirection("scene-3-still-a"));
  });

  test("pickKenBurnsDirection never returns 'center' (reserved for an explicit static choice)", () => {
    for (const key of ["a", "b", "c", "some-longer-seed-key", "1234"]) {
      expect(pickKenBurnsDirection(key)).not.toBe("center");
    }
  });
});

describe("countUp", () => {
  test("starts at 'from', ends at 'to'", () => {
    expect(computeCountUpValue(0, 60, 0, 1000)).toBe(0);
    expect(computeCountUpValue(60, 60, 0, 1000)).toBe(1000);
  });

  test("works for a decreasing count (from > to)", () => {
    expect(computeCountUpValue(0, 60, 100, 0)).toBe(100);
    expect(computeCountUpValue(60, 60, 100, 0)).toBe(0);
  });

  test("formatCountUpValue inserts thousands separators", () => {
    expect(formatCountUpValue(1234567)).toBe("1,234,567");
    expect(formatCountUpValue(42)).toBe("42");
  });

  test("formatCountUpValue respects decimals", () => {
    expect(formatCountUpValue(1234.5678, 2)).toBe("1,234.57");
    expect(formatCountUpValue(9.999, 1)).toBe("10.0");
  });
});

describe("diagramReveal", () => {
  test("node 0 starts revealing before the last node in a multi-node sequence", () => {
    const durationInFrames = 90;
    const nodeCount = 3;
    const midFrame = 20;
    const first = computeNodeRevealProgress(midFrame, durationInFrames, 0, nodeCount);
    const last = computeNodeRevealProgress(midFrame, durationInFrames, nodeCount - 1, nodeCount);
    expect(first).toBeGreaterThan(last);
  });

  test("every node reaches full progress (1) by the end of the duration", () => {
    const durationInFrames = 90;
    const nodeCount = 4;
    for (let i = 0; i < nodeCount; i++) {
      expect(computeNodeRevealProgress(durationInFrames, durationInFrames, i, nodeCount)).toBe(1);
    }
  });

  test("a single-node sequence just tracks total progress linearly", () => {
    expect(computeNodeRevealProgress(30, 60, 0, 1)).toBe(0.5);
  });

  test("computeNodeRevealState: opacity and scale both increase monotonically with progress at coarse sample points", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map(computeNodeRevealState);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.opacity).toBeGreaterThanOrEqual(samples[i - 1]!.opacity);
    }
    expect(samples[0]!.scale).toBeLessThan(samples[samples.length - 1]!.scale);
    expect(samples[samples.length - 1]!.translateYPx).toBeCloseTo(0, 1);
  });
});
