/**
 * src/stages/c-script/script.ts. Two kinds of real coverage, same split
 * as test/stills.contract.test.ts: (1) the prompt builders are pure
 * functions, tested directly for the constraints they must convey (cue
 * vocabulary, provenance rules, no-repeat context); (2) generateScriptChunked's
 * orchestration (outline -> hook -> per-chapter with growing context ->
 * payoff -> consistency pass -> id assignment) is tested against a fake
 * Anthropic client that returns canned per-call responses, since there is
 * no ANTHROPIC_API_KEY in this dev sandbox to exercise the real call.
 */
import { describe, expect, test } from "bun:test";
import {
  buildChapterPrompt,
  buildHookPrompt,
  buildOutlinePrompt,
  buildPayoffPrompt,
  generateScriptChunked,
  runGlobalConsistencyPass,
  type Outline,
  type SentenceDraft,
} from "../src/stages/c-script/script";
import type { Brief } from "../src/stages/a-research/research";

const brief: Brief = {
  workingTitle: "Why servers hum",
  audience: "curious generalists",
  sources: ["https://example.com/a", "https://example.com/b"],
  standByClaims: [{ text: "Data centers use ~1-2% of global electricity", source: "https://example.com/a" }],
};

describe("prompt builders", () => {
  test("buildOutlinePrompt includes the brief and asks for a hook/chapters/payoff shape", () => {
    const prompt = buildOutlinePrompt(brief);
    expect(prompt).toContain("Why servers hum");
    expect(prompt).toContain("curious generalists");
    expect(prompt).toContain("hook idea");
  });

  test("buildHookPrompt conveys the cue vocabulary and provenance rules", () => {
    const outline: Outline = { hookIdea: "servers get surprisingly loud", chapters: [], payoffIdea: "x" };
    const prompt = buildHookPrompt(brief, outline);
    expect(prompt).toContain("GRAPHIC");
    expect(prompt).toContain("BROLL");
    expect(prompt).toContain("GAP");
  });

  test("buildChapterPrompt lists prior sentences so the model doesn't repeat them", () => {
    const outline: Outline = { hookIdea: "x", chapters: [{ label: "Cooling", beats: ["fans", "liquid cooling"] }], payoffIdea: "y" };
    const prior: SentenceDraft[] = [{ text: "Servers hum surprisingly loud.", provenance: "STAGE", cue: { visual: "BROLL" } }];
    const prompt = buildChapterPrompt(brief, outline, outline.chapters[0]!, prior);
    expect(prompt).toContain("Servers hum surprisingly loud.");
    expect(prompt).toContain("fans");
    expect(prompt).toContain("liquid cooling");
    expect(prompt).toContain("do not repeat");
  });

  test("buildPayoffPrompt includes the payoff idea and prior sentences", () => {
    const outline: Outline = { hookIdea: "x", chapters: [], payoffIdea: "cooling is an underrated engineering problem" };
    const prompt = buildPayoffPrompt(brief, outline, []);
    expect(prompt).toContain("cooling is an underrated engineering problem");
  });
});

function fakeClient(responses: unknown[]) {
  let call = 0;
  return {
    messages: {
      parse: (async () => {
        const parsed_output = responses[call];
        call++;
        return { parsed_output, stop_reason: "end_turn" };
      }) as any,
    },
  };
}

describe("generateScriptChunked", () => {
  test("threads outline -> hook -> per-chapter -> payoff -> consistency pass, assigning sequential ids", async () => {
    const outline: Outline = {
      hookIdea: "hook",
      chapters: [
        { label: "Chapter 1", beats: ["beat"] },
        { label: "Chapter 2", beats: ["beat"] },
      ],
      payoffIdea: "payoff",
    };
    const hook = { sentences: [{ text: "Hook sentence.", provenance: "STAGE", cue: { visual: "TEXTPOP" } }] };
    const ch1 = { sentences: [{ text: "Chapter 1 sentence.", provenance: "FACT", source: "https://example.com/a", cue: { visual: "GRAPHIC" } }] };
    const ch2 = { sentences: [{ text: "Chapter 2 sentence.", provenance: "STAGE", cue: { visual: "BROLL" } }] };
    const payoff = { sentences: [{ text: "Payoff sentence.", provenance: "STAGE", cue: { visual: "CUT" } }] };
    const consistency = {
      sentences: [
        { text: "Hook sentence, revised.", provenance: "GAP", cue: { visual: "SFX" } }, // provenance/cue.visual overrides should be ignored
        { text: "Chapter 1 sentence, revised.", provenance: "GAP", cue: { visual: "STILL" } },
        { text: "Chapter 2 sentence, revised.", provenance: "GAP", cue: { visual: "STILL" } },
        { text: "Payoff sentence, revised.", provenance: "GAP", cue: { visual: "STILL" } },
      ],
    };

    const client = fakeClient([{ ...outline }, hook, ch1, ch2, payoff, consistency]);
    const result = await generateScriptChunked(brief, client);

    expect(result.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(result.map((s) => s.text)).toEqual([
      "Hook sentence, revised.",
      "Chapter 1 sentence, revised.",
      "Chapter 2 sentence, revised.",
      "Payoff sentence, revised.",
    ]);
    // Consistency pass may only reword -- provenance and cue.visual must
    // come from the ORIGINAL drafts, never from what the reword call sent back.
    expect(result.map((s) => s.provenance)).toEqual(["STAGE", "FACT", "STAGE", "STAGE"]);
    expect(result.map((s) => s.cue.visual)).toEqual(["TEXTPOP", "GRAPHIC", "BROLL", "CUT"]);
  });
});

describe("runGlobalConsistencyPass", () => {
  test("throws if the consistency pass changes the sentence count", async () => {
    const drafts: SentenceDraft[] = [{ text: "One.", provenance: "STAGE", cue: { visual: "CUT" } }];
    const client = fakeClient([{ sentences: [] }]);
    await expect(runGlobalConsistencyPass(drafts, client)).rejects.toThrow(/changed sentence count/);
  });

  test("returns the input unchanged (no call) for an empty draft list", async () => {
    let called = false;
    const client = { messages: { parse: (async () => { called = true; return { parsed_output: null }; }) as any } };
    const result = await runGlobalConsistencyPass([], client);
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});
