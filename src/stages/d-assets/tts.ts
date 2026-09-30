/**
 * BUILD_PLAN.md section 5.4. Voice provider is pluggable via the
 * VOICE_PROVIDER env var, default "azure" (changed from "voicebox" after
 * measuring real Chatterbox CPU performance -- see the benchmark below):
 *
 * 1. azure (DEFAULT) -- native WordBoundary events, no alignment pass
 *    needed, no self-hosting, ~$0.15-0.20 for a 10-minute script. The
 *    practical default absent a GPU render box.
 * 2. voicebox (GPU-ONLY, $0 marginal cost if you have a GPU) -- self-hosted
 *    Chatterbox (Resemble AI, MIT license) via Voicebox (github.com/
 *    jamiepine/voicebox, MIT, 56k stars), REST API at VOICEBOX_BASE_URL
 *    (default http://127.0.0.1:17493). **Measured directly** (2026-09-30,
 *    installing the underlying `chatterbox-tts` PyPI package straight from
 *    a clean venv, torch 2.14+cpu, 4 vCPU / 15GB sandbox, no GPU -- Voicebox
 *    is just a REST wrapper around this same library, so the finding
 *    transfers): model load ~20s (one-time per server lifetime), then
 *    **19.5s of CPU time to generate 5.24s of audio -- a 3.72x realtime
 *    factor**. Extrapolated to a 10-minute (600s) video script, that's
 *    **~37 minutes of CPU compute just for voice synthesis**, competing
 *    with the Remotion render step on the same box. Resemble's own "~200ms
 *    latency" marketing claim is real but is a GPU, short-utterance latency
 *    figure -- it says nothing about CPU throughput on a long script, which
 *    is the number that actually matters here. Disk footprint: ~1.8GB venv
 *    + ~3GB downloaded model weights (~4.8GB total). Also hit one real
 *    integration snag: current `torchaudio.save()` requires the optional
 *    `torchcodec` package; saving via `soundfile` directly instead works
 *    and avoids that dependency. Chatterbox has no confirmed native
 *    word-timestamp output either way -- every synthesis is run through
 *    `alignWithWhisperX()` (`src/lib/whisperx.ts`). **Only use this
 *    provider if the render box actually has a GPU** -- on CPU it is
 *    strictly worse than `azure` on every axis except dollar cost.
 * 3. elevenlabs (OPTIONAL UPGRADE, ~$0.45-0.90/video) -- eleven_v3's
 *    inline audio-tag expressiveness ([whispers], [excited], etc).
 *    Character-level alignment only, grouped via
 *    src/stages/e-normalize-mix/captions.ts's groupCharsIntoWords().
 *
 * Every provider returns the SAME shape below -- word-level timestamps --
 * so nothing downstream (captions, EDL binding) needs to know or care
 * which one ran. Always export/transcode the result to 48kHz 16-bit PCM
 * WAV (CBR) immediately -- never hand Remotion a VBR MP3 (see
 * normalizeAudioToCbrWav, src/stages/e-normalize-mix/normalize.ts); note
 * Chatterbox itself outputs 24kHz, so this resample step is not optional
 * for that provider the way it might look like for others.
 *
 * The Voicebox REST call itself (as opposed to the underlying Chatterbox
 * library, which WAS measured above) is still NOT run end to end -- verify
 * the exact /generate request/response shape against a real running
 * instance before trusting the TODO string below; it's built from
 * Voicebox's documented endpoint list, not a captured live response.
 */
