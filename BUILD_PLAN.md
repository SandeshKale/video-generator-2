# BUILD_PLAN.md — Automated 16:9 YouTube Pipeline

**Status:** canonical. Supersedes `16x9-youtube-pipeline-implementation-plan.md`, the Qwen/Gemini critiques, and `16x9-youtube-pipeline-hardened-spec.md` — this document folds in everything validated from all of those (see `pipeline-critique-validation-and-final-decisions.md` for the fact-check/arbitration trail) plus the decisions made while actually scaffolding this repo. Read this before writing any stage. Every source file under `src/` carries a docstring pointing back to the relevant section here — treat drift between a file's comment and this document as a bug, not a style choice.

**Runtime: Bun, throughout.** `bun install`, `bun test`, `bunx tsc --noEmit`, `bunx remotion ...` — never `npm`/`node` directly. This repo is deliberately separate from the `video-generator` repo's 9:16 Playwright/ffmpeg pipeline (a sibling project, not a dependency of this one) — it shares that pipeline's philosophy (determinism, per-video visual identity, license discipline) but none of its rendering code, since Remotion's React/`useCurrentFrame()` model replaces `window.__seek(t)`/Playwright entirely for this format.

**Goal, stated precisely:** not "make videos" — produce monetization-safe, highest-quality, highest-creativity 16:9 long-form YouTube explainers, automated end-to-end, where "highest quality/creativity" means *original motion graphics as the primary visual language* (not stock-footage-plus-TTS with a filter on top) and every optimization in this document exists to protect that, not to trade it away for throughput.

---

## 1. Non-negotiable design principles

