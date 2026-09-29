/**
 * BUILD_PLAN.md section 5.4. Voice provider is pluggable via the
 * VOICE_PROVIDER env var, default "voicebox":
 *
 * 1. voicebox (PRIMARY, $0 marginal cost) -- self-hosted Chatterbox
 *    (Resemble AI, MIT license) via Voicebox (github.com/jamiepine/
 *    voicebox, MIT, 56k stars), REST API at VOICEBOX_BASE_URL (default
 *    http://127.0.0.1:17493). Resemble's own (self-reported, not
 *    independently verified here) blind-eval claim: 63.75% of evaluators
 *    preferred Chatterbox over ElevenLabs. Chatterbox has no confirmed
 *    native word-timestamp output -- every Voicebox synthesis is run
 *    through alignWithWhisperX() (src/lib/whisperx.ts) rather than trusted
 *    to return usable alignment on its own. Trades API cost for owning an
 *    inference server (model downloads, uptime, compute contention with
 *    the Remotion render step) -- a real operational cost, not a free lunch.
 * 2. azure (FALLBACK) -- native WordBoundary events, no alignment pass
 *    needed. Switch to this if Voicebox/Chatterbox's self-hosted
 *    reliability or quality doesn't hold up in practice.
 * 3. elevenlabs (OPTIONAL UPGRADE, ~$0.45-0.90/video) -- eleven_v3's
 *    inline audio-tag expressiveness ([whispers], [excited], etc).
 *    Character-level alignment only, grouped via
 *    src/stages/e-normalize-mix/captions.ts's groupCharsIntoWords().
 *
 * Every provider returns the SAME shape below -- word-level timestamps --
 * so nothing downstream (captions, EDL binding) needs to know or care
 * which one ran. Always export/transcode the result to 48kHz 16-bit PCM
 * WAV (CBR) immediately -- never hand Remotion a VBR MP3 (see
 * normalizeAudioToCbrWav, src/stages/e-normalize-mix/normalize.ts).
 *
 * NOT YET RUN END TO END: this needs a running Voicebox server with the
 * Chatterbox model downloaded, which this dev sandbox doesn't have
 * provisioned (no GPU, no multi-GB model download path). Provision it on
 * the actual render box and verify the /generate request/response shape
 * against a real instance before trusting the TODO strings below -- they
 * are built from Voicebox's documented endpoint list, not a captured
 * live response.
 */
import type { z } from "zod";
import { WordSchema } from "../../edl/schema";
import { alignWithWhisperX } from "../../lib/whisperx";

type Word = z.infer<typeof WordSchema>;

export type VoiceSynthesisResult = { audioPath: string; words: Word[] };
export type VoiceProviderName = "voicebox" | "azure" | "elevenlabs";

export function getVoiceProvider(): VoiceProviderName {
  const p = (process.env.VOICE_PROVIDER ?? "voicebox").toLowerCase();
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

async function synthesizeWithAzure(_text: string, _voiceId?: string): Promise<VoiceSynthesisResult> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set");
  throw new Error(
    "TODO: Azure Speech SDK SpeechSynthesizer with a WordBoundary event handler -- AudioOffset " +
      "(100-ns units, divide by 10,000 for ms) + WordOffset give native word-level timing directly, " +
      "no grouping or forced-alignment step needed.",
  );
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
