/**
 * src/lib/anthropic.ts. No ANTHROPIC_API_KEY in this dev sandbox, so the
 * real network call is not exercised -- generateStructured() takes an
 * injectable client precisely so this can be tested against a fake
 * `.messages.parse` implementation instead of mocking global fetch (the
 * SDK does its own request signing/serialization internally, which a raw
 * fetch mock would have to reimplement).
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { generateStructured } from "../src/lib/anthropic";

describe("generateStructured", () => {
  test("returns parsed_output on success", async () => {
    const schema = z.object({ answer: z.number() });
    const fakeClient = {
      messages: {
        parse: (async () => ({ parsed_output: { answer: 4 }, stop_reason: "end_turn" })) as any,
      },
    };
    const result = await generateStructured(schema, { prompt: "what is 2+2" }, fakeClient);
    expect(result.answer).toBe(4);
  });

  test("passes model, prompt, and max_tokens through to the client", async () => {
    let capturedParams: any = null;
    const schema = z.object({ ok: z.boolean() });
    const fakeClient = {
      messages: {
        parse: (async (params: any) => {
          capturedParams = params;
          return { parsed_output: { ok: true }, stop_reason: "end_turn" };
        }) as any,
      },
    };
    await generateStructured(schema, { prompt: "hello", maxTokens: 500, system: "be terse" }, fakeClient);
    expect(capturedParams.model).toBe("claude-opus-5-5");
    expect(capturedParams.max_tokens).toBe(500);
    expect(capturedParams.system).toBe("be terse");
    expect(capturedParams.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  test("defaults max_tokens to 8000 when not specified", async () => {
    let capturedParams: any = null;
    const schema = z.object({ ok: z.boolean() });
    const fakeClient = {
      messages: {
        parse: (async (params: any) => {
          capturedParams = params;
          return { parsed_output: { ok: true }, stop_reason: "end_turn" };
        }) as any,
      },
    };
    await generateStructured(schema, { prompt: "hello" }, fakeClient);
    expect(capturedParams.max_tokens).toBe(8000);
  });

  test("throws a clear error when parsed_output is null (e.g. refusal or malformed output)", async () => {
    const schema = z.object({ answer: z.number() });
    const fakeClient = {
      messages: {
        parse: (async () => ({ parsed_output: null, stop_reason: "refusal" })) as any,
      },
    };
    await expect(generateStructured(schema, { prompt: "some prompt" }, fakeClient)).rejects.toThrow(/refusal/);
  });
});
