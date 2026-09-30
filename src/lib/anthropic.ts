/**
 * Thin wrapper around @anthropic-ai/sdk's structured-output path
 * (`client.messages.parse()` + `zodOutputFormat()`) -- the only way this
 * repo calls an LLM to GENERATE content (script sentences, packaging
 * concepts, claim drafts). Never call Jev (src/lib/jev.ts) for generation
 * and never call this for scoring/choosing/verifying -- see BUILD_PLAN.md
 * section 8 for which gate belongs to which system.
 *
 * `client` is an injectable last parameter (defaults to a lazily
 * constructed real Anthropic client) so callers can pass a mock with a
 * `.messages.parse` stub in tests without touching global state.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

let sharedClient: Anthropic | null = null;
function getSharedClient(): Anthropic {
  if (!sharedClient) sharedClient = new Anthropic();
  return sharedClient;
}

export type StructuredClient = { messages: { parse: Anthropic["messages"]["parse"] } };

export async function generateStructured<T extends z.ZodTypeAny>(
  schema: T,
  opts: { system?: string; prompt: string; maxTokens?: number },
  client: StructuredClient = getSharedClient(),
): Promise<z.infer<T>> {
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { format: zodOutputFormat(schema) },
  });

  if (!response.parsed_output) {
    throw new Error(
      `Claude structured output failed to parse (stop_reason=${response.stop_reason}) for prompt: ${opts.prompt.slice(0, 120)}...`,
    );
  }
  return response.parsed_output;
}
