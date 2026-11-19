import asyncio
import hashlib
import subprocess
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
        return val if val > 0 else 8.5
    except ValueError:
        return 8.5


async def generate_edge_tts(
    clip_id: int,
    text: str,
    voice_name: str = "my-MM-ThihaNeural",
    rate: str = "+12%",
    max_retries: int = 4,
) -> tuple[Path, float]:
    """Generates Burmese speech with Edge TTS, cached by content hash + retry on transient errors."""
    voice = voice_name if voice_name in BURMESE_VOICES else "my-MM-ThihaNeural"
    digest = hashlib.sha1(f"{voice}:{rate}:{text.strip()}".encode("utf-8")).hexdigest()[:12]
    out_mp3 = TTS_DIR / f"clip-{clip_id}-{digest}.mp3"

    if out_mp3.exists() and out_mp3.stat().st_size > 1000:
        return out_mp3, probe_duration(out_mp3)

    for attempt in range(max_retries + 1):
        try:
            tmp_mp3 = TTS_DIR / f"clip-{clip_id}-{digest}.tmp.mp3"
            communicate = edge_tts.Communicate(
                text=text.strip(),
                voice=voice,
                rate=rate,
            )
            await communicate.save(str(tmp_mp3))
            tmp_mp3.replace(out_mp3)
            return out_mp3, probe_duration(out_mp3)
        except Exception:
            if attempt == max_retries:
                raise
            await asyncio.sleep(2.0 * (2 ** attempt))

    raise RuntimeError("Edge TTS failed after retries")
