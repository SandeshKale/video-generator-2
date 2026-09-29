/**
 * Asset Normalization Layer (BUILD_PLAN.md section 3.7 / 5.7). Remotion
 * must composite, never transcode. Every stock clip and every TTS/SFX/music
 * file passes through here BEFORE it is referenced by an EDL. Pinned to
 * PIPELINE_FPS (30) -- see src/edl/schema.ts.
 */
import { runFfmpeg } from "../../lib/ffmpeg";
import { PIPELINE_FPS, PIPELINE_WIDTH, PIPELINE_HEIGHT } from "../../edl/schema";

export async function normalizeBroll(rawPath: string, outPath: string): Promise<void> {
  await runFfmpeg([
    "-i", rawPath,
    "-vf", `scale=${PIPELINE_WIDTH}:${PIPELINE_HEIGHT}:force_original_aspect_ratio=increase,crop=${PIPELINE_WIDTH}:${PIPELINE_HEIGHT},fps=${PIPELINE_FPS}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-g", String(PIPELINE_FPS * 2), // closed GOP, 2s
    "-an",
    outPath,
  ]);
}

/** CBR WAV -- never hand Remotion VBR audio. See BUILD_PLAN.md section 5.4
 * ("audio sync drift with VBR MP3 source audio" failure mode). */
export async function normalizeAudioToCbrWav(rawPath: string, outPath: string): Promise<void> {
  await runFfmpeg(["-i", rawPath, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outPath]);
}

/** CLI entry point: `bun run normalize -- <video|audio> <in> <out>`.
 * Week 2 deliverable (BUILD_PLAN.md section 9) -- this is the thing every
 * fetched B-roll/TTS/SFX/music file gets piped through before it's allowed
 * anywhere near an EDL. */
if (import.meta.main) {
  const [kind, inPath, outPath] = Bun.argv.slice(2);
  if (!kind || !inPath || !outPath || !["video", "audio"].includes(kind)) {
    console.error("Usage: bun run normalize -- <video|audio> <in> <out>");
    process.exit(1);
  }
  const fn = kind === "video" ? normalizeBroll : normalizeAudioToCbrWav;
  await fn(inPath, outPath);
  console.log(`Normalized ${kind}: ${inPath} -> ${outPath}`);
}
