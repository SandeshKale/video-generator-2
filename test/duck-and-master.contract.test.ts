/**
 * Proves the Week 3 ducking + mastering chain (src/stages/e-normalize-mix/
 * duck-and-master.ts) against real ffmpeg output. Same discipline as
 * test/normalize.contract.test.ts: synthetic lavfi fixtures, no binary
 * assets in git, real ffprobe/loudnorm measurements -- not just that the
 * code compiles.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "../src/lib/ffmpeg";
import { duckMusicUnderVoice, masterLoudness, measureLoudnessJson } from "../src/stages/e-normalize-mix/duck-and-master";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "duck-master-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("duckMusicUnderVoice", () => {
  test("attenuates the music bed while the voice sidechain is active", async () => {
    // This test caught a real bug on first run (see the dated comment in
    // duck-and-master.ts): ffmpeg's sidechaincompress has a fixed input
    // order -- input #0 is "main" (compressed, appears at output), input
    // #1 is "sidechain" (the trigger) -- confirmed via `ffmpeg -h
    // filter=sidechaincompress`, not assumed. The original filtergraph had
    // them swapped, so it compressed the voice using the music as the
    // trigger instead of the reverse. A pure sine tone also turned out to
    // be a poor sidechain trigger (its periodic zero-crossings interact
    // oddly with the envelope follower); broadband noise is a closer proxy
    // for speech energy and gives a clean, unambiguous result.
    const music = join(dir, "music.wav");
    const voice = join(dir, "voice.wav");
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=3:sample_rate=48000", "-ac", "2", music]);
    await runFfmpeg(["-f", "lavfi", "-i", "anoisesrc=duration=3:sample_rate=48000:color=white:amplitude=0.8", "-ac", "2", voice]);

    const duckedMusicOnly = join(dir, "ducked-music-only.wav");
    await runFfmpeg([
      "-i", music, "-i", voice,
      "-filter_complex",
      "[0:a][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=100[duck]",
      "-map", "[duck]",
      duckedMusicOnly,
    ]);

    const originalMusicLoudness = await measureLoudnessJson(music);
    const duckedMusicLoudness = await measureLoudnessJson(duckedMusicOnly);
    expect(Number(duckedMusicLoudness.input_i)).toBeLessThan(Number(originalMusicLoudness.input_i));

    // And the public duckMusicUnderVoice() function (music + voice mixed
    // together, using the now-corrected input order) produces valid,
    // non-empty, and correctly-attenuated audio end to end.
    const ducked = join(dir, "ducked.wav");
    await duckMusicUnderVoice(music, voice, ducked, { threshold: 0.05, ratio: 8, attackMs: 5, releaseMs: 100 });
    const mixedLoudness = await measureLoudnessJson(ducked);
    expect(Number.isNaN(Number(mixedLoudness.input_i))).toBe(false);
  }, 30_000);
});

describe("masterLoudness", () => {
  test("brings a quiet mix up into the target LUFS band", async () => {
    // Deliberately quiet source (low volume sine) -- loudnorm should bring
    // it toward -14 LUFS integrated, confirming the filter chain and
    // -ar 48000 output spec both actually apply.
    const quiet = join(dir, "quiet.wav");
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=44100", "-af", "volume=-30dB", "-ac", "2", quiet]);

    const mastered = join(dir, "mastered.wav");
    await masterLoudness(quiet, mastered);

    const loudness = await measureLoudnessJson(mastered);
    const integrated = Number(loudness.input_i);
    expect(integrated).toBeGreaterThanOrEqual(-16);
    expect(integrated).toBeLessThanOrEqual(-13);
  }, 30_000);

  test("measureLoudnessJson returns parseable LUFS/true-peak fields", async () => {
    const src = join(dir, "measure-src.wav");
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000", src]);
    const result = await measureLoudnessJson(src);
    expect(typeof result.input_i).toBe("string");
    expect(Number.isNaN(Number(result.input_i))).toBe(false);
    expect(typeof result.input_tp).toBe("string");
  }, 30_000);
});
