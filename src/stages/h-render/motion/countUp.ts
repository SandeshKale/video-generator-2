/**
 * Animated stat/number reveal (the "specific named number" cue type --
 * BUILD_PLAN.md section 2's originality lever: reach for a real animated
 * stat over generic B-roll whenever the sentence names a number). Pure
 * function of (frame, durationInFrames, from, to).
 */
import { clamp01, easeOutCubic } from "./easing";

/** Eased count from `from` to `to` over [0, durationInFrames). Returns a
 * raw number -- callers decide formatting (decimals, "%", "x", commas). */
export function computeCountUpValue(frame: number, durationInFrames: number, from: number, to: number): number {
  const progress = easeOutCubic(durationInFrames > 0 ? clamp01(frame / durationInFrames) : 1);
  return from + (to - from) * progress;
}

/** Formats a count-up value for display: rounds to `decimals` places and
 * inserts thousands separators, so a StatCallout component doesn't each
 * reimplement this. Pure, locale-independent (always "," as the
 * thousands separator -- deliberate, not a formatting bug: this pipeline
 * has no i18n story yet, per BUILD_PLAN.md's script.language field being
 * unused beyond "en" so far). */
export function formatCountUpValue(value: number, decimals = 0): string {
  const rounded = Number(value.toFixed(decimals));
  const [intPart, decPart] = rounded.toFixed(decimals).split(".");
  const withSeparators = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart ? `${withSeparators}.${decPart}` : withSeparators;
}
