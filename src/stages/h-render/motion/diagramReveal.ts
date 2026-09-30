/**
 * Sequential stagger-reveal for a labeled diagram's nodes/edges -- the
 * "mechanism" cue type (BUILD_PLAN.md section 2's originality lever:
 * GRAPHIC over BROLL whenever the sentence describes a mechanism or
 * comparison). Pure function of (frame, durationInFrames, nodeIndex,
 * nodeCount).
 */
import { clamp01, easeOutBack } from "./easing";

export type NodeRevealState = { opacity: number; translateYPx: number; scale: number };

/** Each node gets an equal-width, slightly-overlapping reveal window
 * within the total duration -- `overlapFraction` controls how much
 * consecutive nodes' windows overlap (0 = strictly sequential/one-at-a-
 * time, close to 1 = nearly simultaneous). A `connectingLine` component
 * can read the same progress value to animate a line growing toward the
 * next node in lockstep. */
export function computeNodeRevealProgress(
  frame: number,
  durationInFrames: number,
  nodeIndex: number,
  nodeCount: number,
  overlapFraction = 0.4,
): number {
  if (nodeCount <= 0) return 1;
  if (nodeCount === 1) return clamp01(durationInFrames > 0 ? frame / durationInFrames : 1);

  const windowSpan = 1 / (nodeCount - (nodeCount - 1) * overlapFraction);
  const windowStep = windowSpan * (1 - overlapFraction);
  const windowStart = nodeIndex * windowStep;

  const totalProgress = durationInFrames > 0 ? frame / durationInFrames : 1;
  const localProgress = (totalProgress - windowStart) / windowSpan;
  return clamp01(localProgress);
}

export function computeNodeRevealState(progress: number): NodeRevealState {
  const eased = easeOutBack(progress);
  return {
    opacity: clamp01(progress * 2), // opacity ramps in the first half of the window, faster than the overshoot settles
    translateYPx: (1 - eased) * 24,
    scale: 0.85 + eased * 0.15,
  };
}
