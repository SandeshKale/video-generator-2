/**
 * BUILD_PLAN.md section 5.2. Generate 10 title/thumbnail concepts (direct
 * LLM call, not an agent framework), score them with Jev (scorePackagingConcepts
 * in src/lib/jev.ts), gate on >=8/10 -- regenerate once, then kill the topic
 * rather than lowering the bar. Human picks the winner by default; auto-pick
 * unlocks only after the first 10 published videos' CTR data justifies it
 * (BUILD_PLAN.md section 5.2, last bullet).
 */
import { z } from "zod";
import { generateStructured, type StructuredClient } from "../../lib/anthropic";
import { scorePackagingConcepts } from "../../lib/jev";
import type { Brief } from "../a-research/research";

export type PackagingConcept = { title: string; thumbnailConcept: string };

/** Jev's `score` question type returns a value in [0, criteria.length - 1]
 * -- scorePackagingConcepts (src/lib/jev.ts) uses a 5-item criteria list
 * (poor/weak/adequate/strong/excellent), so the real range is 0-4, NOT
 * 0-10. Confirmed by a live call, 2026-09-30: a plausible concept pair
 * scored ~3.1-3.15 with the "strong" (index 3) bucket carrying ~60% of
 * the probability mass. The original `SCORE_THRESHOLD = 8` was written
 * before this stage's first live Jev call and assumed a 0-10 scale that
 * does not exist -- it was an unreachable bar (max possible score is 4),
 * so scoreAndGate could never pass. 3.2 (80% of the 0-4 range, preserving
 * the "80th percentile" intent of the original "8/10" framing) requires
 * a concept whose probability mass sits solidly in "strong" or better. */
const SCORE_THRESHOLD = 3.2;
const AUTO_PICK_UNLOCKED_AFTER_N_VIDEOS = 10;
const CONCEPT_COUNT = 10;

const PackagingConceptSchema = z.object({
  title: z.string().describe("YouTube title, under ~70 characters, no clickbait that the video doesn't deliver on"),
  thumbnailConcept: z
    .string()
    .describe(
      "A description of the thumbnail's SUBJECT/BACKGROUND only -- no text/words/letters/logos, those are composited separately by Remotion, never Flux-generated",
    ),
});
const PackagingConceptsSchema = z.object({ concepts: z.array(PackagingConceptSchema).length(CONCEPT_COUNT) });

export function buildConceptsPrompt(brief: Brief): string {
  const claims = brief.standByClaims.map((c) => `- ${c.text}`).join("\n");
  return (
    `Working title: ${brief.workingTitle}\nAudience: ${brief.audience}\nClaims the video will make:\n${claims}\n\n` +
    `Generate exactly ${CONCEPT_COUNT} distinct title + thumbnail-concept pairs for this video. ` +
    `Each title should take a genuinely different angle (curiosity gap, specific number, direct claim, question, ` +
    `contrarian framing, etc.) -- not ${CONCEPT_COUNT} minor rewordings of the same title. Score criteria to optimize for: ` +
    `clarity on first glance, a curiosity gap without lying, specificity (a named object/number beats something vague), ` +
    `trust (the thumbnail must match what the video actually delivers), and thumbnail text under 6 words. ` +
    `Each thumbnailConcept must describe only the subject/background composition -- never include any text, words, ` +
    `letters, or logos in the concept itself, since title type is composited separately, never diffusion-generated.`
  );
}

export async function generateConcepts(brief: Brief, client?: StructuredClient): Promise<PackagingConcept[]> {
  const res = await generateStructured(PackagingConceptsSchema, { prompt: buildConceptsPrompt(brief) }, client);
  return res.concepts;
}

export async function scoreAndGate(
  concepts: PackagingConcept[],
): Promise<{ passed: boolean; scores: Record<number, { score: number; confidence: number }> }> {
  const scores = await scorePackagingConcepts(concepts);
  const passed = Object.values(scores).some((s) => s.score >= SCORE_THRESHOLD);
  return { passed, scores };
}

export { AUTO_PICK_UNLOCKED_AFTER_N_VIDEOS };
