/**
 * BUILD_PLAN.md section 5.7. Stock B-roll is SECONDARY illustration, not the
 * primary visual language (see src/stages/h-render/components/GraphicScene.tsx
 * and BUILD_PLAN.md section 2). Pexels: `Authorization: <key>` header (no
 * "Bearer" prefix, confirmed against pexels.com/api/documentation), 200
 * req/hr / 20,000/mo. Pixabay: `key` query param, 100 req/60s, and its docs
 * REQUIRE caching search results for 24h -- build that cache before calling
 * live in a loop. Deduplicate by provider ID AND perceptual hash -- the same
 * clip appearing twice in one video is a fail.
 */
export type BrollClip = { id: string; uri: string; width: number; height: number; perceptualHash?: string };

const pixabayCache = new Map<string, { result: BrollClip[]; cachedAt: number }>();
const PIXABAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type PexelsVideoFile = { quality: string; width: number | null; height: number | null; link: string };
type PexelsVideo = { id: number; width: number; height: number; video_files: PexelsVideoFile[] };
type PexelsSearchResponse = { videos: PexelsVideo[] };

/** Prefer the highest-resolution "hd" file per result -- normalize.ts
 * re-encodes to the pipeline's fixed spec anyway, but starting from the
 * best available source avoids compounding a low-res upscale. */
function pickBestPexelsFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  const hd = files.filter((f) => f.quality === "hd" && f.width && f.height);
  if (hd.length > 0) return hd.reduce((best, f) => ((f.width ?? 0) > (best.width ?? 0) ? f : best));
  return files.find((f) => f.quality !== "hls");
}

export async function searchPexelsVideo(query: string, opts: { perPage?: number } = {}): Promise<BrollClip[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY is not set");

  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("per_page", String(opts.perPage ?? 15));

  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels search failed: ${res.status} ${res.statusText} -- ${await res.text()}`);
  const body = (await res.json()) as PexelsSearchResponse;

  return body.videos
    .map((v): BrollClip | undefined => {
      const file = pickBestPexelsFile(v.video_files);
      if (!file || !file.width || !file.height) return undefined;
      return { id: `pexels:${v.id}`, uri: file.link, width: file.width, height: file.height };
    })
    .filter((c): c is BrollClip => c !== undefined);
}

type PixabayVideoVariant = { url: string; width: number; height: number };
type PixabayHit = { id: number; videos: { large: PixabayVideoVariant; medium: PixabayVideoVariant } };
type PixabaySearchResponse = { hits: PixabayHit[] };

/** Pixabay's own docs require caching search results for 24h -- both to
 * respect their rate limit and per their terms of use, not just as a
 * performance optimization. Cache is query-keyed and process-local; a
 * real deployment should back this with a persistent store (BUILD_PLAN.md
 * section 9's Postgres state store) so it survives process restarts. */
export async function searchPixabayVideo(query: string, opts: { perPage?: number } = {}): Promise<BrollClip[]> {
  const cacheKey = `${query}::${opts.perPage ?? 15}`;
  const cached = pixabayCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < PIXABAY_CACHE_TTL_MS) {
    return cached.result;
  }

  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) throw new Error("PIXABAY_API_KEY is not set");

  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("orientation", "horizontal");
  url.searchParams.set("per_page", String(opts.perPage ?? 15));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay search failed: ${res.status} ${res.statusText} -- ${await res.text()}`);
  const body = (await res.json()) as PixabaySearchResponse;

  const result = body.hits.map(
    (h): BrollClip => ({ id: `pixabay:${h.id}`, uri: h.videos.large.url, width: h.videos.large.width, height: h.videos.large.height }),
  );
  pixabayCache.set(cacheKey, { result, cachedAt: Date.now() });
  return result;
}

export function dedupeByIdAndHash<T extends { id: number | string; perceptualHash?: string }>(
  assets: T[],
): T[] {
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  return assets.filter((a) => {
    const idKey = String(a.id);
    if (seenIds.has(idKey)) return false;
    if (a.perceptualHash && seenHashes.has(a.perceptualHash)) return false;
    seenIds.add(idKey);
    if (a.perceptualHash) seenHashes.add(a.perceptualHash);
    return true;
  });
}

/** Average-hash (aHash) perceptual hash: sample one frame, downscale to
 * 8x8 grayscale, hash = 1 bit per pixel (above/below the mean), packed as
 * a 16-hex-char string. Cheap and real (no external image-hashing
 * dependency needed) -- ffmpeg does the decode+scale, this file just does
 * the bit-packing. Good enough to catch exact/near-exact duplicate clips
 * across B-roll search results; not a robust general image-similarity
 * algorithm (no rotation/crop invariance) -- that's a deliberate scope
 * limit, not an oversight, since the actual failure mode this exists to
 * catch (BUILD_PLAN.md section 5.7) is "the same stock clip returned
 * twice for two different search queries," not near-duplicates from
 * different sources. */
export async function computePerceptualHash(videoPath: string, atSec = 1): Promise<string> {
  const proc = Bun.spawn(
    [
      "ffmpeg", "-y", "-loglevel", "error",
      "-ss", String(atSec), "-i", videoPath,
      "-frames:v", "1",
      "-vf", "scale=8:8:flags=area,format=gray",
      "-f", "rawvideo", "-",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const buf = await new Response(proc.stdout).arrayBuffer();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code} computing perceptual hash for ${videoPath}`);

  const pixels = new Uint8Array(buf);
  if (pixels.length !== 64) {
    throw new Error(`expected 64 grayscale pixels (8x8) from ${videoPath}, got ${pixels.length} -- check the -ss offset is within the clip's duration`);
  }

  const mean = pixels.reduce((sum, p) => sum + p, 0) / pixels.length;
  let bits = "";
  for (const p of pixels) bits += p > mean ? "1" : "0";

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Number of differing bits between two same-length hex hashes -- 0 means
 * identical, higher means more different. Useful for a near-duplicate
 * threshold beyond dedupeByIdAndHash's exact-match check, if that's ever
 * needed; not currently wired into the dedupe pipeline by default. */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) throw new Error(`hash length mismatch: ${hashA.length} vs ${hashB.length}`);
  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    const diff = parseInt(hashA[i]!, 16) ^ parseInt(hashB[i]!, 16);
    distance += [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][diff]!;
  }
  return distance;
}
