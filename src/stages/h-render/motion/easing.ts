/**
 * Pure easing functions shared by every motion module under
 * src/stages/h-render/motion/. All take a progress value in [0,1] and
 * return an eased value, also clamped implicitly by their own math --
 * never a source of NaN/out-of-range output for in-range input, which
 * matters here because every caller feeds these straight into a CSS
 * transform inside a MasterVideo render pass (BUILD_PLAN.md's "pure
 * function of frame" invariant -- an easing bug is a visible per-frame
 * glitch, not a silent one).
 */

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

export function easeInOutCubic(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export function easeOutBack(t: number, overshoot = 1.70158): number {
  const c = clamp01(t);
  const c1 = overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

/** Maps a frame position onto a [0,1] progress value over a window of
 * `durationInFrames`, starting at `startFrame`. Frames before the window
 * return 0, frames after return 1 -- a deterministic clamp, not an
 * exception, since a caller passing an out-of-window frame is a normal
 * occurrence (e.g. checking progress for a scene outside its own Sequence). */
export function frameProgress(frame: number, startFrame: number, durationInFrames: number): number {
  if (durationInFrames <= 0) return 1;
  return clamp01((frame - startFrame) / durationInFrames);
}
