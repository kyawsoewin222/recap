import hashlib
import json
import os
from pathlib import Path
from typing import Any

JOBS_DIR = Path("storage/jobs")
JOBS_DIR.mkdir(parents=True, exist_ok=True)


def build_job_id(source_video_path: str, chunk_minutes: int = 20) -> str:
    src = Path(source_video_path)
    stat_sig = f"{src.stat().st_size}:{int(src.stat().st_mtime)}" if src.exists() else "missing"
    raw = f"{src.resolve()}:{stat_sig}:{chunk_minutes}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def get_job_dir(job_id: str) -> Path:
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def load_checkpoint(job_id: str) -> dict[str, Any]:
    ckpt_path = get_job_dir(job_id) / "checkpoint.json"
    if ckpt_path.exists():
        return json.loads(ckpt_path.read_text(encoding="utf-8"))
    return {}


def save_checkpoint(job_id: str, data: dict[str, Any]) -> None:
    """Atomic write (temp file + os.replace) so crashes never corrupt checkpoint.json."""
    job_dir = get_job_dir(job_id)
    ckpt_path = job_dir / "checkpoint.json"
    tmp_path = job_dir / "checkpoint.json.tmp"
    tmp_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp_path, ckpt_path)
