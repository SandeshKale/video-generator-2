/**
 * BUILD_PLAN.md section 5.5. Build against Freesound's current unified
 * `GET /apiv2/search/` endpoint (NOT the deprecated `/search/text/` path).
 * Hard-filter license via isFreesoundLicenseSafe() before a result is ever
 * downloaded. Prefer a curated ID allowlist per category (whoosh, click,
 * impact, riser, paper, UI) over live keyword search -- generic-keyword
 * result quality is documented as inconsistent; live search is fallback only.
 */
import { isFreesoundLicenseSafe, requiresAttribution } from "../../lib/licensing/filters";

const CURATED_ALLOWLIST: Record<string, string[]> = {
  // TODO: fill in vetted Freesound sound IDs per category before relying
  // on live search in production.
  whoosh: [],
  click: [],
  impact: [],
  riser: [],
  paper: [],
  ui: [],
};

const FREESOUND_SEARCH_URL = "https://freesound.org/apiv2/search/";

type FreesoundSearchResult = {
  id: number;
  name: string;
  license: string;
  duration: number;
  previews: { "preview-hq-mp3"?: string; "preview-lq-mp3"?: string };
};

export type SfxResult = { id: string; uri: string; license: string; requiresAttribution: boolean };

/** GET /apiv2/search/ -- confirmed against Freesound's own API docs
 * (freesound.org/docs/api/resources_apiv2.html): this is the CURRENT
 * unified search endpoint (the old `/apiv2/search/text/` path was
 * deprecated Nov 2025 and just redirects here). Every result is filtered
 * through isFreesoundLicenseSafe() before being returned -- a CC-BY-NC
 * result must never reach an EDL, full stop, not just be flagged. */
export async function searchSfx(query: string, opts: { maxResults?: number } = {}): Promise<SfxResult[]> {
  const apiKey = process.env.FREESOUND_API_KEY;
  if (!apiKey) throw new Error("FREESOUND_API_KEY is not set");

  const url = new URL(FREESOUND_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("fields", "id,name,license,duration,previews");
  url.searchParams.set("page_size", String(opts.maxResults ?? 15));

  const res = await fetch(url, { headers: { Authorization: `Token ${apiKey}` } });
  if (!res.ok) {
    throw new Error(`Freesound search failed: ${res.status} ${res.statusText} -- ${await res.text()}`);
  }
  const body = (await res.json()) as { results: FreesoundSearchResult[] };

  return body.results
    .filter((r) => isFreesoundLicenseSafe(r.license))
    .filter((r) => r.previews["preview-hq-mp3"])
    .map((r) => ({
      id: String(r.id),
      uri: r.previews["preview-hq-mp3"]!,
      license: r.license,
      requiresAttribution: requiresAttribution(r.license),
    }));
}

/** Resolve a category against the curated allowlist first; live search
 * (searchSfx) is the fallback only, per BUILD_PLAN.md section 5.5 --
 * generic-keyword result quality on Freesound is documented as
 * inconsistent, so don't trust it as the primary source in production. */
export async function resolveSfxForCategory(category: keyof typeof CURATED_ALLOWLIST, fallbackQuery: string): Promise<SfxResult[]> {
  const allowlisted = CURATED_ALLOWLIST[category] ?? [];
  if (allowlisted.length > 0) {
    // TODO: once the allowlist has real IDs, fetch each by ID
    // (GET /apiv2/sounds/<id>/) rather than falling through to search.
    throw new Error(`TODO: fetch curated IDs ${allowlisted.join(",")} via GET /apiv2/sounds/<id>/`);
  }
  return searchSfx(fallbackQuery);
}

export { CURATED_ALLOWLIST, isFreesoundLicenseSafe, requiresAttribution };
