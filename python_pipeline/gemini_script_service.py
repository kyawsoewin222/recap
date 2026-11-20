import json
import os
import random
import subprocess
import time
from pathlib import Path
from typing import Callable, TypeVar

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from checkpoint_store import build_job_id, get_job_dir, load_checkpoint, save_checkpoint

T = TypeVar("T")


class GeneratedClipPlan(BaseModel):
    id: int
    source_start: float
    source_end: float
    english_script: str
    burmese_script: str


class ChunkPlanResult(BaseModel):
    chunk_summary: str
    clips: list[GeneratedClipPlan]


def get_client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set.")
    return genai.Client(api_key=api_key)


def probe_video_duration(video_path: str | Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def build_lowres_proxy(
    source_path: Path,
    proxy_path: Path,
    strip_audio: bool = False,
) -> Path:
    """Shrinks a large 2-hour HD movie into a tiny 360p file for fast Gemini upload."""
    if proxy_path.exists() and proxy_path.stat().st_size > 10_000:
        return proxy_path

    audio_args = ["-an"] if strip_audio else ["-c:a", "aac", "-b:a", "48k"]
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(source_path),
            "-vf", "scale=640:-2",
            "-r", "2",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "32",
            *audio_args,
            str(proxy_path),
        ],
        check=True,
    )
    return proxy_path


def call_with_retry(fn: Callable[[], T], max_retries: int = 5) -> T:
    """
    Retries on transient 429 (rate limit / TPM) and 503 / 500 (service overload)
    with exponential backoff + jitter.
    """
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except genai_errors.APIError as exc:
            code = getattr(exc, "code", None)
            is_retryable = code in (429, 500, 503, 504)
            if not is_retryable or attempt == max_retries:
                raise

            # 429 TPM rate limits usually recover after ~60s; 503 recovers faster
            base_wait = 62.0 if code == 429 else 8.0 * (2 ** attempt)
            jitter = random.uniform(1.0, 5.0)
            wait_sec = min(180.0, base_wait + jitter)
            print(
                f"[Gemini {code}] Transient error on attempt {attempt + 1}/{max_retries}. "
                f"Retrying in {wait_sec:.1f}s..."
            )
            time.sleep(wait_sec)
        except Exception:
            if attempt == max_retries:
                raise
            wait_sec = min(60.0, 6.0 * (2 ** attempt))
            time.sleep(wait_sec)

    raise RuntimeError("Exceeded max retries")


def ensure_gemini_file_active(
    client: genai.Client,
    upload_path: Path,
    job_id: str,
    state: dict,
) -> tuple[str, str, str]:
    """Reuses an already-uploaded Gemini file URI if still ACTIVE (<48h), else uploads."""
    existing_name = state.get("gemini_file_name")
    if existing_name:
        try:
            existing = client.files.get(name=existing_name)
            if getattr(existing.state, "name", None) == "ACTIVE":
                return existing.name, existing.uri, existing.mime_type
        except Exception:
            pass

    video_file = call_with_retry(lambda: client.files.upload(file=str(upload_path)))
    while getattr(video_file.state, "name", None) == "PROCESSING":
        time.sleep(3)
        video_file = client.files.get(name=video_file.name)

    if getattr(video_file.state, "name", None) != "ACTIVE":
        raise RuntimeError(f"Gemini video processing failed: {video_file.state}")

    state["gemini_file_name"] = video_file.name
    state["gemini_file_uri"] = video_file.uri
    state["gemini_file_mime"] = video_file.mime_type
    save_checkpoint(job_id, state)
    return video_file.name, video_file.uri, video_file.mime_type


