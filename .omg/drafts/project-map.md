# Project Map

## Root Configuration
- `package.json` — Node scripts (`dev`, `start`, `build`, `preview`, `clean`, `lint`) and dependencies (`react`, `express`, `vite`, `@google/genai`, `tsx`, `typescript`).
- `tsconfig.json` — TypeScript config (`ES2022`, `moduleResolution: "bundler"`, `allowImportingTsExtensions: true`, `noEmit: true`, `@/*` alias).
- `vite.config.ts` — Vite + React + Tailwind v4, `@` alias, `copy-unbundled-src-assets` build plugin, `DISABLE_HMR` support.
- `.env.example` — Documents `GEMINI_API_KEY` and `APP_URL`.

## Primary App (Node.js / TypeScript / React)
- `server.ts` — Express server (port `3000`), `ffmpeg`/`ffprobe` media probing & rendering, Gemini API calls with retry (`withGeminiRetry`), and API routes:
  - `GET /api/health`
  - `GET /api/default-render`
  - `GET /api/projects/:project/download`
  - `POST /api/upload-episode`
  - `POST /api/analyze-episode`
  - `POST /api/import-srt`
  - `POST /api/translate`
  - `POST /api/shorten-clip`
  - `POST /api/render`
- `src/App.tsx` — Main studio UI state (clips, subtitle mode, burn/mask options, render/storyboard player switching).
- `src/components/RecapPlayer.tsx` — Video & subtitle preview player.
- `src/components/ScriptPanel.tsx` — Clip list, script editing, and pacing controls.
- `src/data/recapClips.ts` — `RecapClip` / `RenderResult` types and initial clip data (`INITIAL_RECAP_CLIPS`, `SOURCE_VIDEO_URL`).
- `src/data/timing.ts` & `src/data/timing.test.ts` — Burmese speech duration estimation, cue wrapping, and tight clip pacing helpers.
- `src/data/srt.ts` & `src/data/srt.test.ts` — SRT generation (`buildSrtFromClips`) and parsing (`parseSrt`).
- `scripts/verify-recap.ts` — End-to-end `/api/render` verification script against a running dev server (`http://localhost:3000`).

## Python Pipeline (`python_pipeline/`)
- `python_pipeline/app.py` — FastAPI server (`POST /api/plan`, `GET /api/jobs/{job_id}`, `POST /api/render`).
- `python_pipeline/run_recap.py` — CLI runner for resumable recap planning and 16:9 rendering.
- `python_pipeline/gemini_script_service.py` — Resumable chunked Gemini script generation.
- `python_pipeline/checkpoint_store.py` — Job directory & checkpoint persistence.
- `python_pipeline/models.py` — Pydantic models (`RecapClip`, etc.).
- `python_pipeline/timing.py` & `python_pipeline/test_timing.py` — Python timing helpers and unit tests.
- `python_pipeline/video_renderer.py` — `ffmpeg` 16:9 video & Burmese subtitle rendering.
- `python_pipeline/requirements.txt` — Python dependencies (`fastapi`, `uvicorn`, `google-genai`, `pydantic`).

## Sample & Reference Docs
- `sample-output/timing-review/` — Sample source video (`source.mp4`), rendered outputs, and review notes.
- `PYTHON_IMPLEMENTATION_GUIDE.md`, `RECAP_TIMING_FIX.md` — Architecture and timing fix documentation.
