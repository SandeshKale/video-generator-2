/**
 * The parts of src/stages/d-assets/tts.ts that don't need a live network
 * call/credentials: getVoiceProvider()'s validation and default, and the
 * ticksToSeconds() conversion used to turn Azure's WordBoundary event
 * offsets (100-nanosecond "ticks", confirmed against Microsoft's own SDK
 * reference docs) into the pipeline's seconds-based Word timing. The live
 * Azure/Voicebox/ElevenLabs network calls themselves are NOT exercised
 * here -- no credentials in this environment -- see BUILD_PLAN.md section
 * 5.4 for what has and hasn't been verified end to end.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getVoiceProvider, ticksToSeconds } from "../src/stages/d-assets/tts";

describe("ticksToSeconds", () => {
  test("converts Azure's 100ns tick units to seconds", () => {
    expect(ticksToSeconds(10_000_000)).toBe(1); // 1 second
    expect(ticksToSeconds(5_000_000)).toBe(0.5);
    expect(ticksToSeconds(0)).toBe(0);
  });
});

describe("getVoiceProvider", () => {
  const originalEnv = process.env.VOICE_PROVIDER;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VOICE_PROVIDER;
    else process.env.VOICE_PROVIDER = originalEnv;
  });

  test("defaults to azure when VOICE_PROVIDER is unset", () => {
    delete process.env.VOICE_PROVIDER;
    expect(getVoiceProvider()).toBe("azure");
  });

  test("accepts voicebox and elevenlabs explicitly", () => {
    process.env.VOICE_PROVIDER = "voicebox";
    expect(getVoiceProvider()).toBe("voicebox");
    process.env.VOICE_PROVIDER = "elevenlabs";
    expect(getVoiceProvider()).toBe("elevenlabs");
  });

  test("is case-insensitive", () => {
    process.env.VOICE_PROVIDER = "AZURE";
    expect(getVoiceProvider()).toBe("azure");
  });

  test("rejects an unknown provider name", () => {
    process.env.VOICE_PROVIDER = "not-a-real-provider";
    expect(() => getVoiceProvider()).toThrow(/Unknown VOICE_PROVIDER/);
  });
});