1. **Determinism.** `MasterVideo` (`src/stages/h-render/MasterVideo.tsx`) is a pure function of `(edl, frame)`. No wall-clock, no `Date.now()`, no unseeded randomness inside the render path. (Randomness at asset-selection time, before rendering, is fine — see `src/stages/d-assets/music.ts` for the one place this repo uses `Math.random()` and why that's safe.)
2. **Every video needs its own visual identity.** Enforced in code, not just style guide: `identityDiffersEnough()` (`src/edl/schema.ts`) hard-fails EDL binding if the new video's palette/type/motif/LUT don't differ from the previous shipped video on ≥2 axes.
3. **Graphic-first, stock-secondary.** Stock B-roll (`src/stages/d-assets/broll.ts`) illustrates; it is never the primary visual language. This is both a monetization-policy requirement (§2 below) and, independently, the higher-retention choice — see the validation doc's finding 2.5.
4. **License-check before ingest, not after.** `src/lib/licensing/filters.ts` — every Freesound/Pexels/Pixabay/LUT asset is filtered *before* it can enter an EDL, never reviewed after the fact.
5. **YouTube-specific safe zones, verified, not assumed.** §11.
6. **Audio is the clock.** `durationInFrames` is always `computeDurationInFrames(masterAudioDurationSec, tailPadFrames)` (`src/edl/schema.ts`) — never a guessed "8–10 minutes." `src/stages/f-bind-edl/bind.ts` enforces this.
7. **One EDL, many consumers.** `src/edl/schema.ts` is the only object that crosses stage boundaries. Prompts, tags, and ad-hoc filenames are not the contract — if a new piece of state needs to pass between two stages, it goes in the EDL schema (bump `schema` to `v2`+ on any breaking change), not a side-channel file.
8. **Normalize once, render many.** Raw stock/TTS/SFX/music never reach Remotion directly. `src/stages/e-normalize-mix/normalize.ts` transcodes everything to 1920×1080 CFR H.264 (video) / 48kHz 16-bit PCM WAV (audio) first.
9. **Idempotent and content-addressed.** Every paid call is wrapped in `withCache({videoId, step, inputHash}, fn)` (`src/orchestration/jobstate/cache.ts`). A retry replays from cache; it never re-bills Flux/Claude/Jev/the voice provider (or, for the self-hosted `voicebox` provider, never re-runs a compute-heavy synthesis+alignment pass).
10. **Transform or reject.** If a video would be "TTS over stock with a LUT," kill it before it renders. §2.
11. **Deterministic checks first, Jev second, human last.** `src/stages/i-qa/qa.ts`'s hard-fail suite (ffprobe/loudnorm/duration/license-ledger — zero models) always runs before any Jev soft-fail check, which always runs before a human is asked to look at anything.
12. **Facts have provenance.** Every scripted claim is `FACT`/`STAGE`/`GAP` (`src/edl/schema.ts` `ProvenanceSchema`). `assertNoVoicedGaps()` is a hard build-time assertion, not a linter suggestion.

---

## 2. Why "graphic-first" is not optional

Verified against YouTube's own current monetization policy (`support.google.com/youtube/answer/1311392`, last updated 2025-07-15): the *reused content* policy requires stock footage to carry "significant original commentary, substantive modifications, or educational or entertainment value" beyond the footage itself; the separately-worded *inauthentic content* policy (renamed from "repetitious content") flags anything "mass-produced" or "produced using a template." A LUT, a grain overlay, and a purpose-built thumbnail are cosmetic — they don't satisfy either clause, and an independent Jev `Noul` evaluation against this exact policy text agreed at 0.06 confidence-of-truth (i.e., strongly false) that they would. Full trail in `pipeline-critique-validation-and-final-decisions.md` §2.1.

**Product shape:** primary visual language = original motion graphics — diagrams, labeled systems, kinetic typography, scene-specific graphic metaphors — built as real Remotion components (`src/stages/h-render/components/`, starting from `GraphicScene.tsx`). Stock B-roll is secondary illustration. Flux stills are for packaging (thumbnails) and occasional metaphor frames, never fake photoreal "documentary footage." Cue vocabulary (`CueKindSchema` in `src/edl/schema.ts`) is an enum — `GRAPHIC | BROLL | STILL | SFX | TEXTPOP | ZOOM | CUT` — and the script generator (`src/stages/c-script/script.ts`) should reach for `GRAPHIC` whenever a sentence describes a mechanism, number, or comparison. That's the actual originality lever, not the color grade.

---

## 3. Architecture

```
A. RESEARCH + PROVENANCE     src/stages/a-research/research.ts
        │  brief -> FACT/STAGE/GAP-tagged claims
        ▼
B. PACKAGING                 src/stages/b-packaging/packaging.ts
        │  10 title×thumb concepts -> Jev Score gate (>=8/10, else regen once, else kill topic)
        │  human picks winner (auto-pick unlocks after 10 published videos' CTR data)
        │  Flux background (src/stages/d-assets/stills.ts) + Remotion type overlay
        ▼
C. SCRIPTED EDL               src/stages/c-script/script.ts
        │  chunked LLM: outline -> hook -> each chapter w/ cues -> payoff
        │  Jev Noul per cue (verifyCuesMatchSentences) + provenance lint
        ▼
D. PARALLEL ASSET BUILD       src/stages/d-assets/{tts,sfx,broll,stills,music}.ts
        │  TTS+alignment | SFX | music | B-roll | Flux stills — independent, cached
        ▼
E. NORMALIZE + MIX            src/stages/e-normalize-mix/{normalize,duck-and-master,captions}.ts
        │  1920x1080 CFR H.264 | 48kHz PCM WAV | sidechain duck | loudnorm -14 LUFS
        │  word-level captions from whichever voice provider ran (§5.4)
        ▼
F. BIND EDL                   src/stages/f-bind-edl/bind.ts
        │  durationInFrames = f(masterAudioDurationSec); provenance + cue + identity asserts
        ▼
G. PREFLIGHT STILLS           src/stages/g-preflight/preflight.ts
        │  remotion still at hook/mid/payoff; human (v1) or Jev Noul review
        ▼
H. RENDER                     src/stages/h-render/{Root,MasterVideo,index}.tsx + components/
        │  Remotion renderMedia(); mux the single pre-mastered audio, never re-mix in Chromium
        ▼
I. HARD QA                    src/stages/i-qa/qa.ts
        │  ffprobe + loudnorm print + duration delta + cue/license ledger checks (deterministic)
        │  then Jev soft-fail checks on sampled stills
        ▼
J. PUBLISH                    src/stages/j-publish/youtube.ts
        │  audited YouTube API project only; private+publishAt; MadeForKids; AI disclosure; chapters
        ▼
K. LEARN                      src/stages/k-learn/analytics.ts
           retention curve -> next video's packaging/pacing prompts

Orchestration: src/orchestration/inngest/functions/create-video.ts (Inngest steps,
  one step = one cache key via src/orchestration/jobstate/cache.ts).
State store:   Postgres, DATABASE_URL (videoId, step, inputHash, outputUri, costCents) — TODO Week 9.
Artifact store: content-addressed files under ARTIFACT_STORE_ROOT (local disk for v1).
```

---

## 4. The EDL — full schema is `src/edl/schema.ts`, not duplicated here

Zod-validated, versioned (`schema: "yt16x9.edl.v1"`), with helper assertions (`assertAllCuesResolved`, `assertNoVoicedGaps`, `identityDiffersEnough`, `computeDurationInFrames`) that are called from `src/stages/f-bind-edl/bind.ts` and `src/stages/i-qa/qa.ts`, and unit-tested in `test/edl.contract.test.ts`. Any new field a stage needs goes here first, as a reviewed schema change, never as an informal property bag.

---

## 5. Phase-by-phase notes (implementation detail lives in each stage's own file docstring)

### 5.1 Research (`a-research/research.ts`)
Ingest a brief: working title, audience, 5–15 sources, claims the creator will stand behind (`BriefSchema`). Tag every claim FACT/STAGE/GAP before scripting — a two-step process (`tagClaims()`), never one LLM call that both drafts and verifies: `draftClaims()` (Claude, `generateStructured()`) drafts claim text plus the specific source passage (`sourceSpan`) each claim is drawn from; `verifyClaimsAgainstSources()` runs a Jev `Noul` checking whether that passage actually supports the claim, and only a claim clearing the confidence bar (`NOUL_CONFIDENCE_THRESHOLD = 0.75`) is tagged FACT — anything else is downgraded to GAP rather than trusted on the LLM's say-so. Jev can check "this sentence is supported by the attached source span," it cannot create the source.

### 5.2 Packaging (`b-packaging/packaging.ts`)
10 concepts (`generateConcepts()`, a direct `generateStructured()`/Claude call — never Jev, which only scores), `scorePackagingConcepts()` (`src/lib/jev.ts`) scores them in one parallel Jev call, gate at `SCORE_THRESHOLD = 3.2`. Regenerate once on failure, then kill the topic — do not lower the bar to keep the pipeline moving. Hybrid thumbnail only: Flux for background/subject with explicit negative-space + `--no text, words, letters, logos` instructions; title type is a Remotion `still` render, never Flux-generated text (diffusion models are unreliable at brand-consistent typography). Human picks the winning concept by default; `AUTO_PICK_UNLOCKED_AFTER_N_VIDEOS = 10` gates auto-pick until real CTR data exists. **Threshold corrected by a live Jev call, 2026-09-30**: Jev's `score` question type returns an index into the criteria list (0-4 for the 5-item poor/weak/adequate/strong/excellent list used here), not 0-10 — the originally-written `SCORE_THRESHOLD = 8` was an unreachable bar (max possible score is 4). A live call scoring a plausible concept pair returned ~3.1-3.15; `3.2` (80% of the 0-4 range, preserving the "80th percentile" intent of the original "8/10" framing) is the corrected bar. See the dated comment in `packaging.ts` and the regression test in `test/jev.contract.test.ts`.

### 5.3 Script (`c-script/script.ts`)
Chunked generation (outline → hook → per-chapter → payoff → global consistency pass) reduces hallucinated/generic cue tags versus one giant prompt — each step is its own `generateStructured()` call (Claude, via `src/lib/anthropic.ts`'s `messages.parse()` + `zodOutputFormat()`), with prior sections' sentences passed in as context so later chunks don't repeat earlier wording. The global consistency pass may only reword for tone/repetition — it is not trusted to keep `provenance`/`cue.visual` correct on its own; the orchestrator overwrites both from the original per-chunk drafts after the pass returns (see `runGlobalConsistencyPass()`). `verifyCuesMatchSentences()` runs a Jev `Noul` per cue. Chapters are plain `0:00`-prefixed lines in the YouTube description (`ChapterSchema` — confirmed there is no separate chapters API object).

### 5.4 Voice (`d-assets/tts.ts` + `lib/whisperx.ts` + `e-normalize-mix/captions.ts`)
Pluggable provider, `VOICE_PROVIDER` env var, three options behind one `synthesizeVoice()` call returning the same `{ audioPath, words }` shape regardless of which ran:

- **`azure` (default)** — native `WordBoundary` events (`AudioOffset`/`WordOffset`), no alignment pass needed at all, no self-hosting, ~$0.15–0.20 for a 10-minute script — the practical default absent a GPU render box.
- **`voicebox` (GPU-only)** — self-hosted **Chatterbox** (Resemble AI, MIT) via **Voicebox** (`github.com/jamiepine/voicebox`, MIT, 56k★), REST API at `VOICEBOX_BASE_URL` (default `http://127.0.0.1:17493`). **Measured directly, 2026-09-30**: installed the underlying `chatterbox-tts` PyPI package (Voicebox is a REST wrapper around the same library, so the finding transfers) in a clean venv on this project's 4 vCPU / 15GB, GPU-less dev sandbox — torch 2.14+cpu, no special tuning. Result: model load ~20s (one-time per server lifetime), then **19.5s of CPU time to generate 5.24s of audio — a 3.72× realtime factor**. Extrapolated to a 10-minute (600s) script, that's **~37 minutes of CPU compute for voice synthesis alone**, directly competing with the Remotion render step on the same box. Resemble's marketed "~200ms latency" is a real number but a GPU, short-utterance one — it says nothing about CPU throughput on a full script, which is what actually matters for this pipeline. Disk footprint: ~1.8GB venv + ~3GB downloaded model weights. One real integration snag hit along the way: current `torchaudio.save()` requires the optional `torchcodec` package; save via `soundfile` directly instead. Chatterbox still has no confirmed native word-timestamp output, so every synthesis (once you do have a GPU box) still runs through `alignWithWhisperX()` (`src/lib/whisperx.ts`). **Verdict: only set `VOICE_PROVIDER=voicebox` on a render box that actually has a GPU** — on CPU alone it is strictly worse than `azure` on speed, reliability, and ops burden, for a savings of ~$0.15–0.20/video. The Voicebox HTTP layer itself (as opposed to the underlying library, which was measured above) is still unverified end-to-end — confirm the exact `/generate` request/response shape against a real running instance before trusting `tts.ts`'s TODO string.
- **`elevenlabs` (optional upgrade, ~$0.45–0.90/video)** — `eleven_v3`'s inline audio-tag expressiveness (`[whispers]`, `[excited]`, etc). Alignment is **character-level only**; `groupCharsIntoWords()` (`e-normalize-mix/captions.ts`) groups it and drops the `[audio-tag]` characters themselves out of the caption stream.

Whichever provider ran, assert `sum(word durations) ≈ audio duration` within 250ms (`assertCaptionCoverage`) before trusting the words for captions — on failure, fall back to (or, for `voicebox`, already ran) a WhisperX pass rather than shipping drifting captions. Always CBR WAV (`normalizeAudioToCbrWav`) immediately after synthesis, for every provider — VBR MP3 into Remotion is a documented audio-drift failure mode; note Chatterbox itself outputs 24kHz, so this resample is load-bearing for that provider, not a formality.

### 5.5 SFX (`d-assets/sfx.ts`)
Freesound's current unified `GET /apiv2/search/` (the `/search/text/` path is deprecated, Nov 2025). `isFreesoundLicenseSafe()` hard-excludes CC-BY-NC before download — monetized YouTube is commercial use. Prefer the `CURATED_ALLOWLIST` per category over live keyword search; generic-keyword result quality is documented as inconsistent.

### 5.6 Music (`d-assets/music.ts`) — mandatory, was missing from the original plan entirely
**v1: YouTube Audio Library only**, downloaded manually into `assets/music/`, tracked in a ledger (`MusicLedgerEntrySchema`) tagged by energy (low/mid/high), selected per chapter — zero Content ID risk. **v2: Epidemic Sound Partner API** (`developers.epidemicsound.com` — confirmed real, but partnership-gated; don't plan on it before a signed partnership). **Never** Suno/Udio/"no copyright" MP3 sites as a production bed. Note from the validation pass: Audio Library tracks are recognizable *because* so many channels use them — weigh moving to v2 sooner than "when volume justifies it" if a distinct sonic identity matters from video 1.

### 5.7 Visual assets (`d-assets/broll.ts`, `d-assets/stills.ts`)
Pexels: header auth, 200 req/hr / 20,000/mo. Pixabay: query-param auth, 100 req/60s, and its docs *require* 24h result caching (`pixabayCache` in `broll.ts` enforces this). `dedupeByIdAndHash()` — same clip in two cues is a fail. Flux.1 via **fal.ai/Replicate only** — Midjourney has no official API and its ToS explicitly bans automation with a documented real ban history; do not integrate it, ever. Photoreal Flux stills require `legal.aiDisclosure = "photoreal"` (confirmed real policy, YouTube now auto-detects undisclosed synthetic content as of May 2026 via C2PA/SynthID signals) — stylized/graphic Flux prompts stay on the lighter disclosure path and are preferred for exactly that reason.

### 5.8 Normalize + mix (`e-normalize-mix/*`)
Order: voice stem (CBR WAV) → music bed trimmed to `voiceDuration + 1.5s` fade → SFX placed on EDL cue times → `duckMusicUnderVoice()` (ffmpeg `sidechaincompress` — **Pedalboard does not do this**, `spotify/pedalboard#254` is open and unresolved since 2023) → SFX bus mixed in → `masterLoudness()` (`loudnorm=I=-14:TP=-1.5:LRA=11`, run **last**). Tune/verify the ducking threshold against the pre-`loudnorm` signal, not the final mastered file — mastering afterward changes the gain structure and can silently drift the calibration. Pedalboard's legitimate role: optional per-track polish (compression/limiting/EQ on the voice stem) *before* ducking, never the ducking itself.

### 5.9 Render (`h-render/*`)
`MasterVideo` consumes `edl.audio.masterUri` as a single pre-mastered file via `<Audio>` — **never re-mix stems inside Chromium**. One `<Sequence>` per `edl.visuals[]` entry. `PIPELINE_FPS = 30` (`src/edl/schema.ts`) is a hard pipeline-wide constant — confirmed via an independent Jev `Choice` call (92% probability) that 30fps is right for this content's diagram/kinetic-type/Ken-Burns motion language; 60fps (used by the `video-generator` repo's 9:16 pipeline for punchy short-form entrances) would double render cost/RAM for motion that doesn't benefit from it here. Benchmark real hardware (`bun run remotion:benchmark`) before touching concurrency settings — Remotion's own documented plateau (GitHub #4949, #4300) is hardware/workload-dependent, tested at up to 224 cores; **do not** default to "render every frame individually and stitch with ffmpeg" preemptively (confirmed premature by an independent Jev `Noul` call at 0.94 confidence) — that's a Week-5+ fallback only if a real soak test on target hardware shows the plateau actually bites at this pipeline's scale.

**Week 2 benchmark results (this sandbox's build hardware: 4 vCPU / 15GB RAM), measured, not estimated** — `bunx remotion benchmark src/stages/h-render/index.ts MasterVideo --concurrencies=1,2,4 --runs=1` against the 10s/300-frame `MasterVideo` fixture composition:

| Concurrency | Wall time | Speedup vs. concurrency=1 |
|---|---|---|
| 1 | 26.17s | 1.00× |
| 2 | 16.51s | 1.59× |
| 4 | 12.11s | 2.16× |

Scaling is sub-linear (as expected — headless Chromium startup and IPC overhead don't parallelize) but monotonically improving through 4 concurrent workers, with **no plateau or regression** at this core count — consistent with the plan's expectation that the documented #4949/#4300 plateau is a very-high-core-count phenomenon (tested there at up to 224 cores), not something a modest single-creator box hits. **Action: default to `--concurrency=4` (or omit the flag and let Remotion auto-detect) on hardware in this class; re-run this exact benchmark command on the actual production box before deploying to different hardware, and only investigate `enableMultiProcessOnLinux` / frame-by-frame fallback strategies if a real re-run there shows a plateau.**

**3-minute soak test, measured**: `bunx remotion render src/stages/h-render/index.ts SoakTest3Min out.mp4 --concurrency=4` — a real 5,400-frame (180s) render — completed in **192s wall clock**, no crashes, no errors, no memory issues on this hardware. Output verified via `ffprobe` to be exactly 180.000000s at 1920×1080, 30fps, h264 — matching the pipeline's contract precisely (`test/normalize.contract.test.ts` verifies the same specs for normalized *inputs*; this is the corresponding proof on the render *output*). This clears the Week 2 gate to start building real `GraphicScene` components (Week 5) without first worrying about render-engine reliability at this scale.

### 5.10 QA (`i-qa/qa.ts`)
Hard fail (no model, checked first): resolution/fps/audio-rate via ffprobe, duration delta <250ms vs. mastered audio, integrated LUFS in [−16, −13], every cue resolved, no disallowed license in the ledger. Soft fail (Jev, then human if low confidence): sampled-still descriptions ("not glitched, text not clipped"). Human (v1, non-optional): packaging pick, three preflight stills, first public video of any new graphic component.

### 5.11 Publish (`j-publish/youtube.ts`)
**Launch blocker, do this in Week 1–2, not Week 10:** a YouTube API project created after 2020-07-28 uploads videos as forced-private until it clears Google's compliance audit (`developers.google.com/youtube/v3/guides/quota_and_compliance_audits`) — there's no published SLA, so submit the audit application immediately and in parallel with everything else, and publish through YouTube Studio manually until it clears (`isApiProjectAudited()` gates `uploadVideo()` on exactly this). `status.privacyStatus = "private"` + `status.publishAt` for scheduling (ignored unless private). `status.selfDeclaredMadeForKids` set explicitly. Chapters live in the description, not a separate field.

### 5.12 Learn (`k-learn/analytics.ts`)
v2 priority, not a launch blocker. Pull retention curve 48–72h post-publish, store against EDL chapter timestamps, feed concrete drop-off data into the next script-generation prompt.

---

## 6. Secrets & config (`.env.example` is authoritative — keep this table in sync with it)

| Key | Gates | Cost model |
|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | script, packaging concepts, provenance drafting | per-token, negligible per video |
| `JEV_API_KEY` | `src/lib/jev.ts` — Score/Choice/Noul gates only | $0.042/M input tokens |
| `VOICE_PROVIDER` / `VOICEBOX_BASE_URL` | `d-assets/tts.ts` — GPU-only alt voice, self-hosted Chatterbox via Voicebox (measured ~3.7× slower than realtime on CPU — see §5.4, don't use without a GPU) | $0 API cost, real cost is compute time/ops |
| `AZURE_SPEECH_KEY`/`REGION` | TTS fallback | ~$16–22/1M chars |
| `ELEVENLABS_API_KEY` | TTS optional upgrade (`eleven_v3` audio tags) | ~$0.05–0.10/1k chars |
| `FREESOUND_API_KEY` | `d-assets/sfx.ts` | free, rate-limited |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` | `d-assets/broll.ts` | free, rate-limited |
| `FAL_KEY` | `d-assets/stills.ts` | $0.025–0.04/megapixel |
| `EPIDEMIC_SOUND_PARTNER_KEY` | music v2 only | partnership-gated |
| `INNGEST_EVENT_KEY`/`SIGNING_KEY` | orchestration | free tier: 50k executions/mo |
| `YOUTUBE_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` | `j-publish/youtube.ts` | free, quota-based |
| `DATABASE_URL` | `orchestration/jobstate` state store | infra cost only |

**Remotion license**: solo builder / ≤3-person team = Free License, covers automation at $0 (confirmed verbatim against `remotion.dev/docs/license/faq`). The Automators tier ($0.01/render, $100/mo minimum) only applies to a Company License at 4+ employees, and freelancer/agency headcount aggregates into that threshold.

---

## 7. Cost model (per ~10 minute video, solo, self-hosted render)

| Item | Estimate |
|---|---|
| LLM script + packaging | ~$0.02–0.08 |
| Voice — `azure` (default) | ~$0.15–0.20 |
| Voice — `voicebox` (GPU-only alt) | $0 API cost, but **measured** ~37min CPU compute/10min-video if no GPU (§5.4) — not recommended without one |
| Voice — `elevenlabs` (optional upgrade) | ~$0.45–0.90 |
| Flux thumbnails + a few stills | ~$0.10–0.40 |
| Pexels/Pixabay/Freesound | $0 |
| Music (Audio Library v1) | $0 |
| Jev gates | <$0.01 |
| Remotion license | $0 (solo/≤3) |
| Compute | amortized electricity/box |
| **Total (default `azure` provider)** | **~$0.30–0.70/video** |
| **Total (with `elevenlabs` upgrade)** | **~$0.60–1.50/video** |
| **Total (`voicebox`, GPU box only)** | **~$0.15–0.50/video + GPU compute time** |

Do not plan a volume target that only makes sense to "amortize Remotion" — that pattern (30 near-identical videos/month against one template) is exactly what the inauthentic-content policy targets.

---

## 8. Legal gates (all programmatic, `src/lib/licensing/filters.ts` + inline stage checks)

1. Freesound: drop NC, attribute BY.
2. Pexels/Pixabay: commercial+modified OK, flag identifiable people/brands for manual review (`flagForManualReview`).
3. Music: Audio Library or channel-safelisted paid library only, logged in the EDL's `legal.licenses`.
4. LUT: per-file license text confirmed before vendoring into `assets/luts/`.
5. Midjourney: never, under any circumstance.
6. Remotion: recheck headcount if the team grows past 3.
7. Voice cloning: only with documented consent.
8. YPP: both the reused-content and inauthentic-content clauses apply, separately — §2.
9. AI disclosure: `legal.aiDisclosure` set correctly at publish time.
10. API audit: no public `videos.insert` from an unaudited project, ever.

---

## 9. Roadmap (single builder, ~12 weeks)

| Weeks | Milestone |
|---|---|
| 1 | `bun install`, EDL schema + contract tests (**done**), Remotion hello-world render (**done**), **submit the YouTube API compliance audit application** (has no SLA — start it now; not automatable, needs a human on the Google Cloud console — still open) |
| 2 | **Done.** Normalization CLI (`bun run normalize -- <video\|audio> <in> <out>`, `src/stages/e-normalize-mix/normalize.ts`) + a real contract test against ffmpeg-generated fixtures (`test/normalize.contract.test.ts`, verifies actual ffprobe output, not just that the code compiles) + `remotion:benchmark` run on real hardware + a real 3-minute/5,400-frame render soak test, both with measured results written into section 5.9 above |
| 3 | **Done.** Azure TTS wired for real via the official `microsoft-cognitiveservices-speech-sdk` (`d-assets/tts.ts` — `SpeechSynthesizer` + `wordBoundary` event; `ticksToSeconds()` unit-tested against Microsoft's documented 100ns-tick unit). SRT writer (`e-normalize-mix/captions.ts`'s `groupWordsIntoCues`/`wordsToSrt`, fully unit-tested including SRT timestamp edge cases). Freesound search wired for real (`d-assets/sfx.ts`, mocked-fetch-tested license filtering). Sidechain duck + loudnorm contract-tested against real ffmpeg output (`test/duck-and-master.contract.test.ts`) — **this caught and fixed two real bugs**, not hypothetical ones: `duckMusicUnderVoice`'s `sidechaincompress` filter had its main/sidechain inputs swapped (it was ducking the voice under the music, the opposite of intended, confirmed by measurement — see the dated comment in `duck-and-master.ts`), and `requiresAttribution()` in `lib/licensing/filters.ts` checked for substring `"by"`, which `"attribution".toLowerCase()` doesn't actually contain, so it silently returned `false` — "no attribution needed" — for a plain Attribution-licensed sound. Live Azure/Freesound network calls themselves are not exercised end-to-end in this sandbox (no credentials) — everything else (SDK types, filter logic, SRT formatting, ffmpeg filter graphs) is real, tested code, not stubs. Voicebox/Chatterbox self-hosting + WhisperX forced alignment remain GPU-only, deferred until a GPU render box is available — CPU-only Chatterbox was benchmarked (see §5.4) at 3.72× realtime, ~37min compute per 10-min video, not worth building against on CPU alone |
| 4 | **Done.** Music ledger loader (`d-assets/music.ts`'s `loadMusicLedger()` — validates the JSON ledger, rejects duplicate `trackId`s, rejects entries whose `filePath` doesn't exist on disk, rejects `requiresAttribution: true` with no `attributionText`; real file-I/O tests, not mocks). Pexels + Pixabay search wired for real (`d-assets/broll.ts`, response shapes confirmed against each provider's own API docs, mocked-fetch tests) with the Pixabay 24h cache actually enforced. `computePerceptualHash()`/`hammingDistance()` — a real average-hash (aHash) implementation using ffmpeg to decode+downscale a frame, no external image-hashing dependency, tested against real ffmpeg output (identical clip → identical hash, visually different clips → nonzero Hamming distance). Flux thumbnail pipeline (`d-assets/stills.ts`) wired against fal.ai's actual queue-based API (confirmed against fal.ai's own docs: `POST https://queue.fal.run/{model}` → poll `status_url` until `COMPLETED` → fetch `response_url`, `Authorization: Key <FAL_KEY>` — not "Bearer") with the polling state machine unit-tested via a mocked fetch + injectable `sleep()`, including a real timeout case. `buildThumbnailPrompt()` keeps Flux strictly to subject/background with title type composited separately by Remotion, per §5.2/5.7. Live Pexels/Pixabay/fal.ai network calls are not exercised end-to-end in this sandbox (no credentials) — same disclosure as Week 3's Azure/Freesound integrations. |
| 5 | **Done.** Three real `GraphicScene` components replacing the placeholder — `StatCallout` (animated count-up number + label, `d-assets/stills.ts`-independent pure-frame math), `LabeledDiagram` (2-6 node sequential-reveal mechanism diagram with a growing connector line), `KenBurnsStill` (pan/zoom on a normalized still via Remotion's `Img`) — plus the underlying tested motion-math modules they share (`h-render/motion/{easing,kenBurns,countUp,diagramReveal}.ts`, 19 new contract tests, all pure functions of `frame`/`durationInFrames`, no wall-clock state). `GraphicScene.tsx` is now a real dispatcher keyed on `visual.component` with a loud red-frame fallback for an unknown/missing component name (same "fail visibly, not silently" principle `KenBurnsStill` applies to a missing `assetUri`). `EdlSchema`'s `VisualSchema` gained an optional `props: z.record(...)` field so a visual can carry per-component config. `Root.tsx`'s `MasterVideo` fixture now exercises all three components in sequence instead of one placeholder. **Real bug found and fixed by actually running the render, not just typechecking**: `Root.tsx` originally referenced its fixture still image via Node's `pathToFileURL`/`join` (`node:path`/`node:url`) — `bunx remotion still` failed with `UnhandledSchemeError: Reading from "node:path" is not handled by plugins`, because Root.tsx is bundled for the *browser* context by Remotion's webpack build, which can't resolve Node builtins. Fixed by moving the fixture to `public/dev-placeholder-still.png` and referencing it via Remotion's own `staticFile()` helper, the documented `public/`-directory convention that exists specifically to sidestep this. All three component types visually verified via rendered `remotion still` PNGs (not just "typechecks"), 82/82 tests pass, `tsc --noEmit` clean. |
| 6 | **Done.** `src/lib/anthropic.ts` — a thin, injectable-client wrapper around `@anthropic-ai/sdk`'s `messages.parse()` + `zodOutputFormat()` structured-output path (model `claude-opus-5-5`), the only place this repo calls an LLM to GENERATE content. Chunked script generator (`generateScriptChunked()`, section 5.3): outline → hook → per-chapter (each chapter's prompt lists every prior sentence so it doesn't repeat wording) → payoff → global consistency reword pass, with `provenance`/`cue.visual` locked to the original per-chunk drafts after that pass rather than trusted from its output. Packaging concept generator (`generateConcepts()`, section 5.2) — 10 distinct title/thumbnail-concept pairs, thumbnail concepts constrained to subject/background only (no text/logos, per the hybrid-thumbnail rule). Two-step research claim tagging (`tagClaims()`, section 5.1) — an LLM drafts claim+sourceSpan pairs, a Jev `Noul` verifies each against its cited passage before it earns provenance FACT. **Live-tested the three Jev-based gates for the first time** (`JEV_API_KEY` is available in this sandbox even though `ANTHROPIC_API_KEY` is not) — `test/jev.live.test.ts` makes real API calls, not mocks, and **this caught a real bug**: `scorePackagingConcepts()`'s `score` question type returns an index into its criteria list (0-4 for the 5-item poor/weak/adequate/strong/excellent list), not a 0-10 scale — the original `SCORE_THRESHOLD = 8` was an unreachable bar, confirmed by a live call scoring a plausible concept pair at ~3.1-3.15. Fixed to `SCORE_THRESHOLD = 3.2` (80% of the real 0-4 range) with a regression test (`test/jev.contract.test.ts`) pinned to that exact live-observed score so a future rescale gets caught immediately. The two other live-tested gates (`verifyCuesMatchSentences`, `verifyClaimsAgainstSources`) both discriminated correctly on the first try (a matching cue/supported claim scored 0.96-0.98, a mismatched cue/unsupported claim scored 0.01-0.02). The Claude/Anthropic call itself remains unverified end-to-end (no `ANTHROPIC_API_KEY` in this sandbox) — same disclosure as every other unavailable-credential integration in this repo; prompt builders, response schemas, and orchestration are real, tested code (a mocked-client suite) exercising the actual control flow, not stubs. 106/106 tests pass, `tsc --noEmit` clean. |
| 7 | `bind-edl` wired to real audio duration + preflight stills + first full 8–10 min render |
| 8 | Hard QA suite fleshed out (`blackdetect`/`silencedetect` thresholds tuned against real renders) + license ledger + identity-diff check |
| 9 | Postgres-backed `jobstate/cache.ts` (replace the in-memory stub) + Inngest wiring with real `inputHash` keys on every paid call |
| 10 | YouTube API client wired for real (contingent on the Week-1 audit having cleared — publish via Studio manually if not) + MadeForKids + chapters + SRT upload |
| 11 | First 2 unlisted, then 1 public video. Real on-device safe-zone screenshots (desktop, iOS, Android, with end screens/cards on) — §11 |
| 12 | Analytics pull, prompt updates from real drop-off data, legal pass, only then consider Remotion Lambda/Cloud Run for scale |

---

## 10. Test strategy

`test/edl.contract.test.ts` is the seed — grow it every time a bug turns out to be an EDL-shape problem in disguise (the single most common failure class in this kind of pipeline). Add as each stage is built:
- Audio fixtures: known WAV + alignment JSON → SRT snapshot.
- FFmpeg fixtures: ducking + loudnorm on a 30s toy mix, assert the LUFS band.
- Remotion still fixtures: one checked-in reference PNG per locked `GraphicScene` component, fail CI on pixel-hash drift above a tight threshold.
- Golden 60s render: rebuilt on every Remotion version bump, compare duration/loudness/three stills.
- Chaos test: kill the render step mid-way, assert the voice provider is not called again on retry (proves the `withCache` idempotency actually works, not just compiles).

No test, no "production-ready."

---

## 11. Safe zones — verify, don't assume

`src/stages/h-render/components/CaptionBand.tsx`'s current caption placement (`paddingBottom: 220`) is a starting guess, not a verified value. Before shipping: screenshot the desktop watch page (default player, with end screens/cards enabled) and the iOS/Android app playing a real 16:9 upload, note where YouTube's own chrome actually sits, and write the measured pixel values back into that component and this section. Do not reuse the `video-generator` repo's 9:16 Instagram-Reels safe-zone numbers — different app, different chrome, verified for a different aspect ratio entirely.

---

## 12. Open items — do not paper over

- Exact current `@remotion/transitions` shader-transition API name — check `remotion.dev` the week you implement transitions; ship hard cuts/simple fades first.
- Per-file LUT licenses — confirm on each individual download page before adding to `assets/luts/`.
- Face/logo detector on stock B-roll — start with manual review (`flagForManualReview`'s output) on v1; don't build a detector before deliberately choosing one.
- YouTube's precise LUFS implementation — no single official spec found; `-14 LUFS integrated / -1.5 dBTP` is a well-corroborated working target, measure against your own first real uploads.
- Postgres schema for the state store (`orchestration/jobstate`) — not yet designed; needed by Week 9.

---

## 13. What to build first if time collapses

1. **Keep:** EDL schema + contract tests, normalization layer, audio clock (durationInFrames from real audio), license filters, hybrid thumbnail, 2–3 real graphic-first scene components, hard QA suite, human packaging gate, the Week-1 API audit submission.
2. **Cut first:** AnimateDiff/Deforum (never in scope here), Pedalboard polish, shader transitions, the Jev sentence-length pacing signal, OCR-based caption QA, Remotion Lambda/Cloud Run, extra Flux B-roll beyond thumbnails.
3. **Cut only if desperate:** Inngest itself (fall back to a bare Postgres job table — `orchestration/jobstate/cache.ts`'s shape survives either way), the Jev packaging score (a human can score 10 titles by hand).

One original, well-timed, legally clean 8-minute video per week beats a pipeline that can emit fourteen templated ones.
