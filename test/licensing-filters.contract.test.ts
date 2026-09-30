/**
 * src/lib/licensing/filters.ts -- these are the hard, deterministic legal
 * gates (BUILD_PLAN.md section 8), so they need real test coverage against
 * the EXACT license-name strings Freesound's API actually returns
 * (confirmed against freesound.org/docs/api/resources_apiv2.html:
 * "Attribution", "Attribution NonCommercial", "Creative Commons 0" -- not
 * URLs). This suite caught a real bug in requiresAttribution() on first
 * write -- see the dated comment in filters.ts.
 */
import { describe, expect, test } from "bun:test";
import { isFreesoundLicenseSafe, requiresAttribution, flagForManualReview } from "../src/lib/licensing/filters";

describe("isFreesoundLicenseSafe", () => {
  test("allows Creative Commons 0", () => {
    expect(isFreesoundLicenseSafe("Creative Commons 0")).toBe(true);
  });

  test("allows plain Attribution", () => {
    expect(isFreesoundLicenseSafe("Attribution")).toBe(true);
  });

  test("blocks Attribution NonCommercial", () => {
    expect(isFreesoundLicenseSafe("Attribution NonCommercial")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(isFreesoundLicenseSafe("ATTRIBUTION NONCOMMERCIAL")).toBe(false);
    expect(isFreesoundLicenseSafe("creative commons 0")).toBe(true);
  });
});

describe("requiresAttribution", () => {
  test("plain Attribution requires attribution", () => {
    // This is the exact case the pre-fix version of this function got
    // backwards -- "attribution".includes("by") is false, so it used to
    // silently return false here.
    expect(requiresAttribution("Attribution")).toBe(true);
  });

  test("Attribution NonCommercial requires attribution", () => {
    expect(requiresAttribution("Attribution NonCommercial")).toBe(true);
  });

  test("Creative Commons 0 does not require attribution", () => {
    expect(requiresAttribution("Creative Commons 0")).toBe(false);
  });
});

describe("flagForManualReview", () => {
  test("flags a clip with people in it", () => {
    expect(flagForManualReview({ peopleCount: 2 })).toBe(true);
  });

  test("flags a clip with a recognizable brand", () => {
    expect(flagForManualReview({ hasRecognizableBrand: true })).toBe(true);
  });

  test("does not flag a clean clip", () => {
    expect(flagForManualReview({ peopleCount: 0, hasRecognizableBrand: false })).toBe(false);
  });

  test("does not flag with no metadata provided", () => {
    expect(flagForManualReview({})).toBe(false);
  });
});
