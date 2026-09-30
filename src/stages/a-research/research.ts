/**
 * BUILD_PLAN.md section 5.1. Ingest a brief (working title, audience,
 * 5-15 source URLs/notes, claims the creator will stand behind). Every
 * numeric/historical claim gets tagged FACT/STAGE/GAP before scripting --
 * this file is where that tagging starts, not an afterthought bolted onto
 * the script stage.
 *
 * Two-step process, deliberately not one LLM call that both drafts and
 * verifies: (1) an LLM drafts claim text from the brief's sources -- pure
 * generation, so it goes through generateStructured (src/lib/anthropic.ts),
 * never Jev; (2) a Jev Noul checks each drafted claim against its cited
 * source text -- pure verification against state the caller supplies, so
 * it goes through callJev, never the LLM. A claim only earns provenance
 * FACT if the Noul's answer clears the confidence bar; anything else is
 * downgraded to GAP rather than trusted on the LLM's say-so alone (see
 * BUILD_PLAN.md section 8: an LLM never gets to certify its own claim).
 */
import { z } from "zod";
import { ProvenanceSchema } from "../../edl/schema";
import { generateStructured, type StructuredClient } from "../../lib/anthropic";
import { callJev } from "../../lib/jev";

export const BriefSchema = z.object({
  workingTitle: z.string(),
  audience: z.string(),
  sources: z.array(z.string().url()).min(1),
  standByClaims: z.array(z.object({ text: z.string(), source: z.string().url() })),
});
export type Brief = z.infer<typeof BriefSchema>;

export const TaggedClaimSchema = z.object({
  text: z.string(),
  provenance: ProvenanceSchema,
  source: z.string().url().optional(),
});
export type TaggedClaim = z.infer<typeof TaggedClaimSchema>;

const DraftedClaimSchema = z.object({
  text: z.string(),
  source: z.string().url().describe("Must be one of the brief's sources -- never invent a URL not in the list"),
  sourceSpan: z.string().describe("The specific passage/fact from that source this claim is drawn from"),
});
const DraftedClaimsSchema = z.object({ claims: z.array(DraftedClaimSchema).min(1) });

const NOUL_CONFIDENCE_THRESHOLD = 0.75;

export function buildDraftClaimsPrompt(brief: Brief): string {
  const standByText = brief.standByClaims.length
    ? `Claims the creator has already vetted and will stand behind:\n${brief.standByClaims.map((c) => `- "${c.text}" (${c.source})`).join("\n")}\n\n`
    : "";
  return (
    `Working title: ${brief.workingTitle}\nAudience: ${brief.audience}\nSources:\n${brief.sources.map((s) => `- ${s}`).join("\n")}\n\n${standByText}` +
    `Draft the factual claims this video will make, each one grounded in a specific passage from one of the sources ` +
    `above. For each claim, state the exact passage (sourceSpan) it's drawn from -- do not draft a claim you can't ` +
    `point to a specific passage for, and never cite a URL that isn't in the sources list.`
  );
}

export async function draftClaims(brief: Brief, client?: StructuredClient): Promise<z.infer<typeof DraftedClaimSchema>[]> {
  const res = await generateStructured(DraftedClaimsSchema, { prompt: buildDraftClaimsPrompt(brief) }, client);
  return res.claims;
}

/** Jev Noul per drafted claim: "does the cited source span actually
 * support this claim text." A claim clearing this bar is tagged FACT;
 * anything else is downgraded to GAP so it can be rewritten or cut before
 * scripting, never voiced as an unverified FACT. */
export async function verifyClaimsAgainstSources(
  claims: { text: string; source: string; sourceSpan: string }[],
): Promise<Record<number, number>> {
  const questions = Object.fromEntries(
    claims.map((c, i) => [
      `claim_${i}`,
      {
        type: "noul" as const,
        instructions: `Does this source passage actually support the claim? Passage: "${c.sourceSpan}" Claim: "${c.text}"`,
        criteria: { true: "the passage directly supports the claim", false: "the passage is unrelated, weaker than, or contradicts the claim" },
      },
    ]),
  );
  const res = await callJev({ claims }, questions);
  return Object.fromEntries(
    claims.map((_, i) => [i, (res.answers[`claim_${i}`] as { noul: number }).noul]),
  );
}

export async function tagClaims(brief: Brief, client?: StructuredClient): Promise<TaggedClaim[]> {
  const drafted = await draftClaims(brief, client);
  const nouls = await verifyClaimsAgainstSources(drafted);
  return drafted.map((c, i) => ({
    text: c.text,
    source: c.source,
    provenance: nouls[i]! >= NOUL_CONFIDENCE_THRESHOLD ? "FACT" : "GAP",
  }));
}
