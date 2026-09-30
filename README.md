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
- `test/` — one contract-test file per stage that has real logic to test (EDL, normalize, duck-and-master, SRT, TTS, licensing filters, SFX). Grow these first whenever a bug turns out to be a shape problem, which `BUILD_PLAN.md` section 10 notes is the most common failure class here — two of these test files caught real production bugs on first write (a swapped ffmpeg filter input order, and a backwards license-attribution check), see `BUILD_PLAN.md`'s Week 3 roadmap entry for both.

## Status

Weeks 1–3 of the `BUILD_PLAN.md` roadmap are done (41/41 tests pass, `bunx tsc --noEmit` is clean):

- **Week 1–2**: EDL schema, asset normalization CLI, Remotion concurrency benchmark, and a real 3-minute/5,400-frame render soak test — all verified against real ffmpeg/Remotion output, results recorded in `BUILD_PLAN.md` section 5.9.
- **Week 3**: Azure TTS wired for real via the official Speech SDK (`VOICE_PROVIDER=azure` by default — see below), an SRT caption writer, Freesound search with license filtering, and ffmpeg sidechain ducking + loudness mastering — all with real contract tests, not just type stubs. Testing the ducking code caught a real bug (main/sidechain inputs were swapped, so it was ducking the wrong signal) and testing the licensing filters caught another (a license-attribution check that silently returned the wrong answer for a plain Attribution license) — both fixed, both now covered by regression tests.
- Voice provider defaults to `azure` (~$0.15–0.20/video, no GPU needed) after directly measuring self-hosted Chatterbox at 3.72× realtime on this project's CPU-only hardware — see `BUILD_PLAN.md` section 5.4 for the numbers. `voicebox`/Chatterbox remains available but is GPU-only.
- Live network calls to Azure and Freesound are **not** exercised end-to-end in this dev sandbox (no credentials here) — everything else (SDK types, request/response shapes, filter logic, SRT formatting, the ffmpeg filter graphs) is real and tested, not assumed.
- Still open from Week 1: the YouTube API compliance audit application — needs a human on the Google Cloud console, not something this repo can automate.

Everything past Week 3 is stubbed per stage, ready to build in the order `BUILD_PLAN.md` section 9 lays out.
