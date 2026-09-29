/**
 * WhisperX-based forced alignment: recovers word-level timestamps from an
 * audio file + its transcript when a TTS provider's native timestamps are
 * unavailable or unreliable. This is the fallback path for the self-hosted
 * Voicebox/Chatterbox provider (src/stages/d-assets/tts.ts) -- Chatterbox
 * has no confirmed native alignment output as of this research -- and for
 * OpenAI TTS if it's ever used (it has no native timestamps at all).
 *
 * WhisperX (github.com/m-bain/whisperX) is a Python tool, not a TypeScript
 * library -- this wraps a subprocess call, the same pattern as
 * src/lib/ffmpeg.ts, rather than porting it. Requires a Python environment
 * with whisperx installed on the render box; NOT YET PROVISIONED OR TESTED
 * in this dev sandbox (no GPU, no Python audio stack here) -- verify the
 * exact CLI/JSON output shape against a real install before trusting the
 * parsing below.
 */
import type { z } from "zod";
import { WordSchema } from "../edl/schema";

type Word = z.infer<typeof WordSchema>;

export async function alignWithWhisperX(audioPath: string, transcript: string): Promise<Word[]> {
  throw new Error(
    `TODO Week 3: shell out to `+
      "`whisperx <audio> --align_model <model> --output_format json`" +
      ` (or call WhisperX's Python API directly via a small subprocess bridge) using "${audioPath}" ` +
      `as the audio and the known transcript ("${transcript.slice(0, 40)}${transcript.length > 40 ? "..." : ""}") ` +
      `as the reference text for forced alignment (not blind ASR -- we already know what was said), then ` +
      `map its per-word output into this file's { t0, t1, w } shape. Provision a Python env with whisperx ` +
      `installed on the actual render box first -- this dev sandbox has neither Python nor a GPU/CPU audio ` +
      `stack set up for it, so this has not been run against real output.`,
  );
}
