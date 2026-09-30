/**
 * src/lib/jev.ts + src/stages/b-packaging/packaging.ts's scoreAndGate,
 * against a mocked fetch (real network coverage lives in
 * test/jev.live.test.ts). Regression coverage for a real bug found via
 * the live test: Jev's `score` question type returns an index into the
 * criteria list (0-4 for a 5-item list), not a 0-10 scale --
 * SCORE_THRESHOLD was originally 8, an unreachable bar. See the dated
 * comment in packaging.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { callJev, scorePackagingConcepts } from "../src/lib/jev";
import { scoreAndGate } from "../src/stages/b-packaging/packaging";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJevScoreResponse(scores: number[]) {
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const answers: Record<string, unknown> = {};
    for (const key of Object.keys(body.questions)) {
      const i = Number(key.split("_")[1]);
      answers[key] = {
        type: "score",
        score: scores[i],
        legend: { 0: "poor", 1: "weak", 2: "adequate", 3: "strong", 4: "excellent" },
        probabilities: {},
        confidence: 0.7,
      };
    }
    return new Response(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("scorePackagingConcepts", () => {
  test("returns the raw 0-4 scale score, not a rescaled 0-10 value", async () => {
    mockJevScoreResponse([3.1]);
    const scores = await scorePackagingConcepts([{ title: "t", thumbnailConcept: "c" }]);
    expect(scores[0]!.score).toBe(3.1);
  });
});

describe("scoreAndGate", () => {
  test("passes when at least one concept clears 3.2/4 (regression: threshold must not be the old unreachable 8)", async () => {
    mockJevScoreResponse([2.0, 3.6]);
    const { passed, scores } = await scoreAndGate([
      { title: "weak concept", thumbnailConcept: "c1" },
      { title: "strong concept", thumbnailConcept: "c2" },
    ]);
    expect(passed).toBe(true);
    expect(scores[1]!.score).toBe(3.6);
  });

  test("fails when every concept scores below the threshold", async () => {
    mockJevScoreResponse([1.5, 2.9]);
    const { passed } = await scoreAndGate([
      { title: "a", thumbnailConcept: "c1" },
      { title: "b", thumbnailConcept: "c2" },
    ]);
    expect(passed).toBe(false);
  });

  test("a realistic live-observed score (~3.1-3.15, per test/jev.live.test.ts) does NOT clear the gate on its own", async () => {
    mockJevScoreResponse([3.15, 3.14]);
    const { passed } = await scoreAndGate([
      { title: "a", thumbnailConcept: "c1" },
      { title: "b", thumbnailConcept: "c2" },
    ]);
    expect(passed).toBe(false);
  });
});

describe("callJev", () => {
  test("throws when JEV_API_KEY is unset", async () => {
    const original = process.env.JEV_API_KEY;
    delete process.env.JEV_API_KEY;
    try {
      await expect(callJev({}, {})).rejects.toThrow(/JEV_API_KEY/);
    } finally {
      if (original !== undefined) process.env.JEV_API_KEY = original;
    }
  });
});
