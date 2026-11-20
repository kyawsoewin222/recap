import re
import json
import math
import tempfile
import warnings
import subprocess
import time
from pathlib import Path

from checkpoint_store import build_job_id, get_job_dir
from edge_tts_service import probe_duration
from models import RecapClip
from timing import narration_timing, subtitle_cues

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
    video_only: bool = False,
) -> dict:
    src_path = Path(source_video_path)
    if not src_path.exists():
        raise FileNotFoundError(f"Source video not found: {src_path}")

    resolved_job_id = job_id or build_job_id(source_video_path, 20)
    if not clips:
        raise ValueError("At least one recap clip is required.")
    # Fresh render directories prevent script/audio/settings edits reusing stale segments.
    work_dir = Path(tempfile.mkdtemp(prefix="render-", dir=get_job_dir(resolved_job_id)))
    seg_dir = work_dir / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)

    segment_paths: list[Path] = []
    subtitle_timings: list[tuple[float, float, str]] = []
    cumulative_time = 0.0

    planned_segments = []
    timing_modes = set()
    previous_end = 0.0
    source_duration = probe_duration(src_path)
    for clip in clips:
        if (not math.isfinite(clip.source_start) or not math.isfinite(clip.source_end) or
                clip.source_start < previous_end or clip.source_end <= clip.source_start or
                clip.source_end > source_duration):
            raise ValueError(f"Clip {clip.id}: source range overlaps or is outside the source video.")
        previous_end = clip.source_end
        local_audio = Path(clip.audio_path) if clip.audio_path else None
        if local_audio is None or not local_audio.is_file():
            if not video_only:
                raise ValueError(f"Clip {clip.id}: narration is missing. Generate audio before rendering.")
            duration = clip.source_end - clip.source_start
            if duration <= 0:
                raise ValueError(f"Clip {clip.id}: source end must follow source start.")
            planned_segments.append((clip, None, duration, 1.0, []))
            continue
        metadata_path = local_audio.with_suffix(".json")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        if metadata.get("text") != clip.burmese_script.strip():
            raise ValueError(f"Clip {clip.id}: narration changed or audio is unverified. Regenerate narration.")
        audio_duration = probe_duration(local_audio)
        try:
            duration, speed = narration_timing(clip.source_start, clip.source_end, audio_duration)
        except ValueError as exc:
            raise ValueError(f"Clip {clip.id}: {exc}") from exc
        cues, timing_mode = subtitle_cues(clip.burmese_script, audio_duration, metadata.get("boundaries", []))
        timing_modes.add(timing_mode)
        planned_segments.append((clip, local_audio, duration, speed, cues))
    if "approximate" in timing_modes:
        warnings.warn("Subtitle phrase timing is approximate, based on text length, not speech alignment; review the sample.", stacklevel=2)

    if include_subtitles:
        filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, check=True)
        if not re.search(r"\bass\s+V->V", filters.stdout):
            raise RuntimeError("Burned-in subtitles need FFmpeg with libass. Install a libass-enabled FFmpeg or render with --no-subtitles / include_subtitles=false; the SRT will still be exported.")

    for idx, (clip, local_audio, clip_duration, speed, cues) in enumerate(planned_segments):
        src_start = clip.source_start
        raw_src_dur = clip.source_end - src_start
        seg_out = seg_dir / f"seg-{idx:03d}.mp4"
        seg_tmp = seg_dir / f"seg-{idx:03d}.tmp.mp4"
        speed_ratio = 1.0 / speed
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
        subtitle_timings.extend(
            (cumulative_time + start, cumulative_time + end, text)
            for start, end, text in cues
        )
        actual_duration = probe_duration(seg_out)
        if local_audio and actual_duration < clip_duration - 0.1:
            raise RuntimeError(f"Clip {clip.id}: rendered segment is shorter than the narration plan; review the source range.")
        cumulative_time += clip_duration

    concat_list = work_dir / "concat.txt"
    concat_list.write_text(
        "\n".join(
            f"file '{segment.resolve().as_posix()}'\nduration {planned[2]:.6f}"
            for segment, planned in zip(segment_paths, planned_segments)
        ),
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
            "-t", f"{cumulative_time:.6f}",
            str(merged_raw),
        ],
        check=True,
    )

    episode = re.search(r"(?:part|episode|ep)[_ -]*(\d+)", src_path.stem, re.IGNORECASE)
    name = f"part{episode.group(1)}" if episode else f"burmese-recap-16x9-{int(time.time() * 1000)}"
    final_mp4 = RENDERS_DIR / f"{name}.mp4"
    final_srt = RENDERS_DIR / f"{name}.srt"
    temp_mp4 = work_dir / f"{name}.mp4"
    temp_srt = work_dir / f"{name}.srt"

    srt_lines = [
        f"{i + 1}\n{format_srt_time(start)} --> {format_srt_time(end)}\n{text}\n"
        for i, (start, end, text) in enumerate(subtitle_timings)
    ]
    temp_srt.write_text("\n".join(srt_lines), encoding="utf-8")

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
                "-t", f"{cumulative_time:.6f}",
                "-movflags", "+faststart",
                str(temp_mp4.resolve()),
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
                "-t", f"{cumulative_time:.6f}",
                "-movflags", "+faststart",
                str(temp_mp4),
            ],
            check=True,
        )

    temp_mp4.replace(final_mp4)
    temp_srt.replace(final_srt)

    return {
        "job_id": resolved_job_id,
        "video_path": str(final_mp4),
        "srt_path": str(final_srt),
        "duration_sec": probe_duration(final_mp4),
        "file_size_bytes": final_mp4.stat().st_size,
        "width": 1280,
        "height": 720,
        "subtitle_timing": "approximate" if "approximate" in timing_modes else "tts-boundaries" if timing_modes else "none",
        "warnings": ["Subtitles use approximate phrase timing; review against the spoken audio."] if "approximate" in timing_modes else [],
    }
