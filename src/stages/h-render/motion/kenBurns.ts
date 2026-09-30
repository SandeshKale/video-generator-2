/**
 * Ken Burns pan/zoom for a still image (Flux stills or B-roll poster
 * frames), per BUILD_PLAN.md section 5.7 ("Ken Burns lives in Remotion on
 * normalized stills, not as a separate video-gen step"). Pure function of
 * (frame, fps, durationInFrames, opts) -- deterministic, no randomness in
 * the render path itself; the starting corner/direction is chosen once at
 * EDL-build time (see pickKenBurnsDirection) and baked into the EDL, not
 * re-randomized per frame or per render.
 */
import { clamp01, easeInOutCubic } from "./easing";

export type KenBurnsDirection = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export type KenBurnsTransform = { scale: number; translateXPct: number; translateYPct: number };

export type KenBurnsOptions = {
  /** Final zoom level at the end of the pan (1 = no zoom). */
  endScale?: number;
  direction?: KenBurnsDirection;
};

const DIRECTION_TARGETS: Record<KenBurnsDirection, { x: number; y: number }> = {
  "top-left": { x: -1, y: -1 },
  "top-right": { x: 1, y: -1 },
  "bottom-left": { x: -1, y: 1 },
  "bottom-right": { x: 1, y: 1 },
  center: { x: 0, y: 0 },
};

/** Returns a CSS-ready { scale, translateXPct, translateYPct } for the
 * given frame within a [0, durationInFrames) window. translateXPct/
 * translateYPct are percentages of the image's own size, intended for a
 * `transform: scale(...) translate(x%, y%)` -- the direction determines
 * which corner the image drifts toward as it slowly zooms in. */
export function computeKenBurnsTransform(
  frame: number,
  durationInFrames: number,
  opts: KenBurnsOptions = {},
): KenBurnsTransform {
  const { endScale = 1.15, direction = "center" } = opts;
  const progress = easeInOutCubic(durationInFrames > 0 ? clamp01(frame / durationInFrames) : 1);
  const target = DIRECTION_TARGETS[direction];

  const scale = 1 + (endScale - 1) * progress;
  // Drift is proportional to how much extra scale is available to pan
  // within -- at scale 1 there's no room to pan without showing empty
  // edges, so translate magnitude grows together with the zoom.
  const maxDriftPct = ((endScale - 1) / endScale) * 50;
  const translateXPct = target.x * maxDriftPct * progress;
  const translateYPct = target.y * maxDriftPct * progress;

  return { scale, translateXPct, translateYPct };
}

/** Deterministic direction picker keyed on a stable string (e.g. the
 * sentenceId or asset id) -- same input always picks the same direction,
 * so re-binding the same EDL twice doesn't silently reshuffle motion.
 * Not randomness in the render path; this runs once at EDL-build time. */
export function pickKenBurnsDirection(seedKey: string): KenBurnsDirection {
  const directions: KenBurnsDirection[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  return directions[hash % directions.length]!;
}
