/**
 * Proves the Week 2 normalization layer (src/stages/e-normalize-mix/normalize.ts)
 * against real ffmpeg output, not just that the code compiles. Fixtures are
 * generated on the fly with ffmpeg's lavfi synthetic sources (testsrc/sine)
 * so this test has no binary assets checked into git and runs anywhere
 * ffmpeg/ffprobe are installed -- see BUILD_PLAN.md section 10 ("no test,
 * no production-ready").
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeAudioToCbrWav, normalizeBroll } from "../src/stages/e-normalize-mix/normalize";
import { runFfmpeg, runFfprobeJson } from "../src/lib/ffmpeg";
import { PIPELINE_FPS, PIPELINE_WIDTH, PIPELINE_HEIGHT } from "../src/edl/schema";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "normalize-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("normalizeBroll", () => {
  test("re-encodes an arbitrary-resolution/fps clip to the pipeline's fixed 1920x1080 CFR spec", async () => {
    // A deliberately "wrong" source: 640x480 @ 24fps -- exactly the kind of
    // off-spec stock clip this layer exists to catch before it reaches Remotion.
    const raw = join(dir, "raw.mp4");
    await runFfmpeg([
      "-f", "lavfi", "-i", "testsrc=size=640x480:rate=24:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      raw,
    ]);

    const out = join(dir, "normalized.mp4");
    await normalizeBroll(raw, out);

    const probe = await runFfprobeJson(["-show_streams", out]);
    const v = probe.streams.find((s: any) => s.codec_type === "video");
    expect(v.width).toBe(PIPELINE_WIDTH);
    expect(v.height).toBe(PIPELINE_HEIGHT);
    expect(v.r_frame_rate).toBe(`${PIPELINE_FPS}/1`);
    expect(v.codec_name).toBe("h264");
    expect(v.pix_fmt).toBe("yuv420p");
  }, 30_000);
});

describe("normalizeAudioToCbrWav", () => {
  test("re-encodes arbitrary-rate audio to 48kHz 16-bit CBR PCM WAV", async () => {
    // 22050Hz mono -- an off-spec source, same idea as the video case above.
    const raw = join(dir, "raw.mp3");
    await runFfmpeg([
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=22050",
      "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k",
      raw,
    ]);

    const out = join(dir, "normalized.wav");
    await normalizeAudioToCbrWav(raw, out);

    const probe = await runFfprobeJson(["-show_streams", out]);
    const a = probe.streams.find((s: any) => s.codec_type === "audio");
    expect(a.sample_rate).toBe("48000");
    expect(a.channels).toBe(2);
    expect(a.codec_name).toBe("pcm_s16le");
  }, 30_000);
});
