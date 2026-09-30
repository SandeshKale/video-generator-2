/**
 * BUILD_PLAN.md section 5.3. Generate in chunks: outline -> hook -> each
 * chapter with cues -> payoff, then a global consistency pass. Cue
 * vocabulary is the CueKindSchema enum (src/edl/schema.ts) -- never
 * free-text tags. Prefer GRAPHIC over BROLL whenever the sentence is a
 * mechanism, number, or comparison (the originality lever, section 2).
 * After generation: run the provenance lint (assertNoVoicedGaps) and the
 * Jev cue-verification Noul gate before this script is allowed downstream.
 *
 * Chunking rationale (measured qualitatively in prior LLM-scripting work,
 * not just theory): one giant "write the whole script" prompt drifts into
 * generic b-roll cue tags and loses track of which numbers/mechanisms it
 * already covered. Each chunk below is a separate `generateStructured`
 * call so the model's attention stays on one section at a time, with the
 * prior sections' sentences passed in as context to avoid repetition.
 *
 * `client` is threaded through every step (defaults to the real Anthropic
 * client inside `generateStructured`) purely so tests can inject a mock
 * -- there is no ANTHROPIC_API_KEY in this dev sandbox, so the LLM calls
 * themselves are not exercised end-to-end here; the prompt builders,
 * schema shapes, and orchestration (context threading, id assignment,
 * cue-vocabulary enforcement via the zod schema itself) are real and
 * tested against a mocked client.
 */
import { z } from "zod";
import { CueKindSchema, ProvenanceSchema, type Sentence } from "../../edl/schema";
import { generateStructured, type StructuredClient } from "../../lib/anthropic";
import { callJev } from "../../lib/jev";
import type { Brief } from "../a-research/research";

const SentenceDraftSchema = z.object({
  text: z.string(),
  provenance: ProvenanceSchema,
  source: z.string().url().optional(),
  cue: z.object({
    visual: CueKindSchema,
    graphic: z.string().nullable().optional(),
    brollQuery: z.string().nullable().optional(),
    sfx: z.string().nullable().optional(),
    textPop: z.string().nullable().optional(),
  }),
});
export type SentenceDraft = z.infer<typeof SentenceDraftSchema>;

const SentenceDraftsSchema = z.object({ sentences: z.array(SentenceDraftSchema).min(1) });

const OutlineSchema = z.object({
  hookIdea: z.string().describe("The single angle/tension that opens the video -- what makes someone keep watching past 3 seconds"),
  chapters: z
    .array(
      z.object({
        label: z.string().describe("Short chapter title for the description's chapter list"),
        beats: z.array(z.string()).min(1).describe("The specific claims/mechanisms/numbers this chapter must cover, one per beat"),
      }),
    )
    .min(2),
  payoffIdea: z.string().describe("How the video closes -- the takeaway or call-to-action"),
});
export type Outline = z.infer<typeof OutlineSchema>;

const CUE_VOCAB_NOTE =
  `Every sentence's cue.visual must be one of: GRAPHIC, BROLL, STILL, SFX, TEXTPOP, ZOOM, CUT. ` +
  `Prefer GRAPHIC over BROLL whenever the sentence names a specific number, mechanism, or comparison -- ` +
  `set cue.graphic to a short component hint (e.g. "StatCallout: 1.2M users" or "LabeledDiagram: input->process->output") in that case. ` +
  `Use BROLL with cue.brollQuery only for generic mood/scene-setting beats, never for a number or process.`;

const PROVENANCE_NOTE =
  `Every sentence's provenance must be FACT (directly supported by a cited source in standByClaims), ` +
  `STAGE (a transition/framing line with no factual claim), or GAP (a claim the creator has not yet sourced -- ` +
  `mark it GAP rather than inventing a source; GAP sentences are cut or rewritten before voicing, never voiced as-is).`;

function briefContext(brief: Brief): string {
  const claims = brief.standByClaims.map((c) => `- "${c.text}" (source: ${c.source})`).join("\n");
  return `Working title: ${brief.workingTitle}\nAudience: ${brief.audience}\nSources: ${brief.sources.join(", ")}\nClaims the creator will stand behind:\n${claims}`;
}

export function buildOutlinePrompt(brief: Brief): string {
  return (
    `${briefContext(brief)}\n\n` +
    `Draft an outline for a YouTube video script: a one-sentence hook idea, 3-6 chapters each with ` +
    `2-5 beats (the specific claims/mechanisms/numbers that chapter covers, pulled from the claims above ` +
    `-- do not invent beats unsupported by any claim), and a payoff idea for the close.`
  );
}

export async function generateOutline(brief: Brief, client?: StructuredClient): Promise<Outline> {
  return generateStructured(OutlineSchema, { prompt: buildOutlinePrompt(brief) }, client);
}

export function buildHookPrompt(brief: Brief, outline: Outline): string {
  return (
    `${briefContext(brief)}\n\nHook idea: ${outline.hookIdea}\n\n` +
    `Write the opening hook: 2-4 short sentences that open the video on this idea, with a cue for each. ${CUE_VOCAB_NOTE} ${PROVENANCE_NOTE}`
  );
}

export async function generateHookSentences(brief: Brief, outline: Outline, client?: StructuredClient): Promise<SentenceDraft[]> {
  const res = await generateStructured(SentenceDraftsSchema, { prompt: buildHookPrompt(brief, outline) }, client);
  return res.sentences;
}