import type { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { WordSchema } from "../../edl/schema";
import { alignWithWhisperX } from "../../lib/whisperx";

type Word = z.infer<typeof WordSchema>;

export type VoiceSynthesisResult = { audioPath: string; words: Word[] };
export type VoiceProviderName = "voicebox" | "azure" | "elevenlabs";

export function getVoiceProvider(): VoiceProviderName {
  const p = (process.env.VOICE_PROVIDER ?? "azure").toLowerCase();
  if (p !== "voicebox" && p !== "azure" && p !== "elevenlabs") {
    throw new Error(`Unknown VOICE_PROVIDER "${p}" -- must be one of: voicebox, azure, elevenlabs`);
  }
  return p;
}

export async function synthesizeVoice(text: string, voiceId?: string): Promise<VoiceSynthesisResult> {
  switch (getVoiceProvider()) {
    case "voicebox":
      return synthesizeWithVoicebox(text, voiceId);
    case "azure":
      return synthesizeWithAzure(text, voiceId);
    case "elevenlabs":
      return synthesizeWithElevenLabs(text, voiceId);
  }
}

async function synthesizeWithVoicebox(text: string, voiceId?: string): Promise<VoiceSynthesisResult> {
  const baseUrl = process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493";
  throw new Error(
    `TODO Week 3: POST ${baseUrl}/generate { engine: "chatterbox", text, voice: "${voiceId ?? "<profile>"}", ` +
      `exaggeration: <0-1> } -- confirm the exact response shape (raw audio bytes vs a saved-file path) ` +
      `against a real running instance, save the audio, then call alignWithWhisperX(audioPath, text) ` +
      `unconditionally to get word-level timestamps rather than trusting a native alignment field. ` +
      `Requires a Voicebox server (Docker Compose, github.com/jamiepine/voicebox) with the Chatterbox ` +
      `model already downloaded -- provision that on the render box, it is not available in this sandbox.`,
  );
}

/** Azure's WordBoundary event reports audioOffset/duration in "ticks"
 * (100-nanosecond units, confirmed against Microsoft's own SDK reference
 * docs for SpeechSynthesisWordBoundaryEventArgs) -- 10,000,000 ticks/sec.
 * Pulled out as a pure function so the conversion math has a unit test
 * independent of a live Azure credential/network call. */
export function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000;
}

async function synthesizeWithAzure(text: string, voiceId?: string): Promise<VoiceSynthesisResult> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set");

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisVoiceName = voiceId ?? "en-US-AvaMultilingualNeural";
  // Uncompressed PCM WAV straight from Azure -- avoids an extra lossy
  // decode/re-encode hop before normalizeAudioToCbrWav() resamples it to
  // the pipeline's 48kHz CBR spec. 24kHz is Azure's standard high-quality
  // Riff PCM rate; the resample step handles the rest either way.
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;

  const audioPath = join(tmpdir(), `azure-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  const audioConfig = sdk.AudioConfig.fromAudioFileOutput(audioPath);
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

  const words: Word[] = [];
  synthesizer.wordBoundary = (_sender, event) => {
    // Punctuation/sentence boundary events also fire on this same handler
    // -- only WordBoundary events correspond to actual spoken words.
    if (event.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) return;
    const t0 = ticksToSeconds(event.audioOffset);
    words.push({ t0, t1: t0 + ticksToSeconds(event.duration), w: event.text });
  };

  await new Promise<void>((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) resolve();
        else reject(new Error(`Azure TTS did not complete: reason=${result.reason} ${result.errorDetails ?? ""}`));
      },
      (err) => {
        synthesizer.close();
        reject(new Error(`Azure TTS error: ${err}`));
      },
    );
  });

  return { audioPath, words };
}

async function synthesizeWithElevenLabs(_text: string, voiceId?: string): Promise<VoiceSynthesisResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  throw new Error(
    `TODO: POST https://api.elevenlabs.io/v1/text-to-speech/${voiceId ?? "{voice_id}"}/with-timestamps ` +
      "with model_id eleven_v3 (or eleven_multilingual_v2), then groupCharsIntoWords() " +
      "(src/stages/e-normalize-mix/captions.ts) the character-level alignment it returns. Chunk long " +
      "scripts at paragraph boundaries if a single request degrades; stitch WAVs with 80-120ms room-tone " +
      "crossfades and offset the alignment of later chunks.",
  );
}
