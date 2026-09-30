/**
 * Remotion entry point. `defaultProps.edl` below are hardcoded fixtures so
 * `bun run remotion:studio`/`remotion:render`/`remotion:benchmark` all work
 * out of the box on a fresh checkout -- per BUILD_PLAN.md Week 1-2
 * milestones. Replace with a real EDL loaded from the artifact store once
 * stage F (bind-edl) exists; never hand Remotion a hand-edited EDL object
 * in production code.
 *
 * Two compositions, deliberately different durations and content:
 * - MasterVideo (10s): exercises all three real graphic-first components
 *   (Week 5) in sequence -- StatCallout, LabeledDiagram, KenBurnsStill --
 *   so `remotion:studio`/`remotion:still` immediately shows real content,
 *   not a placeholder. Uses public/dev-placeholder-still.png (a small
 *   synthetic ffmpeg-generated test pattern, not production content) as
 *   KenBurnsStill's image, referenced via Remotion's own staticFile()
 *   helper -- NOT a Node `node:path`/`pathToFileURL` file:// URL. Found
 *   the hard way: Root.tsx (and anything it imports) gets bundled by
 *   Remotion's webpack build for the BROWSER context, which cannot
 *   resolve Node builtins at all ("UnhandledSchemeError: Reading from
 *   node:path is not handled by plugins") -- Remotion's public/ +
 *   staticFile() convention exists specifically to sidestep this.
 * - SoakTest3Min (3min): the Week 2 soak-test deliverable -- kept to a
 *   single cheap StatCallout scene stretched over the full duration,
 *   since its purpose is testing the render engine's stability over a
 *   long render, not exercising every component.
 */
import React from "react";
import { Composition, staticFile } from "remotion";
import { MasterVideo } from "./MasterVideo";
import { EdlSchema, PIPELINE_FPS, PIPELINE_WIDTH, PIPELINE_HEIGHT, type Edl } from "../../edl/schema";

const DEV_PLACEHOLDER_STILL = staticFile("dev-placeholder-still.png");

const baseIdentity = {
  palette: ["#0B1220", "#E8F1FF", "#FF4D2E"],
  typePair: ["Neue Haas Grotesk", "IBM Plex Mono"] as [string, string],
  motionMotif: "hello-world",
  lutId: "none",
  lutMix: 0,
  grainOpacity: 0,
};

const helloWorldEdl: Edl = EdlSchema.parse({
  schema: "yt16x9.edl.v1",
  videoId: "hello-world",
  identity: baseIdentity,
  audio: {},
  captions: { words: [] },
  visuals: [
    {
      sentenceId: "s0",
      kind: "graphic",
      component: "StatCallout",
      fromSec: 0,
      toSec: 3.33,
      props: { from: 0, to: 1234567, label: "MONTHLY ACTIVE USERS", countUpDurationSec: 1.5 },
    },
    {
      sentenceId: "s1",
      kind: "graphic",
      component: "LabeledDiagram",
      fromSec: 3.33,
      toSec: 6.66,
      props: { title: "How it works", nodes: [{ label: "Input" }, { label: "Process" }, { label: "Output" }] },
    },
    {
      sentenceId: "s2",
      kind: "still",
      component: "KenBurnsStill",
      assetUri: DEV_PLACEHOLDER_STILL,
      fromSec: 6.66,
      toSec: 10,
      props: { direction: "bottom-right", endScale: 1.2 },
    },
  ],
  render: { fps: PIPELINE_FPS, width: PIPELINE_WIDTH, height: PIPELINE_HEIGHT, durationInFrames: 10 * PIPELINE_FPS, tailPadFrames: 0 },
});

const soakTestEdl: Edl = EdlSchema.parse({
  schema: "yt16x9.edl.v1",
  videoId: "soak-test-3min",
  identity: baseIdentity,
  audio: {},
  captions: { words: [] },
  visuals: [
    {
      sentenceId: "s0",
      kind: "graphic",
      component: "StatCallout",
      fromSec: 0,
      toSec: 180,
      props: { from: 0, to: 100, label: "SOAK TEST", countUpDurationSec: 2 },
    },
  ],
  render: { fps: PIPELINE_FPS, width: PIPELINE_WIDTH, height: PIPELINE_HEIGHT, durationInFrames: 180 * PIPELINE_FPS, tailPadFrames: 0 },
});

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MasterVideo"
        component={MasterVideo}
        durationInFrames={helloWorldEdl.render.durationInFrames!}
        fps={PIPELINE_FPS}
        width={PIPELINE_WIDTH}
        height={PIPELINE_HEIGHT}
        defaultProps={{ edl: helloWorldEdl }}
      />
      <Composition
        id="SoakTest3Min"
        component={MasterVideo}
        durationInFrames={soakTestEdl.render.durationInFrames!}
        fps={PIPELINE_FPS}
        width={PIPELINE_WIDTH}
        height={PIPELINE_HEIGHT}
        defaultProps={{ edl: soakTestEdl }}
      />
    </>
  );
};
