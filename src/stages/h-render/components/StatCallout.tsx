/**
 * A big animated number + label -- the component to reach for whenever a
 * script sentence names a specific number (BUILD_PLAN.md section 2's
 * originality lever: GRAPHIC over BROLL for a mechanism, number, or
 * comparison). Pure function of frame via computeCountUpValue -- see
 * src/stages/h-render/motion/countUp.ts for the tested math.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import type { Identity } from "../../../edl/schema";
import { computeCountUpValue, formatCountUpValue } from "../motion/countUp";
import { easeOutCubic, clamp01 } from "../motion/easing";

export const StatCalloutPropsSchema = z.object({
  from: z.number().default(0),
  to: z.number(),
  label: z.string(),
  decimals: z.number().int().min(0).max(4).default(0),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
  /** Seconds into the scene the count-up animation runs for -- the
   * remaining scene duration just holds the final value on screen. */
  countUpDurationSec: z.number().positive().default(1.5),
});
export type StatCalloutProps = z.infer<typeof StatCalloutPropsSchema>;

export const StatCallout: React.FC<{ props: unknown; identity: Identity }> = ({ props, identity }) => {
  const parsed = StatCalloutPropsSchema.parse(props);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const countUpDurationInFrames = parsed.countUpDurationSec * fps;
  const value = computeCountUpValue(frame, countUpDurationInFrames, parsed.from, parsed.to);
  const formatted = `${parsed.prefix}${formatCountUpValue(value, parsed.decimals)}${parsed.suffix}`;

  const entranceProgress = easeOutCubic(clamp01(frame / (0.3 * fps)));
  const labelOpacity = clamp01((frame - 0.15 * fps) / (0.3 * fps));

  return (
    <AbsoluteFill
      style={{
        background: identity.palette[0] ?? "#0B1220",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: identity.typePair[0],
      }}
    >
      <div
        style={{
          fontSize: 220,
          fontWeight: 700,
          color: identity.palette[2] ?? "#FF4D2E",
          letterSpacing: "-0.03em",
          lineHeight: 1,
          opacity: entranceProgress,
          transform: `scale(${0.85 + entranceProgress * 0.15})`,
          textShadow: "0 4px 12px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.8)",
        }}
      >
        {formatted}
      </div>
      <div
        style={{
          marginTop: 24,
          fontSize: 44,
          fontFamily: identity.typePair[1],
          color: identity.palette[1] ?? "#E8F1FF",
          opacity: labelOpacity,
          letterSpacing: "0.02em",
          textShadow: "0 2px 8px rgba(0,0,0,.5)",
        }}
      >
        {parsed.label}
      </div>
    </AbsoluteFill>
  );
};
