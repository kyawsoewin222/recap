import subprocess
import time
from pathlib import Path

from checkpoint_store import build_job_id, get_job_dir
from edge_tts_service import probe_duration
from models import RecapClip

RENDERS_DIR = Path("storage/renders")
RENDERS_DIR.mkdir(parents=True, exist_ok=True)


def format_ass_time(seconds: float) -> str:
    clamped = max(0.0, seconds)
    h = int(clamped // 3600)
    m = int((clamped % 3600) // 60)
    s = int(clamped % 60)
    cs = int((clamped - int(clamped)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def format_srt_time(seconds: float) -> str:
    clamped = max(0.0, seconds)
    h = int(clamped // 3600)
    m = int((clamped % 3600) // 60)
    s = int(clamped % 60)
    ms = int((clamped - int(clamped)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def escape_ass_text(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\r\n", "\\N")
        .replace("\n", "\\N")
        .strip()
    )


def render_16x9_recap(
    source_video_path: str,
    clips: list[RecapClip],
    job_id: str | None = None,
    include_subtitles: bool = True,
    mask_bottom_subtitles: bool = True,
    original_audio_volume: float = 0.35,
    voiceover_volume: float = 1.15,
    auto_duck_original_audio: bool = True,
) -> dict:
    src_path = Path(source_video_path)
    if not src_path.exists():
        raise FileNotFoundError(f"Source video not found: {src_path}")

    resolved_job_id = job_id or build_job_id(source_video_path, 20)
    work_dir = get_job_dir(resolved_job_id) / "render_cache"
    seg_dir = work_dir / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)

    segment_paths: list[Path] = []
    subtitle_timings: list[tuple[float, float, str]] = []
    cumulative_time = 0.0

    for idx, clip in enumerate(clips):
        src_start = max(0.0, clip.source_start)
        src_end = max(src_start + 1.0, clip.source_end)
        raw_src_dur = src_end - src_start

        local_audio: Path | None = None
        clip_duration = max(4.0, clip.target_duration)

        if clip.audio_path and Path(clip.audio_path).exists():
            local_audio = Path(clip.audio_path)
            tts_dur = probe_duration(local_audio)
            clip_duration = max(4.5, min(16.0, tts_dur + 0.40))

        seg_out = seg_dir / f"seg-{idx:03d}.mp4"
        seg_tmp = seg_dir / f"seg-{idx:03d}.tmp.mp4"

        # Segment-level checkpoint: skip if already rendered cleanly
        if seg_out.exists() and seg_out.stat().st_size > 10_000:
            actual_dur = probe_duration(seg_out)
            segment_paths.append(seg_out)
            subtitle_timings.append(
                (cumulative_time, cumulative_time + actual_dur - 0.08, clip.burmese_script.strip())
            )
            cumulative_time += actual_dur
            continue

        speed_ratio = clip_duration / raw_src_dur
        video_filters = [
            "scale=1280:720:force_original_aspect_ratio=increase",
            "crop=1280:720",
            "fps=25",
            f"setpts={speed_ratio:.6f}*PTS",
        ]
        if mask_bottom_subtitles:
            video_filters.append(
                "drawbox=x=0:y=592:w=1280:h=128:color=black@0.82:t=fill"
            )

        args = [
            "ffmpeg", "-y",
            "-ss", f"{src_start:.3f}",
            "-t", f"{raw_src_dur:.3f}",
            "-i", str(src_path),
        ]
        if local_audio:
            args.extend(["-i", str(local_audio)])

        bg_vol = max(0.0, min(1.5, original_audio_volume))
        vo_vol = max(0.0, min(2.0, voiceover_volume))
        tempo = 1.0 / speed_ratio

        filter_parts = [f"[0:v]{','.join(video_filters)}[vout]"]

        bg_filters = []
        if 0.5 <= tempo <= 2.0:
            bg_filters.append(f"atempo={tempo:.4f}")
        bg_filters.extend([
            f"volume={bg_vol:.2f}",
            "aformat=sample_rates=48000:channel_layouts=stereo",
            f"apad=whole_dur={clip_duration:.3f}",
            f"atrim=duration={clip_duration:.3f}",
        ])

        if local_audio:
            filter_parts.append(f"[0:a]{','.join(bg_filters)}[bg]")
            filter_parts.append(
                f"[1:a]volume={vo_vol:.2f},"
                "aformat=sample_rates=48000:channel_layouts=stereo,"
                f"apad=whole_dur={clip_duration:.3f},"
                f"atrim=duration={clip_duration:.3f}[vo_raw]"
            )
            if auto_duck_original_audio:
                filter_parts.append("[vo_raw]asplit=2[vo_sc][vo_mix]")
                filter_parts.append(
                    "[bg][vo_sc]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=350[bg_ducked]"
                )
                filter_parts.append(
                    "[bg_ducked][vo_mix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"
                )
            else:
                filter_parts.append(
                    "[bg][vo_raw]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"
                )
        else:
            filter_parts.append(f"[0:a]{','.join(bg_filters)}[aout]")

        args.extend([
            "-filter_complex", ";".join(filter_parts),
            "-map", "[vout]",
            "-map", "[aout]",
            "-t", f"{clip_duration:.3f}",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "21",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            str(seg_tmp),
        ])

        subprocess.run(args, check=True)
        seg_tmp.replace(seg_out)

        segment_paths.append(seg_out)
        subtitle_timings.append(
            (cumulative_time, cumulative_time + clip_duration - 0.08, clip.burmese_script.strip())
        )
        cumulative_time += clip_duration

    concat_list = work_dir / "concat.txt"
    concat_list.write_text(
        "\n".join(f"file '{p.resolve().as_posix()}'" for p in segment_paths),
        encoding="utf-8",
    )

    merged_raw = work_dir / "merged.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_list),
            "-c", "copy",
            str(merged_raw),
        ],
        check=True,
    )

    stamp = int(time.time() * 1000)
    final_mp4 = RENDERS_DIR / f"burmese-recap-16x9-{stamp}.mp4"
    final_srt = RENDERS_DIR / f"burmese-recap-16x9-{stamp}.srt"

    srt_lines = [
        f"{i + 1}\n{format_srt_time(start)} --> {format_srt_time(end)}\n{text}\n"
        for i, (start, end, text) in enumerate(subtitle_timings)
    ]
    final_srt.write_text("\n".join(srt_lines), encoding="utf-8")

    if include_subtitles:
        ass_header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: BurmeseMain,Noto Sans Myanmar,28,&H00FFFFFF,&H000000FF,&H000A0D14,&H880A0D14,-1,0,0,0,100,100,0,0,1,2.2,1.2,2,64,64,26,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        ass_events = "\n".join(
            f"Dialogue: 0,{format_ass_time(start)},{format_ass_time(end)},BurmeseMain,,0,0,0,,{escape_ass_text(text)}"
            for start, end, text in subtitle_timings
        )
        (work_dir / "subtitles.ass").write_text(
            ass_header + ass_events, encoding="utf-8"
        )

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(merged_raw.resolve()),
                "-vf", "ass=subtitles.ass",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "20",
                "-pix_fmt", "yuv420p",
                "-c:a", "copy",
                "-movflags", "+faststart",
                str(final_mp4.resolve()),
            ],
            cwd=str(work_dir),
            check=True,
        )
    else:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(merged_raw),
                "-c", "copy",
                "-movflags", "+faststart",
                str(final_mp4),
            ],
            check=True,
        )

    return {
        "job_id": resolved_job_id,
        "video_path": str(final_mp4),
        "srt_path": str(final_srt),
        "duration_sec": probe_duration(final_mp4),
        "file_size_bytes": final_mp4.stat().st_size,
        "width": 1280,
        "height": 720,
    }