def generate_resumable_recap_plan(
    source_video_path: str,
    job_id: str | None = None,
    chunk_minutes: int = 20,
    fps: float = 0.5,
    low_res_upload: bool = True,
    strip_audio_in_proxy: bool = False,
    free_tier_delay_sec: float = 25.0,
) -> dict:
    src_path = Path(source_video_path)
    if not src_path.exists():
        raise FileNotFoundError(f"Source video not found: {src_path}")

    resolved_job_id = job_id or build_job_id(source_video_path, chunk_minutes)
    job_dir = get_job_dir(resolved_job_id)

    state = load_checkpoint(resolved_job_id)
    if not state:
        total_duration = probe_video_duration(src_path)
        state = {
            "job_id": resolved_job_id,
            "source_video_path": str(src_path),
            "total_duration_sec": total_duration,
            "chunk_seconds": chunk_minutes * 60,
            "chunks": {},
            "story_so_far": "Opening of the movie.",
            "completed": False,
        }
        save_checkpoint(resolved_job_id, state)

    upload_path = src_path
    if low_res_upload:
        proxy_name = "proxy_360p_noaudio.mp4" if strip_audio_in_proxy else "proxy_360p.mp4"
        proxy_path = job_dir / proxy_name
        upload_path = build_lowres_proxy(
            src_path, proxy_path, strip_audio=strip_audio_in_proxy
        )
        state["proxy_video_path"] = str(upload_path)
        save_checkpoint(resolved_job_id, state)

    client = get_client()
    _, file_uri, file_mime = ensure_gemini_file_active(
        client, upload_path, resolved_job_id, state
    )

    total_sec = int(state["total_duration_sec"])
    chunk_sec = int(state["chunk_seconds"])
    ranges = [
        (start, min(start + chunk_sec, total_sec))
        for start in range(0, total_sec, chunk_sec)
    ]

    for idx, (start, end) in enumerate(ranges):
        chunk_key = str(idx)
        if chunk_key in state["chunks"]:
            print(f"[Checkpoint] Skipping already-completed chunk {idx + 1}/{len(ranges)} ({start}s-{end}s)")
            continue

        story_so_far = state.get("story_so_far", "Opening of the movie.")
        prompt = f"""
You are a viral YouTube movie recap storyteller.
Analyze ONLY the segment from {start}s to {end}s of this movie.

Previous story context:
{story_so_far}

Rules:
- Break this segment into fast-paced sequential clips covering key plot & action beats.
- Use absolute movie timestamps in seconds (`source_start`, `source_end`) within [{start}, {end}].
- Prefer concise natural Burmese narration; short durations are preferences, never hard caps.
- Remove repetition only. Preserve identities, actions, motivations, cause/effect, outcomes, dialogue meaning, reveals, and chronology; invent no facts.
- Compare narration against the source context and English script before returning it. Use longer relevant scene ranges when essential meaning needs longer narration.
- Choose complete relevant action spans in chronological order; never borrow unrelated scenes.
- Do NOT copy or translate movie dialogue verbatim; summarize in completely original wording.
- Return `english_script` and natural, engaging spoken Burmese in `burmese_script`.
- Also return a 2-3 sentence `chunk_summary` to pass continuity to the next segment.
"""

        def _invoke():
            return client.models.generate_content(
                model="gemini-4-hydrogen",
                contents=[
                    types.Part.from_uri(
                        file_uri=file_uri,
                        mime_type=file_mime,
                        video_metadata=types.VideoMetadata(
                            start_offset=f"{start}s",
                            end_offset=f"{end}s",
                            fps=fps,
                        ),
                    ),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW,
                    response_mime_type="application/json",
                    response_schema=ChunkPlanResult,
                ),
            )

        print(f"[Gemini] Processing chunk {idx + 1}/{len(ranges)} ({start}s-{end}s)...")
        response = call_with_retry(_invoke, max_retries=5)
        parsed = json.loads(response.text)

        state["chunks"][chunk_key] = parsed.get("clips", [])
        if parsed.get("chunk_summary"):
            state["story_so_far"] = (
                f"{story_so_far} {parsed['chunk_summary']}".strip()[-1500:]
            )
        save_checkpoint(resolved_job_id, state)

        if free_tier_delay_sec > 0 and idx < len(ranges) - 1:
            time.sleep(free_tier_delay_sec)

    # Flatten and re-number clip IDs cleanly across all chunks
    all_clips = []
    next_id = 1
    for idx in range(len(ranges)):
        for clip in state["chunks"].get(str(idx), []):
            clip_copy = dict(clip)
            clip_copy["id"] = next_id
            next_id += 1
            all_clips.append(clip_copy)

    state["completed"] = True
    save_checkpoint(resolved_job_id, state)

    return {
        "job_id": resolved_job_id,
        "total_chunks": len(ranges),
        "clips": all_clips,
    }
