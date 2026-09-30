/**
 * Programmatic legal gates (BUILD_PLAN.md section 8 / hardened spec
 * section 8). These are hard, deterministic filters -- never a Jev call,
 * never a "looks fine" judgment. A result that fails these must never
 * reach an EDL.
 */

export type FreesoundLicense = "Creative Commons 0" | "Attribution" | "Attribution Noncommercial";

export function isFreesoundLicenseSafe(license: string): boolean {
  // Confirmed against Freesound's own API docs (freesound.org/docs/api/
  // resources_apiv2.html): the `license` field on a search result is a
  // plain string like "Attribution", "Attribution NonCommercial", or
  // "Creative Commons 0" -- not a URL. CC-BY-NC is the one hard exclusion:
  // monetized YouTube is commercial use.
  const blocked = ["noncommercial", "nc/", "by-nc"];
  return !blocked.some((b) => license.toLowerCase().includes(b));
}

/** BUG FOUND AND FIXED 2026-09-30 (caught by a unit test, never actually
 * exercised in production before this): the old check was
 * `license.includes("by")`, which is wrong for the exact license-name
 * strings Freesound's API actually returns -- "attribution".includes("by")
 * is FALSE (no "by" substring in that spelling), so this silently returned
 * false -- "does not require attribution" -- for a plain Attribution-
 * licensed sound, exactly backwards. Check for "attribution" directly. */
export function requiresAttribution(license: string): boolean {
  return license.toLowerCase().includes("attribution");
}

/** Pexels/Pixabay: both ban unaltered standalone resale (not triggered by
 * a produced/edited video) but neither clears third-party rights in
 * identifiable people or brand logos in the footage. v1 = manual review
 * flag only; a real face/logo detector is an explicit [U] in
 * BUILD_PLAN.md section 12 -- don't build one before choosing it deliberately. */
export function flagForManualReview(assetMetadata: { peopleCount?: number; hasRecognizableBrand?: boolean }): boolean {
  return (assetMetadata.peopleCount ?? 0) > 0 || !!assetMetadata.hasRecognizableBrand;
}
