import argparse
import asyncio
import json
from pathlib import Path

from checkpoint_store import get_job_dir
from gemini_script_service import generate_resumable_recap_plan
from models import RecapClip
from video_renderer import render_16x9_recap


async def run_pipeline(args: argparse.Namespace) -> None:
    print(f"=== Step 1: Generating / Resuming Recap Script for {args.video} ===")
    plan = generate_resumable_recap_plan(
        source_video_path=args.video,
        chunk_minutes=args.chunk_minutes,
        fps=args.fps,
        low_res_upload=not args.full_res_upload,
        strip_audio_in_proxy=args.strip_audio,
        free_tier_delay_sec=args.delay,
    )

    job_id = plan["job_id"]
    job_dir = get_job_dir(job_id)
    raw_clips = plan["clips"]

    # Save JSON + plain Burmese script for reference
    (job_dir / "script.json").write_text(
        json.dumps(raw_clips, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (job_dir / "script_burmese.txt").write_text(
        "\n\n".join(
            f"[{c['id']:02d}] ({c['source_start']:.1f}s - {c['source_end']:.1f}s)\n{c['burmese_script']}"
            for c in raw_clips
        ),
        encoding="utf-8",
    )
    print(f"Saved {len(raw_clips)} clips to {job_dir / 'script.json'}")

    clips = [
        RecapClip(
            id=c["id"], source_start=c["source_start"], source_end=c["source_end"],
            english_script=c["english_script"], burmese_script=c["burmese_script"],
        )
        for c in raw_clips
    ]

    print("=== Step 3: Rendering 16:9 MP4 + Burmese Subtitles ===")
    result = render_16x9_recap(
        source_video_path=args.video,
        clips=clips,
        job_id=job_id,
        include_subtitles=not args.no_subtitles,
        mask_bottom_subtitles=not args.no_mask,
        original_audio_volume=args.orig_vol,
    )

    print("\n=== DONE ===")
    print(f"Job ID:   {result['job_id']}")
    print(f"Video:    {result['video_path']}")
    print(f"SRT:      {result['srt_path']}")
    print(f"Duration: {result['duration_sec']:.1f}s ({result['width']}x{result['height']})")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="End-to-end 16:9 Burmese Movie Recap CLI (Resumable)"
    )
    parser.add_argument("--video", required=True, help="Path to source MP4 movie")
    parser.add_argument("--chunk-minutes", type=int, default=20)
    parser.add_argument("--fps", type=float, default=0.5)
    parser.add_argument("--delay", type=float, default=25.0, help="Seconds between chunks")
    parser.add_argument("--full-res-upload", action="store_true")
    parser.add_argument("--strip-audio", action="store_true", help="Strip audio from Gemini upload proxy to save ~50% tokens")
    parser.add_argument("--orig-vol", type=float, default=1.0, help="Original video audio volume (0.0 - 1.5)")
    parser.add_argument("--no-subtitles", action="store_true", help="Do not burn in Burmese subtitles")
    parser.add_argument("--no-mask", action="store_true", help="Do not draw bottom dark scrim")
    args = parser.parse_args()

    asyncio.run(run_pipeline(args))


if __name__ == "__main__":
    main()
