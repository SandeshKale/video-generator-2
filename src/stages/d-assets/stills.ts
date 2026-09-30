/**
 * BUILD_PLAN.md section 5.7 / 3.3. Flux.1 via fal.ai -- NEVER Midjourney
 * (no official API, explicit ToS ban on automation, documented real ban
 * history). Thumbnails and metaphor frames only; photoreal "this place
 * exists" frames require legal.aiDisclosure = "photoreal" on upload
 * (verified real policy, effective and auto-detected since May 2026 --
 * see the validation doc). Prefer stylized/graphic Flux prompts, which
 * stay on the lighter disclosure path, over photoreal fake B-roll.
 *
 * fal.ai's API is queue-based, not a single synchronous call (confirmed
 * against fal.ai's own docs, fal.ai/docs/model-apis/quickstart and
 * .../queue): POST submits a job and returns status_url/response_url,
 * then you poll status_url until COMPLETED and fetch response_url for
 * the actual result. Auth header is `Authorization: Key <FAL_KEY>` --
 * NOT "Bearer".
 */

const FAL_BASE = "https://queue.fal.run";
export type FluxModel = "fal-ai/flux/dev" | "fal-ai/flux-pro/v1.1";

type FalQueueSubmitResponse = { request_id: string; status_url: string; response_url: string };
type FalQueueStatusResponse = { status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" };
type FalFluxResult = { images: { url: string; width: number; height: number }[] };

async function falFetch<T>(url: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Key ${apiKey}` },
  });
  if (!res.ok) throw new Error(`fal.ai request to ${url} failed: ${res.status} ${res.statusText} -- ${await res.text()}`);
  return (await res.json()) as T;
}

/** Extracted for testability: the queue-polling loop is exactly the kind
 * of async state machine that's easy to get subtly wrong (busy-looping,
 * no timeout, swallowing a stuck IN_QUEUE forever) and cheap to verify
 * against a mocked fetch + injectable sleep, without a real fal.ai
 * account or waiting on real inference latency. */
export async function pollFalQueueUntilComplete(
  statusUrl: string,
  responseUrl: string,
  apiKey: string,
  opts: { pollIntervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<FalFluxResult> {
  const { pollIntervalMs = 1000, timeoutMs = 120_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`fal.ai queue polling timed out after ${timeoutMs}ms (status url: ${statusUrl})`);
    }
    const status = await falFetch<FalQueueStatusResponse>(`${statusUrl}?logs=1`, apiKey);
    if (status.status === "COMPLETED") {
      return falFetch<FalFluxResult>(responseUrl, apiKey);
    }
    await sleep(pollIntervalMs);
  }
}

/** Thumbnails must never rely on Flux for legible title typography --
 * diffusion models are unreliable at rendering correct, brand-consistent
 * text (BUILD_PLAN.md section 5.2/5.7). This builds the prompt pieces
 * that keep Flux strictly to subject/background/negative-space, with the
 * actual title type composited separately by Remotion. Pure function,
 * no network -- fully unit-testable. */
export function buildThumbnailPrompt(subjectPrompt: string): { prompt: string; negative_prompt: string } {
  return {
    prompt: `${subjectPrompt}, cinematic composition, clear negative space for text overlay, 16:9 aspect ratio`,
    negative_prompt: "text, words, letters, logos, watermark, signature, captions, typography",
  };
}

export async function generateFluxStill(
  prompt: string,
  opts: { photoreal?: boolean; forThumbnail?: boolean; model?: FluxModel } = {},
): Promise<{ uri: string; width: number; height: number; aiDisclosure: "photoreal" | "animated" }> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY is not set");

  const { photoreal = false, forThumbnail = false, model = "fal-ai/flux/dev" } = opts;
  const body = forThumbnail
    ? { ...buildThumbnailPrompt(prompt), image_size: "landscape_16_9" }
    : { prompt, image_size: "landscape_16_9" };

  const submitRes = await falFetch<FalQueueSubmitResponse>(`${FAL_BASE}/${model}`, apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await pollFalQueueUntilComplete(submitRes.status_url, submitRes.response_url, apiKey);
  const image = result.images[0];
  if (!image) throw new Error(`fal.ai returned no images for prompt: "${prompt.slice(0, 60)}..."`);

  return { uri: image.url, width: image.width, height: image.height, aiDisclosure: photoreal ? "photoreal" : "animated" };
}
