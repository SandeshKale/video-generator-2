/**
 * src/stages/d-assets/broll.ts. Two kinds of coverage here:
 * (1) Pexels/Pixabay response parsing + the Pixabay 24h cache, against a
 *     mocked fetch() -- no live PEXELS_API_KEY/PIXABAY_API_KEY in this
 *     environment, same discipline as test/sfx.contract.test.ts.
 * (2) computePerceptualHash()/hammingDistance() against REAL ffmpeg
 *     output on synthetic lavfi fixtures -- this one needs no mocking at
 *     all, it's a real decode+hash round-trip.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "../src/lib/ffmpeg";
import {
  computePerceptualHash,
  dedupeByIdAndHash,
  hammingDistance,
  searchPexelsVideo,
  searchPixabayVideo,
} from "../src/stages/d-assets/broll";

const originalFetch = globalThis.fetch;
const originalPexelsKey = process.env.PEXELS_API_KEY;
const originalPixabayKey = process.env.PIXABAY_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPexelsKey === undefined) delete process.env.PEXELS_API_KEY;
  else process.env.PEXELS_API_KEY = originalPexelsKey;
  if (originalPixabayKey === undefined) delete process.env.PIXABAY_API_KEY;
  else process.env.PIXABAY_API_KEY = originalPixabayKey;
});

describe("searchPexelsVideo", () => {
  test("picks the highest-resolution hd file and maps fields correctly", async () => {
    process.env.PEXELS_API_KEY = "test-key";
    // A plain `let` captured and reassigned inside an async closure narrows
    // to its initial literal type (`null`) at the assertion site below --
    // TS can't statically see the later reassignment happens before the
    // read. An object property sidesteps that narrowing.
    const captured: { authHeader: string | null } = { authHeader: null };
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      captured.authHeader = (init?.headers as Record<string, string>)?.Authorization ?? null;
      return new Response(
        JSON.stringify({
          videos: [
            {
              id: 123,
              width: 1920,
              height: 1080,
              video_files: [
                { quality: "sd", width: 640, height: 360, link: "https://example.com/sd.mp4" },
                { quality: "hd", width: 1280, height: 720, link: "https://example.com/hd-small.mp4" },
                { quality: "hd", width: 1920, height: 1080, link: "https://example.com/hd-large.mp4" },
                { quality: "hls", width: null, height: null, link: "https://example.com/stream.m3u8" },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const results = await searchPexelsVideo("technology");
    expect(results).toEqual([{ id: "pexels:123", uri: "https://example.com/hd-large.mp4", width: 1920, height: 1080 }]);
    // No "Bearer " prefix -- confirmed against pexels.com/api/documentation.
    expect(captured.authHeader).toBe("test-key");
  });

  test("throws without an API key", async () => {
    delete process.env.PEXELS_API_KEY;
    await expect(searchPexelsVideo("x")).rejects.toThrow(/PEXELS_API_KEY/);
  });
});

describe("searchPixabayVideo", () => {
  test("maps the large video variant and caches by query", async () => {
    process.env.PIXABAY_API_KEY = "test-key";
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          hits: [{ id: 456, videos: { large: { url: "https://example.com/large.mp4", width: 1920, height: 1080 }, medium: { url: "x", width: 1280, height: 720 } } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const first = await searchPixabayVideo("nature-unique-query-1");
    expect(first).toEqual([{ id: "pixabay:456", uri: "https://example.com/large.mp4", width: 1920, height: 1080 }]);
    expect(callCount).toBe(1);

    // Same query again within the 24h TTL -- must NOT hit fetch a second time.
    const second = await searchPixabayVideo("nature-unique-query-1");
    expect(second).toEqual(first);
    expect(callCount).toBe(1);
  });
});

describe("dedupeByIdAndHash", () => {
  test("drops a repeated id even without a hash", () => {
    const result = dedupeByIdAndHash([{ id: "a" }, { id: "a" }, { id: "b" }]);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("drops a repeated perceptual hash across different ids", () => {
    const result = dedupeByIdAndHash([
      { id: "a", perceptualHash: "hash1" },
      { id: "b", perceptualHash: "hash1" },
      { id: "c", perceptualHash: "hash2" },
    ]);
    expect(result.map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("computePerceptualHash + hammingDistance (real ffmpeg)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "phash-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("the same clip hashed twice produces an identical hash", async () => {
    const clip = join(dir, "clip.mp4");
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);

    const h1 = await computePerceptualHash(clip, 1);
    const h2 = await computePerceptualHash(clip, 1);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16); // 64 bits / 4 bits-per-hex-char
    expect(hammingDistance(h1, h2)).toBe(0);
  }, 20_000);

  test("visually different clips produce different hashes with nonzero hamming distance", async () => {
    const clipA = join(dir, "a.mp4");
    const clipB = join(dir, "b.mp4");
    // testsrc (moving gradient/color bars pattern) vs a flat black frame --
    // about as visually different as two synthetic sources can be.
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", clipA]);
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=black:size=320x240:rate=10:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", clipB]);

    const hashA = await computePerceptualHash(clipA, 1);
    const hashB = await computePerceptualHash(clipB, 1);
    expect(hashA).not.toBe(hashB);
    expect(hammingDistance(hashA, hashB)).toBeGreaterThan(0);
  }, 20_000);

  test("hammingDistance rejects mismatched hash lengths", () => {
    expect(() => hammingDistance("ab", "abcd")).toThrow(/length mismatch/);
  });
});
