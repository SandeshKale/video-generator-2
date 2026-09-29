/**
 * Remotion entry point. `defaultProps.edl` below are hardcoded fixtures so
 * `bun run remotion:studio`/`remotion:render`/`remotion:benchmark` all work
 * out of the box on a fresh checkout -- per BUILD_PLAN.md Week 1-2
 * milestones. Replace with a real EDL loaded from the artifact store once
 * stage F (bind-edl) exists; never hand Remotion a hand-edited EDL object
 * in production code.
 *
 * Two compositions, deliberately different durations:
 * - MasterVideo (10s): the default for quick studio/render iteration and
 *   for `remotion:benchmark` -- a benchmark should compare per-frame
 *   throughput across concurrency settings quickly, not re-render a full
 *   video every run.
 * - SoakTest3Min (3min): the Week 2 soak-test deliverable itself. Render
 *   this one in full (`bunx remotion render ... SoakTest3Min`) to prove no
 *   crashes/memory blowup over a longer render on real target hardware,
 *   per BUILD_PLAN.md section 5.9 ("benchmark real hardware before
 *   touching concurrency settings").
 */
import React from "react";
import { Composition } from "remotion";
import { MasterVideo } from "./MasterVideo";
import { EdlSchema, PIPELINE_FPS, PIPELINE_WIDTH, PIPELINE_HEIGHT, type Edl } from "../../edl/schema";

function makeFixtureEdl(videoId: string, durationSec: number): Edl {
  return EdlSchema.parse({
    schema: "yt16x9.edl.v1",
    videoId,
    identity: {
      palette: ["#0B1220", "#E8F1FF", "#FF4D2E"],
      typePair: ["Neue Haas Grotesk", "IBM Plex Mono"],
      motionMotif: "hello-world",
      lutId: "none",
      lutMix: 0,
      grainOpacity: 0,
    },
    audio: {},
    captions: { words: [] },
    visuals: [
      { sentenceId: "s0", kind: "graphic", component: "Placeholder", fromSec: 0, toSec: durationSec },
    ],
    render: { fps: PIPELINE_FPS, width: PIPELINE_WIDTH, height: PIPELINE_HEIGHT, durationInFrames: durationSec * PIPELINE_FPS, tailPadFrames: 0 },
  });
}

const helloWorldEdl = makeFixtureEdl("hello-world", 10);
const soakTestEdl = makeFixtureEdl("soak-test-3min", 180);

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
