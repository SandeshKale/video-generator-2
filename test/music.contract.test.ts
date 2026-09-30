/**
 * src/stages/d-assets/music.ts's loadMusicLedger() -- real file I/O
 * against temp fixture files, not mocked. Covers the failure modes that
 * matter for a mandatory-per-BUILD_PLAN.md gate: a malformed entry, a
 * duplicate trackId, a missing referenced file, and the requiresAttribution
 * <-> attributionText consistency check.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMusicLedger, selectMusicForChapter, type MusicLedgerEntry } from "../src/stages/d-assets/music";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "music-ledger-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeLedger(entries: unknown[]): Promise<string> {
  const ledgerPath = join(dir, "ledger.json");
  await writeFile(ledgerPath, JSON.stringify(entries));
  return ledgerPath;
}

describe("loadMusicLedger", () => {
  test("loads a valid ledger and checks referenced files exist", async () => {
    const trackPath = join(dir, "track1.wav");
    await writeFile(trackPath, "not-really-audio-just-a-fixture");
    const ledgerPath = await writeLedger([
      { trackId: "t1", filePath: trackPath, license: "AUDIO_LIBRARY", energy: "mid", requiresAttribution: false },
    ]);

    const entries = await loadMusicLedger(ledgerPath);
    expect(entries.length).toBe(1);
    expect(entries[0]!.trackId).toBe("t1");
  });

  test("rejects a ledger entry pointing at a file that doesn't exist", async () => {
    const ledgerPath = await writeLedger([
      { trackId: "t1", filePath: join(dir, "does-not-exist.wav"), license: "AUDIO_LIBRARY", energy: "low", requiresAttribution: false },
    ]);
    await expect(loadMusicLedger(ledgerPath)).rejects.toThrow(/missing file/);
  });

  test("skips the file-existence check when checkFilesExist is false", async () => {
    const ledgerPath = await writeLedger([
      { trackId: "t1", filePath: "/nonexistent/path.wav", license: "AUDIO_LIBRARY", energy: "low", requiresAttribution: false },
    ]);
    const entries = await loadMusicLedger(ledgerPath, { checkFilesExist: false });
    expect(entries.length).toBe(1);
  });

  test("rejects a duplicate trackId", async () => {
    const p1 = join(dir, "a.wav");
    const p2 = join(dir, "b.wav");
    await writeFile(p1, "x");
    await writeFile(p2, "x");
    const ledgerPath = await writeLedger([
      { trackId: "dup", filePath: p1, license: "AUDIO_LIBRARY", energy: "low", requiresAttribution: false },
      { trackId: "dup", filePath: p2, license: "AUDIO_LIBRARY", energy: "high", requiresAttribution: false },
    ]);
    await expect(loadMusicLedger(ledgerPath)).rejects.toThrow(/Duplicate trackId/);
  });

  test("rejects requiresAttribution: true with no attributionText", async () => {
    const p1 = join(dir, "a.wav");
    await writeFile(p1, "x");
    const ledgerPath = await writeLedger([
      { trackId: "t1", filePath: p1, license: "AUDIO_LIBRARY", energy: "low", requiresAttribution: true },
    ]);
    await expect(loadMusicLedger(ledgerPath)).rejects.toThrow(/invalid/);
  });

  test("rejects malformed JSON with a clear error, not a crash", async () => {
    const ledgerPath = join(dir, "bad.json");
    await writeFile(ledgerPath, "{ not valid json");
    await expect(loadMusicLedger(ledgerPath)).rejects.toThrow(/Failed to read\/parse/);
  });

  test("rejects a ledger that isn't a JSON array", async () => {
    const ledgerPath = join(dir, "not-array.json");
    await writeFile(ledgerPath, JSON.stringify({ foo: "bar" }));
    await expect(loadMusicLedger(ledgerPath)).rejects.toThrow(/must be a JSON array/);
  });
});

describe("selectMusicForChapter", () => {
  const ledger: MusicLedgerEntry[] = [
    { trackId: "low1", filePath: "x", license: "AUDIO_LIBRARY", energy: "low", requiresAttribution: false },
    { trackId: "high1", filePath: "x", license: "AUDIO_LIBRARY", energy: "high", requiresAttribution: false },
  ];

  test("only selects from tracks matching the requested energy", async () => {
    const pick = await selectMusicForChapter(ledger, "low");
    expect(pick.trackId).toBe("low1");
  });

  test("throws when no track matches the requested energy", async () => {
    await expect(selectMusicForChapter(ledger, "mid")).rejects.toThrow(/No ledger tracks tagged energy="mid"/);
  });
});
