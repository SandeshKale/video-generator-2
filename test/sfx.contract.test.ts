/**
 * src/stages/d-assets/sfx.ts's response handling, tested against a mocked
 * fetch() so the license-filtering/shape-mapping logic has real coverage
 * without needing a live FREESOUND_API_KEY. The actual network call/auth
 * header itself is NOT verified against a real Freesound response in this
 * environment -- flagged here, not glossed over, same as tts.ts's Azure
 * integration.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { searchSfx } from "../src/stages/d-assets/sfx";

const originalFetch = globalThis.fetch;
const originalKey = process.env.FREESOUND_API_KEY;

function mockFreesoundResponse(results: unknown[]) {
  globalThis.fetch = (async (url: string | URL) => {
    return new Response(JSON.stringify({ count: results.length, results, next: null, previous: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.FREESOUND_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.FREESOUND_API_KEY;
  else process.env.FREESOUND_API_KEY = originalKey;
});

describe("searchSfx", () => {
  test("throws if FREESOUND_API_KEY is not set", async () => {
    delete process.env.FREESOUND_API_KEY;
    await expect(searchSfx("whoosh")).rejects.toThrow(/FREESOUND_API_KEY/);
  });

  test("hard-excludes CC-BY-NC results, even when they'd otherwise be the best match", async () => {
    mockFreesoundResponse([
      { id: 1, name: "clean-whoosh", license: "Creative Commons 0", duration: 1.2, previews: { "preview-hq-mp3": "https://example.com/1.mp3" } },
      { id: 2, name: "nc-whoosh", license: "Attribution NonCommercial", duration: 1.1, previews: { "preview-hq-mp3": "https://example.com/2.mp3" } },
    ]);
    const results = await searchSfx("whoosh");
    expect(results.map((r) => r.id)).toEqual(["1"]);
  });

  test("marks Attribution-licensed results as requiring attribution", async () => {
    mockFreesoundResponse([
      { id: 3, name: "by-click", license: "Attribution", duration: 0.3, previews: { "preview-hq-mp3": "https://example.com/3.mp3" } },
    ]);
    const results = await searchSfx("click");
    expect(results[0]!.requiresAttribution).toBe(true);
    expect(results[0]!.uri).toBe("https://example.com/3.mp3");
  });

  test("skips a result with no usable preview URL rather than returning a broken uri", async () => {
    mockFreesoundResponse([
      { id: 4, name: "no-preview", license: "Creative Commons 0", duration: 0.5, previews: {} },
    ]);
    const results = await searchSfx("impact");
    expect(results).toEqual([]);
  });

  test("propagates a non-OK response as an error rather than swallowing it", async () => {
    globalThis.fetch = (async () => new Response("rate limited", { status: 429, statusText: "Too Many Requests" })) as unknown as typeof fetch;
    await expect(searchSfx("riser")).rejects.toThrow(/429/);
  });
});
