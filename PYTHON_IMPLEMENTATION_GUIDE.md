# 16:9 Burmese Movie Recap Pipeline — Step-by-Step Implementation Spec (For Codex)

Implement a resumable Python pipeline that converts any short clip or **2-hour movie** into a fast-paced **16:9 (1280×720)** Burmese movie recap video using **Gemini (`gemini-4-hydrogen`)** for video analysis/scripting, **FFmpeg + `libass`** for rendering with original movie audio preserved.

---

## Target Tech Stack & System Requirements

- **Python Packages**: `google-genai`, `pydantic`, `fastapi`, `uvicorn`
- **System Tools**: `ffmpeg`, `ffprobe` (compiled with `libx264`, `aac`, and `libass`), plus `Noto Sans Myanmar` font (`fonts-noto-core` / `fonts-noto-extra`)
- **Environment Variable**: `GEMINI_API_KEY` (used only for Gemini video-to-script analysis)

---

## Step 1: Define Data Schemas & Job Workspace
Create deterministic per-video job folders under `storage/jobs/{job_id}/`:
- Derive `job_id` from `sha1(resolved_video_path + file_size + mtime + chunk_minutes)[:12]`.
- Define clip schema fields:
  - `id: int`
  - `source_start: float` (absolute seconds in source movie)
  - `source_end: float`
  - `target_duration: float` (default `4.5`)
  - `english_script: str` (original 3–5s single-sentence summary, ~10–14 words max, no copied dialogue)
  - `burmese_script: str` (natural fast-paced spoken Burmese)

---

## Step 2: Implement Atomic Checkpoints & `429` / `503` Retry Handler
To ensure long 2-hour movie jobs never restart from zero on rate limits or transient outages:
1. **Atomic Save Helper**: Always write state to `checkpoint.json.tmp` and replace `checkpoint.json` via `os.replace()`.
2. **Checkpoint Schema (`checkpoint.json`)**:
   - `job_id`, `source_video_path`, `total_duration_sec`, `chunk_seconds`
   - `proxy_video_path` (cached 360p upload proxy)
   - `gemini_file_name`, `gemini_file_uri`, `gemini_file_mime`
   - `story_so_far` (rolling 2–3 sentence plot summary passed between chunks)
   - `chunks` (dict keyed by chunk index `"0"`, `"1"`, ... holding completed clip arrays)
   - `completed: bool`
3. **Retry Wrapper**:
   - Wrap Gemini upload and `generate_content` calls with retry logic for `429`, `500`, `503`, and `504` errors (up to 5 retries).
   - For `429` (TPM rate limit), wait `~62s + jitter`; for `503`/`500`, use exponential backoff (`8s * 2^attempt + jitter`, capped at `180s`).

---

## Step 3: Build Lightweight Upload Proxy & Reusable Gemini Upload
1. Measure source video duration with `ffprobe`.
2. Generate a cached `360p` proxy via FFmpeg (`scale=640:-2 -r 2 -c:v libx264 -preset veryfast -crf 32`) before uploading so a multi-GB 2-hour HD movie shrinks to ~80–120 MB.
   - Support an optional `strip_audio=True` flag (`-an` instead of `-c:a aac -b:a 48k`) to cut Gemini input tokens by ~50% when dialogue isn't needed.
   - Always keep the **original HD local video** for final rendering in Step 6.
3. Before uploading, check `checkpoint.json` for `gemini_file_name`. Call `client.files.get(name=...)`—if status is still `ACTIVE` (Gemini retains files for 48 hours), reuse the URI without re-uploading. Otherwise upload via `client.files.upload(...)` and poll until `ACTIVE`.

---

## Step 4: Chunked Video Analysis (`gemini-4-hydrogen`)
Split `total_duration_sec` into **20-minute windows** (`chunk_minutes=20`, e.g., 6 chunks for a 2-hour movie):
1. Loop through `(start, end)` ranges. If `str(idx)` already exists in `checkpoint["chunks"]`, skip it immediately.
2. Call `client.models.generate_content(model="gemini-4-hydrogen", ...)` with:
   - `types.Part.from_uri(file_uri=..., mime_type=..., video_metadata=types.VideoMetadata(start_offset=f"{start}s", end_offset=f"{end}s", fps=0.5))`
   - `config=types.GenerateContentConfig(media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW, response_mime_type="application/json", response_schema=ChunkPlanResult)`
3. Prompt requirements:
   - Summarize only `[start, end]` using absolute movie timestamps (`source_start`, `source_end`).
   - Keep each segment **short and punchy (3–5 seconds spoken, 1 single short sentence, ~10–14 words max)** so Burmese subtitles stay clean at 1–2 lines instead of long multi-sentence blocks.
   - Do **not** copy or translate dialogue verbatim—use completely original recap wording in both `english_script` and natural spoken `burmese_script`.
   - Return a 2–3 sentence `chunk_summary` to update `story_so_far` for continuity into the next chunk.
4. Immediately save each completed chunk to `checkpoint.json`. Add an optional configurable delay (e.g., `25s`–`60s`) between chunks when running on Gemini Free Tier (250k TPM cap).
5. Flatten all chunks and sequentially re-number `clip.id` (`1..N`), then export `script.json` and `script_burmese.txt`.

---

## Step 5: Render recap video and SRT
Render selected source ranges at their original duration. Keep the original audio at the configured volume and generate scene-timed Burmese SRT cues. Optionally mask existing subtitles or burn in the new subtitles. Voice generation is handled outside this project.

---

## Step 7: Burmese Subtitle Burn-In (`libass`) & Export
1. Generate `.srt` and `.ass` subtitle files using cumulative segment durations.
2. **Critical Myanmar Shaping Rule**: Do **not** use FFmpeg's `drawtext` filter (it breaks Burmese vowel reordering and stacked consonants). Always use FFmpeg's `ass` filter (`libass` + HarfBuzz) with `Fontname=Noto Sans Myanmar`, `PlayResX=1280`, `PlayResY=720`, `WrapStyle=0`, `Alignment=2`.
3. Run FFmpeg with `cwd=work_dir` and `-vf ass=subtitles.ass` (avoiding path-escaping issues), encoding final output with `libx264 -pix_fmt yuv420p -c:a copy -movflags +faststart`.
4. Expose both a CLI runner (`run_recap.py`) and FastAPI routes (`/api/plan`, `/api/jobs/{job_id}`, `/api/render`).

---

## Verification Checklist for Codex
- Verify `ffmpeg -filters` includes `ass`, and `fc-list :lang=my` returns `Noto Sans Myanmar`.
- Test interrupting `/api/plan` or CLI mid-run (e.g., simulated `429` or Ctrl+C after chunk 1) and verify re-running skips chunk 0 and resumes at chunk 1 without re-uploading the video.
- Verify output `.mp4` is `1280x720` (16:9), Burmese subtitles render without broken/box glyphs, and original video audio is preserved.