export function buildChapterPrompt(
  brief: Brief,
  outline: Outline,
  chapter: Outline["chapters"][number],
  priorSentences: SentenceDraft[],
): string {
  const priorText = priorSentences.length
    ? `Sentences already written (do not repeat their content or wording):\n${priorSentences.map((s) => `- ${s.text}`).join("\n")}\n\n`
    : "";
  return (
    `${briefContext(brief)}\n\n${priorText}Chapter: "${chapter.label}"\nBeats to cover:\n${chapter.beats
      .map((b) => `- ${b}`)
      .join("\n")}\n\n` +
    `Write this chapter as a sequence of sentences, one cue each, covering every beat listed. ${CUE_VOCAB_NOTE} ${PROVENANCE_NOTE}`
  );
}

export async function generateChapterSentences(
  brief: Brief,
  outline: Outline,
  chapter: Outline["chapters"][number],
  priorSentences: SentenceDraft[],
  client?: StructuredClient,
): Promise<SentenceDraft[]> {
  const res = await generateStructured(SentenceDraftsSchema, { prompt: buildChapterPrompt(brief, outline, chapter, priorSentences) }, client);
  return res.sentences;
}

export function buildPayoffPrompt(brief: Brief, outline: Outline, priorSentences: SentenceDraft[]): string {
  const priorText = priorSentences.length
    ? `Sentences already written (do not repeat their content or wording):\n${priorSentences.map((s) => `- ${s.text}`).join("\n")}\n\n`
    : "";
  return (
    `${briefContext(brief)}\n\n${priorText}Payoff idea: ${outline.payoffIdea}\n\n` +
    `Write the closing payoff: 2-4 sentences that land the takeaway and close the video. ${CUE_VOCAB_NOTE} ${PROVENANCE_NOTE}`
  );
}

export async function generatePayoffSentences(
  brief: Brief,
  outline: Outline,
  priorSentences: SentenceDraft[],
  client?: StructuredClient,
): Promise<SentenceDraft[]> {
  const res = await generateStructured(SentenceDraftsSchema, { prompt: buildPayoffPrompt(brief, outline, priorSentences) }, client);
  return res.sentences;
}

export function buildConsistencyPassPrompt(drafts: SentenceDraft[]): string {
  return (
    `Here is a full draft script, written chapter-by-chapter, that may repeat words/phrases across ` +
    `chapter boundaries or drift in tone:\n\n${drafts.map((s, i) => `${i}. [${s.provenance}/${s.cue.visual}] ${s.text}`).join("\n")}\n\n` +
    `Return the same sentences (same count, same order, same provenance and cue for each) with only wording ` +
    `lightly revised for consistency of tone and to remove repeated phrasing across chapters. ${CUE_VOCAB_NOTE} ${PROVENANCE_NOTE}`
  );
}

/** Global consistency pass: reads back the full draft and lightly revises
 * wording for tone/repetition. Deliberately does NOT let the model change
 * provenance or cue.visual -- those are asserted unchanged below rather
 * than trusted, since a "light wording pass" silently swapping a FACT to
 * a GAP (or a GRAPHIC to a BROLL) would be a much bigger, unreviewed
 * change than what this pass is for. */
export async function runGlobalConsistencyPass(drafts: SentenceDraft[], client?: StructuredClient): Promise<SentenceDraft[]> {
  if (drafts.length === 0) return drafts;
  const res = await generateStructured(SentenceDraftsSchema, { prompt: buildConsistencyPassPrompt(drafts) }, client);
  if (res.sentences.length !== drafts.length) {
    throw new Error(
      `Global consistency pass changed sentence count (${drafts.length} -> ${res.sentences.length}) -- discarding, this pass may only reword`,
    );
  }
  return res.sentences.map((revised, i) => ({
    ...revised,
    provenance: drafts[i]!.provenance,
    cue: { ...revised.cue, visual: drafts[i]!.cue.visual },
  }));
}

export async function generateScriptChunked(brief: Brief, client?: StructuredClient): Promise<Sentence[]> {
  const outline = await generateOutline(brief, client);
  const hook = await generateHookSentences(brief, outline, client);

  const chapterDrafts: SentenceDraft[] = [];
  for (const chapter of outline.chapters) {
    const drafts = await generateChapterSentences(brief, outline, chapter, [...hook, ...chapterDrafts], client);
    chapterDrafts.push(...drafts);
  }

  const payoff = await generatePayoffSentences(brief, outline, [...hook, ...chapterDrafts], client);

  const allDrafts = [...hook, ...chapterDrafts, ...payoff];
  const consistent = await runGlobalConsistencyPass(allDrafts, client);

  return consistent.map((d, i) => ({ ...d, id: `s${i}` }));
}

/** Jev Noul per cue: "this visual cue accurately matches its sentence's
 * content." Never replaces the provenance lint -- a cue can match a
 * fabricated sentence perfectly and still be wrong to voice. */
export async function verifyCuesMatchSentences(sentences: Sentence[]): Promise<Record<string, number>> {
  const questions = Object.fromEntries(
    sentences.map((s) => [
      s.id,
      {
        type: "noul" as const,
        instructions: `Does the visual cue "${s.cue.visual}"${s.cue.graphic ? ` (${s.cue.graphic})` : ""} accurately match this sentence's content: "${s.text}"?`,
        criteria: { true: "the cue represents what the sentence describes", false: "the cue is generic, mismatched, or unrelated" },
      },
    ]),
  );
  const res = await callJev({ sentences }, questions);
  return Object.fromEntries(
    Object.entries(res.answers).map(([id, a]) => [id, (a as { noul: number }).noul]),
  );
}
