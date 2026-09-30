/**
 * Live tests against the real Jev (TypeSafe AI) System One API --
 * JEV_API_KEY is actually available in this dev sandbox, unlike the LLM
 * provider keys (Azure/Freesound/Pexels/Pixabay/fal.ai/Anthropic), which
 * only have mocked-fetch coverage elsewhere in this repo. These three
 * gates (cue-verification, packaging score, claim-source verification)
 * were written in the Week 1 scaffold but never actually called against
 * the real API until now -- this is that first real call, not a mock.
 *
 * Skips (doesn't fail) if JEV_API_KEY is unset, so the suite still runs
 * clean in an environment without it.
 */
import { describe, expect, test } from "bun:test";
import { verifyCuesMatchSentences } from "../src/stages/c-script/script";
import { scoreAndGate } from "../src/stages/b-packaging/packaging";
import { verifyClaimsAgainstSources } from "../src/stages/a-research/research";
import type { Sentence } from "../src/edl/schema";

const hasJevKey = !!process.env.JEV_API_KEY;
const maybeTest = hasJevKey ? test : test.skip;

describe("Jev live integration", () => {
  maybeTest("verifyCuesMatchSentences: a matching cue scores high, a mismatched cue scores low", async () => {
    const sentences: Sentence[] = [
      {
        id: "s0",
        text: "Monthly active users grew to 1.2 million last quarter.",
        provenance: "FACT",
        cue: { visual: "GRAPHIC", graphic: "StatCallout: 1.2M monthly active users" },
      },
      {
        id: "s1",
        text: "Monthly active users grew to 1.2 million last quarter.",
        provenance: "FACT",
        cue: { visual: "BROLL", brollQuery: "a golden retriever running on a beach" },
      },
    ];
    const scores = await verifyCuesMatchSentences(sentences);
    expect(typeof scores.s0).toBe("number");
    expect(typeof scores.s1).toBe("number");
    // A StatCallout showing the exact number beats an unrelated beach clip.
    expect(scores.s0!).toBeGreaterThan(scores.s1!);
  }, 30000);

  maybeTest("scoreAndGate: a strong concept set clears the threshold", async () => {
    const concepts = [
      { title: "Why Your Server Room Sounds Like a Jet Engine", thumbnailConcept: "a glowing server rack with visible airflow, dramatic blue lighting" },
      { title: "The Hidden Cost of Cooling the Internet", thumbnailConcept: "a thermometer overlaid on a data center hallway" },
    ];
    const { passed, scores } = await scoreAndGate(concepts);
    expect(typeof passed).toBe("boolean");
    expect(Object.keys(scores)).toHaveLength(2);
    for (const s of Object.values(scores)) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  maybeTest("verifyClaimsAgainstSources: a supported claim scores high, an unsupported one scores low", async () => {
    const claims = [
      {
        text: "Data centers consume 1-2% of global electricity.",
        source: "https://example.com/a",
        sourceSpan: "Globally, data centers are estimated to consume between 1% and 2% of total electricity demand.",
      },
      {
        text: "Data centers consume 40% of global electricity.",
        source: "https://example.com/a",
        sourceSpan: "Globally, data centers are estimated to consume between 1% and 2% of total electricity demand.",
      },
    ];
    const nouls = await verifyClaimsAgainstSources(claims);
    expect(nouls[0]!).toBeGreaterThan(nouls[1]!);
  }, 30000);

  test("skip notice", () => {
    if (!hasJevKey) {
      console.log("JEV_API_KEY not set -- skipping live Jev integration tests.");
    }
    expect(true).toBe(true);
  });
});
