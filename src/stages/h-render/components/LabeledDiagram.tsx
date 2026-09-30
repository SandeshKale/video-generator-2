/**
 * A labeled node diagram with a sequential stagger reveal -- the
 * "mechanism" component (BUILD_PLAN.md section 2). Nodes lay out in a
 * single row/column (direction configurable) connected by a growing
 * line, each node driven by computeNodeRevealProgress/State (see
 * src/stages/h-render/motion/diagramReveal.ts for the tested math).
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import type { Identity } from "../../../edl/schema";
import { computeNodeRevealProgress, computeNodeRevealState } from "../motion/diagramReveal";

const NodeSchema = z.object({ label: z.string() });

export const LabeledDiagramPropsSchema = z.object({
  nodes: z.array(NodeSchema).min(2).max(6),
  layout: z.enum(["row", "column"]).default("row"),
  title: z.string().optional(),
});
export type LabeledDiagramProps = z.infer<typeof LabeledDiagramPropsSchema>;

export const LabeledDiagram: React.FC<{ props: unknown; identity: Identity }> = ({ props, identity }) => {
  const parsed = LabeledDiagramPropsSchema.parse(props);
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const isRow = parsed.layout === "row";

  return (
    <AbsoluteFill
      style={{
        background: identity.palette[0] ?? "#0B1220",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: identity.typePair[1],
      }}
    >
      {parsed.title ? (
        <div
          style={{
            fontSize: 48,
            color: identity.palette[1] ?? "#E8F1FF",
            marginBottom: 60,
            fontFamily: identity.typePair[0],
            fontWeight: 700,
            opacity: Math.min(1, frame / (0.3 * fps)),
            textShadow: "0 4px 12px rgba(0,0,0,.5)",
          }}
        >
          {parsed.title}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: isRow ? "row" : "column", alignItems: "center", gap: 0 }}>
        {parsed.nodes.map((node, i) => {
          const progress = computeNodeRevealProgress(frame, durationInFrames, i, parsed.nodes.length);
          const state = computeNodeRevealState(progress);
          const isLast = i === parsed.nodes.length - 1;

          // The connecting line grows using the NEXT node's own reveal
          // progress -- it arrives at the next node exactly as that node
          // finishes appearing, rather than as a disconnected decoration.
          const nextProgress = isLast ? 0 : computeNodeRevealProgress(frame, durationInFrames, i + 1, parsed.nodes.length);

          return (
            <React.Fragment key={i}>
              <div
                style={{
                  opacity: state.opacity,
                  transform: `translateY(${state.translateYPx}px) scale(${state.scale})`,
                  background: "rgba(255,255,255,0.06)",
                  border: `2px solid ${identity.palette[2] ?? "#FF4D2E"}`,
                  borderRadius: 12,
                  padding: "28px 36px",
                  fontSize: 34,
                  color: identity.palette[1] ?? "#E8F1FF",
                  fontWeight: 600,
                  textShadow: "0 2px 8px rgba(0,0,0,.5)",
                  minWidth: 180,
                  textAlign: "center",
                }}
              >
                {node.label}
              </div>
              {!isLast ? (
                <div
                  style={{
                    width: isRow ? 60 * nextProgress : 4,
                    height: isRow ? 4 : 60 * nextProgress,
                    background: identity.palette[2] ?? "#FF4D2E",
                    opacity: 0.8,
                  }}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
