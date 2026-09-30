/**
 * Week 3 SRT writer (src/stages/e-normalize-mix/captions.ts's
 * groupWordsIntoCues / cuesToSrt / wordsToSrt). Pure functions, no
 * network/ffmpeg needed -- but still real contract tests, not just type
 * checks: known word timings in, exact expected SRT text out.
 */
import { describe, expect, test } from "bun:test";
import { groupWordsIntoCues, wordsToSrt } from "../src/stages/e-normalize-mix/captions";

function w(t0: number, t1: number, word: string) {
  return { t0, t1, w: word };
}

describe("groupWordsIntoCues", () => {
  test("keeps closely-timed words in one cue", () => {
    const words = [w(0, 0.2, "The"), w(0.25, 0.5, "quick"), w(0.55, 0.9, "fox")];
    const cues = groupWordsIntoCues(words);
    expect(cues.length).toBe(1);
    expect(cues[0]!.words.map((x) => x.w)).toEqual(["The", "quick", "fox"]);
    expect(cues[0]!.t0).toBe(0);
    expect(cues[0]!.t1).toBe(0.9);
  });

  test("splits on a sentence-break-sized silence gap", () => {
    const words = [w(0, 0.3, "Hello."), w(2.0, 2.3, "Goodbye.")]; // 1.7s gap
    const cues = groupWordsIntoCues(words, { sentenceBreakGapSec: 0.6 });
    expect(cues.length).toBe(2);
    expect(cues[0]!.words.map((x) => x.w)).toEqual(["Hello."]);
    expect(cues[1]!.words.map((x) => x.w)).toEqual(["Goodbye."]);
  });

  test("splits once the word-count cap is hit even with no gaps", () => {
    const words = Array.from({ length: 12 }, (_, i) => w(i * 0.3, i * 0.3 + 0.25, `w${i}`));
    const cues = groupWordsIntoCues(words, { maxWordsPerCue: 5, maxCueDurationSec: 999, sentenceBreakGapSec: 999 });
    expect(cues.length).toBe(3); // 5 + 5 + 2
    expect(cues[0]!.words.length).toBe(5);
    expect(cues[1]!.words.length).toBe(5);
    expect(cues[2]!.words.length).toBe(2);
  });

  test("splits once the duration cap is hit even with no gaps or word-count trigger", () => {
    // 1 word/second, cap at 3s -> a new cue should start on the 4th word
    const words = Array.from({ length: 8 }, (_, i) => w(i, i + 0.4, `w${i}`));
    const cues = groupWordsIntoCues(words, { maxWordsPerCue: 999, maxCueDurationSec: 3, sentenceBreakGapSec: 999 });
    for (const cue of cues) {
      expect(cue.t1 - cue.t0).toBeLessThanOrEqual(3.0001);
    }
    // and every word is accounted for exactly once, in order
    expect(cues.flatMap((c) => c.words.map((x) => x.w))).toEqual(words.map((x) => x.w));
  });

  test("empty input produces no cues", () => {
    expect(groupWordsIntoCues([])).toEqual([]);
  });
});

describe("wordsToSrt", () => {
  test("formats a single cue with correct SRT timestamp syntax", () => {
    const words = [w(0, 0.5, "Hi"), w(0.6, 1.234, "there")];
    const srt = wordsToSrt(words);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,234\nHi there\n");
  });

  test("formats hours/minutes correctly and zero-pads milliseconds", () => {
    // A single word spanning past the 1-hour, 1-minute mark, ending at a
    // sub-100ms millisecond value that must still render as 3 digits.
    const words = [w(3661.5, 3661.505, "late")];
    const srt = wordsToSrt(words);
    expect(srt).toContain("01:01:01,500 --> 01:01:01,505");
  });

  test("numbers cues sequentially with a blank line between them", () => {
    const words = [w(0, 0.3, "One."), w(2, 2.3, "Two.")];
    const srt = wordsToSrt(words, { sentenceBreakGapSec: 0.5 });
    const blocks = srt.trim().split("\n\n");
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.startsWith("1\n")).toBe(true);
    expect(blocks[1]!.startsWith("2\n")).toBe(true);
  });

  test("empty word list produces an empty string", () => {
    expect(wordsToSrt([])).toBe("");
  });
});
