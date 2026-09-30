/**
 * BUILD_PLAN.md section 5.6 (mandatory, new vs. the original plan) +
 * validation doc section 3.5.2. v1 = YouTube Audio Library tracks only,
 * downloaded manually into assets/music/ with license+attribution flags in
 * this ledger -- zero Content ID risk. v2 = Epidemic Sound Partner API
 * (developers.epidemicsound.com, confirmed real but partnership-gated --
 * do not plan on it before a partnership is signed). NEVER Suno/Udio/
 * "no copyright" MP3 sites as a production music bed -- unbounded claim risk.
 *
 * Note (Claude's own addition, not in the source critiques): Audio Library
 * tracks are recognizable precisely because so many channels use them --
 * weigh moving to a channel-safelisted paid library sooner than "when
 * volume justifies it" if a distinct sonic identity matters from video 1.
 */
import { z } from "zod";
import { join } from "node:path";

export const MusicLedgerEntrySchema = z
  .object({
    trackId: z.string(),
    filePath: z.string(),
    license: z.literal("AUDIO_LIBRARY"),
    energy: z.enum(["low", "mid", "high"]),
    requiresAttribution: z.boolean(),
    attributionText: z.string().optional(),
  })
  .refine((entry) => !entry.requiresAttribution || !!entry.attributionText?.trim(), {
    message: "requiresAttribution is true but attributionText is missing/empty",
    path: ["attributionText"],
  });
export type MusicLedgerEntry = z.infer<typeof MusicLedgerEntrySchema>;

const DEFAULT_LEDGER_PATH = join(import.meta.dir, "..", "..", "..", "assets", "music", "ledger.json");

/** Loads and validates assets/music/ledger.json (or an override path).
 * Fails loudly -- a malformed ledger entry, or a trackId that appears
 * twice, or a filePath that doesn't actually exist on disk, must never
 * silently resolve to "no music" mid-pipeline; it should fail before the
 * pipeline commits to a render. `checkFilesExist` defaults to true; set
 * it false only for tests that intentionally use fixture paths that
 * don't exist on disk. */
export async function loadMusicLedger(
  ledgerPath: string = DEFAULT_LEDGER_PATH,
  opts: { checkFilesExist?: boolean } = {},
): Promise<MusicLedgerEntry[]> {
  const { checkFilesExist = true } = opts;
  const raw = await Bun.file(ledgerPath).json().catch((err) => {
    throw new Error(`Failed to read/parse music ledger at ${ledgerPath}: ${err}`);
  });

  if (!Array.isArray(raw)) throw new Error(`Music ledger at ${ledgerPath} must be a JSON array`);

  const entries: MusicLedgerEntry[] = raw.map((entry, i) => {
    const parsed = MusicLedgerEntrySchema.safeParse(entry);
    if (!parsed.success) {
      throw new Error(`Music ledger entry ${i} at ${ledgerPath} is invalid: ${parsed.error.message}`);
    }
    return parsed.data;
  });

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.trackId)) throw new Error(`Duplicate trackId "${entry.trackId}" in music ledger at ${ledgerPath}`);
    seenIds.add(entry.trackId);
  }

  if (checkFilesExist) {
    for (const entry of entries) {
      const exists = await Bun.file(entry.filePath).exists();
      if (!exists) throw new Error(`Music ledger entry "${entry.trackId}" points at a missing file: ${entry.filePath}`);
    }
  }

  return entries;
}

export async function selectMusicForChapter(
  ledger: MusicLedgerEntry[],
  desiredEnergy: "low" | "mid" | "high",
): Promise<MusicLedgerEntry> {
  const candidates = ledger.filter((t) => t.energy === desiredEnergy);
  if (candidates.length === 0) {
    throw new Error(`No ledger tracks tagged energy="${desiredEnergy}" -- add tracks to assets/music/ledger.json before this can resolve.`);
  }
  // Math.random() is fine here -- this runs once at asset-build time, not
  // inside MasterVideo's per-frame render path, so it doesn't violate the
  // "pure function of frame" rule in src/stages/h-render/MasterVideo.tsx.
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
