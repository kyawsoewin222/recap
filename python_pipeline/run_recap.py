import argparse
import asyncio
import json
from pathlib import Path

from checkpoint_store import get_job_dir
from edge_tts_service import generate_edge_tts
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

    clips: list[RecapClip] = []
    if args.video_only:
        print("=== Step 2: Skipping Edge TTS (--video-only mode) ===")
        for c in raw_clips:
            clips.append(
                RecapClip(
                    id=c["id"],
                    source_start=c["source_start"],
                    source_end=c["source_end"],
                    target_duration=9.0,
                    english_script=c["english_script"],
                    burmese_script=c["burmese_script"],
                    audio_path=None,
                )
            )
    else:
        print(f"=== Step 2: Generating Edge TTS ({args.voice}, rate={args.rate}) ===")
        for c in raw_clips:
            mp3_path, dur = await generate_edge_tts(
                clip_id=c["id"],
                text=c["burmese_script"],
                voice_name=args.voice,
                rate=args.rate,
            )
            print(f"  Clip {c['id']:02d}: {dur:.2f}s -> {mp3_path.name}")
            clips.append(
                RecapClip(
                    id=c["id"],
                    source_start=c["source_start"],
                    source_end=c["source_end"],
                    target_duration=dur + 0.4,
                    english_script=c["english_script"],
                    burmese_script=c["burmese_script"],
                    audio_path=str(mp3_path),
                )
            )

    print("=== Step 3: Rendering 16:9 MP4 + Burmese Subtitles ===")
    result = render_16x9_recap(
        source_video_path=args.video,
        clips=clips,
        job_id=job_id,
        include_subtitles=not args.no_subtitles,
        mask_bottom_subtitles=not args.no_mask,
        original_audio_volume=args.orig_vol,
        voiceover_volume=args.vo_vol,
        auto_duck_original_audio=not args.no_duck,
        video_only=args.video_only,
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
    parser.add_argument("--voice", default="my-MM-ThihaNeural", choices=["my-MM-ThihaNeural", "my-MM-NilarNeural"])
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--video-only", action="store_true", help="Skip TTS and export video + original audio + script only")
    parser.add_argument("--orig-vol", type=float, default=0.35, help="Original video audio volume (0.0 - 1.5)")
    parser.add_argument("--vo-vol", type=float, default=1.15, help="Edge TTS voiceover volume")
    parser.add_argument("--no-duck", action="store_true", help="Disable sidechain auto-ducking of original audio")
    parser.add_argument("--no-subtitles", action="store_true", help="Do not burn in Burmese subtitles")
    parser.add_argument("--no-mask", action="store_true", help="Do not draw bottom dark scrim")
    args = parser.parse_args()

    asyncio.run(run_pipeline(args))


if __name__ == "__main__":
    main()
