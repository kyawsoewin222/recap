import asyncio
import hashlib
import json
import math
import subprocess
import sys
import uuid
from pathlib import Path
import edge_tts

TTS_DIR = Path("storage/tts")
TTS_DIR.mkdir(parents=True, exist_ok=True)

BURMESE_VOICES = {"my-MM-ThihaNeural", "my-MM-NilarNeural"}


def probe_duration(file_path: str | Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    try:
        val = float(result.stdout.strip())
        if not math.isfinite(val) or val <= 0:
            raise ValueError("duration must be finite and positive")
        return val
    except ValueError as exc:
        raise ValueError(f"Could not measure audio/video duration: {file_path}") from exc


async def generate_edge_tts(
    clip_id: int,
    text: str,
    voice_name: str = "my-MM-ThihaNeural",
    rate: str = "+0%",
    max_retries: int = 4,
    output_dir: Path = TTS_DIR,
) -> tuple[Path, float]:
    """Generates Burmese speech with Edge TTS, cached by content hash + retry on transient errors."""
    if not text.strip():
        raise ValueError("Narration text is required.")
    if rate != "+0%":
        raise ValueError("Use +0% for natural narration; adjust the selected scene instead of speech speed.")
    output_dir.mkdir(parents=True, exist_ok=True)
    voice = voice_name if voice_name in BURMESE_VOICES else "my-MM-ThihaNeural"
    digest = hashlib.sha1(f"{voice}:{rate}:{text.strip()}".encode("utf-8")).hexdigest()[:12]
    out_mp3 = output_dir / f"clip-{clip_id}-{digest}.mp3"

    metadata_path = out_mp3.with_suffix(".json")
    if (out_mp3.exists() and out_mp3.stat().st_size > 1000 and metadata_path.exists()
            and (cached := json.loads(metadata_path.read_text(encoding="utf-8"))).get("text") == text.strip()
            and cached.get("boundary_type") == "WordBoundary"):
        return out_mp3, probe_duration(out_mp3)

    for attempt in range(max_retries + 1):
        tmp_mp3 = output_dir / f".{uuid.uuid4().hex}.tmp.mp3"
        tmp_metadata = tmp_mp3.with_suffix(".jsonl")
        try:
            communicate = edge_tts.Communicate(
                text=text.strip(),
                voice=voice,
                rate=rate,
                boundary="WordBoundary",
            )
            await communicate.save(str(tmp_mp3), str(tmp_metadata))
            duration = probe_duration(tmp_mp3)
            tmp_mp3.replace(out_mp3)
            boundaries = [json.loads(line) for line in tmp_metadata.read_text(encoding="utf-8").splitlines() if line.strip()]
            metadata_path.write_text(json.dumps({"text": text.strip(), "duration_sec": duration,
                                                 "boundary_type": "WordBoundary", "boundaries": boundaries}, ensure_ascii=False), encoding="utf-8")
            return out_mp3, duration
        except Exception:
            if attempt == max_retries:
                raise
            await asyncio.sleep(2.0 * (2 ** attempt))
        finally:
            tmp_mp3.unlink(missing_ok=True)
            tmp_metadata.unlink(missing_ok=True)

    raise RuntimeError("Edge TTS failed after retries")


if __name__ == "__main__":
    clip_id, voice, directory = sys.argv[1:]
    path, _ = asyncio.run(
        generate_edge_tts(
            int(clip_id), sys.stdin.buffer.read().decode("utf-8"),
            voice, rate="+0%", output_dir=Path(directory),
        )
    )
    print(path.name)
