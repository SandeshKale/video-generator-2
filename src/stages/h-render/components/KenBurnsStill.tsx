/**
 * Ken Burns pan/zoom on a normalized still image (Flux thumbnail/metaphor
 * frame, or a B-roll poster frame) -- BUILD_PLAN.md section 5.7: "Ken
 * Burns lives in Remotion on normalized stills, not as a separate
 * video-gen step." Pure function of frame via computeKenBurnsTransform
 * (src/stages/h-render/motion/kenBurns.ts, tested).
 */
import React from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import type { Identity } from "../../../edl/schema";
import { computeKenBurnsTransform, type KenBurnsDirection } from "../motion/kenBurns";

export const KenBurnsStillPropsSchema = z.object({
  direction: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]).default("center"),
  endScale: z.number().min(1).max(2).default(1.15),
});
export type KenBurnsStillProps = z.infer<typeof KenBurnsStillPropsSchema>;

export const KenBurnsStill: React.FC<{ assetUri?: string; props: unknown; identity: Identity }> = ({
  assetUri,
  props,
  identity,
}) => {
  const parsed = KenBurnsStillPropsSchema.parse(props);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const transform = computeKenBurnsTransform(frame, durationInFrames, {
    direction: parsed.direction as KenBurnsDirection,
    endScale: parsed.endScale,
  });

  if (!assetUri) {
    // Fail loud in the frame itself, not just a thrown exception buried
    // in a render log -- a preflight-stills reviewer should be able to
    // SEE that a still is missing, the same reasoning as GraphicScene's
    // old placeholder being deliberately obvious rather than silent.
    return (
      <AbsoluteFill style={{ background: "#3a0000", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 36 }}>
        KenBurnsStill: missing assetUri
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ background: identity.palette[0] ?? "#0B1220", overflow: "hidden" }}>
      <Img
        src={assetUri}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${transform.scale}) translate(${transform.translateXPct}%, ${transform.translateYPct}%)`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};
