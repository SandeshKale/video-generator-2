/**
 * src/stages/d-assets/stills.ts. Two kinds of real coverage:
 * (1) buildThumbnailPrompt() -- pure function, no network.
 * (2) pollFalQueueUntilComplete() -- the async IN_QUEUE -> IN_PROGRESS ->
 *     COMPLETED state machine, against a mocked fetch with an injected
 *     sleep() so the test runs instantly instead of waiting on real
 *     polling intervals, plus a genuine timeout case. No live FAL_KEY in
 *     this environment -- generateFluxStill()'s actual submit call is not
 *     exercised end-to-end, but the polling logic it depends on is.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { buildThumbnailPrompt, pollFalQueueUntilComplete } from "../src/stages/d-assets/stills";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("buildThumbnailPrompt", () => {
  test("keeps Flux strictly to subject/background and excludes text via negative_prompt", () => {
    const { prompt, negative_prompt } = buildThumbnailPrompt("a server room with glowing cables");
    expect(prompt).toContain("a server room with glowing cables");
    expect(prompt).toContain("negative space for text overlay");
    expect(negative_prompt).toContain("text");
    expect(negative_prompt).toContain("logos");
  });
});

describe("pollFalQueueUntilComplete", () => {
  test("polls through IN_QUEUE -> IN_PROGRESS -> COMPLETED and returns the final result", async () => {
    const statuses = ["IN_QUEUE", "IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    let statusCallCount = 0;
    let responseCallCount = 0;
    const sleepCalls: number[] = [];

    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/status")) {
        const status = statuses[statusCallCount]!;
        statusCallCount++;
        return new Response(JSON.stringify({ status }), { status: 200 });
      }
      // the response (result) URL
      responseCallCount++;
      return new Response(JSON.stringify({ images: [{ url: "https://example.com/thumb.png", width: 1920, height: 1080 }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await pollFalQueueUntilComplete(
      "https://queue.fal.run/fal-ai/flux/dev/requests/abc/status",
      "https://queue.fal.run/fal-ai/flux/dev/requests/abc",
      "test-key",
      { sleep: async (ms) => { sleepCalls.push(ms); } },
    );

    expect(result.images[0]!.url).toBe("https://example.com/thumb.png");
    expect(statusCallCount).toBe(4); // polled through all 4 status states
    expect(responseCallCount).toBe(1); // fetched the result exactly once, after COMPLETED
    expect(sleepCalls.length).toBe(3); // slept between each non-terminal poll, not after COMPLETED
  });

  test("returns immediately without polling if already COMPLETED on first check", async () => {
    let statusCallCount = 0;
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes("/status")) {
        statusCallCount++;
        return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
      }
      return new Response(JSON.stringify({ images: [{ url: "https://example.com/x.png", width: 1024, height: 1024 }] }), { status: 200 });
    }) as unknown as typeof fetch;

    let sleptAtAll = false;
    const result = await pollFalQueueUntilComplete("https://x/status", "https://x/response", "key", {
      sleep: async () => { sleptAtAll = true; },
    });
    expect(statusCallCount).toBe(1);
    expect(sleptAtAll).toBe(false);
    expect(result.images[0]!.width).toBe(1024);
  });

  test("throws a clear timeout error rather than polling forever on a stuck job", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes("/status")) return new Response(JSON.stringify({ status: "IN_QUEUE" }), { status: 200 });
      throw new Error("should never reach the response URL in this test");
    }) as unknown as typeof fetch;

    // No real sleep -- resolve instantly so the loop just spins past the
    // timeout deadline quickly instead of the test itself taking ages.
    await expect(
      pollFalQueueUntilComplete("https://x/status", "https://x/response", "key", {
        timeoutMs: 5,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/timed out/);
  });

  test("propagates a non-OK status-check response as an error", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    await expect(pollFalQueueUntilComplete("https://x/status", "https://x/response", "bad-key")).rejects.toThrow(/401/);
  });
});
