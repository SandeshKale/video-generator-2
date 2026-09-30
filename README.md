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

Weeks 1–6 of the `BUILD_PLAN.md` roadmap are done (106/106 tests pass, `bunx tsc --noEmit` is clean):

- **Week 1–2**: EDL schema, asset normalization CLI, Remotion concurrency benchmark, and a real 3-minute/5,400-frame render soak test — all verified against real ffmpeg/Remotion output, results recorded in `BUILD_PLAN.md` section 5.9.
- **Week 3**: Azure TTS wired for real via the official Speech SDK (`VOICE_PROVIDER=azure` by default — see below), an SRT caption writer, Freesound search with license filtering, and ffmpeg sidechain ducking + loudness mastering. Testing the ducking code caught a real bug (main/sidechain inputs were swapped, so it was ducking the wrong signal) and testing the licensing filters caught another (a license-attribution check that silently returned the wrong answer for a plain Attribution license) — both fixed, both now covered by regression tests.
- **Week 4**: music ledger loader (validates the JSON ledger, rejects duplicate track IDs / missing files / inconsistent attribution flags), Pexels + Pixabay search wired for real with Pixabay's required 24h cache actually enforced, a real perceptual-hash (aHash) implementation for B-roll dedup using ffmpeg (no external image-hashing dependency, tested against real decoded frames), and a Flux thumbnail pipeline wired against fal.ai's actual queue-based API (submit → poll → fetch), with the polling state machine unit-tested including a genuine timeout case.
- **Week 5**: three real `GraphicScene` components — `StatCallout` (animated count-up), `LabeledDiagram` (staggered-reveal mechanism diagram), `KenBurnsStill` (pan/zoom on a normalized still) — built on tested pure-frame motion math (`h-render/motion/`), replacing the old placeholder dispatcher. Caught by actually running the render rather than trusting a typecheck: `Root.tsx` referencing its fixture image via Node's `pathToFileURL` broke Remotion's webpack bundle (`node:path` isn't resolvable in the browser bundle context) — fixed by moving to Remotion's `public/` + `staticFile()` convention. All three components visually verified via rendered stills.
- **Week 6**: `src/lib/anthropic.ts` — an injectable-client wrapper around `@anthropic-ai/sdk`'s structured-output path (`messages.parse()` + `zodOutputFormat()`, model `claude-opus-5-5`), the only place this repo calls an LLM to *generate* content. Chunked script generation (outline → hook → per-chapter → payoff → consistency reword pass, `c-script/script.ts`), 10-concept packaging generation (`b-packaging/packaging.ts`), and two-step research claim tagging — an LLM drafts a claim + cited source passage, a Jev `Noul` verifies it before it earns provenance FACT (`a-research/research.ts`). **Live-tested the Jev-based gates for the first time** (`JEV_API_KEY` is available here even though `ANTHROPIC_API_KEY` is not) — `test/jev.live.test.ts` makes real API calls, and this caught a real bug: `scorePackagingConcepts()`'s score is a 0-4 index into its criteria list, not 0-10 — the original `SCORE_THRESHOLD = 8` was unreachable. Fixed to `3.2` with a regression test pinned to the live-observed score. The other two live-tested gates (cue-match, claim-verification) both discriminated correctly on the first try.
- Voice provider defaults to `azure` (~$0.15–0.20/video, no GPU needed) after directly measuring self-hosted Chatterbox at 3.72× realtime on this project's CPU-only hardware — see `BUILD_PLAN.md` section 5.4 for the numbers. `voicebox`/Chatterbox remains available but is GPU-only.
- Live network calls to Azure, Freesound, Pexels, Pixabay, fal.ai, and Anthropic are **not** exercised end-to-end in this dev sandbox (no credentials here for those; Jev's `JEV_API_KEY` is the exception and is live-tested) — everything else (SDK types, request/response shapes confirmed against each provider's own docs, filter logic, SRT formatting, the ffmpeg filter graphs, the queue-polling state machine, the LLM prompt builders and orchestration against a mocked client) is real and tested, not assumed.
- Still open from Week 1: the YouTube API compliance audit application — needs a human on the Google Cloud console, not something this repo can automate.

Everything past Week 6 is stubbed per stage, ready to build in the order `BUILD_PLAN.md` section 9 lays out.
