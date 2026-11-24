# Validation & Constraints

## Commands
- **Type-check:** `npm run lint` (`tsc --noEmit`)
- **Build:** `npm run build` (`vite build`)
- **Dev server:** `npm run dev` (`tsx server.ts`, listens on `http://localhost:3000`)
- **TS unit tests:** `node --test src/data/srt.test.ts src/data/timing.test.ts` (uses Node/tsx; verify runner support in workspace)
- **E2E render check (requires running dev server + `ffmpeg`/`ffprobe`):** `npx tsx scripts/verify-recap.ts`
- **Python unit tests:** `python -m unittest python_pipeline/test_timing.py`

## Known Constraints
- `ffmpeg` and `ffprobe` must be installed and available on `PATH` for media probing, rendering, and `scripts/verify-recap.ts`.
- `GEMINI_API_KEY` must be set in `.env` or environment for `/api/analyze-episode`, `/api/translate`, `/api/shorten-clip`, and `python_pipeline` Gemini calls.
- `vite.config.ts` disables HMR/watching when `DISABLE_HMR=true`; keep this intact.
- `package.json` `clean` script uses `rm -rf dist server.js` (POSIX syntax; use PowerShell `Remove-Item` on Windows if needed).
