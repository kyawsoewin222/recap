"""Measured narration timing; fallback subtitles are explicitly approximate."""
import math
import re
import unicodedata

PAUSE_SECONDS = 0.25
MIN_VIDEO_SPEED = 0.85
MAX_VIDEO_SPEED = 1.15


def narration_timing(source_start: float, source_end: float, audio_duration: float) -> tuple[float, float]:
    if not all(math.isfinite(value) for value in (source_start, source_end, audio_duration)):
        raise ValueError("Source and audio durations must be finite.")
    if source_start < 0 or source_end <= source_start or audio_duration <= 0:
        raise ValueError("Source range and measured narration duration must be positive.")
    duration = math.ceil((audio_duration + PAUSE_SECONDS) * 25) / 25
    speed = (source_end - source_start) / duration
    if not MIN_VIDEO_SPEED <= speed <= MAX_VIDEO_SPEED:
        raise ValueError(
            f"Needs review: {audio_duration:.2f}s narration needs {duration:.2f}s video, "
            f"but the selected scene needs {speed:.2f}x speed (allowed 0.85x–1.15x). "
            "Select more relevant footage or shorten wording without losing meaning."
        )
    return duration, speed


def approximate_subtitles(text: str, audio_duration: float) -> list[tuple[float, float, str]]:
    # shortcut: phrase durations are approximate; replace with speech alignment when available.
    # Split only at existing phrase/word boundaries, never inside Myanmar combining sequences.
    units = re.findall(r"[^\s၊။!?]+[၊။!?]*|[၊။!?]+", text.strip())
    if not units or not math.isfinite(audio_duration) or audio_duration <= 0:
        raise ValueError("Subtitles need narration text and a positive measured audio duration.")
    phrases: list[str] = []
    current = ""
    for unit in units:
        candidate = f"{current} {unit}".strip()
        if current and len(candidate) > 64:
            phrases.append(current)
            current = unit
        else:
            current = candidate
        if current.endswith(("၊", "။", "!", "?")):
            phrases.append(current)
            current = ""
    if current:
        phrases.append(current)
    # Avoid flashing tiny fragments by combining them with a neighbor.
    while len(phrases) > 1:
        shortest = min(range(len(phrases)), key=lambda i: len(phrases[i]))
        if audio_duration * len(phrases[shortest]) / sum(map(len, phrases)) >= 1.0:
            break
        neighbor = shortest - 1 if shortest else 1
        first, second = sorted((shortest, neighbor))
        phrases[first:second + 1] = [" ".join(phrases[first:second + 1])]
    if any(len(phrase) > 128 for phrase in phrases):
        raise ValueError("Needs subtitle review: add natural Burmese phrase boundaries (spaces or punctuation) to the long narration before generating audio again.")
    weights = [len(phrase) for phrase in phrases]
    total = sum(weights)
    cursor = 0.0
    cues = []
    for phrase, weight in zip(phrases, weights):
        end = min(audio_duration, cursor + audio_duration * weight / total)
        cues.append((cursor, end, phrase))
        cursor = end
    return cues


def subtitle_cues(text: str, audio_duration: float, boundaries: list[dict]) -> tuple[list[tuple[float, float, str]], str]:
    """Use native TTS boundaries only when they cover the narration without altering it."""
    cues = []
    previous_end = 0.0
    for boundary in boundaries:
        try:
            start = float(boundary["offset"]) / 10_000_000
            end = start + float(boundary["duration"]) / 10_000_000
            phrase = str(boundary["text"]).strip()
        except (KeyError, TypeError, ValueError):
            return approximate_subtitles(text, audio_duration), "approximate"
        if (not math.isfinite(start) or not math.isfinite(end) or start < previous_end or
                end <= start or end > audio_duration or not phrase or len(phrase) > 128 or
                unicodedata.category(phrase[0]).startswith("M") or phrase.endswith("\u1039")):
            return approximate_subtitles(text, audio_duration), "approximate"
        if cues and (end - cues[-1][0] < 1.0 or (start - cues[-1][1] < 0.3 and len(cues[-1][2]) + len(phrase) < 64)):
            old_start, _, old_text = cues[-1]
            cues[-1] = (old_start, end, old_text + " " + phrase)
        else:
            cues.append((start, end, phrase))
        previous_end = end
    compact = lambda value: "".join(value.split())
    if cues and compact("".join(cue[2] for cue in cues)) == compact(text):
        return cues, "tts-boundaries"
    return approximate_subtitles(text, audio_duration), "approximate"
