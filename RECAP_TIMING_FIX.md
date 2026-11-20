# Isolated narration, timing and subtitle repair

Prior local changes are committed on `main` at `997c736`, with rollback tag `recap-before-timing-fix-20261120`. The repair is isolated on `fix/recap-narration-timing`. To return to the preserved application after stopping the development server, use `git switch main`; no reset or clean is necessary. Keep any subsequent work committed before switching. Generated runtime files are ignored and do not change the checkpoint.

## Root cause and scope

Node `server.ts`, React `App`/`RecapPlayer`/`ScriptPanel`, and the Python rendering/TTS pipeline all participate. Renderers capped real narration at 14/16 seconds, preview used different minimums, imported SRT accelerated speech to fit cue windows, and every segment became one paragraph-long subtitle. Duration probes silently substituted 8.5 seconds on invalid output; Python reused rendered segments after script changes.

Both renderers now use measured narration plus a small frame-rounded pause, reject missing or stale audio, and enforce 0.85x–1.15x video speed. A segment that cannot fit requires review, source-range adjustment within its scene, or meaning-preserving wording changes. The app offers source-range fields and sample export, and stops after storyboard generation before processing an entire project. SRT source windows now select footage; output windows follow natural narration rather than forcing speech into imported timestamps. Gaps between imported source windows are omitted in the recap.

Shared TypeScript helpers supply preview and server subtitle cues. Edge TTS records word boundaries for aligned phrases; providers without usable alignment use explicitly approximate phrase timing. SRT and burned subtitles use the same final cues. Burmese splitting uses Intl grapheme/word boundaries in TypeScript and existing phrase separators in Python. Narration edits and voice changes invalidate generated assets and pending responses; Listen playback is stopped when invalidated.

Generation prompts preserve key identities, actions, motivations, chronology, cause/effect and reveals, and treat short estimates as preferences. There is no automatic semantic-equivalence guarantee: compare the review sample against source context before accepting shortened narration. No new dependency was added; the existing Python edge-tts minimum is now 7.3.1 for its verified WordBoundary option.

## Verification

- `npm run lint` (TypeScript), `npm run build`, six TypeScript tests.
- Nine Python unit tests using the existing requirements installed into `/tmp/recap-timing-python`; default Python lacks those dependencies.
- `npx tsx scripts/verify-recap.ts` against the running local server: real Burmese audio, both input modes, stale/missing audio, impossible short footage, provider-aligned cue consistency, and four-segment timing drift.
- Real Python TTS/render smoke and two-segment concat smoke; final AAC padding is about 21 ms, does not accumulate per segment, and does not clip narration.
- `git diff --check`.

See `sample-output/timing-review/` for MP4, SRT, inputs and review notes. The installed FFmpeg has no libass, so burn-in has an actionable preflight error and is not visually verified. Browser automation host was unavailable. Human story, pronunciation, pacing and subtitle-layout review remain outstanding; no whole-project export was run.
