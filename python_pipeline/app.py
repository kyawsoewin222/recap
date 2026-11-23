from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from checkpoint_store import load_checkpoint
from gemini_script_service import generate_resumable_recap_plan
from models import GeneratePlanRequest, RenderRequest
from video_renderer import render_16x9_recap

app = FastAPI(title="Burmese 16:9 Recap Studio (Resumable Pipeline)")
app.mount("/storage", StaticFiles(directory="storage"), name="storage")


@app.post("/api/plan")
def create_or_resume_plan(req: GeneratePlanRequest):
    try:
        return generate_resumable_recap_plan(
            source_video_path=req.source_video_path,
            job_id=req.job_id,
            chunk_minutes=req.chunk_minutes,
            fps=req.fps,
            low_res_upload=req.low_res_upload,
            strip_audio_in_proxy=req.strip_audio_in_proxy,
            free_tier_delay_sec=req.free_tier_delay_sec,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/jobs/{job_id}")
def get_job_checkpoint(job_id: str):
    state = load_checkpoint(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job checkpoint not found.")
    return state


@app.post("/api/render")
def render_video(req: RenderRequest):
    try:
        return render_16x9_recap(
            source_video_path=req.source_video_path,
            clips=req.clips,
            job_id=req.job_id,
            include_subtitles=req.include_subtitles,
            mask_bottom_subtitles=req.mask_bottom_subtitles,
            original_audio_volume=req.original_audio_volume,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
