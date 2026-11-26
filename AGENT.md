# AGENT.md

Guidance for coding agents working in **RecapCut Studio** (`chore-init-agent-md`).

## Overview
- **Primary app (Node.js / TypeScript / React):** Express server ([`server.ts`](server.ts)) on port `3000` serving the React 19 + Vite 8 + Tailwind v4 frontend (`src/`) and `/api/*` endpoints for episode upload, dual-provider AI script generation/translation/shortening, SRT import, and `ffmpeg` 16:9 recap rendering.
- **Secondary pipeline (Python):** Resumable FastAPI/CLI implementation under `python_pipeline/` (`app.py`, `run_recap.py`, `gemini_script_service.py`, `checkpoint_store.py`, `video_renderer.py`, `timing.py`) sharing the same dual-provider AI configuration.

## AI Providers & Models
Both the Node.js backend and Python pipeline support **dual-provider AI** controlled by `AI_PROVIDER` (`auto` | `agy` | `gemini`, defaulting to `auto`):
- **`auto` (default):** Uses the Gemini API SDK (`@google/genai` / `google-genai`) when a valid `GEMINI_API_KEY` is configured; otherwise automatically falls back to the local Antigravity CLI (`agy`).
- **`agy`:** Forces execution through the `agy` CLI (`AGY_BIN`, default `agy`) regardless of `GEMINI_API_KEY`.
- **`gemini`:** Forces execution through the Gemini API SDK and requires `GEMINI_API_KEY`.

**Overrides & Diagnostics:**
- **Node.js API:** `POST /api/translate`, `POST /api/shorten-clip`, and `POST /api/analyze-episode` accept an optional `req.body.provider` (`"auto" | "agy" | "gemini"`). `GET /api/health` reports the resolved `aiProvider`.
- **Python Pipeline:** `POST /api/plan` accepts `provider` in `GeneratePlanRequest` (`models.py`), and `python_pipeline/run_recap.py` accepts `--provider auto|agy|gemini` (default `auto`).

**Task-Specific Model Defaults:**
- **Text tasks** (`POST /api/translate`, `POST /api/shorten-clip`): `AGY_TEXT_MODEL="gemini-4-hydrogen-medium"` (`agy` CLI) or `GEMINI_TEXT_MODEL="gemini-4-hydrogen"` (Gemini API).
- **Multimodal video analysis** (`POST /api/analyze-episode`, `generate_resumable_recap_plan`): `AGY_VIDEO_MODEL="gemini-4-argon-medium"` (`agy` CLI using 10-minute 360p 1fps proxy chunks, `read_file`, `--json-schema`, and `-r <conversation_id>`) or `GEMINI_VIDEO_MODEL="gemini-4-hydrogen"` (Gemini API using `files.upload()`).

## Project Structure
- [`server.ts`](server.ts) — Express API (`/api/health`, `/api/default-render`, `/api/projects/:project/download`, `/api/upload-episode`, `/api/analyze-episode`, `/api/import-srt`, `/api/translate`, `/api/shorten-clip`, `/api/render`), static `/assets`, `/renders`, `/uploads`, and `ffmpeg`/`ffprobe` helpers.
- `src/` — Frontend UI (`src/App.tsx`, `src/components/RecapPlayer.tsx`, `src/components/ScriptPanel.tsx`) and shared clip/SRT/timing modules (`src/data/recapClips.ts`, `src/data/srt.ts`, `src/data/timing.ts`).
- `scripts/verify-recap.ts` — Integration check against a running dev server (`http://localhost:3000/api/render`) using `sample-output/timing-review/source.mp4`.
- `python_pipeline/` — Parallel Python FastAPI/CLI pipeline (`requirements.txt`, `models.py`, `timing.py`, `test_timing.py`).
- `sample-output/timing-review/` — Sample media and timing review artifacts.

## Commands
- **Dev server:** `npm run dev` (`tsx server.ts`, port `3000`)
- **Type-check:** `npm run lint` (`tsc --noEmit`)
- **Production build:** `npm run build` (`vite build`)
- **Start production server:** `npm run start` (`node server.ts`)
- **TS unit tests:** `node --test src/data/srt.test.ts src/data/timing.test.ts`
- **E2E render verification (requires running dev server + `ffmpeg`/`ffprobe`):** `npx tsx scripts/verify-recap.ts`
- **Python timing tests:** `python -m unittest python_pipeline/test_timing.py`

## Guardrails & Constraints
- **Preserve Vite config hooks:** Do not remove `copy-unbundled-src-assets` or the `DISABLE_HMR` server/watch handling in [`vite.config.ts`](vite.config.ts).
- **Path safety in `server.ts`:** Keep `resolveSourceVideoPath` restricted to `assets/` and `uploads/` under `public/`.
- **Timing & SRT parity:** `src/data/timing.ts`, `src/data/srt.ts`, `server.ts`, and `python_pipeline/timing.py` share subtitle timing/wrapping assumptions. Verify both unit tests and render output when modifying pacing or SRT formatting.
- **External requirements:** `ffmpeg` and `ffprobe` must be on `PATH` for media probing/rendering. `GEMINI_API_KEY` (see [`.env.example`](.env.example)) is required when `AI_PROVIDER="gemini"`, and optional in `AI_PROVIDER="auto"` (falls back to `agy` CLI) or `AI_PROVIDER="agy"` (requires `AGY_BIN` / `agy` on `PATH`).
- **Windows note:** `package.json` `clean` uses `rm -rf dist server.js` (POSIX). Use PowerShell `Remove-Item` on Windows if cleaning manually.
