# Deep Init Summary

## Overview
**RecapCut Studio** is a full-stack TypeScript/React + Node.js/Express application (with an optional parallel `python_pipeline/` FastAPI/CLI implementation) for creating 16:9 Burmese storytelling video recaps from source episodes using Gemini (`@google/genai`) and `ffmpeg` / `ffprobe`.

## Tech Stack & Entry Points
- **Frontend:** React 19 + Vite 8 + Tailwind CSS v4 (`index.html`, `src/main.tsx`, `src/App.tsx`).
- **Backend (Primary):** Express + `tsx` (`server.ts`, port `3000`) serving Vite dev middleware in development or `dist/` in production, plus `/api/*` endpoints and static `/assets`, `/renders`, `/uploads`.
- **Python Pipeline (Secondary/Resumable):** FastAPI (`python_pipeline/app.py`) and CLI (`python_pipeline/run_recap.py`) with checkpointing (`python_pipeline/checkpoint_store.py`) and `ffmpeg` rendering (`python_pipeline/video_renderer.py`).
- **Media & AI Dependencies:** `ffmpeg` and `ffprobe` on `PATH`; `GEMINI_API_KEY` env var (see `.env.example`).

## Architecture Boundaries & High-Risk Zones
- **Path traversal & media URLs (`server.ts`):** `resolveSourceVideoPath` restricts `sourceVideoUrl` to `assets/` or `uploads/` under `public/`. Static directories (`public/assets`, `public/renders`, `public/uploads`) are created on startup.
- **Timing & SRT synchronization (`src/data/timing.ts`, `src/data/srt.ts`, `server.ts`, `python_pipeline/timing.py`):** Clip pacing (`estimateBurmeseSpeechSec`, `wrapBurmeseCueLines`, `getClipPaceCheck`, `getTightClipDuration`) and SRT cue alignment (`buildSrtFromClips`, `parseSrt`) are shared between frontend UI, Express `/api/render`, and tests. Changes here affect rendered subtitle sync.
- **Vite asset & HMR constraints (`vite.config.ts`):** Do not remove `copy-unbundled-src-assets` plugin or the `DISABLE_HMR` server guard (`hmr` / `watch` disabled when `DISABLE_HMR=true`).
- **Dual implementation:** `server.ts` (Node/TS) and `python_pipeline/` implement parallel recap planning/rendering flows; keep behavior aligned when modifying shared concepts (clip schema, timing, SRT).
