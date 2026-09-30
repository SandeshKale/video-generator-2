/**
 * src/stages/b-packaging/packaging.ts. buildConceptsPrompt/generateConcepts
 * tested against a fake Anthropic client (no ANTHROPIC_API_KEY in this dev
 * sandbox). scoreAndGate/scorePackagingConcepts (the Jev half) is
 * live-tested separately in test/jev.live.test.ts, since JEV_API_KEY is
 * actually available here.
 */
import { describe, expect, test } from "bun:test";
import { buildConceptsPrompt, generateConcepts } from "../src/stages/b-packaging/packaging";
import type { Brief } from "../src/stages/a-research/research";

const brief: Brief = {
  workingTitle: "Why servers hum",
  audience: "curious generalists",
  sources: ["https://example.com/a"],
  standByClaims: [{ text: "Data centers use ~1-2% of global electricity", source: "https://example.com/a" }],
};

describe("buildConceptsPrompt", () => {
  test("asks for exactly 10 concepts and forbids text/logos in the thumbnail concept", () => {
    const prompt = buildConceptsPrompt(brief);
    expect(prompt).toContain("exactly 10");
    expect(prompt).toContain("never include any text, words");
    expect(prompt).toContain("Why servers hum");
  });
});

describe("generateConcepts", () => {
  test("returns the concepts array from the structured response", async () => {
    const concepts = Array.from({ length: 10 }, (_, i) => ({ title: `Title ${i}`, thumbnailConcept: `Concept ${i}` }));
    const client = {
      messages: {
        parse: (async () => ({ parsed_output: { concepts }, stop_reason: "end_turn" })) as any,
      },
    };
    const result = await generateConcepts(brief, client);
    expect(result).toHaveLength(10);
    expect(result[0]!.title).toBe("Title 0");
  });
});
