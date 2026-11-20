from typing import Optional
from pydantic import BaseModel


class RecapClip(BaseModel):
    id: int
    source_start: float
    source_end: float
    target_duration: float = 9.0
    english_script: str
    burmese_script: str
    audio_path: Optional[str] = None


class GeneratePlanRequest(BaseModel):
    source_video_path: str
    job_id: Optional[str] = None
    chunk_minutes: int = 20
    fps: float = 0.5
    low_res_upload: bool = True
    strip_audio_in_proxy: bool = False
    free_tier_delay_sec: float = 25.0


class EdgeTTSRequest(BaseModel):
    clip_id: int
    text: str
    voice_name: str = "my-MM-ThihaNeural"  # or "my-MM-NilarNeural"
    rate: str = "+0%"


class RenderRequest(BaseModel):
    video_only: bool = False
    source_video_path: str
    clips: list[RecapClip]
    job_id: Optional[str] = None
    include_subtitles: bool = True
    mask_bottom_subtitles: bool = True
    original_audio_volume: float = 0.35
    voiceover_volume: float = 1.15
    auto_duck_original_audio: bool = True
