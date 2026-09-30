/**
 * src/stages/a-research/research.ts. draftClaims (the LLM-drafting half)
 * tested against a fake Anthropic client -- no ANTHROPIC_API_KEY in this
 * dev sandbox. verifyClaimsAgainstSources (the Jev-Noul half) and the
 * full tagClaims() orchestration end-to-end are live-tested separately in
 * test/jev.live.test.ts, since JEV_API_KEY is actually available here.
 */
import { describe, expect, test } from "bun:test";
import { buildDraftClaimsPrompt, draftClaims } from "../src/stages/a-research/research";
import type { Brief } from "../src/stages/a-research/research";

const brief: Brief = {
  workingTitle: "Why servers hum",
  audience: "curious generalists",
  sources: ["https://example.com/a", "https://example.com/b"],
  standByClaims: [{ text: "Data centers use ~1-2% of global electricity", source: "https://example.com/a" }],
};

describe("buildDraftClaimsPrompt", () => {
  test("lists every source and forbids citing a URL outside that list", () => {
    const prompt = buildDraftClaimsPrompt(brief);
    expect(prompt).toContain("https://example.com/a");
    expect(prompt).toContain("https://example.com/b");
    expect(prompt).toContain("never cite a URL that isn't in the sources list");
  });
});

describe("draftClaims", () => {
  test("returns the claims array from the structured response", async () => {
    const claims = [
      { text: "Data centers use ~1-2% of global electricity", source: "https://example.com/a", sourceSpan: "global data centers consume 1-2% of electricity" },
    ];
    const client = {
      messages: {
        parse: (async () => ({ parsed_output: { claims }, stop_reason: "end_turn" })) as any,
      },
    };
    const result = await draftClaims(brief, client);
    expect(result).toEqual(claims);
  });
});
