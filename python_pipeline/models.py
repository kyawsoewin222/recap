from typing import Optional
from pydantic import BaseModel


class RecapClip(BaseModel):
    id: int
    source_start: float
    source_end: float
    target_duration: float = 9.0
    english_script: str
    burmese_script: str


class GeneratePlanRequest(BaseModel):
    source_video_path: str
    job_id: Optional[str] = None
    chunk_minutes: int = 20
    fps: float = 0.5
    low_res_upload: bool = True
    strip_audio_in_proxy: bool = False
    free_tier_delay_sec: float = 25.0
    provider: Optional[str] = None  # "auto" | "agy" | "gemini"


class RenderRequest(BaseModel):
    source_video_path: str
    clips: list[RecapClip]
    job_id: Optional[str] = None
    include_subtitles: bool = True
    mask_bottom_subtitles: bool = True
    original_audio_volume: float = 1.0
