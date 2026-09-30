# yt16x9-pipeline

Automated 16:9 (1920×1080) long-form YouTube video pipeline. Bun + TypeScript + Remotion.

**Read [`BUILD_PLAN.md`](./BUILD_PLAN.md) first** — it is the canonical, source-cited spec this scaffold was built from (fact-checked against Remotion's/Google's/YouTube's/Epidemic Sound's own primary sources, with the contested judgment calls independently arbitrated via a live Jev API call — the validation trail is summarized in BUILD_PLAN.md's section headers and inline citations).

## Quick start

```bash
bun install
cp .env.example .env   # fill in API keys — see BUILD_PLAN.md section 6 for what each one gates
bun test                # EDL contract tests
bunx tsc --noEmit        # typecheck
bun run remotion:studio  # opens the hello-world composition in the Remotion Studio UI
bun run remotion:still src/stages/h-render/index.ts MasterVideo out/still.png --frame=15
```

## Where things live

- `src/edl/schema.ts` — the one contract every stage reads/writes. Read this second, after `BUILD_PLAN.md`.
- `src/stages/{a..k}-*/` — one directory per pipeline stage, lettered to match `BUILD_PLAN.md` section 3's architecture diagram. Most are stubs (`throw new Error("TODO Week N: ...")`) pointing at the exact week/section to implement them — this is a real, typechecked, tested scaffold, not a finished pipeline.
- `src/lib/jev.ts` — typed Jev (TypeSafe AI) client. Score/Choice/Noul gates only; Jev never generates content in this codebase.
- `src/orchestration/` — Inngest workflow + the idempotency cache every paid call must go through.
- `test/` — one contract-test file per stage that has real logic to test (EDL, normalize, duck-and-master, SRT, TTS, licensing filters, SFX, broll, music, stills). Grow these first whenever a bug turns out to be a shape problem, which `BUILD_PLAN.md` section 10 notes is the most common failure class here — several of these caught real production bugs on first write (a swapped ffmpeg filter input order, a backwards license-attribution check), see `BUILD_PLAN.md`'s Week 3/4 roadmap entries.

## Status

Weeks 1–4 of the `BUILD_PLAN.md` roadmap are done (63/63 tests pass, `bunx tsc --noEmit` is clean):

- **Week 1–2**: EDL schema, asset normalization CLI, Remotion concurrency benchmark, and a real 3-minute/5,400-frame render soak test — all verified against real ffmpeg/Remotion output, results recorded in `BUILD_PLAN.md` section 5.9.
- **Week 3**: Azure TTS wired for real via the official Speech SDK (`VOICE_PROVIDER=azure` by default — see below), an SRT caption writer, Freesound search with license filtering, and ffmpeg sidechain ducking + loudness mastering. Testing the ducking code caught a real bug (main/sidechain inputs were swapped, so it was ducking the wrong signal) and testing the licensing filters caught another (a license-attribution check that silently returned the wrong answer for a plain Attribution license) — both fixed, both now covered by regression tests.
- **Week 4**: music ledger loader (validates the JSON ledger, rejects duplicate track IDs / missing files / inconsistent attribution flags), Pexels + Pixabay search wired for real with Pixabay's required 24h cache actually enforced, a real perceptual-hash (aHash) implementation for B-roll dedup using ffmpeg (no external image-hashing dependency, tested against real decoded frames), and a Flux thumbnail pipeline wired against fal.ai's actual queue-based API (submit → poll → fetch), with the polling state machine unit-tested including a genuine timeout case.
- Voice provider defaults to `azure` (~$0.15–0.20/video, no GPU needed) after directly measuring self-hosted Chatterbox at 3.72× realtime on this project's CPU-only hardware — see `BUILD_PLAN.md` section 5.4 for the numbers. `voicebox`/Chatterbox remains available but is GPU-only.
- Live network calls to Azure, Freesound, Pexels, Pixabay, and fal.ai are **not** exercised end-to-end in this dev sandbox (no credentials here) — everything else (SDK types, request/response shapes confirmed against each provider's own docs, filter logic, SRT formatting, the ffmpeg filter graphs, the queue-polling state machine) is real and tested, not assumed.
- Still open from Week 1: the YouTube API compliance audit application — needs a human on the Google Cloud console, not something this repo can automate.

Everything past Week 4 is stubbed per stage, ready to build in the order `BUILD_PLAN.md` section 9 lays out.
