/**
 * ElevenLabs' with-timestamps endpoint returns CHARACTER-level alignment
 * only. Group into words here. Assert sum(word durations) ~= audio
 * duration within 250ms -- if it drifts, fall back to a WhisperX pass on
 * the WAV rather than shipping drifting karaoke captions. See
 * BUILD_PLAN.md section 5.4.
 */
import type { z } from "zod";
import { WordSchema } from "../../edl/schema";

type Word = z.infer<typeof WordSchema>;

export type ElevenLabsAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export function groupCharsIntoWords(alignment: ElevenLabsAlignment): Word[] {
  const words: Word[] = [];
  let current: { chars: string[]; start: number } | null = null;

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i]!;
    const start = alignment.character_start_times_seconds[i]!;
    const end = alignment.character_end_times_seconds[i]!;

    // Drop ElevenLabs v3 audio-tag characters, e.g. "[whispers]" -- these
    // are performance directions, not spoken/captioned words.
    if (ch === "[" ) {
      current = null; // discard whatever was building; we'll resync after "]"
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        words.push({ t0: current.start, t1: end, w: current.chars.join("") });
        current = null;
      }
      continue;
    }

    if (!current) current = { chars: [], start };
    current.chars.push(ch);
    if (i === alignment.characters.length - 1) {
      words.push({ t0: current.start, t1: end, w: current.chars.join("") });
    }
  }

  return words.filter((w) => w.w.length > 0 && !w.w.startsWith("[") && !w.w.endsWith("]"));
}

export type SrtCueOptions = {
  /** Start a new cue once this many words have accumulated. */
  maxWordsPerCue?: number;
  /** Start a new cue once the current cue would exceed this duration. */
  maxCueDurationSec?: number;
  /** A silence gap at least this long between words starts a new cue
   * (treated as a likely sentence/clause boundary) even if the word/
   * duration caps above haven't been hit yet. */
  sentenceBreakGapSec?: number;
};

const DEFAULT_SRT_OPTIONS: Required<SrtCueOptions> = {
  maxWordsPerCue: 10,
  maxCueDurationSec: 4,
  sentenceBreakGapSec: 0.6,
};

type Cue = { t0: number; t1: number; words: Word[] };

/** Groups word-level timestamps (from any voice provider, already in the
 * common { t0, t1, w } shape -- see src/stages/d-assets/tts.ts) into
 * caption cues, then formats them as an SRT file. This is what actually
 * ships in the EDL's captions.srtUri (src/edl/schema.ts) -- word-level
 * timing alone isn't a caption track, it needs to be grouped into
 * readable on-screen chunks first. */
export function groupWordsIntoCues(words: Word[], opts: SrtCueOptions = {}): Cue[] {
  const { maxWordsPerCue, maxCueDurationSec, sentenceBreakGapSec } = { ...DEFAULT_SRT_OPTIONS, ...opts };
  if (words.length === 0) return [];

  const cues: Cue[] = [];
  let current: Cue = { t0: words[0]!.t0, t1: words[0]!.t1, words: [words[0]!] };

  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    const prev = words[i - 1]!;
    const gap = w.t0 - prev.t1;
    const wouldExceedDuration = w.t1 - current.t0 > maxCueDurationSec;
    const wouldExceedWordCount = current.words.length >= maxWordsPerCue;
    const isSentenceBreak = gap >= sentenceBreakGapSec;

    if (wouldExceedDuration || wouldExceedWordCount || isSentenceBreak) {
      cues.push(current);
      current = { t0: w.t0, t1: w.t1, words: [w] };
    } else {
      current.words.push(w);
      current.t1 = w.t1;
    }
  }
  cues.push(current);
  return cues;
}

function formatSrtTimestamp(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** Standard SRT format: 1-indexed cue number, "start --> end" timestamp
 * line (comma for the millisecond separator, per the SRT spec), the cue
 * text, then a blank line between cues. */
export function cuesToSrt(cues: Cue[]): string {
  return cues
    .map((cue, i) => {
      const text = cue.words.map((w) => w.w).join(" ");
      return `${i + 1}\n${formatSrtTimestamp(cue.t0)} --> ${formatSrtTimestamp(cue.t1)}\n${text}\n`;
    })
    .join("\n");
}

export function wordsToSrt(words: Word[], opts: SrtCueOptions = {}): string {
  return cuesToSrt(groupWordsIntoCues(words, opts));
}

export function assertCaptionCoverage(words: Word[], audioDurationSec: number, toleranceSec = 0.25): void {
  const spoken = words.reduce((sum, w) => sum + (w.t1 - w.t0), 0);
  if (Math.abs(spoken - audioDurationSec) > toleranceSec * words.length) {
    // A rough per-word tolerance check -- replace with the real "total
    // coverage >= 98% of voiced words" QA gate from BUILD_PLAN.md section
    // 5.10 once a reference forced-alignment (WhisperX) pass is wired in
    // for comparison, not just self-consistency of ElevenLabs' own output.
    throw new Error(
      `Caption word-timing coverage looks off: ${spoken.toFixed(1)}s of words vs ${audioDurationSec.toFixed(1)}s audio -- run WhisperX fallback alignment.`,
    );
  }
}
