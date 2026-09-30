/**
 * Dispatches a visuals[] entry to one of the real graphic-first components
 * (BUILD_PLAN.md section 2) by `visual.component` name. Three real
 * components as of Week 5: StatCallout, LabeledDiagram, KenBurnsStill --
 * more can be added the same way as new scene types are needed. An
 * unknown/missing component name fails LOUD in the rendered frame itself
 * (not just a thrown exception in a log) so a preflight-stills reviewer
 * can see it immediately, same reasoning KenBurnsStill applies to a
 * missing assetUri.
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import type { z } from "zod";
import type { Identity, VisualSchema } from "../../../edl/schema";
import { StatCallout } from "./StatCallout";
import { LabeledDiagram } from "./LabeledDiagram";
import { KenBurnsStill } from "./KenBurnsStill";

type Visual = z.infer<typeof VisualSchema>;

const COMPONENTS: Record<string, React.FC<{ assetUri?: string; props: unknown; identity: Identity }>> = {
  StatCallout: ({ props, identity }) => <StatCallout props={props} identity={identity} />,
  LabeledDiagram: ({ props, identity }) => <LabeledDiagram props={props} identity={identity} />,
  KenBurnsStill: ({ assetUri, props, identity }) => <KenBurnsStill assetUri={assetUri} props={props} identity={identity} />,
};

export const GraphicScene: React.FC<{ visual: Visual; identity: Identity }> = ({ visual, identity }) => {
  const Component = visual.component ? COMPONENTS[visual.component] : undefined;

  if (!Component) {
    return (
      <AbsoluteFill
        style={{
          background: "#3a0000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 36,
          fontFamily: "monospace",
          textAlign: "center",
          padding: 60,
        }}
      >
        GraphicScene: unknown component "{visual.component ?? "(none)"}" — expected one of: {Object.keys(COMPONENTS).join(", ")}
      </AbsoluteFill>
    );
  }

  return <Component assetUri={visual.assetUri} props={visual.props ?? {}} identity={identity} />;
};
